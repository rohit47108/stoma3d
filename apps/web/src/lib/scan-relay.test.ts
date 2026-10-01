import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, DISCLAIMER } from "@stoma3d/contracts";

import { analyzeGuestScan, getGuestModelCard } from "./scan-relay";

const keys = generateKeyPairSync("ed25519");
const publicBytes = keys.publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32);
const environment = {
  NODE_ENV: "test",
  STOMA3D_INFERENCE_URL: "https://inference.example.org/api",
  STOMA3D_RESPONSE_SIGNING_PUBLIC_KEY_B64: publicBytes.toString("base64"),
};
const modelCard = {
  contractVersion: CONTRACT_VERSION,
  serviceVersion: "test",
  intendedUse: "Image observations",
  forbiddenClaims: [],
  modelVersions: {},
  artifactHashes: {},
  enabledHeads: [],
  releaseGates: [],
  limitations: [],
  disclaimer: DISCLAIMER,
};
const analysis = {
  contractVersion: CONTRACT_VERSION,
  captureId: "capture-1",
  region: "dorsal_tongue",
  quality: {
    accepted: false,
    blurScore: 0.1,
    exposureScore: 0.9,
    glareScore: 0,
    obstructionScore: 0,
    faceDetected: false,
    reasons: ["image_too_blurry"],
  },
  anatomyPrediction: {
    region: null,
    confidence: 0,
    selectedRegionMatches: false,
    supported: false,
  },
  candidateMask: null,
  descriptors: null,
  appearanceOutput: null,
  diseaseResearchOutput: null,
  uncertainty: {
    overallConfidence: 0,
    imageQualityConfidence: 0.5,
    datasetSimilarity: null,
    modelAgreement: null,
    limitations: [],
  },
  abstentionReasons: ["image_too_blurry"],
  modelVersions: {},
  inputOrigin: "live_capture",
  analysisOrigin: "unavailable",
  status: "abstained",
  disclaimer: DISCLAIMER,
};
function signedResponse(value: unknown, requestId: string, tamper = false) {
  const raw = JSON.stringify(value);
  const signature = sign(
    null,
    Buffer.from(`stoma3d-response-v1\n${requestId}\n${raw}`),
    keys.privateKey,
  );
  return new Response(tamper ? raw + " " : raw, {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": requestId,
      "x-stoma3d-key-id": createHash("sha256")
        .update(publicBytes)
        .digest("hex")
        .slice(0, 16),
      "x-stoma3d-signature": signature.toString("base64"),
    },
  });
}
function request(fields: Record<string, string> = {}) {
  const body = new FormData();
  body.set(
    "image",
    new Blob([Uint8Array.from([255, 216, 255, 224, 0, 0, 255, 217])], {
      type: "image/jpeg",
    }),
    "photo.jpg",
  );
  body.set("captureId", "capture-1");
  body.set("region", "dorsal_tongue");
  Object.entries(fields).forEach(([key, value]) => body.set(key, value));
  return new Request("https://stoma3d.example.org/api/scan/analyze", {
    method: "POST",
    body,
  });
}
const options = { environment, rateLimit: () => true };

describe("guest analysis relay", () => {
  it("forwards only to the configured service and preserves a verified abstention", async () => {
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const id = new Headers(init?.headers).get("x-request-id")!;
        if (String(url).endsWith("model-card"))
          return signedResponse(modelCard, id);
        const form = init?.body as FormData;
        expect(JSON.parse(String(form.get("metadata"))).requestedHeads).toEqual(
          [],
        );
        expect(form.get("image")).toBeInstanceOf(Blob);
        return signedResponse(analysis, id);
      },
    );
    const response = await analyzeGuestScan(request(), { ...options, fetcher });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(analysis);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://inference.example.org/api/v1/model-card",
      "https://inference.example.org/api/v1/analyze",
    ]);
  });
  it("rejects unknown fields including destination URLs before any forwarding", async () => {
    const fetcher = vi.fn();
    const response = await analyzeGuestScan(
      request({ destination: "http://localhost" }),
      { ...options, fetcher },
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects wrong region and demo origin", async () => {
    expect(
      (await analyzeGuestScan(request({ region: "palate" }), options)).status,
    ).toBe(400);
    expect(
      (
        await analyzeGuestScan(
          request({ inputOrigin: "bundled_demo" }),
          options,
        )
      ).status,
    ).toBe(400);
  });
  it("rejects invalid signatures before parsing results", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) =>
      signedResponse(
        modelCard,
        new Headers(init?.headers).get("x-request-id")!,
        true,
      ),
    );
    const response = await analyzeGuestScan(request(), { ...options, fetcher });
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("invalid_response");
  });
  it("never accepts a result for another capture", async () => {
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) =>
      signedResponse(
        String(url).endsWith("model-card")
          ? modelCard
          : { ...analysis, captureId: "other" },
        new Headers(init?.headers).get("x-request-id")!,
      ),
    );
    expect(
      (await analyzeGuestScan(request(), { ...options, fetcher })).status,
    ).toBe(502);
  });
  it("rejects cross-site requests and applies request limits", async () => {
    const crossSite = request();
    crossSite.headers.set("origin", "https://attacker.example.org");
    expect((await analyzeGuestScan(crossSite, options)).status).toBe(403);
    expect(
      (
        await analyzeGuestScan(request(), {
          ...options,
          rateLimit: () => false,
        })
      ).status,
    ).toBe(429);
    const large = request();
    large.headers.set("content-length", "9000000");
    expect((await analyzeGuestScan(large, options)).status).toBe(413);
  });
  it("does not allow unsigned model cards or unsafe configured destinations", async () => {
    const fetcher = vi.fn(async () => Response.json(modelCard));
    expect((await getGuestModelCard({ ...options, fetcher })).status).toBe(502);
    expect(
      (
        await getGuestModelCard({
          environment: {
            ...environment,
            STOMA3D_INFERENCE_URL: "http://169.254.169.254",
          },
        })
      ).status,
    ).toBe(503);
  });
});
