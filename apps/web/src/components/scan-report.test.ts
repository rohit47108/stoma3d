import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  type VisualDescriptors,
} from "@stoma3d/contracts";
import {
  createGuestSession,
  type GuestCapture,
  type GuestSession,
} from "@/lib/guest-scan";
import { ScanReport } from "./scan-report";
import { ScanResult } from "./scan-result";

function reportSession(descriptors: VisualDescriptors | null): GuestSession {
  const capture: GuestCapture = {
    id: "report-capture",
    region: "left_buccal_mucosa",
    capturedAt: "2026-10-02T12:00:00.000Z",
    image: "data:image/jpeg;base64,dGVzdA==",
    width: 640,
    height: 480,
    analysis: {
      contractVersion: CONTRACT_VERSION,
      captureId: "report-capture",
      region: "left_buccal_mucosa",
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
        region: "left_buccal_mucosa",
        confidence: 0.9,
        supported: true,
        selectedRegionMatches: true,
      },
      candidateMask: descriptors
        ? {
            polygon: [
              [0.1, 0.2],
              [0.4, 0.2],
              [0.3, 0.5],
            ],
            boundingBox: [0.1, 0.2, 0.3, 0.3],
            normalizedArea: descriptors.normalizedArea,
          }
        : null,
      descriptors,
      appearanceOutput: null,
      diseaseResearchOutput: null,
      uncertainty: {
        overallConfidence: 0.8,
        imageQualityConfidence: 0.9,
        datasetSimilarity: null,
        modelAgreement: null,
        limitations: ["Image-relative measurements are approximate."],
      },
      abstentionReasons: [],
      modelVersions: { segmentation: "report-test-only" },
      inputOrigin: "live_capture",
      analysisOrigin: "live_model",
      status: "complete",
      disclaimer: DISCLAIMER,
    },
  };
  return { ...createGuestSession("report-session"), captures: [capture] };
}

describe("browser observation report descriptors", () => {
  it.each([
    [
      0.7,
      1.6,
      0.4,
      "Redder tone",
      "Uneven outline",
      "More varied surface texture",
    ],
    [
      0.5,
      1.2,
      0.2,
      "Mixed tissue tone",
      "Relatively even outline",
      "More even surface texture",
    ],
  ] as const)(
    "prints the same color, shape, and texture descriptions as results (%s, %s, %s)",
    (
      meanRedness,
      borderIrregularity,
      textureContrast,
      color,
      border,
      texture,
    ) => {
      const session = reportSession({
        normalizedArea: 0.09,
        perimeter: 0.4,
        borderIrregularity,
        meanRedness,
        meanBrightness: 0.5,
        textureContrast,
        measurementLabel: "approximate",
      });
      const report = renderToStaticMarkup(
        createElement(ScanReport, { session }),
      );
      const result = renderToStaticMarkup(
        createElement(ScanResult, {
          capture: session.captures[0]!,
          pinConfirmed: false,
          onConfirmPin: () => undefined,
          onRetry: () => undefined,
          onNext: () => undefined,
          onMap: () => undefined,
          complete: false,
        }),
      );
      for (const description of [color, border, texture]) {
        expect(result).toContain(description);
        expect(report).toContain(description);
      }
      expect(report).toContain("9.0% of the image");
      expect(report).toContain("report-session");
      expect(report).toContain("report-capture");
      expect(report).toContain("Input: your photo");
      expect(report).toContain("live model");
      expect(report).toContain("Not confirmed by user.");
      expect(report).toContain("<polygon");
      expect(report).toContain("report-test-only");
    },
  );

  it("does not invent descriptors when no candidate was detected", () => {
    const report = renderToStaticMarkup(
      createElement(ScanReport, {
        session: reportSession(null),
      }),
    );
    expect(report).toContain("No candidate area detected");
    expect(report).not.toContain("Color:");
    expect(report).not.toContain("Border:");
    expect(report).not.toContain("Texture:");
    expect(report).not.toContain("<polygon");
  });
});
