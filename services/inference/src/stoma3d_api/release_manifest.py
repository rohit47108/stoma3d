"""Fail-closed model release manifest and startup-loaded ONNX runtime state.

An enabled head becomes operational only after its evidence is schema-valid, its
manifest-relative artifact matches the pinned hash, and the OpenCV DNN adapter
passes startup inference validation.
"""

from __future__ import annotations

import hashlib
import math
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath, PureWindowsPath
from types import MappingProxyType
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from .contracts import (
    AppearanceClass,
    DiseaseResearchClass,
    DistributionClass,
    ModelHead,
    MouthRegion,
    QualityClass,
)
from .model_adapters import (
    ModelAdapter,
    OnnxAdapterSpec,
    load_onnx_adapter,
)

RELEASE_MANIFEST_ENV = "STOMA3D_RELEASE_MANIFEST_PATH"
MAX_RELEASE_MANIFEST_BYTES = 256 * 1024
MAX_REPEATED_CAPTURE_AREA_ERROR = 0.10

ARTIFACT_KEY_BY_HEAD: Mapping[ModelHead, str] = MappingProxyType(
    {
        ModelHead.SEGMENTATION: "segmentation_weights",
        ModelHead.ANATOMY: "anatomy_weights",
        ModelHead.APPEARANCE: "appearance_weights",
        ModelHead.DISEASE_RESEARCH: "disease_research_weights",
        ModelHead.LESION_REIDENTIFICATION: "lesion_reidentification_weights",
        ModelHead.QUALITY_CONTROL: "quality_control_weights",
        ModelHead.ORAL_TISSUE_SEGMENTATION: "oral_tissue_segmentation_weights",
        ModelHead.OUT_OF_DISTRIBUTION: "out_of_distribution_weights",
        ModelHead.SECONDARY_SEGMENTATION: "secondary_segmentation_weights",
    }
)
REQUIRED_ANALYSIS_HEADS = frozenset({ModelHead.SEGMENTATION, ModelHead.ANATOMY})

SUPPORTED_MODEL_ADAPTER_HEADS = frozenset(ModelHead)


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ImmutableManifestModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )


class ModelInterfaceManifest(ImmutableManifestModel):
    """Exact tensor, preprocessing, calibration, and output contract."""

    input_name: Annotated[str, Field(min_length=1, max_length=128)]
    output_name: Annotated[str, Field(min_length=1, max_length=128)]
    input_scope: Literal["sanitized_full_image"]
    input_color_space: Literal["RGB"]
    input_layout: Literal["NCHW"]
    input_width: Annotated[int, Field(ge=32, le=4096)]
    input_height: Annotated[int, Field(ge=32, le=4096)]
    pixel_scale: Literal["zero_to_one"]
    resize_mode: Literal["stretch"]
    resize_interpolation: Literal["linear", "pillow_bilinear"]
    normalization_mean: tuple[
        Annotated[float, Field(ge=-10, le=10)],
        Annotated[float, Field(ge=-10, le=10)],
        Annotated[float, Field(ge=-10, le=10)],
    ]
    normalization_std: tuple[
        Annotated[float, Field(gt=0, le=10)],
        Annotated[float, Field(gt=0, le=10)],
        Annotated[float, Field(gt=0, le=10)],
    ]
    output_kind: Literal[
        "binary_mask_logits",
        "class_logits",
        "embedding",
    ]
    class_labels: tuple[str, ...] = ()
    supports_abstention: Literal[True]
    probability_transform: Literal["sigmoid", "softmax", "none"]
    segmentation_threshold: Annotated[float, Field(gt=0, lt=1)] | None = None
    calibration_temperature: Annotated[float, Field(gt=0, le=100)] | None = None
    abstention_threshold: Annotated[float, Field(gt=0, le=1)] | None = None
    embedding_l2_normalize: Literal[True] | None = None
    minimum_embedding_dimensions: Annotated[int, Field(ge=2, le=65_536)] | None = None

    @field_validator("input_name", "output_name")
    @classmethod
    def tensor_names_are_exact_and_nonblank(cls, value: str) -> str:
        if not value.strip() or value != value.strip():
            raise ValueError("Tensor names must be nonblank without surrounding space.")
        return value

    @model_validator(mode="after")
    def output_contract_is_complete(self) -> "ModelInterfaceManifest":
        if self.output_kind == "class_logits" and not self.class_labels:
            raise ValueError("class_logits output requires a fixed classLabels list.")
        if self.output_kind != "class_logits" and self.class_labels:
            raise ValueError("classLabels is valid only for class_logits output.")
        if len(set(self.class_labels)) != len(self.class_labels):
            raise ValueError("classLabels must not contain duplicates.")

        if self.output_kind == "binary_mask_logits":
            if (
                self.probability_transform != "sigmoid"
                or self.segmentation_threshold is None
                or self.calibration_temperature is not None
                or self.abstention_threshold is not None
                or self.embedding_l2_normalize is not None
                or self.minimum_embedding_dimensions is not None
            ):
                raise ValueError(
                    "binary_mask_logits requires sigmoid and a segmentationThreshold "
                    "with no classification or embedding settings."
                )
        elif self.output_kind == "class_logits":
            if (
                self.probability_transform != "softmax"
                or self.calibration_temperature is None
                or self.abstention_threshold is None
                or self.segmentation_threshold is not None
                or self.embedding_l2_normalize is not None
                or self.minimum_embedding_dimensions is not None
            ):
                raise ValueError(
                    "class_logits requires softmax, calibrationTemperature, and "
                    "abstentionThreshold with no segmentation or embedding settings."
                )
        elif (
            self.probability_transform != "none"
            or self.embedding_l2_normalize is not True
            or self.minimum_embedding_dimensions is None
            or self.segmentation_threshold is not None
            or self.calibration_temperature is not None
            or self.abstention_threshold is not None
        ):
            raise ValueError(
                "embedding requires probabilityTransform=none, L2 normalization, and "
                "minimumEmbeddingDimensions with no segmentation/classification settings."
            )
        return self


class HeadReleaseManifest(ImmutableManifestModel):
    head: ModelHead
    enabled: bool
    version: Annotated[str, Field(min_length=1, max_length=128)]
    artifact_path: Annotated[str, Field(min_length=1, max_length=512)] | None = None
    artifact_format: Literal["onnx"] | None = None
    artifact_sha256: str | None = Field(
        default=None,
        pattern=r"^[a-f0-9]{64}$",
    )
    evaluated_at: datetime | None = None
    metrics: Mapping[str, float] = Field(default_factory=dict)
    unmet_requirements: tuple[str, ...] = ()
    reviewer_approved: bool = False
    review_evidence: Annotated[str, Field(min_length=1, max_length=512)] | None = None
    interface: ModelInterfaceManifest | None = None

    @field_validator("evaluated_at")
    @classmethod
    def evaluated_at_is_utc(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("evaluatedAt must be timezone-aware UTC.")
        return value.astimezone(timezone.utc)

    @field_validator("metrics")
    @classmethod
    def metrics_are_finite(cls, value: Mapping[str, float]) -> Mapping[str, float]:
        clean: dict[str, float] = {}
        for key, metric in value.items():
            if not key.strip():
                raise ValueError("Metric names must not be blank.")
            converted = float(metric)
            if converted != converted or converted in {float("inf"), float("-inf")}:
                raise ValueError("Metrics must be finite.")
            clean[key] = converted
        return MappingProxyType(clean)

    @model_validator(mode="after")
    def enabled_head_has_complete_release_evidence(self) -> "HeadReleaseManifest":
        if self.enabled and (
            self.artifact_path is None
            or self.artifact_format != "onnx"
            or self.artifact_sha256 is None
            or self.evaluated_at is None
            or not self.metrics
            or self.unmet_requirements
            or not self.reviewer_approved
            or self.review_evidence is None
            or self.interface is None
        ):
            raise ValueError(
                "Enabled heads require an artifact path/hash, dated metrics, no unmet "
                "requirements, reviewer evidence, ONNX format, and a complete model "
                "interface."
            )
        if self.enabled and self.artifact_path is not None:
            if not self.artifact_path.lower().endswith(".onnx"):
                raise ValueError("Enabled ONNX artifacts must use the .onnx extension.")
        expected_output = {
            ModelHead.SEGMENTATION: "binary_mask_logits",
            ModelHead.ANATOMY: "class_logits",
            ModelHead.APPEARANCE: "class_logits",
            ModelHead.DISEASE_RESEARCH: "class_logits",
            ModelHead.LESION_REIDENTIFICATION: "embedding",
            ModelHead.QUALITY_CONTROL: "class_logits",
            ModelHead.ORAL_TISSUE_SEGMENTATION: "binary_mask_logits",
            ModelHead.OUT_OF_DISTRIBUTION: "class_logits",
            ModelHead.SECONDARY_SEGMENTATION: "binary_mask_logits",
        }[self.head]
        if self.interface is not None and self.interface.output_kind != expected_output:
            raise ValueError(
                f"{self.head.value} requires interface.outputKind={expected_output}."
            )
        expected_labels = {
            ModelHead.ANATOMY: tuple(item.value for item in MouthRegion),
            ModelHead.APPEARANCE: tuple(item.value for item in AppearanceClass),
            ModelHead.DISEASE_RESEARCH: tuple(
                item.value for item in DiseaseResearchClass
            ),
            ModelHead.QUALITY_CONTROL: tuple(item.value for item in QualityClass),
            ModelHead.OUT_OF_DISTRIBUTION: tuple(
                item.value for item in DistributionClass
            ),
        }.get(self.head, ())
        if (
            self.interface is not None
            and self.interface.class_labels != expected_labels
        ):
            raise ValueError(
                f"{self.head.value} interface.classLabels must match the fixed taxonomy."
            )
        return self


class ComparisonValidationManifest(ImmutableManifestModel):
    repeated_capture_area_error: Annotated[float, Field(ge=0, le=1)]
    evaluated_at: datetime
    artifact_path: Annotated[str, Field(min_length=1, max_length=512)]
    artifact_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    reviewer_approved: bool
    review_evidence: Annotated[str, Field(min_length=1, max_length=512)]

    @field_validator("evaluated_at")
    @classmethod
    def evaluated_at_is_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("evaluatedAt must be timezone-aware UTC.")
        return value.astimezone(timezone.utc)


class ComparisonValidationEvidence(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    schema_version: Literal["1.0"]
    evaluated_at: datetime
    metric_name: Literal["p95_absolute_relative_registered_area_error"]
    repeated_capture_area_error: Annotated[float, Field(ge=0, le=1)]
    maximum_allowed_error: Literal[0.1]
    gate_passed: Literal[True]
    pair_count: Annotated[int, Field(ge=1)]
    participant_count: Annotated[int, Field(ge=1)]
    evaluable_pair_count: Annotated[int, Field(ge=1)]
    coverage: Annotated[float, Field(gt=0, le=1)]
    aggregate_only: Literal[True]

    @field_validator("evaluated_at")
    @classmethod
    def evaluated_at_is_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("evaluatedAt must be timezone-aware UTC.")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def counts_and_gate_are_consistent(self) -> "ComparisonValidationEvidence":
        if self.evaluable_pair_count > self.pair_count:
            raise ValueError("Evaluable repeat-capture pairs cannot exceed all pairs.")
        expected_coverage = self.evaluable_pair_count / self.pair_count
        if not math.isclose(self.coverage, expected_coverage, abs_tol=1e-9):
            raise ValueError(
                "Repeat-capture coverage is inconsistent with pair counts."
            )
        if self.repeated_capture_area_error > self.maximum_allowed_error:
            raise ValueError("Passing repeat-capture evidence exceeds the error gate.")
        return self


class ComparisonReviewEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["1.0"]
    reviewer_name: Annotated[str, Field(min_length=1, max_length=200)]
    reviewer_role: Annotated[str, Field(min_length=1, max_length=200)]
    reviewed_at: datetime
    approved: Literal[True]
    artifact_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    scope: Literal[
        "Repeat-capture metric, pair eligibility, registration gates, and limitations reviewed."
    ]

    @field_validator("reviewed_at")
    @classmethod
    def reviewed_at_is_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("reviewedAt must be timezone-aware UTC.")
        return value.astimezone(timezone.utc)


class ReleaseManifest(ImmutableManifestModel):
    schema_version: Literal["1.1"]
    release_id: Annotated[str, Field(min_length=1, max_length=128)]
    created_at: datetime
    code_revision: str = Field(pattern=r"^[a-f0-9]{40,64}$")
    heads: tuple[HeadReleaseManifest, ...]
    comparison_validation: ComparisonValidationManifest | None = None

    @field_validator("created_at")
    @classmethod
    def created_at_is_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("createdAt must be timezone-aware UTC.")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def heads_are_unique(self) -> "ReleaseManifest":
        head_names = [item.head for item in self.heads]
        if len(head_names) != len(set(head_names)):
            raise ValueError("Release manifest heads must be unique.")
        return self


@dataclass(frozen=True, slots=True)
class HeadReleaseState:
    head: ModelHead
    enabled: bool
    declared_enabled: bool
    version: str | None
    artifact_sha256: str | None
    evaluated_at: datetime | None
    metrics: Mapping[str, float]
    unmet_requirements: tuple[str, ...]
    reviewer_approved: bool


@dataclass(frozen=True, slots=True)
class ReleaseRuntimeState:
    manifest_loaded: bool
    release_id: str | None
    manifest_sha256: str | None
    code_revision: str | None
    heads: Mapping[ModelHead, HeadReleaseState]
    adapters: Mapping[ModelHead, ModelAdapter]
    repeated_capture_area_error: float | None
    load_reasons: tuple[str, ...]

    @property
    def enabled_heads(self) -> tuple[ModelHead, ...]:
        return tuple(
            head
            for head in ModelHead
            if self.heads[head].enabled and head in self.adapters
        )

    @property
    def declared_enabled_heads(self) -> tuple[ModelHead, ...]:
        return tuple(head for head in ModelHead if self.heads[head].declared_enabled)

    @property
    def analysis_ready(self) -> bool:
        return REQUIRED_ANALYSIS_HEADS.issubset(self.enabled_heads)

    @property
    def artifact_hashes(self) -> Mapping[str, str | None]:
        return MappingProxyType(
            {
                ARTIFACT_KEY_BY_HEAD[head]: self.heads[head].artifact_sha256
                for head in ModelHead
            }
        )

    @property
    def model_versions(self) -> Mapping[str, str]:
        return MappingProxyType(
            {
                head.value: state.version
                for head, state in self.heads.items()
                if state.version is not None and head in self.enabled_heads
            }
        )


def _disabled_head(
    head: ModelHead,
    *,
    reason: str,
    declared_enabled: bool = False,
    version: str | None = None,
    artifact_sha256: str | None = None,
    evaluated_at: datetime | None = None,
    metrics: Mapping[str, float] | None = None,
    reviewer_approved: bool = False,
    additional_reasons: tuple[str, ...] = (),
) -> HeadReleaseState:
    return HeadReleaseState(
        head=head,
        enabled=False,
        declared_enabled=declared_enabled,
        version=version,
        artifact_sha256=artifact_sha256,
        evaluated_at=evaluated_at,
        metrics=MappingProxyType(dict(metrics or {})),
        unmet_requirements=(reason, *additional_reasons),
        reviewer_approved=reviewer_approved,
    )


def empty_release_runtime(*reasons: str) -> ReleaseRuntimeState:
    load_reasons = tuple(reasons) or ("release_manifest_not_configured",)
    heads = {
        head: _disabled_head(
            head,
            reason="No validated release manifest and runtime adapter are configured.",
        )
        for head in ModelHead
    }
    return ReleaseRuntimeState(
        manifest_loaded=False,
        release_id=None,
        manifest_sha256=None,
        code_revision=None,
        heads=MappingProxyType(heads),
        adapters=MappingProxyType({}),
        repeated_capture_area_error=None,
        load_reasons=load_reasons,
    )


def _safe_artifact_path(manifest_directory: Path, raw_path: str) -> Path | None:
    posix = PurePosixPath(raw_path.replace("\\", "/"))
    windows = PureWindowsPath(raw_path)
    if (
        posix.is_absolute()
        or windows.is_absolute()
        or windows.drive
        or ".." in posix.parts
        or raw_path.startswith(("http://", "https://", "s3://", "gs://"))
    ):
        return None
    candidate = (manifest_directory / Path(*posix.parts)).resolve(strict=False)
    try:
        candidate.relative_to(manifest_directory)
    except ValueError:
        return None
    return candidate


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_release_runtime(
    environment: Mapping[str, str] | None = None,
    *,
    supported_adapter_heads: frozenset[ModelHead] = SUPPORTED_MODEL_ADAPTER_HEADS,
    adapter_loader: Callable[[OnnxAdapterSpec], ModelAdapter] = load_onnx_adapter,
) -> ReleaseRuntimeState:
    env = os.environ if environment is None else environment
    raw_manifest_path = env.get(RELEASE_MANIFEST_ENV, "").strip()
    if not raw_manifest_path:
        return empty_release_runtime()

    manifest_path = Path(raw_manifest_path).expanduser().resolve(strict=False)
    if not manifest_path.is_file():
        return empty_release_runtime("release_manifest_not_found")
    try:
        if manifest_path.stat().st_size > MAX_RELEASE_MANIFEST_BYTES:
            return empty_release_runtime("release_manifest_too_large")
        raw = manifest_path.read_bytes()
        manifest = ReleaseManifest.model_validate_json(raw)
    except (OSError, UnicodeError, ValidationError):
        return empty_release_runtime("release_manifest_invalid")

    manifest_directory = manifest_path.parent.resolve(strict=False)
    head_specs = {item.head: item for item in manifest.heads}
    states: dict[ModelHead, HeadReleaseState] = {}
    adapters: dict[ModelHead, ModelAdapter] = {}
    for head in ModelHead:
        spec = head_specs.get(head)
        if spec is None:
            states[head] = _disabled_head(
                head,
                reason="Head is absent from the release manifest.",
            )
            continue
        if not spec.enabled:
            reasons = spec.unmet_requirements or (
                "Head is disabled in the release manifest.",
            )
            states[head] = _disabled_head(
                head,
                reason=reasons[0],
                additional_reasons=tuple(reasons[1:]),
                version=spec.version,
                artifact_sha256=None,
                evaluated_at=spec.evaluated_at,
                metrics=spec.metrics,
                reviewer_approved=spec.reviewer_approved,
            )
            continue

        assert spec.artifact_path is not None
        assert spec.artifact_format == "onnx"
        assert spec.artifact_sha256 is not None
        assert spec.interface is not None
        artifact_path = _safe_artifact_path(manifest_directory, spec.artifact_path)
        runtime_reasons: list[str] = []
        verified_hash: str | None = None
        if artifact_path is None:
            runtime_reasons.append(
                "Artifact path is not a safe manifest-relative path."
            )
        elif not artifact_path.is_file():
            runtime_reasons.append("Pinned model artifact is missing.")
        else:
            try:
                actual_hash = _sha256(artifact_path)
            except OSError:
                runtime_reasons.append("Pinned model artifact could not be read.")
            else:
                if actual_hash != spec.artifact_sha256:
                    runtime_reasons.append("Pinned model artifact hash does not match.")
                else:
                    verified_hash = actual_hash
        if head not in supported_adapter_heads:
            runtime_reasons.append(
                "No runtime inference adapter is registered for this head."
            )
        adapter: ModelAdapter | None = None
        if not runtime_reasons and artifact_path is not None:
            interface = spec.interface
            adapter_spec = OnnxAdapterSpec(
                head=head,
                artifact_path=artifact_path,
                input_name=interface.input_name,
                output_name=interface.output_name,
                input_width=interface.input_width,
                input_height=interface.input_height,
                normalization_mean=interface.normalization_mean,
                normalization_std=interface.normalization_std,
                output_kind=interface.output_kind,
                class_labels=interface.class_labels,
                segmentation_threshold=interface.segmentation_threshold,
                calibration_temperature=interface.calibration_temperature,
                abstention_threshold=interface.abstention_threshold,
                minimum_embedding_dimensions=interface.minimum_embedding_dimensions,
                resize_interpolation=interface.resize_interpolation,
            )
            try:
                adapter = adapter_loader(adapter_spec)
                if adapter.head is not head:
                    raise ValueError("Adapter head does not match its manifest entry.")
            except Exception:
                adapter = None
                runtime_reasons.append(
                    "ONNX runtime adapter failed startup validation."
                )

        if runtime_reasons:
            states[head] = _disabled_head(
                head,
                reason=runtime_reasons[0],
                additional_reasons=tuple(runtime_reasons[1:]),
                declared_enabled=True,
                version=spec.version,
                artifact_sha256=verified_hash,
                evaluated_at=spec.evaluated_at,
                metrics=spec.metrics,
                reviewer_approved=spec.reviewer_approved,
            )
        else:
            assert adapter is not None
            adapters[head] = adapter
            states[head] = HeadReleaseState(
                head=head,
                enabled=True,
                declared_enabled=True,
                version=spec.version,
                artifact_sha256=verified_hash,
                evaluated_at=spec.evaluated_at,
                metrics=MappingProxyType(dict(spec.metrics)),
                unmet_requirements=(),
                reviewer_approved=spec.reviewer_approved,
            )

    repeated_capture_area_error: float | None = None
    comparison = manifest.comparison_validation
    if comparison is not None and comparison.reviewer_approved:
        comparison_artifact = _safe_artifact_path(
            manifest_directory,
            comparison.artifact_path,
        )
        comparison_review = _safe_artifact_path(
            manifest_directory,
            comparison.review_evidence,
        )
        try:
            if (
                comparison_artifact is None
                or not comparison_artifact.is_file()
                or comparison_artifact.stat().st_size > MAX_RELEASE_MANIFEST_BYTES
            ):
                comparison_artifact_hash = None
                comparison_evidence = None
            else:
                comparison_raw = comparison_artifact.read_bytes()
                comparison_artifact_hash = hashlib.sha256(comparison_raw).hexdigest()
                comparison_evidence = ComparisonValidationEvidence.model_validate_json(
                    comparison_raw
                )
            if (
                comparison_review is None
                or not comparison_review.is_file()
                or comparison_review.stat().st_size > MAX_RELEASE_MANIFEST_BYTES
            ):
                comparison_review_evidence = None
            else:
                comparison_review_evidence = (
                    ComparisonReviewEvidence.model_validate_json(
                        comparison_review.read_bytes()
                    )
                )
        except (OSError, ValidationError):
            comparison_artifact_hash = None
            comparison_evidence = None
            comparison_review_evidence = None
        if (
            comparison_artifact_hash == comparison.artifact_sha256
            and comparison_evidence is not None
            and math.isclose(
                comparison_evidence.repeated_capture_area_error,
                comparison.repeated_capture_area_error,
                abs_tol=1e-12,
            )
            and comparison_evidence.evaluated_at == comparison.evaluated_at
            and comparison.repeated_capture_area_error
            <= MAX_REPEATED_CAPTURE_AREA_ERROR
            and comparison_review_evidence is not None
            and comparison_review_evidence.artifact_sha256 == comparison.artifact_sha256
        ):
            repeated_capture_area_error = comparison.repeated_capture_area_error

    return ReleaseRuntimeState(
        manifest_loaded=True,
        release_id=manifest.release_id,
        manifest_sha256=hashlib.sha256(raw).hexdigest(),
        code_revision=manifest.code_revision,
        heads=MappingProxyType(states),
        adapters=MappingProxyType(adapters),
        repeated_capture_area_error=repeated_capture_area_error,
        load_reasons=(),
    )


RELEASE_RUNTIME = load_release_runtime()
