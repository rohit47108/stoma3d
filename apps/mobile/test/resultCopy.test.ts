import { describe, expect, it } from "vitest";
import type { CandidateMask, VisualDescriptors } from "@stoma3d/contracts";

import {
  analysisStatusTitle,
  captureInputLabel,
  historyInputLabel,
  historyResultDescription,
  humanizeResultReason,
  observationStatusLabel,
} from "../src/lib/resultCopy";

describe("observationStatusLabel", () => {
  it.each([
    ["review_unavailable", "Observation saved"],
    ["monitoring", "Monitoring observation"],
    ["retake_required", "Retake required observation"],
    ["stable", "Stable observation"],
    ["visually_changed", "Visually changed observation"],
  ] as const)(
    "labels %s consistently without changing its stored meaning",
    (status, expected) => {
      expect(observationStatusLabel(status)).toBe(expected);
    },
  );
});

describe("humanizeResultReason", () => {
  it("explains release-gated analysis in plain language", () => {
    expect(humanizeResultReason("segmentation_release_gate_unmet")).toBe(
      "The abnormal-area model has not passed its required accuracy checks, so no candidate outline was shown.",
    );
  });

  it("turns unknown machine codes into readable sentences", () => {
    expect(humanizeResultReason("future_reason_code")).toBe(
      "Future reason code.",
    );
  });

  it("preserves a plain service explanation and adds punctuation", () => {
    expect(humanizeResultReason("The service could not be reached")).toBe(
      "The service could not be reached.",
    );
  });

  it("handles a blank reason without exposing an empty bullet", () => {
    expect(humanizeResultReason("   ")).toBe(
      "The service did not provide a reason.",
    );
  });
});

const candidateMask: CandidateMask = {
  polygon: [
    [0.1, 0.1],
    [0.7, 0.1],
    [0.7, 0.7],
  ],
  boundingBox: [0.1, 0.1, 0.6, 0.6],
  normalizedArea: 0.229,
};
const descriptors: VisualDescriptors = {
  normalizedArea: 0.229,
  perimeter: 0.4,
  borderIrregularity: 0.1,
  meanRedness: 0.5,
  meanBrightness: 0.5,
  textureContrast: 0.3,
  measurementLabel: "approximate",
};

describe("saved-photo wording", () => {
  it.each([
    ["photo_library", "Uploaded photo"],
    ["camera", "Camera photo"],
    ["video_sweep", "Video frame"],
    [undefined, "Photo"],
  ] as const)(
    "describes input source %s without assuming camera capture",
    (captureSource, expected) => {
      expect(
        captureInputLabel({ inputOrigin: "live_capture", captureSource }),
      ).toBe(expected);
    },
  );

  it("keeps bundled provenance even when a sample has a capture-source field", () => {
    expect(
      captureInputLabel({
        inputOrigin: "bundled_demo",
        captureSource: "camera",
      }),
    ).toBe("Sample photo");
  });

  it("keeps uploaded photos distinct from camera photos", () => {
    expect(
      historyInputLabel(
        { inputOrigin: "live_capture", captureSource: "photo_library" },
        "live_model",
      ),
    ).toBe("Uploaded photo · Live analysis");
    expect(
      historyInputLabel(
        { inputOrigin: "live_capture", captureSource: "camera" },
        "live_model",
      ),
    ).toBe("Camera photo · Live analysis");
  });

  it("keeps sample and cached provenance visible", () => {
    expect(
      historyInputLabel({ inputOrigin: "bundled_demo" }, "manual_fixture"),
    ).toBe("Sample photo · Manual example");
    expect(
      historyInputLabel({ inputOrigin: "bundled_demo" }, "cached_model_result"),
    ).toBe("Sample photo · Cached analysis");
  });

  it("does not claim a capture method or analysis when old metadata is missing", () => {
    expect(historyInputLabel({ inputOrigin: "live_capture" })).toBe(
      "Photo · No result saved",
    );
  });

  it("labels a candidate measurement approximate and relative to the photo", () => {
    expect(
      historyResultDescription({
        status: "complete",
        candidateMask,
        descriptors,
      }),
    ).toBe("Area outlined · Approx. 22.9% of photo");
  });

  it("never presents failed analysis as an outlined area", () => {
    expect(
      historyResultDescription({
        status: "failed",
        candidateMask,
        descriptors,
      }),
    ).toBe("Analysis unavailable");
  });

  it("keeps an empty completed result distinct from an unavailable result", () => {
    expect(
      historyResultDescription({
        status: "complete",
        candidateMask: null,
        descriptors: null,
      }),
    ).toBe("No candidate area outlined");
    expect(historyResultDescription(undefined)).toBe("Analysis unavailable");
  });
});

describe("analysisStatusTitle", () => {
  it("does not present a completed empty mask as an all-clear result", () => {
    expect(analysisStatusTitle("complete", false)).toBe(
      "No candidate area outlined",
    );
  });

  it("labels a completed candidate result as a visual description", () => {
    expect(analysisStatusTitle("complete", true)).toBe(
      "Candidate area described",
    );
  });
});
