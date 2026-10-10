from __future__ import annotations

import csv
from pathlib import Path

from stoma3d_ml.constants import APPEARANCE_CLASSES, DISEASE_CLASSES
from stoma3d_ml.release_training import (
    SUPPLEMENTAL_SEGMENTATION_COLUMNS,
    _build_parser,
    _classification_artifact_name,
    _classification_interface,
    _load_supplemental_segmentation_manifest,
)


def test_classification_export_records_the_training_resize() -> None:
    interface = _classification_interface(("first", "second"), 0.5, 0.77)
    assert interface == {
        "input_name": "image",
        "output_name": "logits",
        "output_kind": "class_logits",
        "resize_interpolation": "pillow_bilinear",
        "class_labels": ["first", "second"],
        "calibration_temperature": 0.5,
        "abstention_threshold": 0.77,
    }


def test_release_training_accepts_disease_research_task() -> None:
    args = _build_parser().parse_args(
        [
            "--task",
            "disease",
            "--manifest",
            "disease.csv",
            "--data-root",
            "data",
            "--output-dir",
            "run",
        ]
    )

    assert args.task == "disease"
    assert DISEASE_CLASSES == ("normal", "variation", "opmd", "oral_cancer")


def test_release_training_accepts_appearance_task() -> None:
    args = _build_parser().parse_args(
        [
            "--task",
            "appearance",
            "--manifest",
            "appearance.csv",
            "--data-root",
            "data",
            "--output-dir",
            "run",
        ]
    )

    assert args.task == "appearance"
    assert APPEARANCE_CLASSES == (
        "red-patch",
        "white-patch",
        "ulcer-like",
        "mixed",
        "pigmented",
        "none-detected",
        "unsupported",
    )
    assert _classification_artifact_name("appearance") == "appearance.onnx"


def test_segmentation_candidate_can_skip_locked_test_evaluation() -> None:
    args = _build_parser().parse_args(
        [
            "--task",
            "segmentation",
            "--manifest",
            "segmentation.csv",
            "--data-root",
            "data",
            "--output-dir",
            "run",
            "--segmentation-architecture",
            "presence_gated_unetplusplus_efficientnet_b4",
            "--segmentation-loss-version",
            "tolerant_boundary_v2",
            "--segmentation-positive-repeat",
            "2",
            "--validation-only",
        ]
    )

    assert args.validation_only is True
    assert args.segmentation_architecture == "presence_gated_unetplusplus_efficientnet_b4"
    assert args.segmentation_loss_version == "tolerant_boundary_v2"
    assert args.segmentation_positive_repeat == 2


def test_segmentation_can_evaluate_exact_frozen_validation_checkpoint() -> None:
    args = _build_parser().parse_args(
        [
            "--task",
            "segmentation",
            "--manifest",
            "segmentation.csv",
            "--data-root",
            "data",
            "--output-dir",
            "run",
            "--segmentation-loss-version",
            "tolerant_boundary_presence_v3",
            "--evaluate-frozen-run",
            "selected/run.json",
        ]
    )

    assert args.validation_only is False
    assert args.evaluate_frozen_run == Path("selected/run.json")
    assert args.segmentation_loss_version == "tolerant_boundary_presence_v3"


def test_supplemental_segmentation_manifest_is_training_only(tmp_path: Path) -> None:
    (tmp_path / "image.png").write_bytes(b"image")
    (tmp_path / "mask.png").write_bytes(b"mask")
    manifest = tmp_path / "supplement.csv"
    row = {
        "sample_id": "external-1",
        "patient_id": "patient-1",
        "split": "train",
        "image_path": "image.png",
        "mask_path": "mask.png",
        "source_dataset": "external-source",
        "device_family": "mixed-smartphone",
        "license_status": "approved",
        "audit_status": "approved",
        "consent_scope": "research_training",
        "license_terms": "academic_research_noncommercial",
        "provenance_url": "https://example.test/dataset",
        "archive_sha256": "a" * 64,
    }
    with manifest.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SUPPLEMENTAL_SEGMENTATION_COLUMNS)
        writer.writeheader()
        writer.writerow(row)

    rows = _load_supplemental_segmentation_manifest(manifest, data_root=tmp_path)

    assert rows == [row]
