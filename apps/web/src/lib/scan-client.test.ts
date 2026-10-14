import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  type AnalysisResult,
} from "@stoma3d/contracts";
import { analyzeGuestPhoto } from "./scan-client";

const photo = {
  image: "data:image/jpeg;base64,dGVzdA==",
  blob: new Blob(["test"], { type: "image/jpeg" }),
  width: 640,
  height: 480,
};

// Synthetic response for unit tests only; the application never imports it.
function resultBody(): AnalysisResult {
  return {
    contractVersion: CONTRACT_VERSION,
    captureId: "capture-1",
    region: "dorsal_tongue",
    quality: {
      accepted: true,
      blurScore: 0.8,
      exposureScore: 0.8,
      glareScore: 0,
      obstructionScore: 0,
      faceDetected: false,
      reasons: [],
    },
    anatomyPrediction: {
      region: "dorsal_tongue",
      confidence: 0.9,
      supported: true,
      selectedRegionMatches: true,
    },
    candidateMask: null,
    descriptors: null,
    appearanceOutput: null,
    diseaseResearchOutput: null,
    uncertainty: {
      overallConfidence: 0.8,
      imageQualityConfidence: 0.8,
      datasetSimilarity: null,
      modelAgreement: null,
      limitations: [],
    },
    abstentionReasons: [],
    modelVersions: { segmentation: "unit-test-only" },
    inputOrigin: "live_capture",
    analysisOrigin: "live_model",
    status: "complete",
    disclaimer: DISCLAIMER,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("guest analysis response handling", () => {
  it("does not repeat a successful request", async () => {
    const sends = vi.fn().mockResolvedValue(Response.json(resultBody()));
    vi.stubGlobal("fetch", sends);
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ captureId: "capture-1", status: "complete" });
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-transport exception", async () => {
    const failure = new Error("Unexpected failure");
    const sends = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal("fetch", sends);
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toBe(failure);
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it("stops when the recovery attempt is cancelled", async () => {
    const controller = new AbortController();
    const cancellation = new DOMException("Timed out", "AbortError");
    const sends = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Connection closed"))
      .mockImplementationOnce(async () => {
        controller.abort(cancellation);
        throw cancellation;
      });
    vi.stubGlobal("fetch", sends);
    await expect(
      analyzeGuestPhoto(photo, "dorsal_tongue", "capture-1", controller.signal),
    ).rejects.toBe(cancellation);
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it("recovers once from a transport failure using the same photo and capture", async () => {
    const controller = new AbortController();
    const sends = vi.fn(async (_url: string, options: RequestInit) => {
      const form = options.body as FormData;
      expect(form.get("captureId")).toBe("capture-1");
      expect(form.get("region")).toBe("dorsal_tongue");
      expect(form.get("inputOrigin")).toBe("live_capture");
      expect(await (form.get("image") as Blob).text()).toBe("test");
      expect(options.signal).toBe(controller.signal);
      expect(options.cache).toBe("no-store");
      // Consume the serialized body, like an actual request, before failing.
      await new Request(
        "https://stoma3d.test/api/scan/analyze",
        options,
      ).arrayBuffer();
      if (sends.mock.calls.length === 1)
        throw new TypeError("Connection closed");
      return Response.json(resultBody());
    });
    vi.stubGlobal("fetch", sends);
    await expect(
      analyzeGuestPhoto(photo, "dorsal_tongue", "capture-1", controller.signal),
    ).resolves.toMatchObject({
      captureId: "capture-1",
      status: "complete",
      analysisOrigin: "live_model",
    });
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it("revalidates the response after a recovered transport failure", async () => {
    const sends = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Connection closed"))
      .mockResolvedValueOnce(
        Response.json({ ...resultBody(), captureId: "another-capture" }),
      );
    vi.stubGlobal("fetch", sends);
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toThrow("could not be verified");
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it("gives a useful retry message when the connection fails", async () => {
    const sends = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", sends);
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toThrow(
      "Could not connect. Your photo is still here; try again.",
    );
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it("does not send a photo after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const sends = vi.fn().mockResolvedValue(Response.json(resultBody()));
    vi.stubGlobal("fetch", sends);
    await expect(
      analyzeGuestPhoto(photo, "dorsal_tongue", "capture-1", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sends).not.toHaveBeenCalled();
  });

  it("does not retry a transport failure when the scan was cancelled", async () => {
    const controller = new AbortController();
    const failure = new TypeError("Connection closed");
    const sends = vi.fn(async () => {
      controller.abort();
      throw failure;
    });
    vi.stubGlobal("fetch", sends);
    await expect(
      analyzeGuestPhoto(photo, "dorsal_tongue", "capture-1", controller.signal),
    ).rejects.toBe(failure);
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it.each([403, 429, 502, 503])(
    "does not automatically retry an HTTP %s response",
    async (status) => {
      const sends = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "Keep this service message." } },
            { status },
          ),
        );
      vi.stubGlobal("fetch", sends);
      await expect(
        analyzeGuestPhoto(
          photo,
          "dorsal_tongue",
          "capture-1",
          new AbortController().signal,
        ),
      ).rejects.toThrow("Keep this service message.");
      expect(sends).toHaveBeenCalledTimes(1);
    },
  );

  it("respects a request limit returned by the single recovery attempt", async () => {
    const sends = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Connection closed"))
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "Please wait before retrying." } },
          { status: 429 },
        ),
      );
    vi.stubGlobal("fetch", sends);
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toThrow("Please wait before retrying.");
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it.each([
    { region: "ventral_tongue" },
    { inputOrigin: "bundled_demo" },
    { analysisOrigin: "manual_fixture" },
    { analysisOrigin: "cached_model_result" },
    { contractVersion: "invalid-version" },
  ])(
    "rejects mismatched or fixture provenance after transport recovery: %j",
    async (mismatch) => {
      const sends = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Connection closed"))
        .mockResolvedValueOnce(Response.json({ ...resultBody(), ...mismatch }));
      vi.stubGlobal("fetch", sends);
      await expect(
        analyzeGuestPhoto(
          photo,
          "dorsal_tongue",
          "capture-1",
          new AbortController().signal,
        ),
      ).rejects.toThrow("could not be verified");
      expect(sends).toHaveBeenCalledTimes(2);
    },
  );

  it("shows the relay's recoverable service message instead of inventing analysis", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "unavailable",
              message: "The analysis service is offline. Try again.",
            },
          }),
          { status: 503 },
        ),
    );
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toThrow("offline");
  });

  it("rejects malformed successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ status: "complete", captureId: "capture-1" }),
        ),
    );
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toThrow("verified");
  });

  it("does not treat an HTML error page as a normal result", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("<html>Service error</html>", { status: 502 }),
    );
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toThrow("unavailable");
  });

  it("propagates cancelled or timed out requests without fabricated output", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
