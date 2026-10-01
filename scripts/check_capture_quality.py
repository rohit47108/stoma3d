"""Local, aggregate-only quality probe; never exports images or patient IDs."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

from stoma3d_api.processing import SanitizedImage, assess_quality, sanitize_image
from stoma3d_ml.manifest import resolve_data_path, validate_manifest


def quality_probe(manifest: Path, data_root: Path, per_region: int) -> dict:
    with manifest.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    report = validate_manifest(rows)
    if not report.valid:
        raise ValueError("The dataset manifest did not pass its audit.")
    counts: Counter = Counter()
    reasons: Counter = Counter()
    scores: list[float] = []
    blurred_scores: list[float] = []
    face_failures = 0
    for row in rows:
        if row["split"] != "validation" or counts[row["region"]] >= per_region:
            continue
        if row["audit_status"] != "approved" or row["license_status"] != "approved":
            continue
        path = resolve_data_path(data_root, row["image_path"])
        bgr = cv2.imread(str(path))
        if bgr is None:
            raise ValueError("A validation image could not be decoded.")
        height, width = bgr.shape[:2]
        scale = min(1.0, 512 / max(width, height))
        resized = cv2.resize(
            bgr,
            (round(width * scale), round(height * scale)),
            interpolation=cv2.INTER_AREA,
        )
        # Re-encoding matches the ordinary sanitized transport without keeping
        # any source metadata or writing another medical-image file.
        ok, encoded = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            raise ValueError("A validation image could not be normalized.")
        normalized = sanitize_image(encoded.tobytes())
        quality, _ = assess_quality(normalized)
        scores.append(quality.blur_score)
        reasons.update(quality.reasons)
        face_failures += int(quality.face_detected)
        blurred = cv2.GaussianBlur(normalized.bgr, (0, 0), 3)
        blurred_quality, _ = assess_quality(
            SanitizedImage(
                b"probe-only", cv2.cvtColor(blurred, cv2.COLOR_BGR2RGB), blurred
            )
        )
        blurred_scores.append(blurred_quality.blur_score)
        counts[row["region"]] += 1
    if len(counts) != 8 or not scores:
        raise ValueError("The probe must cover all eight regions.")
    candidates = [0.02, 0.03, 0.04, 0.054, 0.07, 0.09]
    return {
        "scope": "licensed validation images; no physical device claims",
        "perRegion": dict(counts),
        "imageCount": len(scores),
        "qualityRejectionReasons": dict(reasons),
        "faceFlags": face_failures,
        "blurScoreQuantiles": np.quantile(scores, [0, 0.05, 0.15, 0.5, 1]).tolist(),
        "thresholds": [
            {
                "cutoff": cutoff,
                "sourceRejected": sum(score < cutoff for score in scores),
                "severeBlurAccepted": sum(score >= cutoff for score in blurred_scores),
            }
            for cutoff in candidates
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--per-region", type=int, default=10)
    args = parser.parse_args()
    print(
        json.dumps(
            quality_probe(args.manifest, args.data_root, args.per_region), indent=2
        )
    )


if __name__ == "__main__":
    main()
