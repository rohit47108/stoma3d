import type { AnalysisResult, AnalysisStatus } from "@stoma3d/contracts";
import type { CaptureRecord } from "../types";

const RESULT_REASON_COPY: Readonly<Record<string, string>> = {
  image_too_small: "The image is too small to evaluate reliably.",
  image_too_blurry:
    "The image is too blurry. Hold the phone steady and try again.",
  exposure_out_of_range:
    "The image is too dark or too bright. Use even lighting and try again.",
  excessive_glare:
    "Reflections cover too much of the image. Change the angle or lighting.",
  image_obstructed:
    "The selected mouth region is partly blocked. Reframe and try again.",
  face_detected:
    "A face or identifying facial area was detected. Reframe to show mouth tissue only.",
  face_check_unavailable:
    "The privacy face check could not run, so the image was not accepted.",
  quality_control_model_abstained:
    "The learned quality check was not confident enough, so the image was not accepted.",
  quality_control_inference_failed:
    "The learned quality check could not finish, so the image was not accepted.",
  learned_quality_blurry:
    "The learned quality check found blur. Hold the phone steady and try again.",
  learned_quality_too_dark:
    "The learned quality check found that the image was too dark.",
  learned_quality_too_bright:
    "The learned quality check found that the image was too bright.",
  learned_quality_glare_heavy:
    "The learned quality check found too much glare.",
  learned_quality_target_region_missing:
    "The learned quality check could not find the selected mouth region.",
  learned_quality_too_far:
    "The learned quality check found that the camera was too far away.",
  learned_quality_too_close:
    "The learned quality check found that the camera was too close.",
  learned_quality_obstructed:
    "The learned quality check found that the selected tissue was blocked.",
  out_of_distribution_model_abstained:
    "The image-similarity check was not confident enough to continue.",
  out_of_distribution_inference_failed:
    "The image-similarity check could not finish.",
  unsupported_image_distribution:
    "This image does not sufficiently resemble the supported evaluation images.",
  anatomy_release_gate_unmet:
    "The automatic mouth-region check is currently unavailable.",
  anatomy_model_abstained:
    "The automatic mouth-region check was not confident enough.",
  selected_region_anatomy_mismatch:
    "The image did not appear to match the selected mouth region.",
  anatomy_inference_failed:
    "The automatic mouth-region check could not finish.",
  segmentation_release_gate_unmet:
    "The abnormal-area model has not passed its required accuracy checks, so no candidate outline was shown.",
  segmentation_inference_failed: "The abnormal-area analysis could not finish.",
  oral_tissue_segmentation_inference_failed:
    "The oral-tissue boundary check could not finish.",
  secondary_segmentation_inference_failed:
    "The independent outline check could not finish.",
  segmentation_models_disagree:
    "Two released outline models disagreed too much, so no candidate result was shown.",
  appearance_inference_failed:
    "The appearance-description analysis could not finish.",
  disease_research_inference_failed:
    "The additional image-pattern analysis could not finish.",
  baseline_image_quality_rejected:
    "The earlier image did not pass the image-quality checks.",
  current_image_quality_rejected:
    "The newer image did not pass the image-quality checks.",
  user_confirmation_required:
    "Confirm that both images show the same observation before comparing them.",
  lesion_reidentification_release_gate_unmet:
    "Automatic observation matching has not passed its required accuracy checks.",
  lesion_reidentification_inference_failed:
    "Automatic observation matching could not finish.",
  candidate_match_score_unavailable: "No automatic match score is available.",
  baseline_candidate_region_unavailable:
    "The earlier image has no validated candidate outline.",
  current_candidate_region_unavailable:
    "The newer image has no validated candidate outline.",
  repeated_capture_area_error_gate_unmet:
    "Change estimates are disabled until repeated-photo testing meets the required error limit.",
  registration_inlier_ratio_below_gate:
    "The two images do not contain enough matching visual landmarks.",
  registration_reprojection_error_above_gate:
    "The two images could not be aligned closely enough.",
  baseline_candidate_area_unavailable:
    "The earlier image has no validated approximate candidate area.",
  registered_baseline_candidate_area_unavailable:
    "The earlier candidate area could not be aligned to the newer image.",
  current_candidate_area_unavailable:
    "The newer image has no validated approximate candidate area.",
  baseline_candidate_area_zero:
    "The earlier image has no measurable candidate area.",
  fixture_region_mismatch:
    "The bundled demonstration case does not match the selected region.",
  fixture_comparison_not_eligible:
    "This bundled demonstration case is not eligible for comparison.",
};

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "The service did not provide a reason.";
  const readable = trimmed.replaceAll("_", " ");
  const sentence = `${readable.charAt(0).toUpperCase()}${readable.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

export function humanizeResultReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return "The service did not provide a reason.";
  const fixedCopy = RESULT_REASON_COPY[trimmed];
  if (fixedCopy) return fixedCopy;
  if (trimmed.includes(" ") || !trimmed.includes("_")) {
    return sentenceCase(trimmed);
  }
  return sentenceCase(trimmed);
}

export function analysisStatusTitle(
  status: AnalysisStatus | undefined,
  hasCandidateMask: boolean,
): string {
  if (status === "complete") {
    return hasCandidateMask
      ? "Candidate area described"
      : "No candidate area outlined";
  }
  if (status === "abstained") return "No abnormal-area result shown";
  if (status === "unsupported") return "Image unsupported";
  return "Analysis unavailable";
}

export function historyInputLabel(
  capture: Pick<CaptureRecord, "inputOrigin" | "captureSource">,
  analysisOrigin?: AnalysisResult["analysisOrigin"],
): string {
  const input =
    capture.inputOrigin === "bundled_demo"
      ? "Sample photo"
      : capture.captureSource === "photo_library"
        ? "Uploaded photo"
        : capture.captureSource === "camera"
          ? "Camera photo"
          : capture.captureSource === "video_sweep"
            ? "Video frame"
            : "Photo";
  const output =
    analysisOrigin === "live_model"
      ? "Live analysis"
      : analysisOrigin === "cached_model_result"
        ? "Cached analysis"
        : analysisOrigin === "manual_fixture"
          ? "Manual example"
          : analysisOrigin === "unavailable"
            ? "Analysis unavailable"
            : "No result saved";
  return `${input} · ${output}`;
}

export function historyResultDescription(
  analysis:
    | Pick<AnalysisResult, "status" | "candidateMask" | "descriptors">
    | undefined,
): string {
  if (
    analysis?.status === "complete" &&
    analysis.candidateMask &&
    analysis.descriptors
  ) {
    return `Area outlined · Approx. ${(analysis.descriptors.normalizedArea * 100).toFixed(1)}% of photo`;
  }
  return analysisStatusTitle(
    analysis?.status,
    Boolean(analysis?.candidateMask),
  );
}
