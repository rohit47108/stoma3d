from __future__ import annotations

import hashlib
import importlib
import json
from pathlib import Path

import pytest
import numpy as np

from stoma3d_api.configuration import (
    DEMO_FIXTURES_ENV,
    DEPLOYMENT_MODE_ENV,
    REQUIRE_SIGNING_ENV,
    DeploymentMode,
    load_service_configuration,
)
from stoma3d_api.contracts import ModelHead
from stoma3d_api.model_adapters import (
    ClassificationPrediction,
    OnnxAdapterSpec,
)
from stoma3d_api.release_manifest import (
    RELEASE_MANIFEST_ENV,
    ReleaseManifest,
    load_release_runtime,
)


def _interface(head: str) -> dict[str, object]:
    output_kind = {
        "segmentation": "binary_mask_logits",
        "anatomy": "class_logits",
        "appearance": "class_logits",
        "disease_research": "class_logits",
        "lesion_reidentification": "embedding",
        "quality_control": "class_logits",
        "oral_tissue_segmentation": "binary_mask_logits",
        "out_of_distribution": "class_logits",
        "secondary_segmentation": "binary_mask_logits",
    }[head]
    labels: list[str] = []
    if head == "anatomy":
        labels = [
            "dorsal_tongue",
            "ventral_tongue",
            "left_buccal_mucosa",
            "right_buccal_mucosa",
            "upper_lip",
            "lower_lip",
            "upper_dental_arch",
            "lower_dental_arch",
        ]
    elif head == "appearance":
        labels = [
            "red-patch",
            "white-patch",
            "ulcer-like",
            "mixed",
            "pigmented",
            "none-detected",
            "unsupported",
        ]
    elif head == "disease_research":
        labels = ["normal", "variation", "opmd", "oral_cancer"]
    elif head == "quality_control":
        labels = [
            "acceptable",
            "blurry",
            "too-dark",
            "too-bright",
            "glare-heavy",
            "target-region-missing",
            "too-far",
            "too-close",
            "obstructed",
        ]
    elif head == "out_of_distribution":
        labels = ["supported", "unsupported"]
    output_settings: dict[str, object]
    if output_kind == "binary_mask_logits":
        output_settings = {
            "probabilityTransform": "sigmoid",
            "segmentationThreshold": 0.5,
        }
    elif output_kind == "class_logits":
        output_settings = {
            "probabilityTransform": "softmax",
            "calibrationTemperature": 1.2,
            "abstentionThreshold": 0.7,
        }
    else:
        output_settings = {
            "probabilityTransform": "none",
            "embeddingL2Normalize": True,
            "minimumEmbeddingDimensions": 8,
        }
    return {
        "inputName": "image",
        "outputName": "output",
        "inputScope": "sanitized_full_image",
        "inputColorSpace": "RGB",
        "inputLayout": "NCHW",
        "inputWidth": 224,
        "inputHeight": 224,
        "pixelScale": "zero_to_one",
        "resizeMode": "stretch",
        "resizeInterpolation": "linear",
        "normalizationMean": [0.5, 0.5, 0.5],
        "normalizationStd": [0.5, 0.5, 0.5],
        "outputKind": output_kind,
        "classLabels": labels,
        "supportsAbstention": True,
        **output_settings,
    }


def _enabled_head(
    head: str,
    artifact_path: str,
    artifact_sha256: str,
) -> dict[str, object]:
    return {
        "head": head,
        "enabled": True,
        "version": f"{head}-2026.1",
        "artifactPath": artifact_path,
        "artifactFormat": "onnx",
        "artifactSha256": artifact_sha256,
        "evaluatedAt": "2026-07-27T12:00:00Z",
        "metrics": {"release_metric": 0.9},
        "unmetRequirements": [],
        "reviewerApproved": True,
        "reviewEvidence": "reviews/release-review.json",
        "interface": _interface(head),
    }


def _write_manifest(
    directory: Path,
    heads: list[dict[str, object]],
    *,
    comparison_validation: dict[str, object] | None = None,
) -> Path:
    manifest_path = directory / "release-manifest.json"
    payload: dict[str, object] = {
        "schemaVersion": "1.1",
        "releaseId": "release-2026-07-27",
        "createdAt": "2026-07-27T12:00:00Z",
        "codeRevision": "a" * 40,
        "heads": heads,
    }
    if comparison_validation is not None:
        payload["comparisonValidation"] = comparison_validation
    manifest_path.write_text(
        json.dumps(payload),
        encoding="utf-8",
    )
    return manifest_path


class _StubAdapter:
    def __init__(self, head: ModelHead) -> None:
        self.head = head

    def predict(self, _rgb: np.ndarray) -> ClassificationPrediction:
        raise AssertionError("Release-loader tests do not run inference.")


def _stub_adapter_loader(spec: OnnxAdapterSpec) -> _StubAdapter:
    return _StubAdapter(spec.head)


def test_service_configuration_is_local_and_demo_disabled_by_default() -> None:
    configuration = load_service_configuration({})
    assert configuration.deployment_mode is DeploymentMode.DEVELOPMENT
    assert configuration.demo_fixtures_enabled is False
    assert configuration.response_signing_required is False

    enabled_demo = load_service_configuration({DEMO_FIXTURES_ENV: "true"})
    assert enabled_demo.demo_fixtures_enabled is True

    with pytest.raises(RuntimeError, match=DEMO_FIXTURES_ENV):
        load_service_configuration({DEMO_FIXTURES_ENV: "yes"})


def test_production_mode_requires_explicit_response_signing() -> None:
    with pytest.raises(RuntimeError, match=REQUIRE_SIGNING_ENV):
        load_service_configuration({DEPLOYMENT_MODE_ENV: "production"})

    configuration = load_service_configuration(
        {
            DEPLOYMENT_MODE_ENV: "production",
            REQUIRE_SIGNING_ENV: "true",
        }
    )
    assert configuration.production is True
    assert configuration.response_signing_required is True


def test_missing_release_manifest_keeps_every_head_disabled() -> None:
    runtime = load_release_runtime({})
    assert runtime.manifest_loaded is False
    assert runtime.analysis_ready is False
    assert runtime.enabled_heads == ()
    assert runtime.load_reasons == ("release_manifest_not_configured",)
    assert all(value is None for value in runtime.artifact_hashes.values())


def test_legacy_release_schema_is_rejected_instead_of_reinterpreted() -> None:
    with pytest.raises(ValueError, match="schemaVersion"):
        ReleaseManifest.model_validate(
            {
                "schemaVersion": "1.0",
                "releaseId": "legacy-release",
                "createdAt": "2026-07-27T12:00:00Z",
                "codeRevision": "a" * 40,
                "heads": [],
            }
        )


def test_hash_verified_invalid_onnx_stays_disabled(
    tmp_path: Path,
) -> None:
    model_directory = tmp_path / "models"
    model_directory.mkdir()
    artifact = model_directory / "segmentation.onnx"
    artifact.write_bytes(b"audited-test-artifact")
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    manifest_path = _write_manifest(
        tmp_path,
        [_enabled_head("segmentation", "models/segmentation.onnx", digest)],
    )

    runtime = load_release_runtime({RELEASE_MANIFEST_ENV: str(manifest_path)})
    state = runtime.heads[ModelHead.SEGMENTATION]
    assert runtime.manifest_loaded is True
    assert state.declared_enabled is True
    assert state.enabled is False
    assert state.artifact_sha256 == digest
    assert "failed startup validation" in " ".join(state.unmet_requirements)


def test_enabled_heads_and_hashes_require_a_loaded_adapter(
    tmp_path: Path,
) -> None:
    model_directory = tmp_path / "models"
    model_directory.mkdir()
    artifact = model_directory / "segmentation.onnx"
    artifact.write_bytes(b"audited-test-artifact")
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    manifest_path = _write_manifest(
        tmp_path,
        [_enabled_head("segmentation", "models/segmentation.onnx", digest)],
    )

    runtime = load_release_runtime(
        {RELEASE_MANIFEST_ENV: str(manifest_path)},
        adapter_loader=_stub_adapter_loader,
    )
    assert runtime.enabled_heads == (ModelHead.SEGMENTATION,)
    assert runtime.analysis_ready is False
    assert runtime.artifact_hashes["segmentation_weights"] == digest


def test_release_loader_preserves_the_declared_training_resize(tmp_path: Path) -> None:
    artifact = tmp_path / "anatomy.onnx"
    artifact.write_bytes(b"audited-test-artifact")
    head = _enabled_head(
        "anatomy", "anatomy.onnx", hashlib.sha256(artifact.read_bytes()).hexdigest()
    )
    head["interface"]["resizeInterpolation"] = "pillow_bilinear"
    manifest_path = _write_manifest(tmp_path, [head])
    loaded: list[OnnxAdapterSpec] = []

    def recording_loader(spec: OnnxAdapterSpec) -> _StubAdapter:
        loaded.append(spec)
        return _StubAdapter(spec.head)

    runtime = load_release_runtime(
        {RELEASE_MANIFEST_ENV: str(manifest_path)}, adapter_loader=recording_loader
    )
    assert runtime.heads[ModelHead.ANATOMY].enabled
    assert loaded[0].resize_interpolation == "pillow_bilinear"


def test_auxiliary_safety_heads_have_strict_loadable_interfaces(tmp_path: Path) -> None:
    names = (
        "quality_control",
        "oral_tissue_segmentation",
        "out_of_distribution",
        "secondary_segmentation",
    )
    heads: list[dict[str, object]] = []
    for name in names:
        artifact = tmp_path / f"{name}.onnx"
        artifact.write_bytes(f"{name}-audited-test-artifact".encode())
        heads.append(
            _enabled_head(
                name, artifact.name, hashlib.sha256(artifact.read_bytes()).hexdigest()
            )
        )
    manifest_path = _write_manifest(tmp_path, heads)
    runtime = load_release_runtime(
        {RELEASE_MANIFEST_ENV: str(manifest_path)},
        adapter_loader=_stub_adapter_loader,
    )
    assert runtime.enabled_heads == tuple(ModelHead(name) for name in names)
    assert runtime.analysis_ready is False
    for name in names:
        assert runtime.artifact_hashes[f"{name}_weights"] is not None


def test_analysis_readiness_requires_both_loaded_core_adapters(
    tmp_path: Path,
) -> None:
    model_directory = tmp_path / "models"
    model_directory.mkdir()
    heads: list[dict[str, object]] = []
    loaded: list[ModelHead] = []
    for head_name in ("segmentation", "anatomy"):
        artifact = model_directory / f"{head_name}.onnx"
        artifact.write_bytes(f"{head_name}-test-onnx".encode())
        heads.append(
            _enabled_head(
                head_name,
                f"models/{head_name}.onnx",
                hashlib.sha256(artifact.read_bytes()).hexdigest(),
            )
        )

    def recording_loader(spec: OnnxAdapterSpec) -> _StubAdapter:
        loaded.append(spec.head)
        return _StubAdapter(spec.head)

    manifest_path = _write_manifest(tmp_path, heads)
    runtime = load_release_runtime(
        {RELEASE_MANIFEST_ENV: str(manifest_path)},
        adapter_loader=recording_loader,
    )

    assert loaded == [ModelHead.SEGMENTATION, ModelHead.ANATOMY]
    assert runtime.analysis_ready is True
    assert runtime.enabled_heads == (
        ModelHead.SEGMENTATION,
        ModelHead.ANATOMY,
    )


def test_wrong_adapter_head_disables_the_manifest_head(tmp_path: Path) -> None:
    artifact = tmp_path / "segmentation.onnx"
    artifact.write_bytes(b"test-onnx")
    manifest_path = _write_manifest(
        tmp_path,
        [
            _enabled_head(
                "segmentation",
                "segmentation.onnx",
                hashlib.sha256(artifact.read_bytes()).hexdigest(),
            )
        ],
    )
    runtime = load_release_runtime(
        {RELEASE_MANIFEST_ENV: str(manifest_path)},
        adapter_loader=lambda _spec: _StubAdapter(ModelHead.ANATOMY),
    )

    assert runtime.enabled_heads == ()
    assert "failed startup validation" in " ".join(
        runtime.heads[ModelHead.SEGMENTATION].unmet_requirements
    )


def test_model_card_uses_the_same_immutable_release_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_directory = tmp_path / "models"
    model_directory.mkdir()
    artifact = model_directory / "segmentation.onnx"
    artifact.write_bytes(b"audited-test-artifact")
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    manifest_path = _write_manifest(
        tmp_path,
        [_enabled_head("segmentation", "models/segmentation.onnx", digest)],
    )
    runtime = load_release_runtime(
        {RELEASE_MANIFEST_ENV: str(manifest_path)},
        adapter_loader=_stub_adapter_loader,
    )

    api_main = importlib.import_module("stoma3d_api.main")
    monkeypatch.setattr(api_main, "RELEASE_RUNTIME", runtime)
    card = api_main._model_card()
    assert card.enabled_heads == [ModelHead.SEGMENTATION]
    assert card.artifact_hashes["segmentation_weights"] == digest
    segmentation_gate = next(
        gate for gate in card.release_gates if gate.head is ModelHead.SEGMENTATION
    )
    assert segmentation_gate.passed is True
    assert segmentation_gate.metrics == {"release_metric": 0.9}


def test_hash_mismatch_and_unsafe_artifact_path_fail_closed(tmp_path: Path) -> None:
    model_directory = tmp_path / "models"
    model_directory.mkdir()
    artifact = model_directory / "segmentation.onnx"
    artifact.write_bytes(b"different-bytes")

    mismatch_path = _write_manifest(
        tmp_path,
        [_enabled_head("segmentation", "models/segmentation.onnx", "0" * 64)],
    )
    mismatch = load_release_runtime(
        {RELEASE_MANIFEST_ENV: str(mismatch_path)},
        adapter_loader=_stub_adapter_loader,
    )
    mismatch_state = mismatch.heads[ModelHead.SEGMENTATION]
    assert mismatch_state.enabled is False
    assert mismatch_state.artifact_sha256 is None
    assert "hash does not match" in " ".join(mismatch_state.unmet_requirements)

    unsafe_path = _write_manifest(
        tmp_path,
        [_enabled_head("segmentation", "../outside.onnx", "0" * 64)],
    )
    unsafe = load_release_runtime(
        {RELEASE_MANIFEST_ENV: str(unsafe_path)},
        adapter_loader=_stub_adapter_loader,
    )
    assert unsafe.heads[ModelHead.SEGMENTATION].enabled is False
    assert "not a safe manifest-relative path" in " ".join(
        unsafe.heads[ModelHead.SEGMENTATION].unmet_requirements
    )


def test_comparison_validation_requires_its_pinned_artifact(tmp_path: Path) -> None:
    evidence_directory = tmp_path / "evidence"
    evidence_directory.mkdir()
    evidence = evidence_directory / "repeat-capture.json"
    evidence.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "evaluated_at": "2026-07-27T12:00:00Z",
                "metric_name": "p95_absolute_relative_registered_area_error",
                "repeated_capture_area_error": 0.08,
                "maximum_allowed_error": 0.1,
                "gate_passed": True,
                "pair_count": 25,
                "participant_count": 10,
                "evaluable_pair_count": 20,
                "coverage": 0.8,
                "aggregate_only": True,
            }
        ),
        encoding="utf-8",
    )
    digest = hashlib.sha256(evidence.read_bytes()).hexdigest()
    review_directory = tmp_path / "reviews"
    review_directory.mkdir()
    (review_directory / "comparison-review.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "reviewer_name": "Engineering reviewer",
                "reviewer_role": "Computer vision validation",
                "reviewed_at": "2026-07-27T12:00:00Z",
                "approved": True,
                "artifact_sha256": digest,
                "scope": (
                    "Repeat-capture metric, pair eligibility, registration gates, "
                    "and limitations reviewed."
                ),
            }
        ),
        encoding="utf-8",
    )
    comparison = {
        "repeatedCaptureAreaError": 0.08,
        "evaluatedAt": "2026-07-27T12:00:00Z",
        "artifactPath": "evidence/repeat-capture.json",
        "artifactSha256": digest,
        "reviewerApproved": True,
        "reviewEvidence": "reviews/comparison-review.json",
    }
    manifest_path = _write_manifest(
        tmp_path,
        [],
        comparison_validation=comparison,
    )
    verified = load_release_runtime({RELEASE_MANIFEST_ENV: str(manifest_path)})
    assert verified.repeated_capture_area_error == 0.08

    comparison["artifactSha256"] = "0" * 64
    mismatch_path = _write_manifest(
        tmp_path,
        [],
        comparison_validation=comparison,
    )
    mismatch = load_release_runtime({RELEASE_MANIFEST_ENV: str(mismatch_path)})
    assert mismatch.repeated_capture_area_error is None

    comparison["artifactSha256"] = digest
    evidence_payload = json.loads(evidence.read_text(encoding="utf-8"))
    evidence_payload["repeated_capture_area_error"] = 0.07
    evidence.write_text(json.dumps(evidence_payload), encoding="utf-8")
    changed_digest = hashlib.sha256(evidence.read_bytes()).hexdigest()
    comparison["artifactSha256"] = changed_digest
    review_path = review_directory / "comparison-review.json"
    review_payload = json.loads(review_path.read_text(encoding="utf-8"))
    review_payload["artifact_sha256"] = changed_digest
    review_path.write_text(json.dumps(review_payload), encoding="utf-8")
    inconsistent_path = _write_manifest(
        tmp_path,
        [],
        comparison_validation=comparison,
    )
    inconsistent = load_release_runtime({RELEASE_MANIFEST_ENV: str(inconsistent_path)})
    assert inconsistent.repeated_capture_area_error is None


def test_enabled_manifest_entry_requires_complete_release_evidence() -> None:
    with pytest.raises(ValueError, match="Enabled heads require"):
        ReleaseManifest.model_validate(
            {
                "schemaVersion": "1.1",
                "releaseId": "invalid-release",
                "createdAt": "2026-07-27T12:00:00Z",
                "codeRevision": "a" * 40,
                "heads": [
                    {
                        "head": "segmentation",
                        "enabled": True,
                        "version": "missing-evidence",
                    }
                ],
            }
        )


def test_model_interface_rejects_wrong_transform_or_label_order() -> None:
    segmentation = _enabled_head(
        "segmentation",
        "segmentation.onnx",
        "a" * 64,
    )
    segmentation_interface = segmentation["interface"]
    assert isinstance(segmentation_interface, dict)
    segmentation_interface["probabilityTransform"] = "softmax"
    with pytest.raises(ValueError, match="binary_mask_logits requires sigmoid"):
        ReleaseManifest.model_validate(
            {
                "schemaVersion": "1.1",
                "releaseId": "invalid-segmentation-interface",
                "createdAt": "2026-07-27T12:00:00Z",
                "codeRevision": "a" * 40,
                "heads": [segmentation],
            }
        )

    anatomy = _enabled_head("anatomy", "anatomy.onnx", "b" * 64)
    anatomy_interface = anatomy["interface"]
    assert isinstance(anatomy_interface, dict)
    labels = anatomy_interface["classLabels"]
    assert isinstance(labels, list)
    anatomy_interface["classLabels"] = list(reversed(labels))
    with pytest.raises(ValueError, match="fixed taxonomy"):
        ReleaseManifest.model_validate(
            {
                "schemaVersion": "1.1",
                "releaseId": "invalid-anatomy-interface",
                "createdAt": "2026-07-27T12:00:00Z",
                "codeRevision": "a" * 40,
                "heads": [anatomy],
            }
        )


def test_public_source_manifest_omits_the_private_segmentation_artifact() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    manifest_path = repository_root / "services/inference/release/release-manifest.json"
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    segmentation = next(
        head for head in payload["heads"] if head["head"] == "segmentation"
    )

    assert segmentation["enabled"] is False
    assert "artifactPath" not in segmentation
    assert "artifactSha256" not in segmentation

    runtime = load_release_runtime({RELEASE_MANIFEST_ENV: str(manifest_path)})
    assert ModelHead.SEGMENTATION not in runtime.enabled_heads
    assert ModelHead.ANATOMY in runtime.enabled_heads
