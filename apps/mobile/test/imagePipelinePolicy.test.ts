import { describe, expect, it } from "vitest";

import { type SanitizedCapture } from "../src/lib/imagePipeline";
import {
  withFaceDetectionResult,
  withUnavailablePrivacyCheck,
  canSendForServerPrivacyCheck,
  checkCapturePrivacy,
  retryDraftQuality,
} from "../src/lib/privacyPolicy";

const baseCapture: SanitizedCapture = {
  uri: "file:///temporary/capture.jpg",
  mimeType: "image/jpeg",
  source: "camera",
  width: 1024,
  height: 768,
  byteSize: 1024,
  telemetry: {
    edgeStrength: 0.2,
    meanLuminance: 0.5,
    highlightFraction: 0.01,
    obstructionEstimate: 0.1,
    faceDetected: false,
    stable: true,
  },
};

describe("face detection telemetry", () => {
  it("records a detected face without mutating the sanitized capture", () => {
    const updated = withFaceDetectionResult(baseCapture, true);

    expect(updated.telemetry.faceDetected).toBe(true);
    expect(baseCapture.telemetry.faceDetected).toBe(false);
  });

  it("records a successful no-face result", () => {
    expect(
      withFaceDetectionResult(baseCapture, false).telemetry.faceDetected,
    ).toBe(false);
  });

  it("distinguishes detector failure from a detected face", () => {
    expect(withFaceDetectionResult(baseCapture, true).privacyStatus).toBe(
      "face_detected",
    );
    expect(withUnavailablePrivacyCheck(baseCapture).privacyStatus).toBe(
      "unavailable",
    );
  });

  it("requires both mouth-only crop and explicit consent for server fallback", () => {
    const unavailable = withUnavailablePrivacyCheck(baseCapture);
    expect(canSendForServerPrivacyCheck(unavailable, true)).toBe(false);
    expect(
      canSendForServerPrivacyCheck({ ...unavailable, cropped: true }, false),
    ).toBe(false);
    expect(
      canSendForServerPrivacyCheck({ ...unavailable, cropped: true }, true),
    ).toBe(true);
    expect(
      canSendForServerPrivacyCheck(
        { ...unavailable, cropped: true, privacyStatus: "face_detected" },
        true,
      ),
    ).toBe(false);
  });

  it("keeps a photo recoverable when the detector cannot run", async () => {
    const result = await checkCapturePrivacy(baseCapture, {
      status: "ready",
      initialize: async () => {},
      detectFaces: async () => {
        throw new Error("native detector failed");
      },
    });
    expect(result.uri).toBe(baseCapture.uri);
    expect(result.privacyStatus).toBe("unavailable");
    expect(result.telemetry.faceDetected).toBe(false);
  });

  it("requires a real no-face response rather than treating an empty detector response as passed", async () => {
    const result = await checkCapturePrivacy(baseCapture, {
      status: "ready",
      initialize: async () => {},
      detectFaces: async () => undefined,
    });
    expect(result.privacyStatus).toBe("unavailable");
  });

  it("only saves measured, privacy-passed, usable photos as retry drafts", () => {
    const usable: SanitizedCapture = {
      ...baseCapture,
      privacyStatus: "passed",
      telemetry: {
        ...baseCapture.telemetry,
        measurementStatus: "measured",
        focusVariance: 0.002,
        wellExposedFraction: 0.95,
      },
    };
    expect(retryDraftQuality(usable)?.accepted).toBe(true);
    expect(
      retryDraftQuality({
        ...usable,
        privacyStatus: "unavailable",
        cropped: true,
      }),
    ).toBeNull();
    expect(
      retryDraftQuality({ ...usable, privacyStatus: "face_detected" }),
    ).toBeNull();
    expect(
      retryDraftQuality({
        ...usable,
        telemetry: { ...usable.telemetry, measurementStatus: "unavailable" },
      }),
    ).toBeNull();
    expect(
      retryDraftQuality({
        ...usable,
        telemetry: { ...usable.telemetry, focusVariance: 0 },
      }),
    ).toBeNull();
    expect(retryDraftQuality({ ...usable, source: "video_sweep" })).toBeNull();
  });
});
