"""Strict OpenCV DNN adapters for hash-pinned ONNX model heads.

The adapter owns preprocessing and output interpretation so a release manifest
describes one exact, testable tensor contract. Models are parsed and exercised
once during service startup; request-time failures are still treated as
abstentions by the processing layer.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol, TypeAlias

import cv2
import numpy as np
from PIL import Image

from .contracts import ModelHead


class ModelAdapterError(RuntimeError):
    """Raised when a model cannot produce a contract-valid prediction."""


class ModelAdapterLoadError(ModelAdapterError):
    """Raised when an ONNX artifact cannot be safely loaded and validated."""


@dataclass(frozen=True, slots=True)
class OnnxAdapterSpec:
    head: ModelHead
    artifact_path: Path
    input_name: str
    output_name: str
    input_width: int
    input_height: int
    normalization_mean: tuple[float, float, float]
    normalization_std: tuple[float, float, float]
    output_kind: Literal["binary_mask_logits", "class_logits", "embedding"]
    class_labels: tuple[str, ...]
    segmentation_threshold: float | None
    calibration_temperature: float | None
    abstention_threshold: float | None
    minimum_embedding_dimensions: int | None
    resize_interpolation: Literal["linear", "pillow_bilinear"] = "linear"


@dataclass(frozen=True, slots=True)
class SegmentationPrediction:
    probabilities: np.ndarray
    threshold: float
    confidence: float


@dataclass(frozen=True, slots=True)
class ClassificationPrediction:
    labels: tuple[str, ...]
    probabilities: tuple[float, ...]
    top_label: str | None
    confidence: float
    abstained: bool


@dataclass(frozen=True, slots=True)
class EmbeddingPrediction:
    values: np.ndarray


AdapterPrediction: TypeAlias = (
    SegmentationPrediction | ClassificationPrediction | EmbeddingPrediction
)


class ModelAdapter(Protocol):
    head: ModelHead

    def predict(self, rgb: np.ndarray) -> AdapterPrediction:
        """Run one validated model prediction over a sanitized RGB image."""


def _sigmoid(logits: np.ndarray) -> np.ndarray:
    clipped = np.clip(logits.astype(np.float64), -80.0, 80.0)
    probabilities = 1.0 / (1.0 + np.exp(-clipped))
    return probabilities.astype(np.float32)


def _softmax(logits: np.ndarray, temperature: float) -> np.ndarray:
    calibrated = logits.astype(np.float64) / temperature
    calibrated -= np.max(calibrated)
    exponentials = np.exp(calibrated)
    denominator = float(np.sum(exponentials))
    if not math.isfinite(denominator) or denominator <= 0:
        raise ModelAdapterError("Classification probabilities are invalid.")
    probabilities = exponentials / denominator
    if not np.all(np.isfinite(probabilities)):
        raise ModelAdapterError("Classification probabilities are invalid.")
    return probabilities


class OpenCVDnnOnnxAdapter:
    """One CPU-only OpenCV DNN network plus its immutable tensor contract."""

    def __init__(self, spec: OnnxAdapterSpec, network: cv2.dnn.Net) -> None:
        self.spec = spec
        self.head = spec.head
        self._network = network
        self._network_lock = threading.Lock()

    def _preprocess(self, rgb: np.ndarray) -> np.ndarray:
        if (
            not isinstance(rgb, np.ndarray)
            or rgb.ndim != 3
            or rgb.shape[2] != 3
            or rgb.size == 0
        ):
            raise ModelAdapterError("Model input must be a non-empty RGB image.")
        if rgb.dtype != np.uint8:
            raise ModelAdapterError("Model input pixels must be uint8 RGB values.")

        size = (self.spec.input_width, self.spec.input_height)
        if self.spec.resize_interpolation == "linear":
            resized = cv2.resize(rgb, size, interpolation=cv2.INTER_LINEAR)
        elif self.spec.resize_interpolation == "pillow_bilinear":
            # Match torchvision's PIL Resize, including antialiasing during
            # downsampling. This is declared by the release, never guessed.
            resized = np.asarray(
                Image.fromarray(rgb).resize(size, Image.Resampling.BILINEAR)
            )
        else:
            raise ModelAdapterError("Unsupported model resize interpolation.")
        tensor = resized.astype(np.float32) / np.float32(255.0)
        mean = np.asarray(self.spec.normalization_mean, dtype=np.float32)
        standard_deviation = np.asarray(
            self.spec.normalization_std,
            dtype=np.float32,
        )
        tensor = (tensor - mean) / standard_deviation
        tensor = np.transpose(tensor, (2, 0, 1))[np.newaxis, ...]
        tensor = np.ascontiguousarray(tensor, dtype=np.float32)
        if tensor.shape != (
            1,
            3,
            self.spec.input_height,
            self.spec.input_width,
        ):
            raise ModelAdapterError("Preprocessed model input has an invalid shape.")
        if not np.all(np.isfinite(tensor)):
            raise ModelAdapterError("Preprocessed model input is not finite.")
        return tensor

    def _forward(self, rgb: np.ndarray) -> np.ndarray:
        tensor = self._preprocess(rgb)
        try:
            with self._network_lock:
                self._network.setInput(tensor, self.spec.input_name)
                output = self._network.forward(self.spec.output_name)
        except cv2.error as exc:
            raise ModelAdapterError("OpenCV DNN inference failed.") from exc
        except Exception as exc:
            raise ModelAdapterError("ONNX inference failed.") from exc

        array = np.asarray(output)
        if not np.issubdtype(array.dtype, np.number):
            raise ModelAdapterError("Model output must be numeric.")
        if not np.all(np.isfinite(array)):
            raise ModelAdapterError("Model output contains non-finite values.")
        return array

    def predict(self, rgb: np.ndarray) -> AdapterPrediction:
        output = self._forward(rgb)
        if self.spec.output_kind == "binary_mask_logits":
            return self._segmentation_prediction(output)
        if self.spec.output_kind == "class_logits":
            return self._classification_prediction(output)
        return self._embedding_prediction(output)

    def _segmentation_prediction(
        self,
        output: np.ndarray,
    ) -> SegmentationPrediction:
        if (
            output.ndim != 4
            or output.shape[0] != 1
            or output.shape[1] != 1
            or output.shape[2] < 2
            or output.shape[3] < 2
            or output.shape[2] > 4096
            or output.shape[3] > 4096
        ):
            raise ModelAdapterError(
                "Segmentation output must have shape [1, 1, height, width]."
            )
        if self.spec.segmentation_threshold is None:
            raise ModelAdapterError("Segmentation threshold is missing.")
        probabilities = _sigmoid(output[0, 0])
        confidence = float(np.mean(np.maximum(probabilities, 1.0 - probabilities)))
        if not math.isfinite(confidence):
            raise ModelAdapterError("Segmentation confidence is invalid.")
        return SegmentationPrediction(
            probabilities=probabilities,
            threshold=self.spec.segmentation_threshold,
            confidence=confidence,
        )

    def _classification_prediction(
        self,
        output: np.ndarray,
    ) -> ClassificationPrediction:
        if (
            output.ndim != 2
            or output.shape[0] != 1
            or output.shape[1] != len(self.spec.class_labels)
        ):
            raise ModelAdapterError(
                "Classification output must have shape [1, class_count]."
            )
        if (
            self.spec.calibration_temperature is None
            or self.spec.abstention_threshold is None
        ):
            raise ModelAdapterError("Classification calibration settings are missing.")
        probabilities = _softmax(
            output[0],
            self.spec.calibration_temperature,
        )
        top_index = int(np.argmax(probabilities))
        confidence = float(probabilities[top_index])
        abstained = confidence < self.spec.abstention_threshold
        return ClassificationPrediction(
            labels=self.spec.class_labels,
            probabilities=tuple(float(value) for value in probabilities),
            top_label=None if abstained else self.spec.class_labels[top_index],
            confidence=confidence,
            abstained=abstained,
        )

    def _embedding_prediction(self, output: np.ndarray) -> EmbeddingPrediction:
        minimum_dimensions = self.spec.minimum_embedding_dimensions
        if (
            output.ndim != 2
            or output.shape[0] != 1
            or minimum_dimensions is None
            or output.shape[1] < minimum_dimensions
            or output.shape[1] > 65_536
        ):
            raise ModelAdapterError(
                "Embedding output must have shape [1, embedding_dimensions]."
            )
        values = output[0].astype(np.float64)
        norm = float(np.linalg.norm(values))
        if not math.isfinite(norm) or norm <= 1e-12:
            raise ModelAdapterError("Embedding output has zero or invalid norm.")
        normalized = (values / norm).astype(np.float32)
        if not np.all(np.isfinite(normalized)):
            raise ModelAdapterError("Normalized embedding is invalid.")
        return EmbeddingPrediction(values=normalized)

    def validate_startup_contract(self) -> None:
        """Exercise names, preprocessing, output shape, and numeric transforms."""

        blank = np.zeros(
            (self.spec.input_height, self.spec.input_width, 3),
            dtype=np.uint8,
        )
        self.predict(blank)


def load_onnx_adapter(spec: OnnxAdapterSpec) -> ModelAdapter:
    """Parse and validate one ONNX artifact with OpenCV's CPU backend."""

    try:
        network = cv2.dnn.readNetFromONNX(str(spec.artifact_path))
        if network.empty():
            raise ModelAdapterLoadError("The ONNX network is empty.")
        network.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        network.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        adapter = OpenCVDnnOnnxAdapter(spec, network)
        adapter.validate_startup_contract()
    except ModelAdapterLoadError:
        raise
    except (cv2.error, ModelAdapterError, OSError, ValueError) as exc:
        raise ModelAdapterLoadError(
            "The ONNX artifact failed startup validation."
        ) from exc
    return adapter
