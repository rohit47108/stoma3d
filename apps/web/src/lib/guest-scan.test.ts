import { describe, expect, it } from "vitest";
import {
  MOUTH_REGIONS,
  CONTRACT_VERSION,
  DISCLAIMER,
  type AnalysisResult,
  type MouthRegion,
} from "@stoma3d/contracts";

import {
  createGuestSession,
  nextGuestRegion,
  guestCompletedRegions,
  confirmGuestObservation,
  guestSessionSchema,
  addGuestCapture,
  resultProblem,
  suggestedRetryRegion,
} from "./guest-scan";
import { fittedImageSize, validatePhotoFile } from "./scan-image";
import { encryptGuestRecord, decryptGuestRecord } from "./guest-storage";

// Synthetic contract data for isolated state tests, never loaded by the product.
function testCapture(region: MouthRegion = "dorsal_tongue", id = "capture-1") {
  const analysis: AnalysisResult = {
    contractVersion: CONTRACT_VERSION,
    captureId: id,
    region,
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
      region,
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
    modelVersions: { segmentation: "test-only" },
    inputOrigin: "live_capture",
    analysisOrigin: "live_model",
    status: "complete",
    disclaimer: DISCLAIMER,
  };
  return {
    id,
    region,
    capturedAt: "2026-10-01T12:00:00.000Z",
    image: "data:image/jpeg;base64,dGVzdA==",
    width: 640,
    height: 480,
    analysis,
  };
}

describe("guest scanning", () => {
  it("starts the standard eight-region scan without an account", () => {
    const session = createGuestSession("scan-1", "2026-10-01T12:00:00.000Z");
    expect(session.protocol).toBe("standard_eight_region");
    expect(nextGuestRegion(session)).toBe("dorsal_tongue");
    expect(guestCompletedRegions(session)).toEqual([]);
    expect(guestSessionSchema.parse(session)).toEqual(session);
  });

  it("requires complete real analysis before confirming an observation pin", () => {
    const session = createGuestSession("scan-1", "2026-10-01T12:00:00.000Z");
    expect(() => confirmGuestObservation(session, "missing")).toThrow();
    expect(MOUTH_REGIONS).toHaveLength(8);
  });

  it("keeps a quality-accepted abstained photo for retry without calling it a normal result", () => {
    const session = createGuestSession("scan-1", "2026-10-01T12:00:00.000Z");
    const capture = testCapture();
    capture.analysis.status = "abstained";
    capture.analysis.abstentionReasons = [
      "Segmentation confidence was insufficient.",
    ];
    const saved = addGuestCapture(session, capture);
    expect(saved.captures[0]?.analysis.status).toBe("abstained");
    expect(guestCompletedRegions(saved)).toEqual(["dorsal_tongue"]);
    expect(() => confirmGuestObservation(saved, capture.id)).toThrow();
  });

  it("does not save rejected photos or a response from another capture", () => {
    const session = createGuestSession("scan-1", "2026-10-01T12:00:00.000Z");
    const rejected = testCapture();
    rejected.analysis.quality.accepted = false;
    rejected.analysis.status = "abstained";
    expect(() => addGuestCapture(session, rejected)).toThrow();
    const wrongId = testCapture();
    wrongId.analysis.captureId = "other";
    expect(() => addGuestCapture(session, wrongId)).toThrow();
  });

  it.each(["ventral_tongue", null] as const)(
    "rejects a contradictory or missing predicted region (%s) even when the match flag is true",
    (predictedRegion) => {
      const session = createGuestSession("scan-1", "2026-10-01T12:00:00.000Z");
      const capture = testCapture("dorsal_tongue");
      capture.analysis.anatomyPrediction.region = predictedRegion;

      expect(() => addGuestCapture(session, capture)).toThrow(
        "matching anatomy",
      );
      expect(guestCompletedRegions(session)).toEqual([]);
    },
  );

  it("completes at eight accepted regions and replaces rather than duplicates a region", () => {
    let session = createGuestSession("scan-1", "2026-10-01T12:00:00.000Z");
    for (const region of MOUTH_REGIONS)
      session = addGuestCapture(session, testCapture(region, region));
    expect(nextGuestRegion(session)).toBeNull();
    session = addGuestCapture(
      session,
      testCapture("dorsal_tongue", "replacement"),
    );
    expect(session.captures).toHaveLength(8);
    expect(
      session.captures.find((item) => item.region === "dorsal_tongue")?.id,
    ).toBe("replacement");
  });
});

describe("photo correction instructions", () => {
  function rejectedPhoto(reasons: string[]): AnalysisResult {
    const result = testCapture().analysis;
    result.status = "abstained";
    result.quality.accepted = false;
    result.quality.reasons = reasons;
    result.abstentionReasons = [...reasons];
    return result;
  }

  it("asks for better lighting before focus when a dark photo fails both checks", () => {
    expect(
      resultProblem(
        rejectedPhoto(["image_too_blurry", "exposure_out_of_range"]),
      ),
    ).toBe("Use even lighting and try another photo.");
  });

  it.each([
    ["image_too_small", "Choose a higher-resolution photo or take a new one."],
    ["excessive_glare", "Move away from direct light and try another photo."],
    [
      "image_obstructed",
      "Keep the mouth clear of fingers and other objects, then try again.",
    ],
    [
      "image_too_blurry",
      "The photo is out of focus. Hold still and take another.",
    ],
    ["exposure_out_of_range", "Use even lighting and try another photo."],
  ])("gives a specific correction for %s", (reason, message) => {
    expect(resultProblem(rejectedPhoto([reason]))).toBe(message);
  });

  it("prioritizes a small source image over unreliable lighting and focus readings", () => {
    expect(
      resultProblem(
        rejectedPhoto([
          "image_too_small",
          "image_too_blurry",
          "exposure_out_of_range",
        ]),
      ),
    ).toBe("Choose a higher-resolution photo or take a new one.");
  });

  it("explains a small image when the privacy detector cannot run at that size", () => {
    expect(
      resultProblem(
        rejectedPhoto(["image_too_small", "face_check_unavailable"]),
      ),
    ).toBe("Choose a higher-resolution photo or take a new one.");
  });

  it("keeps a detected face correction ahead of image-quality instructions", () => {
    const result = rejectedPhoto(["image_too_blurry", "exposure_out_of_range"]);
    result.quality.faceDetected = true;
    expect(resultProblem(result)).toBe(
      "Crop the photo to show only the mouth, then try again.",
    );
  });

  it.each(["face_check_unavailable", "privacy_check_unavailable"])(
    "keeps %s distinct from image-quality problems",
    (reason) => {
      expect(
        resultProblem(
          rejectedPhoto([reason, "image_too_blurry", "exposure_out_of_range"]),
        ),
      ).toBe("The photo privacy check could not finish. Try again.");
    },
  );

  it("offers a supported alternate region without accepting the mismatched result", () => {
    const result = testCapture().analysis;
    result.status = "unsupported";
    result.anatomyPrediction.region = "ventral_tongue";
    result.anatomyPrediction.selectedRegionMatches = false;

    expect(suggestedRetryRegion(result)).toBe("ventral_tongue");
    expect(() =>
      addGuestCapture(createGuestSession("scan-1"), {
        ...testCapture(),
        analysis: result,
      }),
    ).toThrow("matching anatomy");
  });

  it.each([
    "rejected-quality",
    "detected-face",
    "unsupported-anatomy",
    "matching-region",
    "complete",
    "failed",
  ])("does not suggest changing regions for %s", (condition) => {
    const result = testCapture().analysis;
    result.status = "unsupported";
    result.anatomyPrediction.region = "ventral_tongue";
    result.anatomyPrediction.selectedRegionMatches = false;
    if (condition === "rejected-quality") result.quality.accepted = false;
    if (condition === "detected-face") result.quality.faceDetected = true;
    if (condition === "unsupported-anatomy")
      result.anatomyPrediction.supported = false;
    if (condition === "matching-region")
      result.anatomyPrediction.region = result.region;
    if (condition === "complete") result.status = "complete";
    if (condition === "failed") result.status = "failed";

    expect(suggestedRetryRegion(result)).toBeNull();
  });
});

describe("browser image preparation", () => {
  it("uses a bounded analysis size while keeping the image proportions", () => {
    expect(fittedImageSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fittedImageSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(() => fittedImageSize(0, 500)).toThrow("read");
  });

  it("rejects unsupported and oversized files before decoding", () => {
    expect(() =>
      validatePhotoFile({
        type: "application/pdf",
        size: 100,
        name: "photo.pdf",
      }),
    ).toThrow("photo");
    expect(() =>
      validatePhotoFile({
        type: "image/jpeg",
        size: 30 * 1024 * 1024,
        name: "photo.jpg",
      }),
    ).toThrow("25 MB");
    expect(() =>
      validatePhotoFile({ type: "image/heic", size: 100, name: "photo.heic" }),
    ).not.toThrow();
  });
});

describe("encrypted guest records", () => {
  it("encrypts scan content and detects changed ciphertext", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const content = { image: "private mouth photo", region: "dorsal_tongue" };
    const encrypted = await encryptGuestRecord(key, content);
    expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain(
      content.image,
    );
    expect(await decryptGuestRecord(key, encrypted)).toEqual(content);
    const changed = new Uint8Array(encrypted.ciphertext.slice(0));
    changed[0] = changed[0]! ^ 1;
    await expect(
      decryptGuestRecord(key, { ...encrypted, ciphertext: changed.buffer }),
    ).rejects.toThrow();
  });

  it("uses a fresh IV for every saved record and non-exportable keys", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const first = await encryptGuestRecord(key, { id: "one" });
    const second = await encryptGuestRecord(key, { id: "one" });
    expect(first.iv).not.toEqual(second.iv);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});
