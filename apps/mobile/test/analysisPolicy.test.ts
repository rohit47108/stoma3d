import { describe, expect, it } from "vitest";
import {
  analysisResultSchema,
  CONTRACT_VERSION,
  DISCLAIMER,
} from "@stoma3d/contracts";

import {
  captureAnalysisRetryDisposition,
  captureRegionCorrection,
  captureStorageRejectionReasons,
} from "../src/lib/analysisPolicy";

function analysis(
  overrides: {
    qualityAccepted?: boolean;
    anatomySupported?: boolean;
    selectedRegionMatches?: boolean;
    predictedRegion?: "left_buccal_mucosa" | "dorsal_tongue" | null;
    status?: "complete" | "abstained" | "unsupported" | "failed";
    analysisOrigin?: "live_model" | "unavailable";
  } = {},
) {
  return analysisResultSchema.parse({
    contractVersion: CONTRACT_VERSION,
    captureId: "capture-1",
    region: "left_buccal_mucosa",
    quality: {
      accepted: overrides.qualityAccepted ?? true,
      blurScore: 0.9,
      exposureScore: 0.9,
      glareScore: 0.1,
      obstructionScore: 0.1,
      faceDetected: false,
      reasons:
        overrides.qualityAccepted === false ? ["Server quality rejection"] : [],
    },
    anatomyPrediction: {
      region:
        "predictedRegion" in overrides
          ? (overrides.predictedRegion ?? null)
          : "left_buccal_mucosa",
      confidence: 0.9,
      supported: overrides.anatomySupported ?? true,
      selectedRegionMatches: overrides.selectedRegionMatches ?? true,
    },
    candidateMask: null,
    descriptors: null,
    appearanceOutput: null,
    diseaseResearchOutput: null,
    uncertainty: {
      overallConfidence: 0.8,
      imageQualityConfidence: 0.9,
      datasetSimilarity: 0.7,
      modelAgreement: 0.8,
      limitations: ["Research prototype"],
    },
    abstentionReasons: [],
    modelVersions: { anatomy: "test" },
    inputOrigin: "live_capture",
    analysisOrigin: overrides.analysisOrigin ?? "live_model",
    status:
      overrides.status ??
      (overrides.qualityAccepted === false ||
      overrides.selectedRegionMatches === false ||
      overrides.predictedRegion === "dorsal_tongue"
        ? "failed"
        : "complete"),
    disclaimer: DISCLAIMER,
  });
}

describe("protected capture storage acceptance", () => {
  it("offers an explicit supported mismatch correction only for a single standard photo", () => {
    const mismatch = analysis({
      selectedRegionMatches: false,
      predictedRegion: "dorsal_tongue",
      status: "unsupported",
    });
    expect(
      captureRegionCorrection(mismatch, "left_buccal_mucosa", {
        protocol: "standard_eight_region",
        candidateCount: 1,
      }),
    ).toBe("dorsal_tongue");
    expect(
      captureStorageRejectionReasons(mismatch, "left_buccal_mucosa"),
    ).not.toEqual([]);
  });

  it.each(["guided_video_sweep", "detailed_multi_angle"] as const)(
    "does not relabel a %s capture set from one mismatched view",
    (protocol) => {
      expect(
        captureRegionCorrection(
          analysis({
            predictedRegion: "dorsal_tongue",
            selectedRegionMatches: false,
            status: "unsupported",
          }),
          "left_buccal_mucosa",
          { protocol, candidateCount: 1 },
        ),
      ).toBeNull();
    },
  );

  it("does not suggest unconfirmed anatomy, unavailable responses, or multiple photos", () => {
    for (const result of [
      analysis({ anatomySupported: false, predictedRegion: "dorsal_tongue" }),
      analysis({
        analysisOrigin: "unavailable",
        predictedRegion: "dorsal_tongue",
      }),
      analysis(),
    ]) {
      expect(
        captureRegionCorrection(result, "left_buccal_mucosa", {
          protocol: "standard_eight_region",
          candidateCount: 1,
        }),
      ).toBeNull();
    }
    expect(
      captureRegionCorrection(
        analysis({
          predictedRegion: "dorsal_tongue",
          selectedRegionMatches: false,
          status: "unsupported",
        }),
        "left_buccal_mucosa",
        { protocol: "standard_eight_region", candidateCount: 2 },
      ),
    ).toBeNull();
  });

  it("never offers anatomy correction for failed, completed, rejected-quality, or face-bearing responses", () => {
    const mismatch = analysis({
      predictedRegion: "dorsal_tongue",
      selectedRegionMatches: false,
      status: "unsupported",
    });
    for (const result of [
      { ...mismatch, status: "failed" as const },
      { ...mismatch, status: "complete" as const },
      { ...mismatch, quality: { ...mismatch.quality, accepted: false } },
      { ...mismatch, quality: { ...mismatch.quality, faceDetected: true } },
      {
        ...mismatch,
        anatomyPrediction: {
          ...mismatch.anatomyPrediction,
          selectedRegionMatches: true,
        },
      },
    ]) {
      expect(
        captureRegionCorrection(result, "left_buccal_mucosa", {
          protocol: "standard_eight_region",
          candidateCount: 1,
        }),
      ).toBeNull();
    }
  });

  it("accepts when backend quality passes and supported anatomy matches", () => {
    expect(
      captureStorageRejectionReasons(analysis(), "left_buccal_mucosa"),
    ).toEqual([]);
  });

  it("does not save a face-bearing response even if it claims accepted quality", () => {
    const result = analysis();
    expect(
      captureStorageRejectionReasons(
        {
          ...result,
          quality: { ...result.quality, faceDetected: true },
        },
        "left_buccal_mucosa",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("rejects backend quality failures and supported anatomy mismatches", () => {
    const reasons = captureStorageRejectionReasons(
      analysis({
        qualityAccepted: false,
        selectedRegionMatches: false,
        predictedRegion: "dorsal_tongue",
      }),
      "left_buccal_mucosa",
    );
    expect(reasons).toEqual([
      "Server quality rejection",
      "The automatic anatomy check did not match the selected region. The image was not added.",
    ]);
  });

  it("preserves a quality-accepted image when research analysis abstains", () => {
    expect(
      captureStorageRejectionReasons(
        analysis({
          status: "abstained",
        }),
        "left_buccal_mucosa",
      ),
    ).toEqual([]);
  });

  it.each(["unsupported", "abstained"] as const)(
    "does not accept unconfirmed anatomy even when quality passes and analysis is %s",
    (status) => {
      expect(
        captureStorageRejectionReasons(
          analysis({ anatomySupported: false, predictedRegion: null, status }),
          "left_buccal_mucosa",
        ),
      ).toEqual([
        "The mouth region could not be confirmed. Choose another photo of this region.",
      ]);
    },
  );

  it("preserves the previous saved result when retry transport is unavailable", () => {
    expect(
      captureAnalysisRetryDisposition(
        analysis({
          analysisOrigin: "unavailable",
          anatomySupported: false,
          predictedRegion: null,
          status: "failed",
        }),
        "left_buccal_mucosa",
      ),
    ).toBe("preserve");
  });

  it("rejects a verified retry response with unsupported anatomy", () => {
    expect(
      captureAnalysisRetryDisposition(
        analysis({
          anatomySupported: false,
          predictedRegion: null,
          status: "unsupported",
        }),
        "left_buccal_mucosa",
      ),
    ).toBe("reject");
  });

  it("updates a supported, quality-accepted abstention without claiming a finding", () => {
    expect(
      captureAnalysisRetryDisposition(
        analysis({ status: "abstained" }),
        "left_buccal_mucosa",
      ),
    ).toBe("update");
  });
});
