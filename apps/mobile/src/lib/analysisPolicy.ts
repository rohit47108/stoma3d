import type { AnalysisResult, MouthRegion } from "@stoma3d/contracts";

export function captureStorageRejectionReasons(
  analysis: AnalysisResult,
  selectedRegion: MouthRegion,
): string[] {
  const reasons = [...analysis.quality.reasons];
  if (!analysis.quality.accepted && reasons.length === 0) {
    reasons.push("Server quality validation rejected this image.");
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
  // A transport failure is not evidence that a previously accepted photo is bad.
  if (analysis.analysisOrigin === "unavailable") return "preserve";
  if (captureStorageRejectionReasons(analysis, selectedRegion).length > 0) {
    return "reject";
  }
  return analysis.status === "failed" ? "preserve" : "update";
}
