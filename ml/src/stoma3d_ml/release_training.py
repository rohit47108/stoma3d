"""Train and export release-candidate Stoma3D models on audited manifests.

SMART-OM supports anatomy classification, candidate-lesion segmentation, and a
four-category disease research experiment. Separately licensed manifests can
support the seven-class appearance experiment. Segmentation experiments can run
in validation-only mode so candidate selection never reads the locked test
images. Release evaluations export an OpenCV-compatible ONNX model and write
aggregate evidence only. Exporting a model never releases it: the separate gate
still requires adequate patient counts, metrics, provenance, and review.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import shutil
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .constants import (
    APPEARANCE_CLASSES,
    DISEASE_CLASSES,
    MOUTH_REGIONS,
    RELEASE_THRESHOLDS,
)
from .manifest import load_manifest, resolve_data_path, validate_manifest
from .metrics import classification_metrics, expected_calibration_error
from .smart_om import SMART_OM_DATASET_ID, SMART_OM_LICENSE

IMAGE_NET_MEAN = (0.485, 0.456, 0.406)
IMAGE_NET_STD = (0.229, 0.224, 0.225)
BOUNDARY_TOLERANCE_RATIO = 0.01
PRESENCE_RECALL_FLOOR = 0.90
SUPPORTED_TASKS = ("anatomy", "segmentation", "appearance", "disease")
SUPPLEMENTAL_SEGMENTATION_COLUMNS = (
    "sample_id",
    "patient_id",
    "split",
    "image_path",
    "mask_path",
    "source_dataset",
    "device_family",
    "license_status",
    "audit_status",
    "consent_scope",
    "license_terms",
    "provenance_url",
    "archive_sha256",
)


def _dependencies() -> tuple[Any, Any, Any, Any]:
    try:
        import torch
        import torch.nn.functional as functional
        import torchvision
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            'Release training requires the optional "research" dependencies.'
        ) from exc
    return torch, functional, torchvision, Image


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_supplemental_segmentation_manifest(
    path: Path,
    *,
    data_root: Path,
) -> list[dict[str, str]]:
    """Load audited training-only masks that do not claim a canonical mouth region."""

    if not path.is_file():
        raise ValueError(f"Supplemental segmentation manifest not found: {path}")
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            fieldnames = tuple(reader.fieldnames or ())
            missing = [
                column for column in SUPPLEMENTAL_SEGMENTATION_COLUMNS if column not in fieldnames
            ]
            if missing:
                raise ValueError(
                    "Supplemental segmentation manifest is missing columns: " + ", ".join(missing)
                )
            rows = [
                {key: (value or "").strip() for key, value in row.items() if key is not None}
                for row in reader
            ]
    except (OSError, UnicodeError, csv.Error) as exc:
        raise ValueError(f"Cannot read supplemental segmentation manifest: {exc}") from exc

    if not rows:
        raise ValueError("Supplemental segmentation manifest is empty.")
    seen_samples: set[str] = set()
    errors: list[str] = []
    for index, row in enumerate(rows, start=2):
        sample_id = row["sample_id"]
        if not sample_id:
            errors.append(f"row {index}: sample_id is blank")
        elif sample_id in seen_samples:
            errors.append(f"row {index}: duplicate sample_id {sample_id!r}")
        else:
            seen_samples.add(sample_id)
        for field in ("patient_id", "source_dataset", "device_family"):
            if not row[field]:
                errors.append(f"row {index}: {field} is blank")
        if row["split"] != "train":
            errors.append(f"row {index}: only split=train is permitted")
        if row["license_status"] != "approved":
            errors.append(f"row {index}: license_status must be approved")
        if row["audit_status"] != "approved":
            errors.append(f"row {index}: audit_status must be approved")
        if row["consent_scope"] != "research_training":
            errors.append(f"row {index}: consent_scope must be research_training")
        if row["license_terms"] != "academic_research_noncommercial":
            errors.append(f"row {index}: license_terms must be academic_research_noncommercial")
        if not row["provenance_url"].startswith("https://"):
            errors.append(f"row {index}: provenance_url must use https")
        archive_sha256 = row["archive_sha256"].lower()
        if len(archive_sha256) != 64 or any(
            character not in "0123456789abcdef" for character in archive_sha256
        ):
            errors.append(f"row {index}: archive_sha256 is invalid")
        for field in ("image_path", "mask_path"):
            try:
                resolved = resolve_data_path(data_root, row[field])
            except ValueError as exc:
                errors.append(f"row {index}: {field}: {exc}")
                continue
            if not resolved.is_file():
                errors.append(f"row {index}: {field} was not found")
    if errors:
        preview = "; ".join(errors[:10])
        suffix = f"; plus {len(errors) - 10} more" if len(errors) > 10 else ""
        raise ValueError(f"Supplemental segmentation manifest is invalid: {preview}{suffix}")
    return rows


def _source_revision() -> str:
    """Return a deterministic digest for the exact training source snapshot."""

    package = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for path in sorted(package.glob("*.py")):
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _safe_output_directory(output_dir: Path) -> Path:
    output = output_dir.resolve(strict=False)
    if output.exists() and any(output.iterdir()):
        raise RuntimeError(f"Refusing to overwrite non-empty training output: {output}")
    output.mkdir(parents=True, exist_ok=True)
    return output


def _seed_everything(torch: Any, seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True


def _device(torch: Any) -> Any:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _workers() -> int:
    # Windows spawn workers duplicate enough state to make the small research
    # runs less reliable. One in-process loader is deterministic and sufficient.
    return 0


def _autocast(torch: Any, device: Any) -> Any:
    return torch.autocast(device_type=device.type, enabled=device.type == "cuda")


def _manifest_sha256(path: Path) -> str:
    return _sha256(path.resolve(strict=True))


def _fit_temperature(torch: Any, logits: Any, targets: Any) -> float:
    """Fit one positive temperature on validation logits only."""

    if int(logits.shape[0]) == 0:
        return 1.0
    log_temperature = torch.zeros(1, dtype=torch.float64, requires_grad=True)
    logits64 = logits.to(dtype=torch.float64)
    targets64 = targets.long()
    optimizer = torch.optim.LBFGS(
        [log_temperature],
        lr=0.1,
        max_iter=80,
        line_search_fn="strong_wolfe",
    )

    def closure() -> Any:
        optimizer.zero_grad()
        temperature = log_temperature.exp().clamp(0.05, 20.0)
        loss = torch.nn.functional.cross_entropy(logits64 / temperature, targets64)
        loss.backward()
        return loss

    optimizer.step(closure)
    value = float(log_temperature.detach().exp().clamp(0.05, 20.0).item())
    return value if math.isfinite(value) else 1.0


def _choose_abstention_threshold(
    torch: Any, logits: Any, targets: Any, temperature: float
) -> float:
    """Choose a validation-only confidence floor without hiding errors.

    The threshold targets at least 90% coverage and never changes the release
    accuracy metrics, which are calculated over every held-out sample.
    """

    probabilities = torch.softmax(logits / temperature, dim=1)
    confidence, prediction = probabilities.max(dim=1)
    correct = prediction.eq(targets)
    candidates = [round(value / 100, 2) for value in range(35, 91)]
    viable: list[tuple[float, float, float]] = []
    for threshold in candidates:
        accepted = confidence >= threshold
        coverage = float(accepted.float().mean().item())
        if coverage < 0.90 or not bool(accepted.any()):
            continue
        accuracy = float(correct[accepted].float().mean().item())
        viable.append((accuracy, threshold, coverage))
    if not viable:
        return 0.35
    viable.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return viable[0][1]


def _classification_evaluation(
    torch: Any,
    logits: Any,
    targets: Any,
    *,
    labels: Sequence[str],
    temperature: float,
    abstention_threshold: float,
) -> dict[str, object]:
    probabilities = torch.softmax(logits / temperature, dim=1)
    confidence, predicted_indices = probabilities.max(dim=1)
    expected = [labels[int(index)] for index in targets.tolist()]
    predicted = [labels[int(index)] for index in predicted_indices.tolist()]
    metrics = classification_metrics(expected, predicted, labels)
    correct = predicted_indices.eq(targets)
    metrics["expected_calibration_error"] = expected_calibration_error(
        [float(value) for value in confidence.tolist()],
        [bool(value) for value in correct.tolist()],
    )
    accepted = confidence >= abstention_threshold
    metrics["abstention_threshold"] = abstention_threshold
    metrics["accepted_fraction"] = float(accepted.float().mean().item())
    metrics["accepted_accuracy"] = (
        float(correct[accepted].float().mean().item()) if bool(accepted.any()) else 0.0
    )
    metrics["calibration_temperature"] = temperature
    return metrics


def _anatomy_transforms(torchvision: Any, image_size: int) -> tuple[Any, Any]:
    transforms = torchvision.transforms
    train = transforms.Compose(
        [
            transforms.RandomResizedCrop(
                (image_size, image_size),
                scale=(0.78, 1.0),
                ratio=(0.88, 1.12),
            ),
            transforms.RandomRotation(8),
            transforms.ColorJitter(
                brightness=0.16,
                contrast=0.16,
                saturation=0.10,
                hue=0.025,
            ),
            transforms.ToTensor(),
            transforms.Normalize(IMAGE_NET_MEAN, IMAGE_NET_STD),
        ]
    )
    evaluate = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(IMAGE_NET_MEAN, IMAGE_NET_STD),
        ]
    )
    return train, evaluate


def _build_classification_model(
    torch: Any,
    torchvision: Any,
    *,
    class_count: int,
    pretrained: bool,
) -> Any:
    weights = torchvision.models.MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
    model = torchvision.models.mobilenet_v3_small(weights=weights)
    last = model.classifier[-1]
    model.classifier[-1] = torch.nn.Linear(last.in_features, class_count)
    return model


def _load_classification_logits(
    torch: Any,
    model: Any,
    loader: Any,
    device: Any,
) -> tuple[Any, Any, float]:
    model.eval()
    logits: list[Any] = []
    targets: list[Any] = []
    loss_total = 0.0
    sample_count = 0
    with torch.inference_mode():
        for images, expected in loader:
            images = images.to(device, non_blocking=True)
            expected_device = expected.to(device, non_blocking=True)
            output = model(images)
            loss = torch.nn.functional.cross_entropy(output, expected_device)
            count = int(expected.numel())
            sample_count += count
            loss_total += float(loss.item()) * count
            logits.append(output.detach().cpu())
            targets.append(expected.detach().cpu())
    if not logits:
        raise RuntimeError("The requested classification split is empty.")
    return (
        torch.cat(logits, dim=0),
        torch.cat(targets, dim=0),
        loss_total / sample_count,
    )


def _classification_interface(
    labels: Sequence[str], temperature: float, abstention_threshold: float
) -> dict[str, object]:
    return {
        "input_name": "image",
        "output_name": "logits",
        "output_kind": "class_logits",
        "resize_interpolation": "pillow_bilinear",
        "class_labels": list(labels),
        "calibration_temperature": temperature,
        "abstention_threshold": abstention_threshold,
    }


def _classification_artifact_name(task: str) -> str:
    artifact_names = {
        "anatomy": "anatomy.onnx",
        "appearance": "appearance.onnx",
        "disease": "disease_research.onnx",
    }
    try:
        return artifact_names[task]
    except KeyError as exc:
        raise ValueError(f"Unsupported classification task: {task}") from exc


def _train_classification(
    rows: Sequence[Mapping[str, str]],
    *,
    task: str,
    label_field: str,
    labels: Sequence[str],
    data_root: Path,
    output: Path,
    image_size: int,
    batch_size: int,
    epochs: int,
    learning_rate: float,
    seed: int,
    pretrained: bool,
) -> dict[str, object]:
    torch, _, torchvision, Image = _dependencies()
    _seed_everything(torch, seed)
    train_transform, evaluate_transform = _anatomy_transforms(torchvision, image_size)
    label_to_index = {label: index for index, label in enumerate(labels)}

    class Dataset(torch.utils.data.Dataset):
        def __init__(self, split: str) -> None:
            self.rows = [row for row in rows if row["split"] == split]
            self.transform = train_transform if split == "train" else evaluate_transform

        def __len__(self) -> int:
            return len(self.rows)

        def __getitem__(self, index: int) -> tuple[Any, int]:
            row = self.rows[index]
            with Image.open(resolve_data_path(data_root, row["image_path"])) as image:
                tensor = self.transform(image.convert("RGB"))
            return tensor, label_to_index[row[label_field]]

    train_dataset = Dataset("train")
    validation_dataset = Dataset("validation")
    test_dataset = Dataset("test")
    generator = torch.Generator().manual_seed(seed)
    train_loader = torch.utils.data.DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        generator=generator,
        num_workers=_workers(),
        pin_memory=torch.cuda.is_available(),
    )
    validation_loader = torch.utils.data.DataLoader(
        validation_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=_workers(),
        pin_memory=torch.cuda.is_available(),
    )
    test_loader = torch.utils.data.DataLoader(
        test_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=_workers(),
        pin_memory=torch.cuda.is_available(),
    )

    counts = Counter(row[label_field] for row in rows if row["split"] == "train")
    class_weights = torch.tensor(
        [len(train_dataset) / (len(labels) * counts[label]) for label in labels],
        dtype=torch.float32,
    )
    device = _device(torch)
    model = _build_classification_model(
        torch,
        torchvision,
        class_count=len(labels),
        pretrained=pretrained,
    ).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=learning_rate,
        weight_decay=0.01,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    criterion = torch.nn.CrossEntropyLoss(
        weight=class_weights.to(device),
        label_smoothing=0.04,
    )
    best_state: dict[str, Any] | None = None
    best_macro_f1 = -1.0
    history: list[dict[str, float | int]] = []
    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        train_count = 0
        for images, targets in train_loader:
            images = images.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with _autocast(torch, device):
                logits = model(images)
                loss = criterion(logits, targets)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            count = int(targets.numel())
            train_loss += float(loss.item()) * count
            train_count += count
        scheduler.step()
        validation_logits, validation_targets, validation_loss = _load_classification_logits(
            torch, model, validation_loader, device
        )
        validation_prediction = validation_logits.argmax(dim=1)
        validation_metrics = classification_metrics(
            [labels[int(value)] for value in validation_targets.tolist()],
            [labels[int(value)] for value in validation_prediction.tolist()],
            labels,
        )
        macro_f1 = float(validation_metrics["macro_f1"])
        history.append(
            {
                "epoch": epoch,
                "train_loss": train_loss / max(train_count, 1),
                "validation_loss": validation_loss,
                "validation_macro_f1": macro_f1,
            }
        )
        print(
            f"{task} epoch {epoch}/{epochs}: validation macro F1={macro_f1:.4f}",
            flush=True,
        )
        if macro_f1 > best_macro_f1:
            best_macro_f1 = macro_f1
            best_state = {
                key: value.detach().cpu().clone() for key, value in model.state_dict().items()
            }
    if best_state is None:
        raise RuntimeError(f"{task} training did not produce a checkpoint.")
    model.load_state_dict(best_state)
    model.to(device)
    validation_logits, validation_targets, _ = _load_classification_logits(
        torch, model, validation_loader, device
    )
    temperature = _fit_temperature(torch, validation_logits, validation_targets)
    abstention_threshold = _choose_abstention_threshold(
        torch, validation_logits, validation_targets, temperature
    )
    test_logits, test_targets, test_loss = _load_classification_logits(
        torch, model, test_loader, device
    )
    test_metrics = _classification_evaluation(
        torch,
        test_logits,
        test_targets,
        labels=labels,
        temperature=temperature,
        abstention_threshold=abstention_threshold,
    )
    test_metrics["cross_entropy"] = test_loss
    weights_path = output / "model.pt"
    torch.save(best_state, weights_path)
    artifact_name = _classification_artifact_name(task)
    onnx_path = output / artifact_name
    export_model = _build_classification_model(
        torch,
        torchvision,
        class_count=len(labels),
        pretrained=False,
    )
    export_model.load_state_dict(best_state)
    export_model.eval()
    _export_onnx(torch, export_model, onnx_path, image_size=image_size)
    return {
        "task": task,
        "artifact": onnx_path.name,
        "artifact_sha256": _sha256(onnx_path),
        "weights_sha256": _sha256(weights_path),
        "configuration": {
            "architecture": "torchvision_mobilenet_v3_small",
            "pretrained_imagenet": pretrained,
            "image_size": image_size,
            "batch_size": batch_size,
            "epochs": epochs,
            "learning_rate": learning_rate,
            "seed": seed,
            "normalization_mean": list(IMAGE_NET_MEAN),
            "normalization_std": list(IMAGE_NET_STD),
        },
        "validation_best_macro_f1": best_macro_f1,
        "test": test_metrics,
        "history": history,
        "interface": _classification_interface(labels, temperature, abstention_threshold),
    }


def _build_segmentation_model(
    torch: Any,
    torchvision: Any,
    *,
    pretrained: bool,
    architecture: str,
) -> Any:
    """Build one release-candidate binary segmentation network."""

    unetplusplus_encoders = {
        "unetplusplus_efficientnet_b3": ("efficientnet-b3", False),
        "presence_gated_unetplusplus_efficientnet_b3": ("efficientnet-b3", True),
        "presence_gated_unetplusplus_efficientnet_b4": ("efficientnet-b4", True),
    }
    if architecture in unetplusplus_encoders:
        try:
            import segmentation_models_pytorch as smp
        except ImportError as exc:
            raise RuntimeError("U-Net++ training requires segmentation-models-pytorch.") from exc
        encoder_name, presence_gated = unetplusplus_encoders[architecture]
        segmentation_model = smp.UnetPlusPlus(
            encoder_name=encoder_name,
            encoder_weights="imagenet" if pretrained else None,
            in_channels=3,
            classes=1,
            activation=None,
        )
        if not presence_gated:
            return segmentation_model

        class PresenceGatedUnetPlusPlus(torch.nn.Module):
            """One segmentation model with an internal no-candidate gate."""

            def __init__(self) -> None:
                super().__init__()
                self.encoder = segmentation_model.encoder
                self.decoder = segmentation_model.decoder
                self.segmentation_head = segmentation_model.segmentation_head
                deepest_channels = int(self.encoder.out_channels[-1])
                self.presence_head = torch.nn.Sequential(
                    torch.nn.AdaptiveAvgPool2d(1),
                    torch.nn.Flatten(),
                    torch.nn.Dropout(p=0.2),
                    torch.nn.Linear(deepest_channels, 1),
                )
                self.presence_threshold = 0.5

            def forward_components(self, image: Any) -> tuple[Any, Any]:
                features = self.encoder(image)
                decoded = self.decoder(features)
                mask_logits = self.segmentation_head(decoded)
                presence_logits = self.presence_head(features[-1])
                return mask_logits, presence_logits

            def forward(self, image: Any) -> Any:
                mask_logits, presence_logits = self.forward_components(image)
                present = torch.sigmoid(presence_logits) >= self.presence_threshold
                return torch.where(
                    present[:, :, None, None],
                    mask_logits,
                    torch.full_like(mask_logits, -20.0),
                )

        return PresenceGatedUnetPlusPlus()
    if architecture == "deeplabv3_resnet50":
        weights = (
            torchvision.models.segmentation.DeepLabV3_ResNet50_Weights.DEFAULT
            if pretrained
            else None
        )

        class DeepLabBinary(torch.nn.Module):
            def __init__(self) -> None:
                super().__init__()
                model_arguments: dict[str, Any] = {"weights": weights}
                if weights is None:
                    model_arguments["weights_backbone"] = None
                self.model = torchvision.models.segmentation.deeplabv3_resnet50(
                    **model_arguments,
                )
                classifier = self.model.classifier[-1]
                self.model.classifier[-1] = torch.nn.Conv2d(
                    classifier.in_channels,
                    1,
                    1,
                )
                self.model.aux_classifier = None

            def forward(self, image: Any) -> Any:
                return self.model(image)["out"]

        return DeepLabBinary()
    if architecture != "mobilenet_v3_small_unet":
        raise ValueError(f"Unsupported segmentation architecture: {architecture}")

    weights = torchvision.models.MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None

    class ConvBlock(torch.nn.Module):
        def __init__(self, in_channels: int, out_channels: int) -> None:
            super().__init__()
            self.block = torch.nn.Sequential(
                torch.nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
                torch.nn.BatchNorm2d(out_channels),
                torch.nn.ReLU(inplace=False),
                torch.nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False),
                torch.nn.BatchNorm2d(out_channels),
                torch.nn.ReLU(inplace=False),
            )

        def forward(self, value: Any) -> Any:
            return self.block(value)

    class UpBlock(torch.nn.Module):
        def __init__(self, in_channels: int, skip_channels: int, out_channels: int) -> None:
            super().__init__()
            self.block = ConvBlock(in_channels + skip_channels, out_channels)

        def forward(self, value: Any, skip: Any) -> Any:
            value = torch.nn.functional.interpolate(
                value,
                size=skip.shape[-2:],
                mode="bilinear",
                align_corners=False,
            )
            return self.block(torch.cat((value, skip), dim=1))

    class MobileUNet(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.encoder = torchvision.models.mobilenet_v3_small(weights=weights).features
            self.up14 = UpBlock(576, 48, 160)
            self.up28 = UpBlock(160, 24, 96)
            self.up56 = UpBlock(96, 16, 56)
            self.up112 = UpBlock(56, 16, 32)
            self.head = torch.nn.Sequential(
                ConvBlock(32, 24),
                torch.nn.Conv2d(24, 1, 1),
            )

        def forward(self, image: Any) -> Any:
            value = image
            skip112 = skip56 = skip28 = skip14 = None
            for index, layer in enumerate(self.encoder):
                value = layer(value)
                if index == 0:
                    skip112 = value
                elif index == 1:
                    skip56 = value
                elif index == 3:
                    skip28 = value
                elif index == 8:
                    skip14 = value
            assert skip112 is not None
            assert skip56 is not None
            assert skip28 is not None
            assert skip14 is not None
            value = self.up14(value, skip14)
            value = self.up28(value, skip28)
            value = self.up56(value, skip56)
            value = self.up112(value, skip112)
            value = self.head(value)
            return torch.nn.functional.interpolate(
                value,
                size=image.shape[-2:],
                mode="bilinear",
                align_corners=False,
            )

    return MobileUNet()


def _segmentation_pair_transform(
    torch: Any,
    torchvision: Any,
    Image: Any,
    image: Any,
    mask: Any,
    *,
    image_size: int,
    train: bool,
) -> tuple[Any, Any]:
    functional = torchvision.transforms.functional
    image = image.resize((image_size, image_size), resample=Image.Resampling.BILINEAR)
    mask = mask.resize((image_size, image_size), resample=Image.Resampling.NEAREST)
    if train:
        if random.random() < 0.5:
            image = functional.hflip(image)
            mask = functional.hflip(mask)
        angle = random.uniform(-10.0, 10.0)
        translate = (
            round(random.uniform(-0.06, 0.06) * image_size),
            round(random.uniform(-0.06, 0.06) * image_size),
        )
        scale = random.uniform(0.90, 1.10)
        shear = random.uniform(-4.0, 4.0)
        image = functional.affine(
            image,
            angle,
            translate=translate,
            scale=scale,
            shear=(shear, 0.0),
            interpolation=torchvision.transforms.InterpolationMode.BILINEAR,
            fill=0,
        )
        mask = functional.affine(
            mask,
            angle,
            translate=translate,
            scale=scale,
            shear=(shear, 0.0),
            interpolation=torchvision.transforms.InterpolationMode.NEAREST,
            fill=0,
        )
        image = torchvision.transforms.ColorJitter(
            brightness=0.18,
            contrast=0.18,
            saturation=0.12,
            hue=0.025,
        )(image)
        if random.random() < 0.18:
            image = functional.gaussian_blur(image, kernel_size=3, sigma=(0.1, 1.2))
        if random.random() < 0.18:
            image = functional.adjust_sharpness(
                image,
                sharpness_factor=random.uniform(0.65, 1.45),
            )
    image_tensor = functional.to_tensor(image)
    image_tensor = functional.normalize(image_tensor, IMAGE_NET_MEAN, IMAGE_NET_STD)
    mask_tensor = functional.pil_to_tensor(mask).float().div(255.0)
    return image_tensor, (mask_tensor >= 0.5).float()


def _dice_loss(torch: Any, logits: Any, targets: Any) -> Any:
    probabilities = torch.sigmoid(logits)
    numerator = 2.0 * (probabilities * targets).sum(dim=(1, 2, 3)) + 1.0
    denominator = probabilities.sum(dim=(1, 2, 3)) + targets.sum(dim=(1, 2, 3)) + 1.0
    return 1.0 - (numerator / denominator).mean()


def _focal_tversky_loss(
    torch: Any,
    logits: Any,
    targets: Any,
    *,
    false_positive_weight: float = 0.35,
    false_negative_weight: float = 0.65,
) -> Any:
    """Penalize missed candidate pixels more than modest over-segmentation."""

    probabilities = torch.sigmoid(logits)
    dimensions = (1, 2, 3)
    true_positive = (probabilities * targets).sum(dim=dimensions)
    false_positive = (probabilities * (1.0 - targets)).sum(dim=dimensions)
    false_negative = ((1.0 - probabilities) * targets).sum(dim=dimensions)
    tversky = (true_positive + 1.0) / (
        true_positive
        + false_positive_weight * false_positive
        + false_negative_weight * false_negative
        + 1.0
    )
    return torch.pow(1.0 - tversky, 0.75).mean()


def _boundary_loss(torch: Any, logits: Any, targets: Any) -> Any:
    probabilities = torch.sigmoid(logits)
    predicted_boundary = torch.nn.functional.max_pool2d(
        probabilities,
        3,
        stride=1,
        padding=1,
    ) + torch.nn.functional.max_pool2d(
        -probabilities,
        3,
        stride=1,
        padding=1,
    )
    truth_boundary = torch.nn.functional.max_pool2d(
        targets,
        3,
        stride=1,
        padding=1,
    ) + torch.nn.functional.max_pool2d(
        -targets,
        3,
        stride=1,
        padding=1,
    )
    numerator = 2.0 * (predicted_boundary * truth_boundary).sum(dim=(1, 2, 3)) + 1.0
    denominator = predicted_boundary.sum(dim=(1, 2, 3)) + truth_boundary.sum(dim=(1, 2, 3)) + 1.0
    return 1.0 - (numerator / denominator).mean()


def _tolerant_boundary_loss(torch: Any, logits: Any, targets: Any) -> Any:
    """A differentiable boundary F1 loss aligned with the release metric tolerance."""

    probabilities = torch.sigmoid(logits)
    predicted_boundary = torch.nn.functional.max_pool2d(
        probabilities,
        3,
        stride=1,
        padding=1,
    ) + torch.nn.functional.max_pool2d(
        -probabilities,
        3,
        stride=1,
        padding=1,
    )
    truth_boundary = torch.nn.functional.max_pool2d(
        targets,
        3,
        stride=1,
        padding=1,
    ) + torch.nn.functional.max_pool2d(
        -targets,
        3,
        stride=1,
        padding=1,
    )
    radius = _boundary_tolerance_radius(targets)
    kernel_size = 2 * radius + 1
    predicted_tolerance = torch.nn.functional.max_pool2d(
        predicted_boundary,
        kernel_size,
        stride=1,
        padding=radius,
    )
    truth_tolerance = torch.nn.functional.max_pool2d(
        truth_boundary,
        kernel_size,
        stride=1,
        padding=radius,
    )
    dimensions = (1, 2, 3)
    precision = (predicted_boundary * truth_tolerance).sum(dim=dimensions) / (
        predicted_boundary.sum(dim=dimensions) + 1.0
    )
    recall = (truth_boundary * predicted_tolerance).sum(dim=dimensions) / (
        truth_boundary.sum(dim=dimensions) + 1.0
    )
    boundary_f1 = 2.0 * precision * recall / (precision + recall + 1.0e-6)
    return 1.0 - boundary_f1.mean()


def _binary_boundaries(torch: Any, masks: Any) -> Any:
    masks = masks.float()
    dilated = torch.nn.functional.max_pool2d(masks, 3, stride=1, padding=1)
    eroded = -torch.nn.functional.max_pool2d(-masks, 3, stride=1, padding=1)
    return (dilated - eroded) > 0


def _boundary_tolerance_radius(masks: Any) -> int:
    height, width = masks.shape[-2:]
    return max(
        1,
        math.ceil(BOUNDARY_TOLERANCE_RATIO * math.hypot(height, width)),
    )


def _largest_connected_components(torch: Any, predictions: Any) -> Any:
    """Mirror the API's one-candidate largest-component postprocessing."""

    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise RuntimeError(
            "Largest-component segmentation scoring requires OpenCV and NumPy."
        ) from exc
    if predictions.ndim != 4 or predictions.shape[1] != 1:
        raise ValueError("Segmentation predictions must have shape [N, 1, H, W].")
    source_device = predictions.device
    masks = predictions.detach().to("cpu").numpy().astype("uint8")
    filtered = np.zeros_like(masks, dtype="uint8")
    for index in range(masks.shape[0]):
        count, labels, stats, _ = cv2.connectedComponentsWithStats(
            masks[index, 0],
            connectivity=8,
        )
        if count <= 1:
            continue
        areas = stats[1:, cv2.CC_STAT_AREA]
        largest_label = int(np.argmax(areas)) + 1
        filtered[index, 0] = labels == largest_label
    return torch.from_numpy(filtered).to(source_device).bool()


def _segmentation_metrics(
    torch: Any,
    probabilities: Any,
    targets: Any,
    *,
    threshold: float,
    largest_component_only: bool = False,
) -> dict[str, float | int]:
    if torch.cuda.is_available() and probabilities.device.type == "cpu":
        probabilities = probabilities.to("cuda", non_blocking=True)
        targets = targets.to("cuda", non_blocking=True)
    predictions = probabilities >= threshold
    if largest_component_only:
        predictions = _largest_connected_components(torch, predictions)
    truth = targets.bool()
    prediction_boundaries = _binary_boundaries(torch, predictions)
    truth_boundaries = _binary_boundaries(torch, truth)
    dimensions = (1, 2, 3)
    intersection = (predictions & truth).sum(dim=dimensions).float()
    predicted_pixels = predictions.sum(dim=dimensions).float()
    truth_pixels = truth.sum(dim=dimensions).float()
    denominator = predicted_pixels + truth_pixels
    dice_values = torch.where(
        denominator > 0,
        2.0 * intersection / denominator.clamp_min(1.0),
        torch.ones_like(denominator),
    )
    positive = truth_pixels > 0
    negative = ~positive

    tolerance_radius = _boundary_tolerance_radius(truth)
    tolerance_kernel = 2 * tolerance_radius + 1
    expected_tolerance = torch.nn.functional.max_pool2d(
        truth_boundaries.float(),
        tolerance_kernel,
        stride=1,
        padding=tolerance_radius,
    ).bool()
    predicted_tolerance = torch.nn.functional.max_pool2d(
        prediction_boundaries.float(),
        tolerance_kernel,
        stride=1,
        padding=tolerance_radius,
    ).bool()
    predicted_boundary_count = prediction_boundaries.sum(dim=dimensions).float()
    truth_boundary_count = truth_boundaries.sum(dim=dimensions).float()
    boundary_precision = (prediction_boundaries & expected_tolerance).sum(
        dim=dimensions
    ).float() / predicted_boundary_count.clamp_min(1.0)
    boundary_recall = (truth_boundaries & predicted_tolerance).sum(
        dim=dimensions
    ).float() / truth_boundary_count.clamp_min(1.0)
    boundary_denominator = boundary_precision + boundary_recall
    boundary_values = torch.where(
        (predicted_boundary_count == 0) & (truth_boundary_count == 0),
        torch.ones_like(boundary_denominator),
        torch.where(
            (predicted_boundary_count == 0) | (truth_boundary_count == 0),
            torch.zeros_like(boundary_denominator),
            2.0 * boundary_precision * boundary_recall / boundary_denominator.clamp_min(1e-12),
        ),
    )
    negative_specificity = (
        (~predictions[negative]).float().mean(dim=dimensions)
        if bool(negative.any())
        else torch.empty(0)
    )
    return {
        "sample_count": int(dice_values.numel()),
        "positive_sample_count": int(positive.sum().item()),
        "negative_sample_count": int(negative.sum().item()),
        "dice": float(dice_values.mean().item()),
        "positive_dice": (
            float(dice_values[positive].mean().item()) if bool(positive.any()) else 0.0
        ),
        "boundary_f1": float(boundary_values.mean().item()),
        "positive_boundary_f1": (
            float(boundary_values[positive].mean().item()) if bool(positive.any()) else 0.0
        ),
        "negative_pixel_specificity": (
            float(negative_specificity.mean().item()) if int(negative_specificity.numel()) else 0.0
        ),
    }


def _load_segmentation_predictions(
    torch: Any,
    model: Any,
    loader: Any,
    device: Any,
) -> tuple[Any, Any]:
    model.eval()
    probabilities: list[Any] = []
    targets: list[Any] = []
    with torch.inference_mode():
        for images, expected in loader:
            with _autocast(torch, device):
                logits = model(images.to(device, non_blocking=True))
            probabilities.append(torch.sigmoid(logits.float()).cpu())
            targets.append(expected.cpu())
    if not probabilities:
        raise RuntimeError("The requested segmentation split is empty.")
    return torch.cat(probabilities, dim=0), torch.cat(targets, dim=0)


def _load_presence_gated_predictions(
    torch: Any,
    model: Any,
    loader: Any,
    device: Any,
) -> tuple[Any, Any | None, Any]:
    if not hasattr(model, "forward_components"):
        probabilities, targets = _load_segmentation_predictions(
            torch,
            model,
            loader,
            device,
        )
        return probabilities, None, targets
    probabilities: list[Any] = []
    presence_probabilities: list[Any] = []
    targets: list[Any] = []
    model.eval()
    with torch.inference_mode():
        for images, expected in loader:
            with _autocast(torch, device):
                mask_logits, presence_logits = model.forward_components(
                    images.to(device, non_blocking=True)
                )
            probabilities.append(torch.sigmoid(mask_logits.float()).cpu())
            presence_probabilities.append(torch.sigmoid(presence_logits.float()).cpu())
            targets.append(expected.cpu())
    if not probabilities:
        raise RuntimeError("The requested segmentation split is empty.")
    return (
        torch.cat(probabilities, dim=0),
        torch.cat(presence_probabilities, dim=0),
        torch.cat(targets, dim=0),
    )


def _choose_presence_and_mask_thresholds(
    torch: Any,
    probabilities: Any,
    presence_probabilities: Any,
    targets: Any,
) -> tuple[float, float]:
    if torch.cuda.is_available() and probabilities.device.type == "cpu":
        probabilities = probabilities.to("cuda", non_blocking=True)
        presence_probabilities = presence_probabilities.to("cuda", non_blocking=True)
        targets = targets.to("cuda", non_blocking=True)
    scored: list[tuple[bool, bool, float, float, float, float, float, float]] = []
    truth_positive = targets.sum(dim=(1, 2, 3)) > 0
    for presence_threshold in (0.25, 0.3, 0.35, 0.4, 0.5, 0.6):
        present = presence_probabilities >= presence_threshold
        presence_recall = (
            float(present[:, 0][truth_positive].float().mean().item())
            if bool(truth_positive.any())
            else 0.0
        )
        gated = torch.where(
            present[:, :, None, None],
            probabilities,
            torch.zeros_like(probabilities),
        )
        for mask_threshold in (0.35, 0.45, 0.55, 0.6, 0.65, 0.7):
            metrics = _segmentation_metrics(
                torch,
                gated,
                targets,
                threshold=mask_threshold,
            )
            score = _segmentation_selection_score(metrics)
            gate_passed, positive_quality, gate_margin, _ = _segmentation_gate_selection_key(
                metrics
            )
            scored.append(
                (
                    presence_recall >= PRESENCE_RECALL_FLOOR,
                    gate_passed,
                    positive_quality,
                    gate_margin,
                    score,
                    presence_recall,
                    -presence_threshold,
                    mask_threshold,
                )
            )
    scored.sort(reverse=True)
    _, _, _, _, _, _, negative_presence_threshold, mask_threshold = scored[0]
    presence_threshold = -negative_presence_threshold
    return presence_threshold, mask_threshold


def _segmentation_selection_score(metrics: Mapping[str, float | int]) -> float:
    """Select checkpoints using positive-mask quality as well as empty images."""

    return (
        float(metrics["dice"])
        + float(metrics["boundary_f1"])
        + 0.50 * float(metrics["positive_dice"])
        + 0.25 * float(metrics["positive_boundary_f1"])
    )


def _segmentation_gate_selection_key(
    metrics: Mapping[str, float | int],
) -> tuple[bool, float, float, float]:
    """Require both gates, then prefer actual positive-mask quality."""

    dice = float(metrics["dice"])
    boundary_f1 = float(metrics["boundary_f1"])
    positive_dice = float(metrics["positive_dice"])
    positive_boundary_f1 = float(metrics["positive_boundary_f1"])
    thresholds = RELEASE_THRESHOLDS["segmentation"]
    dice_margin = dice - float(thresholds["dice"])
    boundary_margin = boundary_f1 - float(thresholds["boundary_f1"])
    return (
        dice_margin >= 0.0 and boundary_margin >= 0.0,
        min(positive_dice, positive_boundary_f1),
        min(dice_margin, boundary_margin),
        _segmentation_selection_score(metrics),
    )


def _presence_positive_weight(positive_count: int, negative_count: int) -> float:
    """Balance the presence loss when a training-only supplement is one-sided."""

    if positive_count < 1 or negative_count < 1:
        raise ValueError("Presence training requires positive and negative samples.")
    return min(max(negative_count / positive_count, 0.1), 10.0)


def _choose_segmentation_threshold(torch: Any, probabilities: Any, targets: Any) -> float:
    if torch.cuda.is_available() and probabilities.device.type == "cpu":
        probabilities = probabilities.to("cuda", non_blocking=True)
        targets = targets.to("cuda", non_blocking=True)
    candidates = [round(value / 100, 2) for value in range(25, 76, 5)]
    truth = targets.bool()
    dimensions = (1, 2, 3)
    scored: list[tuple[float, float]] = []
    for threshold in candidates:
        predictions = probabilities >= threshold
        intersection = (predictions & truth).sum(dim=dimensions).float()
        denominator = predictions.sum(dim=dimensions).float() + truth.sum(dim=dimensions).float()
        dice = torch.where(
            denominator > 0,
            2.0 * intersection / denominator.clamp_min(1.0),
            torch.ones_like(denominator),
        )
        scored.append((float(dice.mean().item()), threshold))
    scored.sort(reverse=True)
    return scored[0][1]


def _train_segmentation(
    rows: Sequence[Mapping[str, str]],
    *,
    data_root: Path,
    output: Path,
    image_size: int,
    batch_size: int,
    epochs: int,
    learning_rate: float,
    seed: int,
    pretrained: bool,
    segmentation_architecture: str,
    segmentation_loss_version: str,
    evaluate_test: bool,
    supplemental_rows: Sequence[Mapping[str, str]] = (),
    supplemental_data_root: Path | None = None,
    supplemental_manifest_sha256: str | None = None,
    refit_source_run: Path | None = None,
    positive_sample_repeat: int = 1,
) -> dict[str, object]:
    torch, _, torchvision, Image = _dependencies()
    _seed_everything(torch, seed)
    refit_source: Mapping[str, object] | None = None
    refit_source_hash: str | None = None
    if refit_source_run is not None:
        try:
            loaded_source = json.loads(refit_source_run.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"Cannot read segmentation refit source: {exc}") from exc
        if not isinstance(loaded_source, Mapping) or loaded_source.get("task") != "segmentation":
            raise ValueError("The refit source must be a segmentation run.json file.")
        source_configuration = loaded_source.get("configuration")
        source_history = loaded_source.get("history")
        if not isinstance(source_configuration, Mapping) or not isinstance(source_history, list):
            raise ValueError("The refit source is missing configuration or validation history.")
        expected_configuration = {
            "architecture": segmentation_architecture,
            "image_size": image_size,
            "batch_size": batch_size,
            "epochs": epochs,
            "learning_rate": learning_rate,
            "seed": seed,
            "pretrained_imagenet": pretrained,
            "segmentation_loss_version": segmentation_loss_version,
            "positive_sample_repeat": positive_sample_repeat,
        }
        mismatches = [
            key
            for key, expected in expected_configuration.items()
            if source_configuration.get(key) != expected
        ]
        source_supplemental = source_configuration.get("supplemental_segmentation")
        if supplemental_rows:
            if (
                not isinstance(source_supplemental, Mapping)
                or source_supplemental.get("manifest_sha256") != supplemental_manifest_sha256
                or source_supplemental.get("sample_count") != len(supplemental_rows)
            ):
                mismatches.append("supplemental_segmentation")
        elif source_supplemental is not None:
            mismatches.append("supplemental_segmentation")
        if mismatches:
            raise ValueError(
                "Refit arguments must match the selected validation run: " + ", ".join(mismatches)
            )
        refit_source = loaded_source
        refit_source_hash = _sha256(refit_source_run)

    class Dataset(torch.utils.data.Dataset):
        def __init__(self, split: str) -> None:
            selected_splits = (
                {"train", "validation"}
                if split == "train" and refit_source is not None
                else {split}
            )
            self.rows = [row for row in rows if row["split"] in selected_splits]
            if split == "train":
                self.rows.extend({**row, "_supplemental": "true"} for row in supplemental_rows)
            self.train = split == "train"
            self.cached_pairs = [self._load_pair(row) for row in self.rows]

        def __len__(self) -> int:
            return len(self.rows)

        def _load_pair(self, row: Mapping[str, str]) -> tuple[Any, Any]:
            row_data_root = (
                supplemental_data_root if row.get("_supplemental") == "true" else data_root
            )
            if row_data_root is None:
                raise RuntimeError("Supplemental segmentation data root is missing.")
            with (
                Image.open(resolve_data_path(row_data_root, row["image_path"])) as image,
                Image.open(resolve_data_path(row_data_root, row["mask_path"])) as mask,
            ):
                resized_image = image.convert("RGB").resize(
                    (image_size, image_size),
                    resample=Image.Resampling.BILINEAR,
                )
                resized_mask = mask.convert("L").resize(
                    (image_size, image_size),
                    resample=Image.Resampling.NEAREST,
                )
                return resized_image.copy(), resized_mask.copy()

        def __getitem__(self, index: int) -> tuple[Any, Any]:
            image, mask = self.cached_pairs[index]
            return _segmentation_pair_transform(
                torch,
                torchvision,
                Image,
                image.copy(),
                mask.copy(),
                image_size=image_size,
                train=self.train,
            )

    train_dataset = Dataset("train")
    validation_dataset = Dataset("validation") if refit_source is None else None
    test_dataset = Dataset("test") if evaluate_test else None
    training_positive_count = sum(
        int(mask.getbbox() is not None) for _, mask in train_dataset.cached_pairs
    )
    training_negative_count = len(train_dataset) - training_positive_count
    presence_positive_weight = _presence_positive_weight(
        training_positive_count * positive_sample_repeat,
        training_negative_count,
    )
    generator = torch.Generator().manual_seed(seed)
    positive_indices = [
        index
        for index, (_, mask) in enumerate(train_dataset.cached_pairs)
        if mask.getbbox() is not None
    ]
    training_indices = list(range(len(train_dataset))) + positive_indices * (
        positive_sample_repeat - 1
    )
    train_loader = torch.utils.data.DataLoader(
        train_dataset,
        batch_size=batch_size,
        sampler=torch.utils.data.SubsetRandomSampler(
            training_indices,
            generator=generator,
        ),
        num_workers=_workers(),
        pin_memory=torch.cuda.is_available(),
    )
    evaluation_batch_size = max(batch_size, 8)
    validation_loader = (
        torch.utils.data.DataLoader(
            validation_dataset,
            batch_size=evaluation_batch_size,
            shuffle=False,
            num_workers=_workers(),
            pin_memory=torch.cuda.is_available(),
        )
        if validation_dataset is not None
        else None
    )
    test_loader = (
        torch.utils.data.DataLoader(
            test_dataset,
            batch_size=evaluation_batch_size,
            shuffle=False,
            num_workers=_workers(),
            pin_memory=torch.cuda.is_available(),
        )
        if test_dataset is not None
        else None
    )
    device = _device(torch)
    model = _build_segmentation_model(
        torch,
        torchvision,
        pretrained=pretrained,
        architecture=segmentation_architecture,
    ).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=learning_rate,
        weight_decay=0.01,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    best_state: dict[str, Any] | None = None
    best_score = -1.0
    best_selection_key = (
        False,
        float("-inf"),
        float("-inf"),
        float("-inf"),
    )
    best_threshold = 0.5
    best_presence_threshold: float | None = None
    best_epoch = 0
    selected_training_epochs = epochs
    history: list[dict[str, float | int]] = []
    if refit_source is not None:
        source_history = refit_source["history"]
        assert isinstance(source_history, list)
        scored_history: list[tuple[tuple[bool, float, float, float], Mapping[str, object]]] = []
        for entry in source_history:
            if not isinstance(entry, Mapping):
                continue
            metrics = {
                "dice": float(entry["validation_dice"]),
                "boundary_f1": float(entry["validation_boundary_f1"]),
                "positive_dice": float(entry["validation_positive_dice"]),
                "positive_boundary_f1": float(entry["validation_positive_boundary_f1"]),
            }
            scored_history.append((_segmentation_gate_selection_key(metrics), entry))
        if not scored_history:
            raise ValueError("The refit source has no usable validation checkpoints.")
        best_selection_key, selected_entry = max(scored_history, key=lambda item: item[0])
        best_score = _segmentation_selection_score(
            {
                "dice": float(selected_entry["validation_dice"]),
                "boundary_f1": float(selected_entry["validation_boundary_f1"]),
                "positive_dice": float(selected_entry["validation_positive_dice"]),
                "positive_boundary_f1": float(selected_entry["validation_positive_boundary_f1"]),
            }
        )
        best_epoch = int(selected_entry["epoch"])
        selected_training_epochs = best_epoch
        best_threshold = float(selected_entry["threshold"])
        selected_presence = selected_entry.get("presence_threshold")
        best_presence_threshold = (
            float(selected_presence) if selected_presence is not None else None
        )
    for epoch in range(1, selected_training_epochs + 1):
        model.train()
        loss_total = 0.0
        sample_count = 0
        for images, targets in train_loader:
            images = images.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with _autocast(torch, device):
                if hasattr(model, "forward_components"):
                    logits, presence_logits = model.forward_components(images)
                    positive = targets.sum(dim=(1, 2, 3)) > 0
                    presence_targets = positive.float().unsqueeze(1)
                    if segmentation_loss_version == "tolerant_boundary_presence_v3":
                        presence_binary = torch.nn.functional.binary_cross_entropy_with_logits(
                            presence_logits,
                            presence_targets,
                            pos_weight=torch.tensor(
                                presence_positive_weight,
                                device=device,
                            ),
                            reduction="none",
                        )
                        presence_probabilities = torch.sigmoid(presence_logits)
                        presence_correct_probability = presence_targets * presence_probabilities + (
                            1.0 - presence_targets
                        ) * (1.0 - presence_probabilities)
                        presence_focal = (
                            (1.0 - presence_correct_probability).pow(2.0) * presence_binary
                        ).mean()
                        presence_loss = 0.50 * presence_binary.mean() + 0.50 * presence_focal
                    else:
                        presence_loss = torch.nn.functional.binary_cross_entropy_with_logits(
                            presence_logits,
                            presence_targets,
                            pos_weight=torch.tensor(1.35, device=device),
                        )
                    if bool(positive.any()):
                        positive_logits = logits[positive]
                        positive_targets = targets[positive]
                        positive_pixel_weight = (
                            2.25
                            if segmentation_loss_version
                            in {
                                "tolerant_boundary_v2",
                                "tolerant_boundary_presence_v3",
                            }
                            else 3.0
                        )
                        binary = torch.nn.functional.binary_cross_entropy_with_logits(
                            positive_logits,
                            positive_targets,
                            pos_weight=torch.tensor(positive_pixel_weight, device=device),
                        )
                        if segmentation_loss_version in {
                            "tolerant_boundary_v2",
                            "tolerant_boundary_presence_v3",
                        }:
                            segmentation_loss = (
                                0.18 * binary
                                + 0.42
                                * _focal_tversky_loss(
                                    torch,
                                    positive_logits,
                                    positive_targets,
                                    false_positive_weight=0.55,
                                    false_negative_weight=0.45,
                                )
                                + 0.40
                                * _tolerant_boundary_loss(
                                    torch,
                                    positive_logits,
                                    positive_targets,
                                )
                            )
                        else:
                            segmentation_loss = (
                                0.20 * binary
                                + 0.52
                                * _focal_tversky_loss(
                                    torch,
                                    positive_logits,
                                    positive_targets,
                                )
                                + 0.28
                                * _boundary_loss(
                                    torch,
                                    positive_logits,
                                    positive_targets,
                                )
                            )
                    else:
                        segmentation_loss = presence_loss * 0.0
                    negative = ~positive
                    if bool(negative.any()):
                        negative_mask_loss = torch.nn.functional.binary_cross_entropy_with_logits(
                            logits[negative],
                            targets[negative],
                        )
                    else:
                        negative_mask_loss = presence_loss * 0.0
                    if segmentation_loss_version == "tolerant_boundary_presence_v3":
                        loss = (
                            0.60 * segmentation_loss
                            + 0.28 * presence_loss
                            + 0.12 * negative_mask_loss
                        )
                    else:
                        loss = (
                            0.72 * segmentation_loss
                            + 0.18 * presence_loss
                            + 0.10 * negative_mask_loss
                        )
                else:
                    logits = model(images)
                    binary = torch.nn.functional.binary_cross_entropy_with_logits(
                        logits,
                        targets,
                        pos_weight=torch.tensor(4.0, device=device),
                    )
                    loss = (
                        0.35 * binary
                        + 0.50 * _dice_loss(torch, logits, targets)
                        + 0.15 * _boundary_loss(torch, logits, targets)
                    )
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            count = int(images.shape[0])
            loss_total += float(loss.item()) * count
            sample_count += count
        scheduler.step()
        if refit_source is not None:
            history.append(
                {
                    "epoch": epoch,
                    "train_loss": loss_total / max(sample_count, 1),
                }
            )
            print(
                f"segmentation refit epoch {epoch}/{selected_training_epochs}: "
                f"train loss={loss_total / max(sample_count, 1):.4f}",
                flush=True,
            )
            best_state = {
                key: value.detach().cpu().clone() for key, value in model.state_dict().items()
            }
            continue
        assert validation_loader is not None
        (
            validation_probabilities,
            validation_presence,
            validation_targets,
        ) = _load_presence_gated_predictions(torch, model, validation_loader, device)
        presence_threshold: float | None = None
        if validation_presence is not None:
            presence_threshold, threshold = _choose_presence_and_mask_thresholds(
                torch,
                validation_probabilities,
                validation_presence,
                validation_targets,
            )
            gated_probabilities = torch.where(
                (validation_presence >= presence_threshold)[:, :, None, None],
                validation_probabilities,
                torch.zeros_like(validation_probabilities),
            )
        else:
            threshold = _choose_segmentation_threshold(
                torch,
                validation_probabilities,
                validation_targets,
            )
            gated_probabilities = validation_probabilities
        metrics = _segmentation_metrics(
            torch,
            gated_probabilities,
            validation_targets,
            threshold=threshold,
        )
        score = _segmentation_selection_score(metrics)
        selection_key = _segmentation_gate_selection_key(metrics)
        history.append(
            {
                "epoch": epoch,
                "train_loss": loss_total / max(sample_count, 1),
                "validation_dice": float(metrics["dice"]),
                "validation_positive_dice": float(metrics["positive_dice"]),
                "validation_boundary_f1": float(metrics["boundary_f1"]),
                "validation_positive_boundary_f1": float(metrics["positive_boundary_f1"]),
                "threshold": threshold,
                **(
                    {"presence_threshold": presence_threshold}
                    if presence_threshold is not None
                    else {}
                ),
            }
        )
        print(
            f"segmentation epoch {epoch}/{epochs}: "
            f"validation Dice={float(metrics['dice']):.4f}, "
            f"positive Dice={float(metrics['positive_dice']):.4f}, "
            f"boundary F1={float(metrics['boundary_f1']):.4f}, "
            f"positive boundary F1={float(metrics['positive_boundary_f1']):.4f}"
            + (
                f", presence threshold={presence_threshold:.2f}"
                if presence_threshold is not None
                else ""
            ),
            flush=True,
        )
        if selection_key > best_selection_key:
            best_selection_key = selection_key
            best_score = score
            best_epoch = epoch
            best_threshold = threshold
            best_presence_threshold = presence_threshold
            best_state = {
                key: value.detach().cpu().clone() for key, value in model.state_dict().items()
            }
    if best_state is None:
        raise RuntimeError("Segmentation training did not produce a checkpoint.")
    model.load_state_dict(best_state)
    model.to(device)
    if best_presence_threshold is not None:
        model.presence_threshold = best_presence_threshold
    test_metrics: dict[str, float | int] | None = None
    if test_loader is not None:
        test_probabilities, test_presence, test_targets = _load_presence_gated_predictions(
            torch, model, test_loader, device
        )
        if test_presence is not None:
            assert best_presence_threshold is not None
            test_probabilities = torch.where(
                (test_presence >= best_presence_threshold)[:, :, None, None],
                test_probabilities,
                torch.zeros_like(test_probabilities),
            )
        test_metrics = _segmentation_metrics(
            torch,
            test_probabilities,
            test_targets,
            threshold=best_threshold,
        )
        test_metrics["segmentation_threshold"] = best_threshold
        test_metrics["boundary_tolerance_ratio"] = BOUNDARY_TOLERANCE_RATIO
        if best_presence_threshold is not None:
            test_metrics["presence_threshold"] = best_presence_threshold
    weights_path = output / "model.pt"
    torch.save(best_state, weights_path)
    onnx_path = output / "segmentation.onnx"
    export_model = _build_segmentation_model(
        torch,
        torchvision,
        pretrained=False,
        architecture=segmentation_architecture,
    )
    export_model.load_state_dict(best_state)
    if best_presence_threshold is not None:
        export_model.presence_threshold = best_presence_threshold
    export_model.eval()
    _export_onnx(torch, export_model, onnx_path, image_size=image_size)
    return {
        "task": "segmentation",
        "artifact": onnx_path.name,
        "artifact_sha256": _sha256(onnx_path),
        "weights_sha256": _sha256(weights_path),
        "configuration": {
            "architecture": segmentation_architecture,
            "pretrained_imagenet": pretrained,
            "image_size": image_size,
            "batch_size": batch_size,
            "evaluation_batch_size": evaluation_batch_size,
            "epochs": epochs,
            "learning_rate": learning_rate,
            "seed": seed,
            "segmentation_loss_version": segmentation_loss_version,
            "normalization_mean": list(IMAGE_NET_MEAN),
            "normalization_std": list(IMAGE_NET_STD),
            "cache_preprocessed_images": True,
            "metric_device": device.type,
            "presence_positive_weight": presence_positive_weight,
            "positive_sample_repeat": positive_sample_repeat,
            "effective_training_sample_count": len(training_indices),
            "selected_training_epochs": selected_training_epochs,
            "selected_validation_epoch": best_epoch,
            "training_splits": (["train", "validation"] if refit_source is not None else ["train"]),
            "supplemental_segmentation": (
                {
                    "manifest_sha256": supplemental_manifest_sha256,
                    "sample_count": len(supplemental_rows),
                    "patient_count": len(
                        {(row["source_dataset"], row["patient_id"]) for row in supplemental_rows}
                    ),
                    "source_datasets": sorted({row["source_dataset"] for row in supplemental_rows}),
                    "license_terms": sorted({row["license_terms"] for row in supplemental_rows}),
                    "training_only": True,
                }
                if supplemental_rows
                else None
            ),
            "validation_selection": (
                {
                    "source_run_sha256": refit_source_hash,
                    "selected_segmentation_threshold": best_threshold,
                    "selected_presence_threshold": best_presence_threshold,
                }
                if refit_source is not None
                else {"source": "current_run_validation_split"}
            ),
        },
        "validation_best_score": best_score,
        **({"test": test_metrics} if test_metrics is not None else {}),
        "history": history,
        "interface": {
            "input_name": "image",
            "output_name": "logits",
            "output_kind": "binary_mask_logits",
            "segmentation_threshold": best_threshold,
        },
    }


def _evaluate_frozen_segmentation(
    rows: Sequence[Mapping[str, str]],
    *,
    data_root: Path,
    output: Path,
    image_size: int,
    batch_size: int,
    epochs: int,
    learning_rate: float,
    seed: int,
    pretrained: bool,
    segmentation_architecture: str,
    segmentation_loss_version: str,
    frozen_source_run: Path,
    supplemental_rows: Sequence[Mapping[str, str]] = (),
    supplemental_manifest_sha256: str | None = None,
    positive_sample_repeat: int = 1,
) -> dict[str, object]:
    """Evaluate the exact validation-selected checkpoint without retraining it."""

    try:
        source = json.loads(frozen_source_run.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read frozen segmentation source: {exc}") from exc
    if (
        not isinstance(source, Mapping)
        or source.get("task") != "segmentation"
        or source.get("validation_only") is not True
        or source.get("release_evaluation") is not False
    ):
        raise ValueError("The frozen source must be a completed validation-only segmentation run.")
    source_configuration = source.get("configuration")
    source_history = source.get("history")
    source_interface = source.get("interface")
    if (
        not isinstance(source_configuration, Mapping)
        or not isinstance(source_history, list)
        or not isinstance(source_interface, Mapping)
    ):
        raise ValueError(
            "The frozen segmentation source is missing configuration, history, or interface."
        )
    expected_configuration = {
        "architecture": segmentation_architecture,
        "image_size": image_size,
        "batch_size": batch_size,
        "epochs": epochs,
        "learning_rate": learning_rate,
        "seed": seed,
        "pretrained_imagenet": pretrained,
        "segmentation_loss_version": segmentation_loss_version,
        "positive_sample_repeat": positive_sample_repeat,
    }
    mismatches = [
        key
        for key, expected in expected_configuration.items()
        if source_configuration.get(key) != expected
    ]
    source_supplemental = source_configuration.get("supplemental_segmentation")
    if supplemental_rows:
        if (
            not isinstance(source_supplemental, Mapping)
            or source_supplemental.get("manifest_sha256") != supplemental_manifest_sha256
            or source_supplemental.get("sample_count") != len(supplemental_rows)
        ):
            mismatches.append("supplemental_segmentation")
    elif source_supplemental is not None:
        mismatches.append("supplemental_segmentation")
    if mismatches:
        raise ValueError(
            "Frozen evaluation arguments must match the selected validation run: "
            + ", ".join(mismatches)
        )

    scored_history: list[tuple[tuple[bool, float, float, float], Mapping[str, object]]] = []
    for entry in source_history:
        if not isinstance(entry, Mapping):
            continue
        metrics = {
            "dice": float(entry["validation_dice"]),
            "boundary_f1": float(entry["validation_boundary_f1"]),
            "positive_dice": float(entry["validation_positive_dice"]),
            "positive_boundary_f1": float(entry["validation_positive_boundary_f1"]),
        }
        scored_history.append((_segmentation_gate_selection_key(metrics), entry))
    if not scored_history:
        raise ValueError("The frozen source has no usable validation checkpoints.")
    _, selected_entry = max(scored_history, key=lambda item: item[0])
    selected_epoch = int(selected_entry["epoch"])
    if source_configuration.get("selected_validation_epoch") != selected_epoch:
        raise ValueError(
            "The frozen source artifact is not the current gate-selected validation epoch."
        )
    selected_threshold = float(selected_entry["threshold"])
    selected_presence = selected_entry.get("presence_threshold")
    selected_presence_threshold = (
        float(selected_presence) if selected_presence is not None else None
    )
    if not math.isclose(
        float(source_interface.get("segmentation_threshold", -1)),
        selected_threshold,
        abs_tol=1e-12,
    ):
        raise ValueError("The frozen source interface threshold does not match its checkpoint.")

    source_artifact_name = source.get("artifact")
    if not isinstance(source_artifact_name, str) or Path(source_artifact_name).name != (
        source_artifact_name
    ):
        raise ValueError("The frozen source artifact name is invalid.")
    source_directory = frozen_source_run.parent
    source_artifact = source_directory / source_artifact_name
    source_weights = source_directory / "model.pt"
    if not source_artifact.is_file() or not source_weights.is_file():
        raise ValueError("The frozen source artifact or weights are missing.")
    if _sha256(source_artifact) != source.get("artifact_sha256"):
        raise ValueError("The frozen source ONNX hash does not match run.json.")
    if _sha256(source_weights) != source.get("weights_sha256"):
        raise ValueError("The frozen source weights hash does not match run.json.")

    torch, _, torchvision, Image = _dependencies()
    _seed_everything(torch, seed)

    class TestDataset(torch.utils.data.Dataset):
        def __init__(self) -> None:
            self.cached_pairs: list[tuple[Any, Any]] = []
            for row in rows:
                if row["split"] != "test":
                    continue
                with (
                    Image.open(resolve_data_path(data_root, row["image_path"])) as image,
                    Image.open(resolve_data_path(data_root, row["mask_path"])) as mask,
                ):
                    resized_image = image.convert("RGB").resize(
                        (image_size, image_size),
                        resample=Image.Resampling.BILINEAR,
                    )
                    resized_mask = mask.convert("L").resize(
                        (image_size, image_size),
                        resample=Image.Resampling.NEAREST,
                    )
                    self.cached_pairs.append((resized_image.copy(), resized_mask.copy()))

        def __len__(self) -> int:
            return len(self.cached_pairs)

        def __getitem__(self, index: int) -> tuple[Any, Any]:
            image, mask = self.cached_pairs[index]
            return _segmentation_pair_transform(
                torch,
                torchvision,
                Image,
                image.copy(),
                mask.copy(),
                image_size=image_size,
                train=False,
            )

    test_dataset = TestDataset()
    if not test_dataset:
        raise ValueError("The frozen evaluation test split is empty.")
    evaluation_batch_size = max(batch_size, 8)
    test_loader = torch.utils.data.DataLoader(
        test_dataset,
        batch_size=evaluation_batch_size,
        shuffle=False,
        num_workers=_workers(),
        pin_memory=torch.cuda.is_available(),
    )
    device = _device(torch)
    model = _build_segmentation_model(
        torch,
        torchvision,
        pretrained=False,
        architecture=segmentation_architecture,
    )
    try:
        state = torch.load(source_weights, map_location="cpu", weights_only=True)
    except TypeError:
        state = torch.load(source_weights, map_location="cpu")
    model.load_state_dict(state)
    model.to(device)
    if selected_presence_threshold is not None:
        model.presence_threshold = selected_presence_threshold
    test_probabilities, test_presence, test_targets = _load_presence_gated_predictions(
        torch,
        model,
        test_loader,
        device,
    )
    if test_presence is not None:
        assert selected_presence_threshold is not None
        test_probabilities = torch.where(
            (test_presence >= selected_presence_threshold)[:, :, None, None],
            test_probabilities,
            torch.zeros_like(test_probabilities),
        )
    test_metrics = _segmentation_metrics(
        torch,
        test_probabilities,
        test_targets,
        threshold=selected_threshold,
        largest_component_only=True,
    )
    test_metrics["segmentation_threshold"] = selected_threshold
    test_metrics["boundary_tolerance_ratio"] = BOUNDARY_TOLERANCE_RATIO
    if selected_presence_threshold is not None:
        test_metrics["presence_threshold"] = selected_presence_threshold

    artifact_path = output / source_artifact_name
    weights_path = output / "model.pt"
    shutil.copy2(source_artifact, artifact_path)
    shutil.copy2(source_weights, weights_path)
    configuration = dict(source_configuration)
    configuration["evaluation_mode"] = "exact_frozen_validation_checkpoint"
    configuration["evaluation_postprocessing"] = "largest_connected_component"
    configuration["frozen_source_run_sha256"] = _sha256(frozen_source_run)
    return {
        "task": "segmentation",
        "artifact": artifact_path.name,
        "artifact_sha256": _sha256(artifact_path),
        "weights_sha256": _sha256(weights_path),
        "configuration": configuration,
        "validation_best_score": source["validation_best_score"],
        "test": test_metrics,
        "history": source_history,
        "interface": dict(source_interface),
    }


def _export_onnx(torch: Any, model: Any, output_path: Path, *, image_size: int) -> None:
    dummy = torch.zeros(1, 3, image_size, image_size, dtype=torch.float32)
    try:
        torch.onnx.export(
            model,
            dummy,
            output_path,
            input_names=["image"],
            output_names=["logits"],
            dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
            opset_version=17,
            do_constant_folding=True,
            dynamo=False,
        )
    except TypeError:
        # PyTorch 2.7 did not expose the explicit dynamo flag.
        torch.onnx.export(
            model,
            dummy,
            output_path,
            input_names=["image"],
            output_names=["logits"],
            dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
            opset_version=17,
            do_constant_folding=True,
        )


def _write_evidence(
    output: Path,
    result: Mapping[str, object],
    *,
    manifest: Path,
    data_root: Path,
) -> dict[str, object]:
    test = result["test"]
    assert isinstance(test, Mapping)
    task = str(result["task"])
    with manifest.open("r", encoding="utf-8", newline="") as handle:
        manifest_rows = list(csv.DictReader(handle))
    source_datasets = sorted(
        {row["source_dataset"] for row in manifest_rows if row.get("source_dataset")}
    )
    license_terms = sorted(
        {row["license_terms"] for row in manifest_rows if row.get("license_terms")}
    )
    if not license_terms and source_datasets == [SMART_OM_DATASET_ID]:
        license_terms = [SMART_OM_LICENSE]
    evidence: dict[str, object] = {
        "schema_version": "1.0",
        "evaluation_id": f"smart-om-{task}-locked-test-2026",
        "task": task,
        "artifact_sha256": result["artifact_sha256"],
        "dataset_manifest_sha256": _manifest_sha256(manifest),
        "code_revision": _source_revision(),
        "evaluated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "patient_disjoint": True,
        "source_dataset": (
            source_datasets[0] if len(source_datasets) == 1 else "multiple audited sources"
        ),
        "source_license": (license_terms[0] if len(license_terms) == 1 else "See license_terms."),
        "source_datasets": source_datasets,
        "license_terms": license_terms,
        "data_root_persisted": False,
        "disclaimer": "This result is not a diagnosis and does not establish clinical validity.",
        "configuration": result["configuration"],
        "interface": result["interface"],
        "test": dict(test),
    }
    split_patients: dict[str, set[str]] = {
        "train": set(),
        "validation": set(),
        "test": set(),
    }
    for row in manifest_rows:
        split = row["split"]
        if split in split_patients:
            split_patients[split].add(row["patient_id"])
    evidence["split_patient_counts"] = {
        split: len(patients) for split, patients in split_patients.items()
    }
    evidence["patient_overlap_count"] = sum(
        len(split_patients[first] & split_patients[second])
        for first, second in (
            ("train", "validation"),
            ("train", "test"),
            ("validation", "test"),
        )
    )
    if task in {"appearance", "disease"}:
        labels = APPEARANCE_CLASSES if task == "appearance" else DISEASE_CLASSES
        label_field = "appearance_label" if task == "appearance" else "disease_label"
        test_patients_by_class: dict[str, set[str]] = {label: set() for label in labels}
        for row in manifest_rows:
            if row["split"] != "test":
                continue
            label = row[label_field]
            if label in test_patients_by_class:
                test_patients_by_class[label].add(row["patient_id"])

    if task == "appearance":
        evidence["appearance_release_gate"] = {
            "patient_disjoint": evidence["patient_overlap_count"] == 0,
            "provenance_complete": bool(source_datasets and license_terms),
            "clinical_review_signed": False,
            "held_out_patients_per_class": {
                label: len(test_patients_by_class[label]) for label in APPEARANCE_CLASSES
            },
            "macro_f1": test["macro_f1"],
            "per_class_recall": test["per_class_recall"],
            "expected_calibration_error": test["expected_calibration_error"],
            "enabled": False,
            "limitations": [
                "The seven-class output remains closed until every fixed release gate passes.",
                "A released appearance output is descriptive and is not a diagnosis.",
            ],
        }

    if task == "disease":
        evidence["disease_release_gate"] = {
            "patient_disjoint": evidence["patient_overlap_count"] == 0,
            "independent_held_out": True,
            "independent_held_out_scope": (
                "Locked patient-disjoint test split from the same published SMART-OM dataset."
            ),
            "provenance_complete": True,
            "clinical_review_signed": False,
            "held_out_patients_per_class": {
                label: len(test_patients_by_class[label]) for label in DISEASE_CLASSES
            },
            "macro_f1": test["macro_f1"],
            "per_class_sensitivity": test["per_class_recall"],
            "per_class_specificity": test["per_class_specificity"],
            "expected_calibration_error": test["expected_calibration_error"],
            "enabled": False,
            "limitations": [
                "The oral-cancer test class contains far fewer than 100 held-out patients.",
                "No signed clinical review is present.",
                "This same-dataset held-out evaluation does not establish clinical validity.",
            ],
        }
    # The absolute controlled-data path is intentionally never written.
    del data_root
    evidence_path = output / "locked-test-evaluation.json"
    evidence_path.write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return evidence


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", choices=SUPPORTED_TASKS, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--learning-rate", type=float, default=0.0003)
    parser.add_argument(
        "--segmentation-architecture",
        choices=(
            "mobilenet_v3_small_unet",
            "deeplabv3_resnet50",
            "unetplusplus_efficientnet_b3",
            "presence_gated_unetplusplus_efficientnet_b3",
            "presence_gated_unetplusplus_efficientnet_b4",
        ),
        default="presence_gated_unetplusplus_efficientnet_b3",
    )
    parser.add_argument(
        "--segmentation-loss-version",
        choices=(
            "candidate_boundary_v1",
            "tolerant_boundary_v2",
            "tolerant_boundary_presence_v3",
            "validation_model_soup_v1",
        ),
        default="candidate_boundary_v1",
    )
    parser.add_argument(
        "--segmentation-positive-repeat",
        type=int,
        choices=(1, 2, 3, 4),
        default=1,
        help=(
            "Repeat licensed positive-mask training rows without copying files. "
            "Validation and test rows are never repeated."
        ),
    )
    parser.add_argument(
        "--validation-only",
        action="store_true",
        help=(
            "For segmentation experiments, select on train/validation and do not load or "
            "evaluate the locked test split."
        ),
    )
    parser.add_argument(
        "--supplemental-segmentation-manifest",
        type=Path,
        help="Audited training-only segmentation rows without canonical region labels.",
    )
    parser.add_argument(
        "--supplemental-segmentation-data-root",
        type=Path,
        help="Controlled local root for the supplemental segmentation manifest.",
    )
    parser.add_argument(
        "--refit-source-run",
        type=Path,
        help=(
            "For segmentation only, refit on train plus validation using the exact "
            "configuration and validation-selected thresholds from this prior run.json."
        ),
    )
    parser.add_argument(
        "--evaluate-frozen-run",
        type=Path,
        help=(
            "For segmentation only, evaluate the exact gate-selected model.pt and "
            "ONNX artifact from a completed validation-only run without retraining."
        ),
    )
    parser.add_argument("--no-pretrained", action="store_true")
    parser.add_argument("--acknowledge-audited-data", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if not args.acknowledge_audited_data:
        print(
            "Training refused: --acknowledge-audited-data is required.",
            file=sys.stderr,
        )
        return 2
    if not args.data_root.is_dir():
        print("Training refused: data root does not exist.", file=sys.stderr)
        return 2
    if args.epochs < 1 or args.batch_size < 1 or args.image_size < 64:
        print("Training refused: invalid epochs, batch size, or image size.", file=sys.stderr)
        return 2
    if args.task != "segmentation" and args.segmentation_positive_repeat != 1:
        print(
            "Training refused: positive-mask repetition is only valid for segmentation.",
            file=sys.stderr,
        )
        return 2
    if not math.isfinite(args.learning_rate) or args.learning_rate <= 0:
        print("Training refused: learning rate must be positive and finite.", file=sys.stderr)
        return 2
    if args.refit_source_run is not None and args.task != "segmentation":
        print(
            "Training refused: --refit-source-run is only valid for segmentation.",
            file=sys.stderr,
        )
        return 2
    if args.evaluate_frozen_run is not None and args.task != "segmentation":
        print(
            "Training refused: --evaluate-frozen-run is only valid for segmentation.",
            file=sys.stderr,
        )
        return 2
    if args.validation_only and args.task != "segmentation":
        print(
            "Training refused: --validation-only is only valid for segmentation.",
            file=sys.stderr,
        )
        return 2
    if args.validation_only and args.refit_source_run is not None:
        print(
            "Training refused: validation-only selection and refit cannot run together.",
            file=sys.stderr,
        )
        return 2
    if args.validation_only and args.evaluate_frozen_run is not None:
        print(
            "Training refused: validation-only selection and frozen evaluation "
            "cannot run together.",
            file=sys.stderr,
        )
        return 2
    if args.refit_source_run is not None and args.evaluate_frozen_run is not None:
        print(
            "Training refused: refit and exact frozen evaluation cannot run together.",
            file=sys.stderr,
        )
        return 2
    if (
        args.segmentation_loss_version == "validation_model_soup_v1"
        and args.evaluate_frozen_run is None
    ):
        print(
            "Training refused: validation_model_soup_v1 can only be used to "
            "evaluate an exported validation model soup.",
            file=sys.stderr,
        )
        return 2
    supplemental_arguments = (
        args.supplemental_segmentation_manifest,
        args.supplemental_segmentation_data_root,
    )
    if any(value is not None for value in supplemental_arguments) and not all(
        value is not None for value in supplemental_arguments
    ):
        print(
            "Training refused: both supplemental segmentation arguments are required.",
            file=sys.stderr,
        )
        return 2
    if args.supplemental_segmentation_manifest is not None and args.task != "segmentation":
        print(
            "Training refused: supplemental segmentation data is only valid for segmentation.",
            file=sys.stderr,
        )
        return 2
    if (
        args.supplemental_segmentation_data_root is not None
        and not args.supplemental_segmentation_data_root.is_dir()
    ):
        print(
            "Training refused: supplemental segmentation data root does not exist.",
            file=sys.stderr,
        )
        return 2
    rows, load_issues = load_manifest(args.manifest)
    if load_issues:
        for issue in load_issues:
            print(f"Training refused [{issue.code}]: {issue.message}", file=sys.stderr)
        return 2
    report = validate_manifest(
        rows,
        require_audited=True,
        require_files=True,
        data_root=args.data_root,
        task=args.task,
    )
    if not report.valid:
        for issue in report.issues:
            print(f"Training refused [{issue.code}]: {issue.message}", file=sys.stderr)
        return 2
    if any(
        report.split_patient_counts.get(split, 0) == 0 for split in ("train", "validation", "test")
    ):
        print(
            "Training refused: train, validation, and test patients are required.", file=sys.stderr
        )
        return 2
    supplemental_rows: list[dict[str, str]] = []
    supplemental_manifest_sha256: str | None = None
    if args.supplemental_segmentation_manifest is not None:
        assert args.supplemental_segmentation_data_root is not None
        try:
            supplemental_rows = _load_supplemental_segmentation_manifest(
                args.supplemental_segmentation_manifest,
                data_root=args.supplemental_segmentation_data_root,
            )
            supplemental_manifest_sha256 = _sha256(args.supplemental_segmentation_manifest)
        except ValueError as exc:
            print(f"Training refused: {exc}", file=sys.stderr)
            return 2
    try:
        output = _safe_output_directory(args.output_dir)
        common = {
            "rows": rows,
            "data_root": args.data_root,
            "output": output,
            "image_size": args.image_size,
            "batch_size": args.batch_size,
            "epochs": args.epochs,
            "learning_rate": args.learning_rate,
            "seed": args.seed,
            "pretrained": not args.no_pretrained,
        }
        if args.task in {"anatomy", "appearance", "disease"}:
            if args.task == "anatomy":
                label_field = "anatomy_label"
                labels = MOUTH_REGIONS
            elif args.task == "appearance":
                label_field = "appearance_label"
                labels = APPEARANCE_CLASSES
            else:
                label_field = "disease_label"
                labels = DISEASE_CLASSES
            result = _train_classification(
                **common,
                task=args.task,
                label_field=label_field,
                labels=labels,
            )
        else:
            if args.evaluate_frozen_run is not None:
                result = _evaluate_frozen_segmentation(
                    **common,
                    segmentation_architecture=args.segmentation_architecture,
                    segmentation_loss_version=args.segmentation_loss_version,
                    frozen_source_run=args.evaluate_frozen_run,
                    supplemental_rows=supplemental_rows,
                    supplemental_manifest_sha256=supplemental_manifest_sha256,
                    positive_sample_repeat=args.segmentation_positive_repeat,
                )
            else:
                result = _train_segmentation(
                    **common,
                    segmentation_architecture=args.segmentation_architecture,
                    segmentation_loss_version=args.segmentation_loss_version,
                    evaluate_test=not args.validation_only,
                    supplemental_rows=supplemental_rows,
                    supplemental_data_root=args.supplemental_segmentation_data_root,
                    supplemental_manifest_sha256=supplemental_manifest_sha256,
                    refit_source_run=args.refit_source_run,
                    positive_sample_repeat=args.segmentation_positive_repeat,
                )
        if args.validation_only:
            evidence = {
                "task": "segmentation",
                "validation_only": True,
                "locked_test_evaluated": False,
                "validation_best_score": result["validation_best_score"],
                "artifact_sha256": result["artifact_sha256"],
            }
            run = {
                **result,
                "release_evaluation": False,
                "locked_test_evaluation": None,
                "validation_only": True,
                "disclaimer": "This result is not a diagnosis.",
            }
        else:
            evidence = _write_evidence(
                output,
                result,
                manifest=args.manifest,
                data_root=args.data_root,
            )
            run = {
                **result,
                "release_evaluation": True,
                "locked_test_evaluation": "locked-test-evaluation.json",
                "disclaimer": "This result is not a diagnosis.",
            }
        (output / "run.json").write_text(
            json.dumps(run, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"Training failed safely: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(evidence, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
