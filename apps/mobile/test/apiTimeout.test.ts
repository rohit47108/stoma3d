import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { fromByteArray } from "base64-js";
import * as Network from "expo-network";
import { CONTRACT_VERSION, DISCLAIMER } from "@stoma3d/contracts";
import { responseSigningMessage } from "../src/lib/responseSignature";

vi.mock("expo-crypto", () => ({ randomUUID: () => "request-timeout-test" }));
vi.mock("expo-file-system", () => ({
  File: class extends Blob {
    constructor(_uri: string) {
      super(["sanitized-test-only"], { type: "image/jpeg" });
    }
  },
}));
vi.mock("expo-network", () => ({
  getNetworkStateAsync: vi.fn(async () => ({ isConnected: true })),
}));
vi.mock("@/constants", () => ({
  API_BASE_URL: "https://inference.stoma3d.test",
}));
vi.mock("@/lib/comparisonPolicy", () => import("../src/lib/comparisonPolicy"));
vi.mock("@/lib/liveInputPolicy", () => import("../src/lib/liveInputPolicy"));
vi.mock(
  "@/lib/responseSignature",
  () => import("../src/lib/responseSignature"),
);
vi.mock(
  "@/lib/transportSecurity",
  () => import("../src/lib/transportSecurity"),
);
vi.mock("@/lib/modelHeadPolicy", () => import("../src/lib/modelHeadPolicy"));

import {
  analyzeCapture,
  compareCaptures,
  fetchModelCard,
} from "../src/lib/api";

// Deterministic test-only key; never used by a deployment.
const signingSeed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const publicKey = ed25519.getPublicKey(signingSeed);
const requestId = "request-timeout-test";
const modelCard = {
  contractVersion: CONTRACT_VERSION,
  serviceVersion: "deadline-test",
  intendedUse: "Test-only model card",
  forbiddenClaims: [],
  modelVersions: {},
  artifactHashes: {},
  enabledHeads: [],
  releaseGates: [],
  limitations: [],
  disclaimer: DISCLAIMER,
};

function signedResponse(body = JSON.stringify(modelCard), status = 200) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
      "x-stoma3d-key-id": bytesToHex(sha256(publicKey)).slice(0, 16),
      "x-stoma3d-signature": fromByteArray(
        ed25519.sign(responseSigningMessage(requestId, body), signingSeed),
      ),
    },
  });
}

describe("mobile inference response deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("__DEV__", false);
    vi.stubEnv(
      "EXPO_PUBLIC_RESPONSE_SIGNING_PUBLIC_KEY_B64",
      fromByteArray(publicKey),
    );
    vi.mocked(Network.getNetworkStateAsync).mockResolvedValue({
      isConnected: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["headers", "body"])(
    "ends a request when %s never arrive, even if transport ignores abort",
    async (stage) => {
      let requestSignal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          requestSignal = init.signal as AbortSignal;
          if (stage === "headers") return new Promise<Response>(() => {});
          const response = new Response(null, {
            headers: {
              "cache-control": "no-store",
              "x-request-id": "request-timeout-test",
            },
          });
          response.text = () => new Promise<string>(() => {});
          return response;
        }),
      );
      let failure: Error | undefined;
      const pending = fetchModelCard().catch((error: Error) => {
        failure = error;
      });

      await vi.advanceTimersByTimeAsync(18_001);

      expect(failure?.message).toMatch(/took too long/i);
      expect(requestSignal?.aborted).toBe(true);
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("bounds a stalled native connectivity check without starting an upload", async () => {
    vi.mocked(Network.getNetworkStateAsync).mockImplementation(
      () => new Promise(() => {}),
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = fetchModelCard().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(18_001);
    expect(await result).toMatchObject({ kind: "timeout" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a real offline failure distinct from a timeout", async () => {
    vi.mocked(Network.getNetworkStateAsync).mockResolvedValue({
      isConnected: false,
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(fetchModelCard()).rejects.toMatchObject({ kind: "offline" });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still attempts the service when the advisory network check fails", async () => {
    vi.mocked(Network.getNetworkStateAsync).mockRejectedValue(
      new Error("Native check unavailable"),
    );
    vi.stubGlobal("fetch", async () => signedResponse());
    expect(await fetchModelCard()).toEqual(modelCard);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a connection failure distinct from verification errors", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Network request failed");
    });
    await expect(fetchModelCard()).rejects.toMatchObject({ kind: "network" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["before request", "before headers", "during body"])(
    "honors caller cancellation %s without waiting for the deadline",
    async (stage) => {
      const controller = new AbortController();
      const fetch = vi.fn(async () => {
        if (stage === "before headers") return new Promise<Response>(() => {});
        const response = signedResponse();
        response.text = () => new Promise<string>(() => {});
        return response;
      });
      vi.stubGlobal("fetch", fetch);
      if (stage === "before request") controller.abort();
      const result = fetchModelCard(controller.signal).catch(
        (error: Error) => error,
      );
      await vi.advanceTimersByTimeAsync(1);
      controller.abort();
      expect(await result).toMatchObject({ name: "AbortError" });
      expect(vi.getTimerCount()).toBe(0);
      if (stage === "before request") expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("accepts a signed model card and clears its deadline and caller listener", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return signedResponse();
    });
    expect(await fetchModelCard(controller.signal)).toEqual(modelCard);
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    expect(requestSignal?.aborted).toBe(false);
  });

  it.each([
    ["cache headers", /privacy headers/i],
    ["request identity", /request ID/i],
    ["signature", /signature verification/i],
    ["JSON", /unreadable response/i],
    ["schema", /serviceVersion/i],
  ] as const)("still rejects invalid %s", async (problem, message) => {
    const response = signedResponse(
      problem === "JSON" ? "not-json" : problem === "schema" ? "{}" : undefined,
    );
    if (problem === "cache headers") response.headers.delete("cache-control");
    if (problem === "request identity") {
      response.headers.set("x-request-id", "replayed-request");
    }
    if (problem === "signature") response.text = async () => "{}";
    vi.stubGlobal("fetch", async () => response);
    await expect(fetchModelCard()).rejects.toThrow(message);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a verified server error instead of calling it a connection failure", async () => {
    vi.stubGlobal("fetch", async () =>
      signedResponse(
        JSON.stringify({
          error: {
            code: "not_ready",
            message: "Please retry shortly.",
            requestId,
          },
        }),
        503,
      ),
    );
    await expect(fetchModelCard()).rejects.toMatchObject({
      kind: "server",
      message: "Please retry shortly.",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replace a timed-out analysis with a late response", async () => {
    let resolveBody: (body: string) => void = () => {};
    const response = signedResponse();
    response.text = () =>
      new Promise((resolve) => {
        resolveBody = resolve;
      });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(signedResponse())
        .mockResolvedValueOnce(response),
    );
    const localQuality = {
      accepted: true,
      blurScore: 0.9,
      exposureScore: 0.9,
      glareScore: 0.1,
      obstructionScore: 0.1,
      faceDetected: false,
      reasons: [],
    };
    let result: Awaited<ReturnType<typeof analyzeCapture>> | undefined;
    const pending = analyzeCapture({
      captureId: "timed-out-capture",
      selectedRegion: "dorsal_tongue",
      imageUri: "file:///sanitized-test-only.jpg",
      mimeType: "image/jpeg",
      inputOrigin: "live_capture",
      localQuality,
    }).then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(18_001);
    await pending;
    expect(result).toMatchObject({
      captureId: "timed-out-capture",
      status: "failed",
      analysisOrigin: "unavailable",
      quality: localQuality,
      candidateMask: null,
      descriptors: null,
      abstentionReasons: [expect.stringMatching(/took too long/i)],
    });
    const timedOutResult = result;
    resolveBody(JSON.stringify(modelCard));
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(timedOutResult);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("suppresses comparison change when its response body stalls", async () => {
    const response = signedResponse();
    response.text = () => new Promise<string>(() => {});
    vi.stubGlobal("fetch", async () => response);
    const reference = (captureId: string) => ({
      captureId,
      region: "dorsal_tongue" as const,
      status: "complete" as const,
      analysisOrigin: "live_model" as const,
      qualityAccepted: true,
      candidateNormalizedArea: 0.05,
      modelVersions: { segmentation: "test-only" },
    });
    const pending = compareCaptures({
      baselineCaptureId: "baseline",
      currentCaptureId: "current",
      region: "dorsal_tongue",
      baselineImageUri: "file:///baseline-test-only.jpg",
      currentImageUri: "file:///current-test-only.jpg",
      baselineMimeType: "image/jpeg",
      currentMimeType: "image/jpeg",
      baselineAnalysis: reference("baseline"),
      currentAnalysis: reference("current"),
      inputOrigin: "live_capture",
      userConfirmedMatch: true,
    });
    await vi.advanceTimersByTimeAsync(18_001);
    expect(await pending).toMatchObject({
      analysisOrigin: "unavailable",
      comparable: false,
      normalizedChange: null,
      descriptorChanges: null,
      suppressionReasons: [
        expect.stringMatching(/took too long/i),
        "Insufficient comparable data.",
      ],
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
