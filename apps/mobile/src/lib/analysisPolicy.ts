import type {
  AnalysisResult,
  CaptureProtocol,
  MouthRegion,
} from "@stoma3d/contracts";

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
