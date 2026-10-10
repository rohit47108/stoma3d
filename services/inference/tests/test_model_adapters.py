from __future__ import annotations

from pathlib import Path
from dataclasses import replace

import cv2
import numpy as np
import pytest
from PIL import Image

from stoma3d_api.contracts import ModelHead
from stoma3d_api.model_adapters import (
    ClassificationPrediction,
    EmbeddingPrediction,
    ModelAdapterError,
    ModelAdapterLoadError,
    OnnxAdapterSpec,
    OpenCVDnnOnnxAdapter,
    SegmentationPrediction,
    load_onnx_adapter,
)


class _FakeNetwork:
    def __init__(self, output: np.ndarray, *, empty: bool = False) -> None:
        self.output = output
        self.is_empty = empty
        self.input_tensor: np.ndarray | None = None
        self.input_name: str | None = None
        self.output_name: str | None = None
        self.forward_calls = 0

    def empty(self) -> bool:
        return self.is_empty

    def setPreferableBackend(self, _backend: int) -> None:
        pass

    def setPreferableTarget(self, _target: int) -> None:
        pass

    def setInput(self, tensor: np.ndarray, name: str) -> None:
        self.input_tensor = tensor.copy()
        self.input_name = name

    def forward(self, name: str) -> np.ndarray:
        self.forward_calls += 1
        self.output_name = name
        return self.output.copy()


def _spec(
    head: ModelHead,
    output_kind: str,
    *,
    labels: tuple[str, ...] = (),
) -> OnnxAdapterSpec:
    return OnnxAdapterSpec(
        head=head,
        artifact_path=Path("model.onnx"),
        input_name="image_tensor",
        output_name="model_output",
        input_width=4,
        input_height=3,
        normalization_mean=(0.5, 0.25, 0.0),
        normalization_std=(0.5, 0.25, 1.0),
        output_kind=output_kind,  # type: ignore[arg-type]
        class_labels=labels,
        segmentation_threshold=0.6 if output_kind == "binary_mask_logits" else None,
        calibration_temperature=2.0 if output_kind == "class_logits" else None,
        abstention_threshold=0.7 if output_kind == "class_logits" else None,
        minimum_embedding_dimensions=3 if output_kind == "embedding" else None,
    )


def test_classification_adapter_uses_exact_rgb_preprocessing_and_temperature() -> None:
    network = _FakeNetwork(np.array([[4.0, 2.0]], dtype=np.float32))
    adapter = OpenCVDnnOnnxAdapter(
        _spec(
            ModelHead.ANATOMY,
            "class_logits",
            labels=("first", "second"),
        ),
        network,  # type: ignore[arg-type]
    )
    rgb = np.zeros((3, 4, 3), dtype=np.uint8)
    rgb[:, :, 0] = 255
    rgb[:, :, 1] = 64
    prediction = adapter.predict(rgb)

    assert isinstance(prediction, ClassificationPrediction)
    assert prediction.top_label == "first"
    assert prediction.abstained is False
    assert prediction.probabilities == pytest.approx((0.73105858, 0.26894142))
    assert network.input_name == "image_tensor"
    assert network.output_name == "model_output"
    assert network.input_tensor is not None
    assert network.input_tensor.shape == (1, 3, 3, 4)
    assert network.input_tensor.dtype == np.float32
    assert network.input_tensor[0, 0] == pytest.approx(np.ones((3, 4)))
    assert network.input_tensor[0, 1] == pytest.approx(
        np.full((3, 4), (64 / 255 - 0.25) / 0.25),
        abs=1e-6,
    )
    assert network.input_tensor[0, 2] == pytest.approx(np.zeros((3, 4)))


def test_adapter_validates_segmentation_and_embedding_outputs() -> None:
    segmentation_network = _FakeNetwork(
        np.array([[[[-2.0, 2.0], [0.0, 4.0]]]], dtype=np.float32)
    )
    segmentation = OpenCVDnnOnnxAdapter(
        _spec(ModelHead.SEGMENTATION, "binary_mask_logits"),
        segmentation_network,  # type: ignore[arg-type]
    ).predict(np.zeros((3, 4, 3), dtype=np.uint8))
    assert isinstance(segmentation, SegmentationPrediction)
    assert segmentation.threshold == 0.6
    assert segmentation.probabilities.shape == (2, 2)
    assert segmentation.probabilities[0, 0] == pytest.approx(0.11920292)
    assert segmentation.probabilities[1, 1] == pytest.approx(0.98201376)

    embedding_network = _FakeNetwork(np.array([[3.0, 4.0, 0.0]], dtype=np.float32))
    embedding = OpenCVDnnOnnxAdapter(
        _spec(ModelHead.LESION_REIDENTIFICATION, "embedding"),
        embedding_network,  # type: ignore[arg-type]
    ).predict(np.zeros((3, 4, 3), dtype=np.uint8))
    assert isinstance(embedding, EmbeddingPrediction)
    assert embedding.values == pytest.approx(np.array([0.6, 0.8, 0.0]))


def test_classification_can_match_antialiased_pillow_training_resize() -> None:
    network = _FakeNetwork(np.array([[4.0, 2.0]], dtype=np.float32))
    spec = replace(
        _spec(ModelHead.ANATOMY, "class_logits", labels=("first", "second")),
        resize_interpolation="pillow_bilinear",
    )
    rgb = np.random.default_rng(2026).integers(0, 256, (31, 47, 3), dtype=np.uint8)
    expected_pixels = np.asarray(
        Image.fromarray(rgb).resize((4, 3), Image.Resampling.BILINEAR)
    )
    assert not np.array_equal(expected_pixels, cv2.resize(rgb, (4, 3)))
    expected = (
        expected_pixels.astype(np.float32) / np.float32(255.0)
        - np.asarray(spec.normalization_mean, dtype=np.float32)
    ) / np.asarray(spec.normalization_std, dtype=np.float32)
    OpenCVDnnOnnxAdapter(spec, network).predict(rgb)  # type: ignore[arg-type]
    np.testing.assert_allclose(
        network.input_tensor, np.transpose(expected, (2, 0, 1))[None], atol=1e-6
    )


def test_legacy_segmentation_keeps_opencv_linear_resize() -> None:
    spec = _spec(ModelHead.SEGMENTATION, "binary_mask_logits")
    assert spec.resize_interpolation == "linear"
    network = _FakeNetwork(np.zeros((1, 1, 4, 4), dtype=np.float32))
    rgb = np.random.default_rng(2026).integers(0, 256, (31, 47, 3), dtype=np.uint8)
    expected = (
        cv2.resize(rgb, (4, 3)).astype(np.float32) / np.float32(255.0)
        - np.asarray(spec.normalization_mean, dtype=np.float32)
    ) / np.asarray(spec.normalization_std, dtype=np.float32)
    OpenCVDnnOnnxAdapter(spec, network).predict(rgb)  # type: ignore[arg-type]
    np.testing.assert_allclose(
        network.input_tensor, np.transpose(expected, (2, 0, 1))[None], atol=1e-6
    )


def test_adapter_rejects_unknown_resize_method_before_inference() -> None:
    spec = replace(
        _spec(ModelHead.ANATOMY, "class_logits", labels=("first", "second")),
        resize_interpolation="unknown",  # type: ignore[arg-type]
    )
    network = _FakeNetwork(np.array([[4.0, 2.0]], dtype=np.float32))
    with pytest.raises(ModelAdapterError, match="resize"):
        OpenCVDnnOnnxAdapter(spec, network).predict(
            np.zeros((31, 47, 3), dtype=np.uint8)
        )  # type: ignore[arg-type]
    assert network.forward_calls == 0


@pytest.mark.parametrize(
    "output",
    [
        np.zeros((1, 2, 4, 4), dtype=np.float32),
        np.full((1, 1, 4, 4), np.nan, dtype=np.float32),
    ],
)
def test_adapter_rejects_invalid_or_nonfinite_output(output: np.ndarray) -> None:
    adapter = OpenCVDnnOnnxAdapter(
        _spec(ModelHead.SEGMENTATION, "binary_mask_logits"),
        _FakeNetwork(output),  # type: ignore[arg-type]
    )
    with pytest.raises(ModelAdapterError):
        adapter.predict(np.zeros((3, 4, 3), dtype=np.uint8))


def test_onnx_loader_runs_startup_forward_and_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invalid_network = _FakeNetwork(np.zeros((1, 2, 4, 4), dtype=np.float32))
    monkeypatch.setattr(
        "stoma3d_api.model_adapters.cv2.dnn.readNetFromONNX",
        lambda _path: invalid_network,
    )
    with pytest.raises(ModelAdapterLoadError, match="startup validation"):
        load_onnx_adapter(_spec(ModelHead.SEGMENTATION, "binary_mask_logits"))
    assert invalid_network.forward_calls == 1

    valid_network = _FakeNetwork(np.zeros((1, 1, 4, 4), dtype=np.float32))
    monkeypatch.setattr(
        "stoma3d_api.model_adapters.cv2.dnn.readNetFromONNX",
        lambda _path: valid_network,
    )
    adapter = load_onnx_adapter(_spec(ModelHead.SEGMENTATION, "binary_mask_logits"))
    assert adapter.head is ModelHead.SEGMENTATION
    assert valid_network.forward_calls == 1
