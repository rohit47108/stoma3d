import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CONTRACT_VERSION, DISCLAIMER } from "@stoma3d/contracts";
import { describe, expect, it } from "vitest";
import type { GuestCapture } from "@/lib/guest-scan";
import { ScanResult } from "./scan-result";

function unavailableCapture(): GuestCapture {
  return {
    id: "test-capture",
    region: "dorsal_tongue",
    capturedAt: "2026-10-01T12:00:00.000Z",
    image: "data:image/jpeg;base64,dGVzdA==",
    width: 640,
    height: 480,
    analysis: {
      contractVersion: CONTRACT_VERSION,
      captureId: "test-capture",
      region: "dorsal_tongue",
      quality: {
        accepted: true,
        blurScore: 0.9,
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
        overallConfidence: 0,
        imageQualityConfidence: 0.9,
        datasetSimilarity: null,
        modelAgreement: null,
        limitations: [],
      },
      abstentionReasons: ["Analysis could not complete."],
      modelVersions: { anatomy: "test-only" },
      inputOrigin: "live_capture",
      analysisOrigin: "unavailable",
      status: "abstained",
      disclaimer: DISCLAIMER,
    },
  };
}

describe("saved photo result provenance", () => {
  it("shows saving feedback and disables result actions while an observation saves", () => {
    const capture = unavailableCapture();
    capture.analysis.status = "complete";
    capture.analysis.analysisOrigin = "live_model";
    capture.analysis.candidateMask = {
      polygon: [
        [0.1, 0.1],
        [0.5, 0.1],
        [0.3, 0.5],
      ],
      normalizedArea: 0.08,
      boundingBox: [0.1, 0.1, 0.4, 0.4],
    };
    const html = renderToStaticMarkup(
      createElement(ScanResult, {
        capture,
        pinConfirmed: false,
        onConfirmPin: () => undefined,
        onRetry: () => undefined,
        onNext: () => undefined,
        onMap: () => undefined,
        complete: false,
        busy: true,
      }),
    );
    expect(html).toMatch(/disabled=""[^>]*>Saving observation…/);
    expect(html).toMatch(/disabled=""[^>]*>Next region/);
    expect(html).toMatch(/disabled=""[^>]*>View on 3D map/);
  });

  it("renders unavailable provenance and retry instead of claiming a live model or normal result", () => {
    const html = renderToStaticMarkup(
      createElement(ScanResult, {
        capture: unavailableCapture(),
        pinConfirmed: false,
        onConfirmPin: () => undefined,
        onRetry: () => undefined,
        onNext: () => undefined,
        onMap: () => undefined,
        complete: false,
      }),
    );
    expect(html).toContain("Analysis: unavailable");
    expect(html).toContain("Try analysis again");
    expect(html).not.toContain("Analysis: live model");
    expect(html).not.toContain("No candidate area detected");
  });
});
