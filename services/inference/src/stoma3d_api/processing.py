"""Image sanitization, quality checks, learned inference, and registration.

Learned outputs are available only through startup-validated, hash-pinned ONNX
adapters. The deterministic routines here derive visual descriptors from an
actual model mask; they do not substitute color rules for a missing model.
"""

from __future__ import annotations

import io
import hashlib
import math
import threading
import warnings
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .contracts import (
    AnalysisOrigin,
    AnalysisResult,
    AnalysisStatus,
    AnalyzeMetadata,
    AnatomyPrediction,
    AppearanceClass,
    CandidateMask,
    CalibratedMeasurementChanges,
    ClassScore,
    ComparisonResult,
    CompareMetadata,
    DescriptorChanges,
    DiseaseResearchClass,
    DistributionClass,
    ImagePixelSize,
    ModelHead,
    ModelOutput,
    MouthRegion,
    QualityClass,
    QualityResult,
    RegistrationAlignment,
    Uncertainty,
    VisualDescriptors,
)
from .calibration import (
    NEUTRAL_COLOR_REFERENCE_VERSION,
    NeutralColorReference,
    estimate_calibrated_bounding_box,
    estimate_neutral_color_reference,
)
from .model_adapters import (
    ClassificationPrediction,
    EmbeddingPrediction,
    ModelAdapter,
    ModelAdapterError,
    SegmentationPrediction,
)
from .release_manifest import RELEASE_RUNTIME, ReleaseRuntimeState

MAX_IMAGE_BYTES = 1_750_000
MAX_IMAGE_PIXELS = 20_000_000
MAX_PROCESSING_EDGE = 2_048
QUALITY_ANALYSIS_EDGE = 512
SUPPORTED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}
SUPPORTED_PIL_FORMATS = {"JPEG", "PNG", "WEBP"}

MODEL_VERSIONS = {
    "quality": "opencv-quality-yunet-v4-512",
    "registration": "orb-homography-descriptor-normalization-v4",
}
MINIMUM_SEGMENTATION_ENSEMBLE_IOU = 0.50
YUNET_MODEL_PATH = (
    Path(__file__).resolve().parent / "assets" / "face_detection_yunet_2023mar.onnx"
)
YUNET_MODEL_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
# Calibrated on licensed SMART-OM train/validation images and deliberately
# blurred copies. The prior 0.09 cutoff rejected roughly 31% of the usable
# calibration images; this cutoff rejected 9.2% while accepting none of the
# severe-blur controls. Physical-device acceptance testing remains a release
# requirement.
MIN_BLUR_SCORE = 0.054


class ImageInputError(ValueError):
    """Raised when bytes cannot safely be treated as a supported image."""


@dataclass(frozen=True, slots=True)
class SanitizedImage:
    """An EXIF-free JPEG and the exact pixels used for analysis."""

    jpeg_bytes: bytes
    rgb: np.ndarray
    bgr: np.ndarray


def _clamp(value: float) -> float:
    return float(max(0.0, min(1.0, value)))


def _invoked_model_versions(
    runtime: ReleaseRuntimeState,
    invoked_heads: set[ModelHead],
) -> dict[str, str]:
    versions = dict(MODEL_VERSIONS)
    for head in invoked_heads:
        state = runtime.heads[head]
        if state.version is not None:
            versions[head.value] = state.version
    return versions


def sanitize_image(raw: bytes) -> SanitizedImage:
    """Decode, orient, bound, RGB-normalize, and re-encode an upload.

    Processing the re-decoded JPEG ensures descriptors correspond to the
    sanitized bytes that could safely be forwarded to a model.  No EXIF,
    filename, ICC profile, or other source metadata survives this boundary.
    """

    if not raw:
        raise ImageInputError("The uploaded image is empty.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ImageInputError("The uploaded image exceeds the 1.75 MB transport limit.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                source_format = (source.format or "").upper()
                if source_format not in SUPPORTED_PIL_FORMATS:
                    raise ImageInputError(
                        "Only JPEG, PNG, and WebP images are supported."
                    )
                if getattr(source, "n_frames", 1) != 1:
                    raise ImageInputError(
                        "Animated or multi-frame images are not supported."
                    )
                width, height = source.size
                if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
                    raise ImageInputError("The image dimensions are not supported.")
                oriented = ImageOps.exif_transpose(source)
                rgb_image = oriented.convert("RGB")
                if max(rgb_image.size) > MAX_PROCESSING_EDGE:
                    rgb_image.thumbnail(
                        (MAX_PROCESSING_EDGE, MAX_PROCESSING_EDGE),
                        Image.Resampling.LANCZOS,
                    )

                encoded = io.BytesIO()
                rgb_image.save(
                    encoded,
                    format="JPEG",
                    quality=90,
                    optimize=False,
                    progressive=False,
                    exif=b"",
                )
    except ImageInputError:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise ImageInputError("The upload is not a decodable image.") from exc
    except Image.DecompressionBombWarning as exc:
        raise ImageInputError("The image dimensions exceed the safety limit.") from exc

    jpeg_bytes = encoded.getvalue()
    encoded_array = np.frombuffer(jpeg_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(encoded_array, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ImageInputError("The sanitized image could not be decoded.")
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return SanitizedImage(jpeg_bytes=jpeg_bytes, rgb=rgb, bgr=bgr)


@dataclass(frozen=True, slots=True)
class _FaceDetectorState:
    detector: object
    lock: threading.Lock


@lru_cache(maxsize=1)
def _face_detector() -> _FaceDetectorState | None:
    try:
        if (
            not YUNET_MODEL_PATH.is_file()
            or hashlib.sha256(YUNET_MODEL_PATH.read_bytes()).hexdigest()
            != YUNET_MODEL_SHA256
        ):
            return None
        detector = cv2.FaceDetectorYN_create(
            str(YUNET_MODEL_PATH),
            "",
            (320, 320),
            0.85,
            0.3,
            5000,
        )
        return _FaceDetectorState(
            detector=detector,
            lock=threading.Lock(),
        )
    except (AttributeError, cv2.error, OSError, ValueError):
        return None


def _detect_face(image: SanitizedImage) -> bool | None:
    state = _face_detector()
    if state is None:
        return None
    height, width = image.bgr.shape[:2]
    longest = max(height, width)
    scale = min(1.0, 640.0 / max(longest, 1))
    detection_image = (
        image.bgr
        if scale == 1.0
        else cv2.resize(
            image.bgr,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    )
    detection_height, detection_width = detection_image.shape[:2]
    try:
        with state.lock:
            state.detector.setInputSize((detection_width, detection_height))
            _, faces = state.detector.detect(detection_image)
    except (AttributeError, cv2.error, TypeError, ValueError):
        return None
    return faces is not None and len(faces) > 0


@lru_cache(maxsize=1)
def privacy_check_ready() -> bool:
    """Exercise the packaged detector on non-patient pixels before readiness."""
    bgr = np.zeros((320, 320, 3), dtype=np.uint8)
    probe = SanitizedImage(b"", bgr, bgr)
    return _detect_face(probe) is not None


def assess_quality(image: SanitizedImage) -> tuple[QualityResult, float]:
    """Return deterministic, normalized capture-quality signals.

    ``blurScore`` and ``exposureScore`` are pass confidences (higher is better),
    while ``glareScore`` and ``obstructionScore`` are problem severities (lower
    is better).  The API README records these semantics for clients.
    """

    height, width = image.bgr.shape[:2]
    scale = min(1.0, QUALITY_ANALYSIS_EDGE / max(height, width))
    # Focus must not depend on the phone's sensor resolution. Keep aspect
    # ratio, downsample only, and use the same image for all quality metrics.
    quality_bgr = (
        image.bgr
        if scale == 1.0
        else cv2.resize(
            image.bgr,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    )
    gray = cv2.cvtColor(quality_bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(quality_bgr, cv2.COLOR_BGR2HSV)

    laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    blur_score = _clamp(1.0 - math.exp(-laplacian_variance / 180.0))
    exposure_score = _clamp(float(np.mean((gray >= 30) & (gray <= 225))))
    glare_score = _clamp(float(np.mean((hsv[:, :, 2] >= 245) & (hsv[:, :, 1] <= 55))))
    obstruction_score = _clamp(float(np.mean(gray <= 20)))

    face_check = _detect_face(image) if min(width, height) >= 128 else None
    face_detected = face_check is True

    reasons: list[str] = []
    if min(width, height) < 128:
        reasons.append("image_too_small")
    if blur_score < MIN_BLUR_SCORE:
        reasons.append("image_too_blurry")
    if exposure_score < 0.65:
        reasons.append("exposure_out_of_range")
    if glare_score > 0.15:
        reasons.append("excessive_glare")
    if obstruction_score > 0.20:
        reasons.append("image_obstructed")
    if face_detected:
        reasons.append("face_detected")
    elif face_check is None:
        reasons.append("face_check_unavailable")

    quality_confidence = _clamp(
        np.mean(
            [
                blur_score,
                exposure_score,
                1.0 - glare_score,
                1.0 - obstruction_score,
            ]
        )
        * (0.5 if face_detected else 1.0)
    )
    return (
        QualityResult(
            accepted=not reasons,
            blur_score=blur_score,
            exposure_score=exposure_score,
            glare_score=glare_score,
            obstruction_score=obstruction_score,
            face_detected=face_detected,
            reasons=reasons,
        ),
        quality_confidence,
    )


def _segmentation_probabilities_for_image(
    image: SanitizedImage,
    prediction: SegmentationPrediction,
) -> np.ndarray:
    probabilities = np.asarray(prediction.probabilities, dtype=np.float32)
    if (
        probabilities.ndim != 2
        or probabilities.size == 0
        or not np.all(np.isfinite(probabilities))
        or float(np.min(probabilities)) < 0
        or float(np.max(probabilities)) > 1
        or not math.isfinite(prediction.threshold)
        or not 0 < prediction.threshold < 1
        or not math.isfinite(prediction.confidence)
        or not 0 <= prediction.confidence <= 1
    ):
        raise ModelAdapterError("Segmentation probability map is invalid.")

    rgb = image.rgb
    height, width, _ = rgb.shape
    resized_probabilities = cv2.resize(
        probabilities,
        (width, height),
        interpolation=cv2.INTER_LINEAR,
    )
    return np.clip(resized_probabilities, 0.0, 1.0)


def _apply_tissue_mask(
    image: SanitizedImage,
    candidate: SegmentationPrediction,
    tissue: SegmentationPrediction,
) -> SegmentationPrediction:
    candidate_probabilities = _segmentation_probabilities_for_image(image, candidate)
    tissue_probabilities = _segmentation_probabilities_for_image(image, tissue)
    tissue_pixels = tissue_probabilities >= tissue.threshold
    if not np.any(tissue_pixels):
        raise ModelAdapterError("The oral-tissue segmentation mask is empty.")
    return SegmentationPrediction(
        probabilities=np.where(tissue_pixels, candidate_probabilities, 0.0).astype(
            np.float32
        ),
        threshold=candidate.threshold,
        confidence=min(candidate.confidence, tissue.confidence),
    )


def _segmentation_agreement(
    image: SanitizedImage,
    primary: SegmentationPrediction,
    secondary: SegmentationPrediction,
) -> float:
    primary_mask = (
        _segmentation_probabilities_for_image(image, primary) >= primary.threshold
    )
    secondary_mask = (
        _segmentation_probabilities_for_image(image, secondary) >= secondary.threshold
    )
    union = int(np.count_nonzero(primary_mask | secondary_mask))
    if union == 0:
        return 1.0
    intersection = int(np.count_nonzero(primary_mask & secondary_mask))
    return _clamp(intersection / union)


def candidate_from_model_mask(
    image: SanitizedImage,
    prediction: SegmentationPrediction,
    *,
    color_reference: NeutralColorReference | None = None,
) -> tuple[CandidateMask | None, VisualDescriptors | None, np.ndarray | None]:
    """Convert one validated model probability map into approximate descriptors."""

    resized_probabilities = _segmentation_probabilities_for_image(image, prediction)
    rgb = image.rgb
    height, width, _ = rgb.shape
    binary = (resized_probabilities >= prediction.threshold).astype(np.uint8) * 255

    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    image_area = width * height
    candidates: list[tuple[int, int]] = []
    for label in range(1, count):
        component_area = int(stats[label, cv2.CC_STAT_AREA])
        area_ratio = component_area / image_area
        if 0 < area_ratio <= 1:
            candidates.append((component_area, label))
    if not candidates:
        return None, None, None

    component_area, best_label = max(candidates)
    component = (labels == best_label).astype(np.uint8) * 255
    contours, _ = cv2.findContours(
        component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return None, None, None
    contour = max(contours, key=cv2.contourArea)
    geometric_area = float(cv2.contourArea(contour))
    if geometric_area <= 0:
        return None, None, None

    perimeter_pixels = float(cv2.arcLength(contour, True))
    approximated = cv2.approxPolyDP(contour, max(1.0, perimeter_pixels * 0.015), True)
    points = approximated.reshape(-1, 2)
    x, y, box_width, box_height = cv2.boundingRect(contour)
    if len(points) < 3:
        points = np.array(
            [
                [x, y],
                [x + box_width - 1, y],
                [x + box_width - 1, y + box_height - 1],
                [x, y + box_height - 1],
            ],
            dtype=np.int32,
        )

    x_divisor = max(width - 1, 1)
    y_divisor = max(height - 1, 1)
    polygon = [
        (_clamp(float(point_x) / x_divisor), _clamp(float(point_y) / y_divisor))
        for point_x, point_y in points
    ]
    normalized_area = _clamp(component_area / image_area)
    bounding_box = (
        _clamp(x / width),
        _clamp(y / height),
        _clamp(box_width / width),
        _clamp(box_height / height),
    )

    mask_pixels = component.astype(bool)
    rgb_float = rgb.astype(np.float32)
    selected_rgb = rgb_float[mask_pixels]
    descriptor_rgb = (
        color_reference.correct_rgb(selected_rgb)
        if color_reference is not None and color_reference.applied
        else selected_rgb
    )
    mean_redness = _clamp(
        float(
            np.mean(
                np.maximum(
                    0.0,
                    descriptor_rgb[:, 0]
                    - (descriptor_rgb[:, 1] + descriptor_rgb[:, 2]) / 2.0,
                )
            )
            / 255.0
        )
    )
    mean_brightness = _clamp(float(np.mean(descriptor_rgb)) / 255.0)
    gray = cv2.cvtColor(image.bgr, cv2.COLOR_BGR2GRAY)
    texture_values = cv2.Laplacian(gray, cv2.CV_32F)[mask_pixels]
    texture_contrast = _clamp(float(np.std(texture_values)) / 64.0)
    border_irregularity = max(
        0.0,
        (perimeter_pixels * perimeter_pixels) / (4.0 * math.pi * geometric_area) - 1.0,
    )

    candidate = CandidateMask(
        polygon=polygon,
        bounding_box=bounding_box,
        normalized_area=normalized_area,
    )
    descriptors = VisualDescriptors(
        normalized_area=normalized_area,
        perimeter=perimeter_pixels / max(math.hypot(width, height), 1.0),
        border_irregularity=border_irregularity,
        mean_redness=mean_redness,
        mean_brightness=mean_brightness,
        texture_contrast=texture_contrast,
    )
    return candidate, descriptors, component


def _gated_output(head_name: str) -> ModelOutput:
    return ModelOutput(
        enabled=False,
        gate_passed=False,
        top_label=None,
        confidence=None,
        scores=[],
        limitation=(
            f"The {head_name} research head is disabled because its release gate "
            "has not been satisfied and clinically reviewed."
        ),
    )


def _abstained_model_output(head_name: str, limitation: str) -> ModelOutput:
    return ModelOutput(
        enabled=True,
        gate_passed=True,
        top_label=None,
        confidence=None,
        scores=[],
        limitation=f"The {head_name} research head {limitation}",
    )


def _classification_model_output(
    adapter: ModelAdapter,
    image: SanitizedImage,
    *,
    head_name: str,
    expected_labels: tuple[str, ...],
) -> ModelOutput:
    prediction = adapter.predict(image.rgb)
    if not isinstance(prediction, ClassificationPrediction):
        raise ModelAdapterError(
            f"The {head_name} adapter returned the wrong output type."
        )
    _validate_classification_prediction(prediction, expected_labels)
    return ModelOutput(
        enabled=True,
        gate_passed=True,
        top_label=prediction.top_label,
        confidence=prediction.confidence,
        scores=(
            []
            if prediction.abstained
            else [
                ClassScore(label=label, probability=probability)
                for label, probability in zip(
                    prediction.labels,
                    prediction.probabilities,
                    strict=True,
                )
            ]
        ),
        limitation=(
            f"The {head_name} result is a gated experimental research output, "
            "not a diagnosis or care recommendation."
            if not prediction.abstained
            else (
                f"The {head_name} model abstained because calibrated confidence "
                "was below its release threshold."
            )
        ),
    )


def _validate_classification_prediction(
    prediction: ClassificationPrediction,
    expected_labels: tuple[str, ...],
) -> None:
    probabilities = np.asarray(prediction.probabilities, dtype=np.float64)
    if (
        prediction.labels != expected_labels
        or probabilities.shape != (len(expected_labels),)
        or not np.all(np.isfinite(probabilities))
        or np.any(probabilities < 0)
        or np.any(probabilities > 1)
        or not math.isclose(float(np.sum(probabilities)), 1.0, abs_tol=1e-6)
        or not math.isfinite(prediction.confidence)
        or not 0 <= prediction.confidence <= 1
    ):
        raise ModelAdapterError("Classification probabilities are invalid.")
    top_index = int(np.argmax(probabilities))
    if not math.isclose(
        prediction.confidence,
        float(probabilities[top_index]),
        abs_tol=1e-6,
    ):
        raise ModelAdapterError("Classification confidence is inconsistent.")
    expected_top_label = expected_labels[top_index]
    if prediction.abstained:
        if prediction.top_label is not None:
            raise ModelAdapterError("An abstained classification exposed a label.")
    elif prediction.top_label != expected_top_label:
        raise ModelAdapterError("Classification top label is inconsistent.")


def analyze_sanitized_image(
    image: SanitizedImage,
    metadata: AnalyzeMetadata,
    runtime: ReleaseRuntimeState | None = None,
) -> AnalysisResult:
    runtime = RELEASE_RUNTIME if runtime is None else runtime
    quality, quality_confidence = assess_quality(image)
    requested = set(metadata.requested_heads)
    limitations = [
        "All candidate areas and visual descriptors are approximate and have no physical scale.",
        "Model outputs are research observations and cannot diagnose or rule out disease.",
    ]
    if ModelHead.OUT_OF_DISTRIBUTION not in runtime.adapters:
        limitations.append(
            "Dataset similarity was not assessed because no released out-of-distribution model is available."
        )
    if ModelHead.SECONDARY_SEGMENTATION not in runtime.adapters:
        limitations.append(
            "Model agreement was not assessed because no released independent ensemble is available."
        )
    successful_model_output = False
    invoked_heads: set[ModelHead] = set()
    dataset_similarity: float | None = None
    model_agreement: float | None = None
    distribution_supported = True
    distribution_rejected = False

    quality_adapter = runtime.adapters.get(ModelHead.QUALITY_CONTROL)
    if ModelHead.QUALITY_CONTROL in requested:
        if quality_adapter is None:
            limitations.append(
                "Learned quality control was not assessed because no released quality model is available; deterministic checks were used."
            )
        elif quality.accepted:
            invoked_heads.add(ModelHead.QUALITY_CONTROL)
            learned_quality_reason: str | None = None
            try:
                prediction = quality_adapter.predict(image.rgb)
                if not isinstance(prediction, ClassificationPrediction):
                    raise ModelAdapterError(
                        "The quality-control adapter returned the wrong output type."
                    )
                _validate_classification_prediction(
                    prediction,
                    tuple(item.value for item in QualityClass),
                )
                successful_model_output = True
                quality_confidence = min(quality_confidence, prediction.confidence)
                if prediction.abstained:
                    learned_quality_reason = "quality_control_model_abstained"
                elif prediction.top_label != QualityClass.ACCEPTABLE.value:
                    assert prediction.top_label is not None
                    learned_quality_reason = (
                        "learned_quality_" + prediction.top_label.replace("-", "_")
                    )
            except Exception:
                learned_quality_reason = "quality_control_inference_failed"
            if learned_quality_reason is not None:
                quality = QualityResult(
                    accepted=False,
                    blur_score=quality.blur_score,
                    exposure_score=quality.exposure_score,
                    glare_score=quality.glare_score,
                    obstruction_score=quality.obstruction_score,
                    face_detected=quality.face_detected,
                    reasons=list(
                        dict.fromkeys([*quality.reasons, learned_quality_reason])
                    ),
                )

    ood_adapter = runtime.adapters.get(ModelHead.OUT_OF_DISTRIBUTION)
    if ModelHead.OUT_OF_DISTRIBUTION in requested:
        if ood_adapter is None:
            limitations.append(
                "Dataset similarity was not assessed because no released out-of-distribution model is available."
            )
        elif quality.accepted:
            invoked_heads.add(ModelHead.OUT_OF_DISTRIBUTION)
            try:
                prediction = ood_adapter.predict(image.rgb)
                if not isinstance(prediction, ClassificationPrediction):
                    raise ModelAdapterError(
                        "The out-of-distribution adapter returned the wrong output type."
                    )
                expected_labels = tuple(item.value for item in DistributionClass)
                _validate_classification_prediction(prediction, expected_labels)
                supported_index = expected_labels.index(
                    DistributionClass.SUPPORTED.value
                )
                dataset_similarity = prediction.probabilities[supported_index]
                successful_model_output = True
                if prediction.abstained:
                    distribution_supported = False
                    quality.reasons.append("out_of_distribution_model_abstained")
                elif prediction.top_label == DistributionClass.UNSUPPORTED.value:
                    distribution_supported = False
                    distribution_rejected = True
                    quality.reasons.append("unsupported_image_distribution")
            except Exception:
                dataset_similarity = None
                distribution_supported = False
                quality.reasons.append("out_of_distribution_inference_failed")

    anatomy_prediction = AnatomyPrediction(
        region=None,
        confidence=0.0,
        supported=False,
        selected_region_matches=False,
    )
    abstention_reasons = list(quality.reasons)
    anatomy_supported_and_matches = False
    segmentation_prediction: SegmentationPrediction | None = None
    tissue_prediction: SegmentationPrediction | None = None
    segmentation_confidence = 0.0

    for required_head in (ModelHead.SEGMENTATION, ModelHead.ANATOMY):
        if (
            not runtime.heads[required_head].enabled
            or required_head not in runtime.adapters
        ):
            abstention_reasons.append(f"{required_head.value}_release_gate_unmet")
    abstention_reasons.extend(runtime.load_reasons)

    anatomy_adapter = runtime.adapters.get(ModelHead.ANATOMY)
    if quality.accepted and distribution_supported and anatomy_adapter is not None:
        invoked_heads.add(ModelHead.ANATOMY)
        try:
            anatomy_result = anatomy_adapter.predict(image.rgb)
            if not isinstance(anatomy_result, ClassificationPrediction):
                raise ModelAdapterError(
                    "The anatomy adapter returned the wrong output type."
                )
            expected_labels = tuple(region.value for region in MouthRegion)
            _validate_classification_prediction(anatomy_result, expected_labels)
            predicted_region = (
                MouthRegion(anatomy_result.top_label)
                if anatomy_result.top_label is not None
                else None
            )
            successful_model_output = True
            anatomy_supported_and_matches = predicted_region is metadata.selected_region
            anatomy_prediction = AnatomyPrediction(
                region=predicted_region,
                confidence=anatomy_result.confidence,
                supported=predicted_region is not None,
                selected_region_matches=anatomy_supported_and_matches,
            )
            if anatomy_result.abstained:
                abstention_reasons.append("anatomy_model_abstained")
            elif not anatomy_supported_and_matches:
                abstention_reasons.append("selected_region_anatomy_mismatch")
        except Exception:
            abstention_reasons.append("anatomy_inference_failed")
    elif quality.accepted and distribution_supported:
        limitations.append(
            "Anatomy support is unavailable because no validated anatomy adapter is loaded."
        )

    tissue_adapter = runtime.adapters.get(ModelHead.ORAL_TISSUE_SEGMENTATION)
    tissue_requested = ModelHead.ORAL_TISSUE_SEGMENTATION in requested
    if tissue_requested and tissue_adapter is None:
        limitations.append(
            "A separate oral-tissue mask was not assessed because no released oral-tissue segmentation model is available."
        )
    elif (
        tissue_requested
        and tissue_adapter is not None
        and quality.accepted
        and distribution_supported
        and anatomy_supported_and_matches
    ):
        invoked_heads.add(ModelHead.ORAL_TISSUE_SEGMENTATION)
        try:
            raw_tissue = tissue_adapter.predict(image.rgb)
            if not isinstance(raw_tissue, SegmentationPrediction):
                raise ModelAdapterError(
                    "The oral-tissue adapter returned the wrong output type."
                )
            tissue_probabilities = _segmentation_probabilities_for_image(
                image, raw_tissue
            )
            if not np.any(tissue_probabilities >= raw_tissue.threshold):
                raise ModelAdapterError("The oral-tissue segmentation mask is empty.")
            tissue_prediction = raw_tissue
            successful_model_output = True
        except Exception:
            abstention_reasons.append("oral_tissue_segmentation_inference_failed")

    tissue_required = tissue_requested and tissue_adapter is not None

    segmentation_adapter = runtime.adapters.get(ModelHead.SEGMENTATION)
    if (
        quality.accepted
        and distribution_supported
        and anatomy_supported_and_matches
        and (not tissue_required or tissue_prediction is not None)
        and segmentation_adapter is not None
    ):
        invoked_heads.add(ModelHead.SEGMENTATION)
        try:
            raw_segmentation = segmentation_adapter.predict(image.rgb)
            if not isinstance(raw_segmentation, SegmentationPrediction):
                raise ModelAdapterError(
                    "The segmentation adapter returned the wrong output type."
                )
            if tissue_prediction is not None:
                raw_segmentation = _apply_tissue_mask(
                    image,
                    raw_segmentation,
                    tissue_prediction,
                )
            # Validate and convert the model mask before marking this request complete.
            candidate_from_model_mask(image, raw_segmentation)
            segmentation_prediction = raw_segmentation
            segmentation_confidence = raw_segmentation.confidence
            successful_model_output = True
        except Exception:
            abstention_reasons.append("segmentation_inference_failed")
    elif (
        quality.accepted
        and distribution_supported
        and anatomy_supported_and_matches
        and (not tissue_required or tissue_prediction is not None)
    ):
        limitations.append(
            "Candidate masks are unavailable because no validated segmentation adapter is loaded."
        )

    base_primary_complete = (
        quality.accepted
        and distribution_supported
        and anatomy_supported_and_matches
        and segmentation_prediction is not None
    )
    secondary_adapter = runtime.adapters.get(ModelHead.SECONDARY_SEGMENTATION)
    secondary_requested = ModelHead.SECONDARY_SEGMENTATION in requested
    secondary_required = secondary_requested and secondary_adapter is not None
    secondary_passed = not secondary_required
    if secondary_requested and secondary_adapter is None:
        limitations.append(
            "Model agreement was not assessed because no released independently trained secondary segmentation model is available."
        )
    elif base_primary_complete and secondary_adapter is not None:
        invoked_heads.add(ModelHead.SECONDARY_SEGMENTATION)
        try:
            raw_secondary = secondary_adapter.predict(image.rgb)
            if not isinstance(raw_secondary, SegmentationPrediction):
                raise ModelAdapterError(
                    "The secondary segmentation adapter returned the wrong output type."
                )
            if tissue_prediction is not None:
                raw_secondary = _apply_tissue_mask(
                    image,
                    raw_secondary,
                    tissue_prediction,
                )
            assert segmentation_prediction is not None
            model_agreement = _segmentation_agreement(
                image,
                segmentation_prediction,
                raw_secondary,
            )
            segmentation_confidence = min(
                segmentation_confidence,
                raw_secondary.confidence,
                model_agreement,
            )
            successful_model_output = True
            secondary_passed = model_agreement >= MINIMUM_SEGMENTATION_ENSEMBLE_IOU
            if not secondary_passed:
                abstention_reasons.append("segmentation_models_disagree")
                limitations.append(
                    "Independent segmentation masks disagreed beyond the released comparison threshold, so the candidate result was withheld."
                )
        except Exception:
            secondary_passed = False
            model_agreement = None
            abstention_reasons.append("secondary_segmentation_inference_failed")

    primary_complete = base_primary_complete and secondary_passed
    candidate_mask: CandidateMask | None = None
    descriptors: VisualDescriptors | None = None
    color_reference: NeutralColorReference | None = None
    if primary_complete and segmentation_prediction is not None:
        candidate_mask, descriptors, _ = candidate_from_model_mask(
            image,
            segmentation_prediction,
        )
        if candidate_mask is None:
            limitations.append(
                "The released segmentation model returned no thresholded candidate region."
            )
            if metadata.calibration is not None:
                limitations.append(
                    "Neutral-patch color normalization was not applied because no completed candidate region was available."
                )
        elif metadata.calibration is not None:
            color_reference = estimate_neutral_color_reference(
                image.bgr,
                candidate_mask.bounding_box,
                plane_confirmed=metadata.calibration.plane_confirmed,
                expected_marker_id=metadata.calibration.marker_id,
                marker_side_mm=metadata.calibration.marker_side_mm,
            )
            if color_reference.applied:
                candidate_mask, descriptors, _ = candidate_from_model_mask(
                    image,
                    segmentation_prediction,
                    color_reference=color_reference,
                )
                limitations.append(
                    "Mean redness and mean brightness were normalized from all four neutral patches on the detected Stoma3D calibration card. The source image, mask, anatomy, quality, texture, and guidance inputs were not changed."
                )
            else:
                rendered_reasons = ", ".join(
                    reason.replace("_", " ")
                    for reason in color_reference.suppression_reasons
                )
                limitations.append(
                    "Neutral-patch color normalization was not applied"
                    + (f": {rendered_reasons}. " if rendered_reasons else ". ")
                    + "The approximate color descriptors use the uncorrected sanitized image."
                )
    elif metadata.calibration is not None:
        limitations.append(
            "Neutral-patch color normalization was not applied because no completed candidate region was available."
        )

    appearance_output: ModelOutput | None = None
    if ModelHead.APPEARANCE in requested:
        appearance_adapter = runtime.adapters.get(ModelHead.APPEARANCE)
        if appearance_adapter is None:
            appearance_output = _gated_output("appearance")
        elif not primary_complete:
            appearance_output = _abstained_model_output(
                "appearance",
                "was not run because the primary analysis did not complete.",
            )
        else:
            invoked_heads.add(ModelHead.APPEARANCE)
            try:
                appearance_output = _classification_model_output(
                    appearance_adapter,
                    image,
                    head_name="appearance",
                    expected_labels=tuple(item.value for item in AppearanceClass),
                )
                successful_model_output = True
            except Exception:
                appearance_output = _abstained_model_output(
                    "appearance",
                    "failed for this image and exposed no prediction.",
                )
                abstention_reasons.append("appearance_inference_failed")

    disease_output: ModelOutput | None = None
    if ModelHead.DISEASE_RESEARCH in requested:
        disease_adapter = runtime.adapters.get(ModelHead.DISEASE_RESEARCH)
        if disease_adapter is None:
            disease_output = _gated_output("disease-category")
        elif not primary_complete:
            disease_output = _abstained_model_output(
                "disease-category",
                "was not run because the primary analysis did not complete.",
            )
        else:
            invoked_heads.add(ModelHead.DISEASE_RESEARCH)
            try:
                disease_output = _classification_model_output(
                    disease_adapter,
                    image,
                    head_name="disease-category",
                    expected_labels=tuple(item.value for item in DiseaseResearchClass),
                )
                successful_model_output = True
            except Exception:
                disease_output = _abstained_model_output(
                    "disease-category",
                    "failed for this image and exposed no prediction.",
                )
                abstention_reasons.append("disease_research_inference_failed")

    if primary_complete:
        status = AnalysisStatus.COMPLETE
    elif distribution_rejected:
        status = AnalysisStatus.UNSUPPORTED
    elif (
        quality.accepted
        and anatomy_prediction.confidence > 0
        and (
            not anatomy_prediction.supported
            or not anatomy_prediction.selected_region_matches
        )
    ):
        status = AnalysisStatus.UNSUPPORTED
    else:
        status = AnalysisStatus.ABSTAINED

    confidence_factors = [
        quality_confidence,
        anatomy_prediction.confidence,
        segmentation_confidence,
    ]
    if dataset_similarity is not None:
        confidence_factors.append(dataset_similarity)
    if model_agreement is not None:
        confidence_factors.append(model_agreement)
    overall_confidence = min(confidence_factors) if primary_complete else 0.0
    if not primary_complete:
        limitations.append("No completed image interpretation is available.")

    model_versions = _invoked_model_versions(runtime, invoked_heads)
    if color_reference is not None and color_reference.applied:
        model_versions["descriptor_color_reference"] = NEUTRAL_COLOR_REFERENCE_VERSION

    return AnalysisResult(
        capture_id=metadata.capture_id,
        region=metadata.selected_region,
        quality=quality,
        anatomy_prediction=anatomy_prediction,
        candidate_mask=candidate_mask,
        descriptors=descriptors,
        appearance_output=appearance_output,
        disease_research_output=disease_output,
        uncertainty=Uncertainty(
            overall_confidence=overall_confidence,
            image_quality_confidence=quality_confidence,
            dataset_similarity=dataset_similarity,
            model_agreement=model_agreement,
            limitations=list(dict.fromkeys(limitations)),
        ),
        abstention_reasons=list(dict.fromkeys(abstention_reasons)),
        model_versions=model_versions,
        input_origin=metadata.input_origin,
        analysis_origin=(
            AnalysisOrigin.LIVE_MODEL
            if successful_model_output
            else AnalysisOrigin.UNAVAILABLE
        ),
        status=status,
    )


def failed_analysis(metadata: AnalyzeMetadata) -> AnalysisResult:
    """Return a schema-valid unavailable result without substituting a fixture."""

    reason = "analysis_unavailable"
    return AnalysisResult(
        capture_id=metadata.capture_id,
        region=metadata.selected_region,
        quality=QualityResult(
            accepted=False,
            blur_score=0,
            exposure_score=0,
            glare_score=0,
            obstruction_score=0,
            face_detected=False,
            reasons=[reason],
        ),
        anatomy_prediction=AnatomyPrediction(
            region=None,
            confidence=0,
            supported=False,
            selected_region_matches=False,
        ),
        candidate_mask=None,
        descriptors=None,
        appearance_output=None,
        disease_research_output=None,
        uncertainty=Uncertainty(
            overall_confidence=0,
            image_quality_confidence=0,
            dataset_similarity=None,
            model_agreement=None,
            limitations=[
                "Analysis failed; no result or fixture substitution is available."
            ],
        ),
        abstention_reasons=[reason],
        model_versions=MODEL_VERSIONS,
        input_origin=metadata.input_origin,
        analysis_origin=AnalysisOrigin.UNAVAILABLE,
        status=AnalysisStatus.FAILED,
    )


def _orb_registration(
    baseline: SanitizedImage, current: SanitizedImage
) -> tuple[float, float, float, list[str], np.ndarray | None]:
    baseline_gray = cv2.cvtColor(baseline.bgr, cv2.COLOR_BGR2GRAY)
    current_gray = cv2.cvtColor(current.bgr, cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(nfeatures=1_200, fastThreshold=10)
    baseline_keypoints, baseline_descriptors = orb.detectAndCompute(baseline_gray, None)
    current_keypoints, current_descriptors = orb.detectAndCompute(current_gray, None)
    if (
        baseline_descriptors is None
        or current_descriptors is None
        or len(baseline_keypoints) < 8
        or len(current_keypoints) < 8
    ):
        return 0.0, 1.0, 0.0, ["insufficient_registration_features"], None

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = sorted(
        matcher.match(baseline_descriptors, current_descriptors),
        key=lambda m: m.distance,
    )
    good = [match for match in matches if match.distance <= 64]
    if len(good) < 8:
        return 0.0, 1.0, 0.0, ["insufficient_feature_matches"], None

    source_points = np.float32(
        [baseline_keypoints[match.queryIdx].pt for match in good]
    ).reshape(-1, 1, 2)
    destination_points = np.float32(
        [current_keypoints[match.trainIdx].pt for match in good]
    ).reshape(-1, 1, 2)
    homography, inlier_mask = cv2.findHomography(
        source_points, destination_points, cv2.RANSAC, 3.0
    )
    if (
        homography is None
        or inlier_mask is None
        or homography.shape != (3, 3)
        or not np.all(np.isfinite(homography))
        or abs(float(np.linalg.det(homography))) < 1e-10
    ):
        return 0.0, 1.0, 0.0, ["registration_failed"], None

    inliers = inlier_mask.ravel().astype(bool)
    inlier_ratio = _clamp(float(np.mean(inliers)))
    projected = cv2.perspectiveTransform(source_points, homography)
    errors = np.linalg.norm(projected[:, 0, :] - destination_points[:, 0, :], axis=1)
    inlier_errors = errors[inliers]
    diagonal = max(math.hypot(*current_gray.shape[::-1]), 1.0)
    reprojection_error_ratio = (
        float(np.median(inlier_errors) / diagonal) if inlier_errors.size else 1.0
    )
    error_confidence = _clamp(1.0 - reprojection_error_ratio / 0.03)
    registration_confidence = _clamp(0.65 * inlier_ratio + 0.35 * error_confidence)
    reasons: list[str] = []
    if inlier_ratio < 0.60:
        reasons.append("registration_inlier_ratio_below_gate")
    if reprojection_error_ratio > 0.03:
        reasons.append("registration_reprojection_error_above_gate")
    return (
        inlier_ratio,
        reprojection_error_ratio,
        registration_confidence,
        reasons,
        homography,
    )


def _public_registration_alignment(
    baseline: SanitizedImage,
    current: SanitizedImage,
    baseline_to_current_pixels: np.ndarray,
) -> RegistrationAlignment | None:
    """Convert a gated pixel homography into a bounded client-safe transform.

    OpenCV estimates baseline-to-current pixel coordinates. The comparison UI
    overlays the current capture on the baseline, so the public transform is
    the inverse mapping in normalized image coordinates. No image bytes or
    derived registered image are returned.
    """

    baseline_height, baseline_width = baseline.bgr.shape[:2]
    current_height, current_width = current.bgr.shape[:2]
    if min(baseline_height, baseline_width, current_height, current_width) < 1:
        return None
    try:
        current_to_baseline_pixels = np.linalg.inv(baseline_to_current_pixels)
    except np.linalg.LinAlgError:
        return None

    baseline_pixel_scale = np.diag(
        [max(baseline_width - 1, 1), max(baseline_height - 1, 1), 1.0]
    )
    current_pixel_scale = np.diag(
        [max(current_width - 1, 1), max(current_height - 1, 1), 1.0]
    )
    try:
        normalized = (
            np.linalg.inv(baseline_pixel_scale)
            @ current_to_baseline_pixels
            @ current_pixel_scale
        )
    except np.linalg.LinAlgError:
        return None
    if normalized.shape != (3, 3) or not np.all(np.isfinite(normalized)):
        return None
    scale = float(normalized[2, 2])
    if abs(scale) < 1e-10:
        return None
    normalized = normalized / scale
    determinant = float(np.linalg.det(normalized))
    if not math.isfinite(determinant) or abs(determinant) < 1e-10:
        return None

    # Reject transforms with a projective horizon through or immediately next
    # to the rendered image. The client can safely clip finite off-canvas
    # coordinates, but cannot safely divide by a near-zero homogeneous value.
    sample_points = np.array(
        [
            [0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0, 0.5, 1.0],
            [0.0, 0.0, 0.0, 0.5, 0.5, 0.5, 1.0, 1.0, 1.0],
            [1.0] * 9,
        ],
        dtype=np.float64,
    )
    projected = normalized @ sample_points
    denominators = projected[2, :]
    if np.any(np.abs(denominators) < 1e-6):
        return None
    projected_coordinates = projected[:2, :] / denominators
    if not np.all(np.isfinite(projected_coordinates)):
        return None
    # Excessively large values are not useful for a clipped comparison view
    # and can overflow lower-precision graphics paths on mobile devices.
    if float(np.max(np.abs(projected_coordinates))) > 16.0:
        return None

    return RegistrationAlignment(
        matrix=tuple(float(value) for value in normalized.ravel()),
        source_image_size=ImagePixelSize(
            width_px=current_width,
            height_px=current_height,
        ),
        target_image_size=ImagePixelSize(
            width_px=baseline_width,
            height_px=baseline_height,
        ),
    )


@dataclass(frozen=True)
class _MaskGeometry:
    normalized_area: float
    normalized_width: float
    normalized_height: float
    normalized_perimeter: float
    border_irregularity: float


def _mask_geometry(component: np.ndarray) -> _MaskGeometry | None:
    """Derive image-normalized geometry from a single binary candidate mask."""

    if not isinstance(component, np.ndarray) or component.ndim != 2:
        return None
    height, width = component.shape
    mask = (component > 0).astype(np.uint8) * 255
    pixel_area = int(np.count_nonzero(mask))
    if height <= 0 or width <= 0 or pixel_area <= 0:
        return None
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    geometric_area = float(cv2.contourArea(contour))
    if geometric_area <= 0:
        return None
    perimeter_pixels = float(cv2.arcLength(contour, True))
    _, _, box_width, box_height = cv2.boundingRect(contour)
    border_irregularity = max(
        0.0,
        (perimeter_pixels * perimeter_pixels) / (4.0 * math.pi * geometric_area) - 1.0,
    )
    return _MaskGeometry(
        normalized_area=_clamp(pixel_area / float(width * height)),
        normalized_width=_clamp(box_width / float(width)),
        normalized_height=_clamp(box_height / float(height)),
        normalized_perimeter=perimeter_pixels / max(math.hypot(width, height), 1.0),
        border_irregularity=border_irregularity,
    )


def _relative_change(baseline: float, current: float) -> float | None:
    if baseline <= 0 or not math.isfinite(baseline) or not math.isfinite(current):
        return None
    return (current - baseline) / baseline


def _ulceration_like_contrast(
    image: SanitizedImage,
    component: np.ndarray,
) -> float | None:
    """Return a non-diagnostic center-to-edge color/brightness contrast statistic.

    This is a deterministic image descriptor, not an ulcer detector or disease
    probability. Small masks abstain rather than manufacture a value.
    """

    if component.ndim != 2 or component.shape != image.bgr.shape[:2]:
        return None
    mask = (component > 0).astype(np.uint8)
    if int(np.count_nonzero(mask)) < 25:
        return None
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    maximum_distance = float(distance.max())
    if not math.isfinite(maximum_distance) or maximum_distance < 2.0:
        return None
    core = distance >= maximum_distance * 0.6
    rim = (mask > 0) & (distance <= max(1.0, maximum_distance * 0.3))
    if int(np.count_nonzero(core)) < 5 or int(np.count_nonzero(rim)) < 5:
        return None

    rgb = image.rgb.astype(np.float32)
    brightness = np.mean(rgb, axis=2) / 255.0
    redness = np.maximum(0.0, rgb[:, :, 0] - (rgb[:, :, 1] + rgb[:, :, 2]) / 2.0)
    redness /= 255.0
    brightness_contrast = abs(
        float(np.mean(brightness[core]) - np.mean(brightness[rim]))
    )
    redness_contrast = abs(float(np.mean(redness[core]) - np.mean(redness[rim])))
    return _clamp((brightness_contrast + redness_contrast) / 2.0)


def compare_sanitized_images(
    baseline: SanitizedImage,
    current: SanitizedImage,
    metadata: CompareMetadata,
    runtime: ReleaseRuntimeState | None = None,
) -> ComparisonResult:
    runtime = RELEASE_RUNTIME if runtime is None else runtime
    baseline_quality, _ = assess_quality(baseline)
    current_quality, _ = assess_quality(current)
    segmentation_adapter = runtime.adapters.get(ModelHead.SEGMENTATION)
    reidentification_adapter = runtime.adapters.get(ModelHead.LESION_REIDENTIFICATION)
    baseline_candidate: CandidateMask | None = None
    baseline_descriptors: VisualDescriptors | None = None
    baseline_component: np.ndarray | None = None
    current_candidate: CandidateMask | None = None
    current_descriptors: VisualDescriptors | None = None
    current_component: np.ndarray | None = None
    candidate_match_score: float | None = None
    learned_output_available = False
    invoked_heads: set[ModelHead] = set()
    suppression_reasons: list[str] = []

    if (
        segmentation_adapter is not None
        and baseline_quality.accepted
        and current_quality.accepted
    ):
        invoked_heads.add(ModelHead.SEGMENTATION)
        try:
            baseline_segmentation = segmentation_adapter.predict(baseline.rgb)
            current_segmentation = segmentation_adapter.predict(current.rgb)
            if not isinstance(
                baseline_segmentation, SegmentationPrediction
            ) or not isinstance(
                current_segmentation,
                SegmentationPrediction,
            ):
                raise ModelAdapterError(
                    "The segmentation adapter returned the wrong output type."
                )
            (
                baseline_candidate,
                baseline_descriptors,
                baseline_component,
            ) = candidate_from_model_mask(baseline, baseline_segmentation)
            (
                current_candidate,
                current_descriptors,
                current_component,
            ) = candidate_from_model_mask(current, current_segmentation)
            learned_output_available = True
        except Exception:
            baseline_candidate = None
            baseline_descriptors = None
            current_candidate = None
            current_descriptors = None
            suppression_reasons.append("segmentation_inference_failed")

    if (
        reidentification_adapter is not None
        and baseline_quality.accepted
        and current_quality.accepted
    ):
        invoked_heads.add(ModelHead.LESION_REIDENTIFICATION)
        try:
            baseline_embedding = reidentification_adapter.predict(baseline.rgb)
            current_embedding = reidentification_adapter.predict(current.rgb)
            if not isinstance(
                baseline_embedding, EmbeddingPrediction
            ) or not isinstance(
                current_embedding,
                EmbeddingPrediction,
            ):
                raise ModelAdapterError(
                    "The re-identification adapter returned the wrong output type."
                )
            baseline_values = np.asarray(baseline_embedding.values, dtype=np.float64)
            current_values = np.asarray(current_embedding.values, dtype=np.float64)
            if (
                baseline_values.ndim != 1
                or current_values.ndim != 1
                or baseline_values.shape != current_values.shape
                or baseline_values.size < 2
                or not np.all(np.isfinite(baseline_values))
                or not np.all(np.isfinite(current_values))
            ):
                raise ModelAdapterError("Re-identification embeddings are invalid.")
            baseline_norm = float(np.linalg.norm(baseline_values))
            current_norm = float(np.linalg.norm(current_values))
            if baseline_norm <= 1e-12 or current_norm <= 1e-12:
                raise ModelAdapterError("Re-identification embeddings have zero norm.")
            cosine_similarity = float(
                np.dot(baseline_values, current_values) / (baseline_norm * current_norm)
            )
            candidate_match_score = _clamp((cosine_similarity + 1.0) / 2.0)
            learned_output_available = True
        except Exception:
            candidate_match_score = None
            if not metadata.user_confirmed_match:
                suppression_reasons.append("lesion_reidentification_inference_failed")

    (
        inlier_ratio,
        reprojection_error_ratio,
        registration_confidence,
        registration_reasons,
        homography,
    ) = _orb_registration(baseline, current)
    suppression_reasons.extend(registration_reasons)
    registration_alignment = (
        _public_registration_alignment(baseline, current, homography)
        if homography is not None
        and not registration_reasons
        and learned_output_available
        else None
    )

    if not baseline_quality.accepted:
        suppression_reasons.append("baseline_image_quality_rejected")
    if not current_quality.accepted:
        suppression_reasons.append("current_image_quality_rejected")
    if not metadata.user_confirmed_match:
        suppression_reasons.append("user_confirmation_required")

    # Re-identification is an optional automated suggestion. Once the user has
    # explicitly reviewed and confirmed the pair, a missing suggestion must not
    # block an otherwise valid geometric comparison.
    if not metadata.user_confirmed_match:
        if reidentification_adapter is None:
            suppression_reasons.append("lesion_reidentification_release_gate_unmet")
        elif candidate_match_score is None:
            suppression_reasons.append("candidate_match_score_unavailable")
    if segmentation_adapter is None:
        suppression_reasons.append("segmentation_release_gate_unmet")
    else:
        if baseline_candidate is None or baseline_descriptors is None:
            suppression_reasons.append("baseline_candidate_region_unavailable")
        if current_candidate is None or current_descriptors is None:
            suppression_reasons.append("current_candidate_region_unavailable")

    repeatability_gate_passed = runtime.repeated_capture_area_error is not None
    if not repeatability_gate_passed:
        suppression_reasons.append("repeated_capture_area_error_gate_unmet")

    # Prior-analysis metadata binds capture and region identity, but it is
    # supplied by the caller and therefore never drives a live measurement.
    # Candidate areas are recomputed from the two sanitized images by the
    # currently deployed segmentation head.
    registered_baseline: np.ndarray | None = None
    if baseline_component is not None and homography is not None:
        current_height, current_width = current.bgr.shape[:2]
        registered_baseline = cv2.warpPerspective(
            baseline_component,
            homography,
            (current_width, current_height),
            flags=cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )
    baseline_geometry = (
        _mask_geometry(registered_baseline) if registered_baseline is not None else None
    )
    current_geometry = (
        _mask_geometry(current_component) if current_component is not None else None
    )
    if baseline_geometry is None:
        suppression_reasons.append("registered_baseline_candidate_area_unavailable")
    if current_geometry is None:
        suppression_reasons.append("current_candidate_area_unavailable")

    comparable = not suppression_reasons
    normalized_change: float | None = None
    descriptor_changes: DescriptorChanges | None = None
    if comparable and baseline_geometry is not None and current_geometry is not None:
        normalized_change = _relative_change(
            baseline_geometry.normalized_area,
            current_geometry.normalized_area,
        )
        normalized_width_change = _relative_change(
            baseline_geometry.normalized_width,
            current_geometry.normalized_width,
        )
        normalized_height_change = _relative_change(
            baseline_geometry.normalized_height,
            current_geometry.normalized_height,
        )
        normalized_perimeter_change = _relative_change(
            baseline_geometry.normalized_perimeter,
            current_geometry.normalized_perimeter,
        )
        if (
            normalized_change is None
            or normalized_width_change is None
            or normalized_height_change is None
            or normalized_perimeter_change is None
            or baseline_descriptors is None
            or current_descriptors is None
            or baseline_component is None
            or current_component is None
        ):
            comparable = False
            suppression_reasons.append("candidate_descriptor_change_unavailable")
            normalized_change = None
        else:
            baseline_ulceration_contrast = _ulceration_like_contrast(
                baseline, baseline_component
            )
            current_ulceration_contrast = _ulceration_like_contrast(
                current, current_component
            )
            descriptor_changes = DescriptorChanges(
                normalized_width_change=normalized_width_change,
                normalized_height_change=normalized_height_change,
                normalized_perimeter_change=normalized_perimeter_change,
                border_irregularity_change=(
                    current_geometry.border_irregularity
                    - baseline_geometry.border_irregularity
                ),
                mean_redness_change=(
                    current_descriptors.mean_redness - baseline_descriptors.mean_redness
                ),
                mean_brightness_change=(
                    current_descriptors.mean_brightness
                    - baseline_descriptors.mean_brightness
                ),
                texture_contrast_change=(
                    current_descriptors.texture_contrast
                    - baseline_descriptors.texture_contrast
                ),
                ulceration_like_contrast_change=(
                    current_ulceration_contrast - baseline_ulceration_contrast
                    if baseline_ulceration_contrast is not None
                    and current_ulceration_contrast is not None
                    else None
                ),
            )

    calibrated_changes: CalibratedMeasurementChanges | None = None
    calibration_suppression_reasons: list[str] = []
    calibration_requests = (
        metadata.baseline_calibration,
        metadata.current_calibration,
    )
    if any(request is not None for request in calibration_requests):
        if not all(request is not None for request in calibration_requests):
            calibration_suppression_reasons.append("paired_calibration_required")
        else:
            if not comparable:
                calibration_suppression_reasons.append("comparison_not_comparable")
            if not repeatability_gate_passed:
                calibration_suppression_reasons.append(
                    "repeated_capture_area_error_gate_unmet"
                )
            if baseline_candidate is None or current_candidate is None:
                calibration_suppression_reasons.append("candidate_bounds_unavailable")
        if not calibration_suppression_reasons:
            baseline_request = metadata.baseline_calibration
            current_request = metadata.current_calibration
            assert baseline_request is not None and current_request is not None
            baseline_estimate = estimate_calibrated_bounding_box(
                baseline.bgr,
                baseline_candidate.bounding_box,
                plane_confirmed=baseline_request.plane_confirmed,
                expected_marker_id=baseline_request.marker_id,
                marker_side_mm=baseline_request.marker_side_mm,
            )
            current_estimate = estimate_calibrated_bounding_box(
                current.bgr,
                current_candidate.bounding_box,
                plane_confirmed=current_request.plane_confirmed,
                expected_marker_id=current_request.marker_id,
                marker_side_mm=current_request.marker_side_mm,
            )
            calibration_suppression_reasons.extend(
                f"baseline_{reason}" for reason in baseline_estimate.suppression_reasons
            )
            calibration_suppression_reasons.extend(
                f"current_{reason}" for reason in current_estimate.suppression_reasons
            )
            required_values = (
                baseline_estimate.estimated_width_mm,
                current_estimate.estimated_width_mm,
                baseline_estimate.estimated_height_mm,
                current_estimate.estimated_height_mm,
                baseline_estimate.estimated_area_mm2,
                current_estimate.estimated_area_mm2,
            )
            if (
                baseline_estimate.valid
                and current_estimate.valid
                and all(value is not None for value in required_values)
            ):
                (
                    baseline_width_mm,
                    current_width_mm,
                    baseline_height_mm,
                    current_height_mm,
                    baseline_area_mm2,
                    current_area_mm2,
                ) = required_values
                assert baseline_width_mm is not None
                assert current_width_mm is not None
                assert baseline_height_mm is not None
                assert current_height_mm is not None
                assert baseline_area_mm2 is not None
                assert current_area_mm2 is not None
                calibrated_changes = CalibratedMeasurementChanges(
                    card_version=baseline_request.card_version,
                    marker_id=baseline_request.marker_id,
                    marker_side_mm=baseline_request.marker_side_mm,
                    baseline_width_mm=baseline_width_mm,
                    current_width_mm=current_width_mm,
                    width_change_mm=current_width_mm - baseline_width_mm,
                    baseline_height_mm=baseline_height_mm,
                    current_height_mm=current_height_mm,
                    height_change_mm=current_height_mm - baseline_height_mm,
                    baseline_area_mm2=baseline_area_mm2,
                    current_area_mm2=current_area_mm2,
                    area_change_mm2=current_area_mm2 - baseline_area_mm2,
                    baseline_confidence=baseline_estimate.confidence,
                    current_confidence=current_estimate.confidence,
                )
            elif not calibration_suppression_reasons:
                calibration_suppression_reasons.append("calibration_evidence_invalid")

    return ComparisonResult(
        baseline_capture_id=metadata.baseline_capture_id,
        current_capture_id=metadata.current_capture_id,
        region=metadata.region,
        candidate_match_score=candidate_match_score,
        user_confirmed_match=metadata.user_confirmed_match,
        registration_confidence=registration_confidence,
        inlier_ratio=inlier_ratio,
        reprojection_error_ratio=reprojection_error_ratio,
        repeated_capture_area_error=runtime.repeated_capture_area_error,
        repeatability_gate_passed=repeatability_gate_passed,
        registration_alignment=registration_alignment,
        normalized_change=normalized_change,
        descriptor_changes=descriptor_changes,
        calibrated_measurement_changes=calibrated_changes,
        calibration_suppression_reasons=list(
            dict.fromkeys(calibration_suppression_reasons)
        ),
        comparable=comparable,
        suppression_reasons=list(dict.fromkeys(suppression_reasons)),
        model_versions=_invoked_model_versions(runtime, invoked_heads),
        input_origin=metadata.input_origin,
        analysis_origin=(
            AnalysisOrigin.LIVE_MODEL
            if learned_output_available
            else AnalysisOrigin.UNAVAILABLE
        ),
    )


def failed_comparison(metadata: CompareMetadata) -> ComparisonResult:
    return ComparisonResult(
        baseline_capture_id=metadata.baseline_capture_id,
        current_capture_id=metadata.current_capture_id,
        region=metadata.region,
        candidate_match_score=None,
        user_confirmed_match=metadata.user_confirmed_match,
        registration_confidence=0,
        inlier_ratio=0,
        reprojection_error_ratio=1,
        repeated_capture_area_error=None,
        repeatability_gate_passed=False,
        registration_alignment=None,
        normalized_change=None,
        descriptor_changes=None,
        calibrated_measurement_changes=None,
        calibration_suppression_reasons=(
            ["comparison_not_comparable"]
            if metadata.baseline_calibration is not None
            or metadata.current_calibration is not None
            else []
        ),
        comparable=False,
        suppression_reasons=["analysis_unavailable"],
        model_versions=MODEL_VERSIONS,
        input_origin=metadata.input_origin,
        analysis_origin=AnalysisOrigin.UNAVAILABLE,
    )
