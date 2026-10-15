import type {
  AnalysisResult,
  CaptureProtocol,
  MouthRegion,
} from "@stoma3d/contracts";

const MEASURED_IMAGE_REJECTION_REASONS: ReadonlySet<string> = new Set([
  "image_too_small",
  "image_too_blurry",
  "exposure_out_of_range",
  "excessive_glare",
  "image_obstructed",
  "face_detected",
  "learned_quality_blurry",
  "learned_quality_too_dark",
  "learned_quality_too_bright",
  "learned_quality_glare_heavy",
  "learned_quality_target_region_missing",
  "learned_quality_too_far",
  "learned_quality_too_close",
  "learned_quality_obstructed",
]);

export function captureRegionCorrection(
  analysis: AnalysisResult,
  selectedRegion: MouthRegion,
  context: { protocol: CaptureProtocol; candidateCount: number },
): MouthRegion | null {
  const prediction = analysis.anatomyPrediction;
  if (
    context.protocol !== "standard_eight_region" ||
    context.candidateCount !== 1 ||
    analysis.analysisOrigin !== "live_model" ||
    (analysis.status !== "abstained" && analysis.status !== "unsupported") ||
    !analysis.quality.accepted ||
    analysis.quality.faceDetected ||
    !prediction.supported ||
    prediction.selectedRegionMatches ||
    !prediction.region ||
    prediction.region === selectedRegion
  ) {
    return null;
  }
  return prediction.region;
}

export function captureStorageRejectionReasons(
  analysis: AnalysisResult,
  selectedRegion: MouthRegion,
): string[] {
  const reasons = [...analysis.quality.reasons];
  if (!analysis.quality.accepted && reasons.length === 0) {
    reasons.push("Server quality validation rejected this image.");
  }
  if (analysis.quality.faceDetected && analysis.quality.accepted) {
    reasons.push(
      "A face may be visible. Reframe to include mouth tissue only.",
    );
  }
  // A quality rejection can stop anatomy from running; it is not a mismatch.
  if (
    (!analysis.quality.accepted || analysis.quality.faceDetected) &&
    !analysis.anatomyPrediction.supported
  ) {
    return reasons;
  }
  if (!analysis.anatomyPrediction.supported) {
    reasons.push(
      "The mouth region could not be confirmed. Choose another photo of this region.",
    );
  } else if (
    !analysis.anatomyPrediction.selectedRegionMatches ||
    analysis.anatomyPrediction.region !== selectedRegion
  ) {
    reasons.push(
      "The automatic anatomy check did not match the selected region. The image was not added.",
    );
  }
  return reasons;
}

export function captureAnalysisRetryDisposition(
  analysis: AnalysisResult,
  selectedRegion: MouthRegion,
): "preserve" | "reject" | "update" {
  if (analysis.analysisOrigin === "unavailable") {
    // No learned output also describes a measured rejection before model heads
    // run. Service/transport failures alone are not evidence of a bad photo.
    return analysis.quality.faceDetected ||
      (!analysis.quality.accepted &&
        analysis.quality.reasons.some((reason) =>
          MEASURED_IMAGE_REJECTION_REASONS.has(reason),
        ))
      ? "reject"
      : "preserve";
  }
  if (captureStorageRejectionReasons(analysis, selectedRegion).length > 0) {
    return "reject";
  }
  return analysis.status === "failed" ? "preserve" : "update";
}
