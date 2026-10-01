import type { QualityResult } from "@stoma3d/contracts";

import { TRANSPORT_IMAGE_BYTE_LIMIT } from "../constants";

export interface ImageTelemetry {
  edgeStrength: number;
  focusVariance?: number;
  meanLuminance: number;
  highlightFraction: number;
  obstructionEstimate: number;
  faceDetected: boolean;
  stable: boolean;
  width?: number;
  height?: number;
  byteSize?: number;
  measurementStatus?: "measured" | "unavailable";
  processingError?: string;
  wellExposedFraction?: number;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function evaluateImageTelemetry(
  telemetry: ImageTelemetry,
  policy: "strict" | "advisory" = "strict",
): QualityResult {
  // The focus-variance reference was selected on licensed SMART-OM
  // train/validation images and deliberately blurred copies. The legacy edge
  // score remains a fallback for persisted telemetry created before this field
  // existed.
  const unavailable = telemetry.measurementStatus === "unavailable";
  const standardized = telemetry.measurementStatus === "measured";
  const blurScore = unavailable
    ? 0.5
    : clamp(
        standardized && telemetry.focusVariance !== undefined
          ? 1 - Math.exp(-(telemetry.focusVariance * 255 * 255) / 180)
          : telemetry.focusVariance === undefined
            ? telemetry.edgeStrength / 0.18
            : telemetry.focusVariance / 0.015,
      );
  const exposureScore = unavailable
    ? 0.5
    : clamp(
        standardized && telemetry.wellExposedFraction !== undefined
          ? telemetry.wellExposedFraction
          : 1 - Math.abs(telemetry.meanLuminance - 0.55) / 0.55,
      );
  const glareScore = unavailable
    ? 0
    : clamp(
        standardized
          ? telemetry.highlightFraction
          : telemetry.highlightFraction / 0.2,
      );
  const obstructionScore = unavailable
    ? 0
    : clamp(telemetry.obstructionEstimate);
  const reasons: string[] = [];

  if (
    telemetry.width !== undefined &&
    telemetry.height !== undefined &&
    Math.min(telemetry.width, telemetry.height) <
      (policy === "advisory" || standardized ? 128 : 480)
  ) {
    reasons.push("The photo is too small. Choose a larger image.");
  }
  if (
    policy === "strict" &&
    !standardized &&
    telemetry.width !== undefined &&
    telemetry.height !== undefined &&
    telemetry.height > 0
  ) {
    const aspectRatio = telemetry.width / telemetry.height;
    if (aspectRatio < 0.45 || aspectRatio > 2.2) {
      reasons.push(
        "The image framing is unusually narrow or wide. Center one mouth region and try again.",
      );
    }
  }
  if (
    telemetry.byteSize !== undefined &&
    telemetry.byteSize > TRANSPORT_IMAGE_BYTE_LIMIT
  ) {
    reasons.push(
      "The sanitized image is larger than the protected upload-size limit.",
    );
  }
  if (
    policy === "strict" &&
    !unavailable &&
    blurScore < (standardized ? 0.054 : 0.42)
  )
    reasons.push("The image looks blurry. Move slightly back and hold still.");
  if (
    policy === "strict" &&
    !unavailable &&
    exposureScore < (standardized ? 0.65 : 0.45)
  ) {
    reasons.push(
      telemetry.meanLuminance < 0.3
        ? "The area is too dark."
        : "The area is too bright.",
    );
  }
  if (
    policy === "strict" &&
    !unavailable &&
    glareScore > (standardized ? 0.15 : 0.55)
  )
    reasons.push("Tilt the phone to reduce glare.");
  if (
    policy === "strict" &&
    !unavailable &&
    obstructionScore > (standardized ? 0.2 : 0.5)
  )
    reasons.push("The target appears partly blocked.");
  if (telemetry.faceDetected)
    reasons.push(
      "A face may be visible. Reframe to include mouth tissue only.",
    );

  return {
    accepted: reasons.length === 0,
    blurScore,
    exposureScore,
    glareScore,
    obstructionScore,
    faceDetected: telemetry.faceDetected,
    reasons,
  };
}
