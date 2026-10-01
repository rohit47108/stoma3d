import cv2
import numpy as np
import pytest

from stoma3d_api import processing


def image_from_bgr(bgr: np.ndarray) -> processing.SanitizedImage:
    return processing.SanitizedImage(
        jpeg_bytes=b"test-only", bgr=bgr, rgb=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    )


def test_quality_is_measured_at_a_consistent_resolution(monkeypatch) -> None:
    monkeypatch.setattr(processing, "_detect_face", lambda _: False)
    rng = np.random.default_rng(15)
    bgr = rng.integers(60, 180, (512, 384, 3), dtype=np.uint8)
    larger = cv2.resize(bgr, (768, 1024), interpolation=cv2.INTER_NEAREST)
    first, _ = processing.assess_quality(image_from_bgr(bgr))
    second, _ = processing.assess_quality(image_from_bgr(larger))
    assert first.blur_score == pytest.approx(second.blur_score, abs=1e-12)
    assert first.exposure_score == second.exposure_score
    assert first.reasons == second.reasons


def test_unavailable_privacy_is_not_reported_as_detected_face(monkeypatch) -> None:
    monkeypatch.setattr(processing, "_detect_face", lambda _: None)
    rng = np.random.default_rng(15)
    quality, _ = processing.assess_quality(
        image_from_bgr(rng.integers(60, 180, (512, 384, 3), dtype=np.uint8))
    )
    assert not quality.accepted
    assert not quality.face_detected
    assert quality.reasons == ["face_check_unavailable"]
