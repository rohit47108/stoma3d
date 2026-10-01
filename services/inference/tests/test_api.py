from __future__ import annotations

import base64
import asyncio
import hashlib
import importlib
import io
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
)
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from starlette.requests import Request

from stoma3d_api import processing as processing_module
from stoma3d_api import signing as signing_module
from stoma3d_api.contracts import ModelHead, ReleaseGate
from stoma3d_api.fixtures import CANONICAL_DEMO_SHA256
from stoma3d_api.main import (
    MAX_COMPARE_REQUEST_BYTES,
    MAX_METADATA_BYTES,
    VERCEL_REQUEST_BODY_LIMIT_BYTES,
    app,
)
from stoma3d_api.rate_limit import (
    EphemeralRequestRateLimiter,
    RateLimitConfiguration,
    load_rate_limit_configuration,
)
from stoma3d_api.processing import MAX_IMAGE_BYTES, sanitize_image
from stoma3d_api.runtime import (
    DEFAULT_MAX_CONCURRENT_INFERENCE,
    InferenceCapacityError,
    MAX_CONCURRENT_INFERENCE_ENV,
    BoundedInferenceExecutor,
    load_max_concurrent_inference,
)
from stoma3d_api.signing import (
    KEY_ID_ENV,
    PRIVATE_KEY_ENV,
    REQUIRE_SIGNING_ENV,
    ResponseSigner,
)

client = TestClient(app, raise_server_exceptions=False)


def _synthetic_capture(*, include_candidate: bool = True) -> bytes:
    image = Image.new("RGB", (320, 320), (174, 102, 112))
    draw = ImageDraw.Draw(image)
    # Small asymmetric landmarks provide real ORB features but are too small
    # to qualify as the candidate connected component.
    for index in range(24):
        x = 18 + ((index * 47) % 282)
        y = 18 + ((index * 83) % 282)
        color = (145 + index % 7, 78, 91)
        draw.rectangle((x - 3, y - 3, x + 3, y + 3), outline=color, width=2)
        draw.line((x - 5, y, x + 5, y), fill=color, width=1)
        draw.line((x, y - 5, x, y + 5), fill=color, width=1)
    if include_candidate:
        draw.ellipse(
            (185, 122, 257, 194), fill=(226, 48, 60), outline=(116, 48, 64), width=3
        )
        draw.ellipse((205, 144, 218, 158), fill=(196, 70, 75))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _uniform_capture() -> bytes:
    image = Image.new("RGB", (320, 320), (170, 105, 115))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _analyze_metadata(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "contractVersion": "1.1.0",
        "captureId": "capture-1",
        "selectedRegion": "left_buccal_mucosa",
        "inputOrigin": "live_capture",
        "requestedHeads": ["segmentation", "anatomy"],
    }
    value.update(overrides)
    return value


def _compare_metadata(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "contractVersion": "1.1.0",
        "baselineCaptureId": "capture-earlier",
        "currentCaptureId": "capture-current",
        "region": "left_buccal_mucosa",
        "userConfirmedMatch": False,
        "inputOrigin": "live_capture",
        "baselineAnalysis": {
            "captureId": "capture-earlier",
            "region": "left_buccal_mucosa",
            "status": "abstained",
            "analysisOrigin": "unavailable",
            "qualityAccepted": True,
            "candidateNormalizedArea": None,
            "modelVersions": {"segmentation": "disabled-release-gate"},
        },
        "currentAnalysis": {
            "captureId": "capture-current",
            "region": "left_buccal_mucosa",
            "status": "abstained",
            "analysisOrigin": "unavailable",
            "qualityAccepted": True,
            "candidateNormalizedArea": None,
            "modelVersions": {"segmentation": "disabled-release-gate"},
        },
    }
    value.update(overrides)
    return value


def _post_analyze(
    image_bytes: bytes, metadata: dict[str, object], content_type: str = "image/png"
):
    return client.post(
        "/v1/analyze",
        files={"image": ("capture.png", image_bytes, content_type)},
        data={"metadata": json.dumps(metadata)},
    )


def _post_compare(image_bytes: bytes, metadata: dict[str, object]):
    return client.post(
        "/v1/compare",
        files={
            "baseline_image": ("baseline.png", image_bytes, "image/png"),
            "current_image": ("current.png", image_bytes, "image/png"),
        },
        data={"metadata": json.dumps(metadata)},
    )


def _canonical_fixture_bytes() -> bytes:
    fixture_path = (
        Path(__file__).resolve().parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "bundled-demo.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    raw = base64.b64decode(fixture["base64"], validate=True)
    assert hashlib.sha256(raw).hexdigest() == CANONICAL_DEMO_SHA256 == fixture["sha256"]
    return raw


def test_only_four_public_routes_are_exposed() -> None:
    assert {route.path for route in app.routes} == {
        "/healthz",
        "/v1/model-card",
        "/v1/analyze",
        "/v1/compare",
    }


def test_ephemeral_rate_limit_is_bounded_and_expires() -> None:
    limiter = EphemeralRequestRateLimiter(
        RateLimitConfiguration(
            per_client_requests=2,
            global_requests=3,
            window_seconds=10,
        ),
        salt=b"test-salt",
    )
    assert limiter.check("198.51.100.1", now=100) is None
    assert limiter.check("198.51.100.1", now=101) is None
    assert limiter.check("198.51.100.1", now=102) == 8
    assert limiter.check("198.51.100.2", now=102) is None
    assert limiter.check("198.51.100.3", now=102) == 8
    assert limiter.check("198.51.100.1", now=111) is None


def test_rate_limit_configuration_is_strict() -> None:
    production = load_rate_limit_configuration(production=True, environment={})
    assert production.per_client_requests == 30
    assert production.global_requests == 300
    assert production.window_seconds == 60
    with pytest.raises(RuntimeError):
        load_rate_limit_configuration(
            production=True,
            environment={"STOMA3D_RATE_LIMIT_PER_CLIENT": "0"},
        )


def test_analysis_rate_limit_rejects_before_multipart_parsing(monkeypatch) -> None:
    from stoma3d_api import main as main_module

    monkeypatch.setattr(
        main_module,
        "REQUEST_RATE_LIMITER",
        EphemeralRequestRateLimiter(
            RateLimitConfiguration(
                per_client_requests=1,
                global_requests=10,
                window_seconds=60,
            ),
            salt=b"integration-test-salt",
        ),
    )
    first = client.post("/v1/analyze", content=b"not multipart")
    second = client.post("/v1/analyze", content=b"not multipart")
    assert first.status_code == 422
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limit_exceeded"
    assert second.headers["retry-after"] == "60"
    assert second.headers["cache-control"] == "no-store"


def test_health_and_errors_have_privacy_headers_and_request_ids() -> None:
    client_request_id = "0f9f24c2-bac8-4b4d-a3f6-fce22630d96b"
    response = client.get("/healthz", headers={"X-Request-ID": client_request_id})
    assert response.status_code == 200
    health = response.json()
    assert health == {
        "status": "ok",
        "serverAlive": True,
        "serviceVersion": "0.1.0",
        "contractVersion": "1.1.0",
        "retainsData": False,
        "deploymentMode": "development",
        "analysisReady": False,
        "privacyReady": True,
        "productionReady": False,
        "responseSigningConfigured": False,
        "responseSigningRequired": False,
        "demoFixturesEnabled": False,
        "releaseManifestLoaded": False,
        "releaseId": None,
        "enabledHeads": [],
        "readinessReasons": [
            "release_manifest_not_configured",
            "required_analysis_heads_unavailable",
            "response_signing_not_configured",
            "deployment_mode_not_production",
        ],
    }
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-request-id"] == client_request_id

    missing = client.get("/does-not-exist", headers={"X-Request-ID": "bad value"})
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
    assert missing.json()["error"]["requestId"] == missing.headers["x-request-id"]
    assert missing.headers["x-request-id"] != "bad value"
    assert missing.headers["cache-control"] == "no-store"


def test_health_reports_unavailable_privacy_check(monkeypatch) -> None:
    from stoma3d_api import main

    monkeypatch.setattr(main, "privacy_check_ready", lambda: False)
    health = client.get("/healthz").json()
    assert health["privacyReady"] is False
    assert health["analysisReady"] is False
    assert health["productionReady"] is False
    assert "privacy_check_unavailable" in health["readinessReasons"]


def test_model_card_keeps_all_research_release_gates_closed() -> None:
    response = client.get("/v1/model-card")
    assert response.status_code == 200
    card = response.json()
    assert card["contractVersion"] == "1.1.0"
    assert card["disclaimer"] == "This result is not a diagnosis."
    assert {gate["head"] for gate in card["releaseGates"]} == {
        "segmentation",
        "anatomy",
        "appearance",
        "disease_research",
        "lesion_reidentification",
        "quality_control",
        "oral_tissue_segmentation",
        "out_of_distribution",
        "secondary_segmentation",
    }
    assert all(gate["passed"] is False for gate in card["releaseGates"])
    assert all(gate["reviewerApproved"] is False for gate in card["releaseGates"])
    assert card["enabledHeads"] == []
    assert card["comparisonRepeatabilityGatePassed"] is False
    assert card["comparisonRepeatedCaptureAreaError"] is None
    assert any(
        "normalized change remains hidden" in limitation.lower()
        and "10% or less" in limitation.lower()
        for limitation in card["limitations"]
    )
    assert (
        card["artifactHashes"]["processing_source"]
        == hashlib.sha256(Path(processing_module.__file__).read_bytes()).hexdigest()
    )
    assert (
        card["artifactHashes"]["response_signing_source"]
        == hashlib.sha256(Path(signing_module.__file__).read_bytes()).hexdigest()
    )
    assert len(card["artifactHashes"]["model_adapter_source"]) == 64
    assert len(card["artifactHashes"]["release_manifest_source"]) == 64
    assert card["artifactHashes"]["segmentation_weights"] is None
    assert card["artifactHashes"]["anatomy_weights"] is None
    assert card["artifactHashes"]["appearance_weights"] is None
    assert card["artifactHashes"]["disease_research_weights"] is None
    assert card["artifactHashes"]["lesion_reidentification_weights"] is None
    assert card["artifactHashes"]["quality_control_weights"] is None
    assert card["artifactHashes"]["oral_tissue_segmentation_weights"] is None
    assert card["artifactHashes"]["out_of_distribution_weights"] is None
    assert card["artifactHashes"]["secondary_segmentation_weights"] is None


def test_release_gate_datetime_matches_utc_z_contract() -> None:
    gate = ReleaseGate(
        head=ModelHead.SEGMENTATION,
        passed=False,
        evaluated_at=datetime(2026, 7, 21, 12, 0, tzinfo=timezone.utc),
        metrics={},
        unmet_requirements=["not evaluated"],
        reviewer_approved=False,
    )
    assert gate.model_dump(mode="json", by_alias=True)["evaluatedAt"] == (
        "2026-07-21T12:00:00Z"
    )
    with pytest.raises(ValueError, match="must use UTC"):
        ReleaseGate(
            head=ModelHead.SEGMENTATION,
            passed=False,
            evaluated_at=datetime(
                2026, 7, 21, 8, 0, tzinfo=timezone(timedelta(hours=-4))
            ),
            metrics={},
            unmet_requirements=["not evaluated"],
            reviewer_approved=False,
        )


def test_live_analysis_abstains_with_unreleased_segmentation_and_anatomy() -> None:
    raw = _synthetic_capture()
    metadata = _analyze_metadata(
        requestedHeads=["segmentation", "anatomy", "appearance", "disease_research"]
    )
    first = _post_analyze(raw, metadata)
    second = _post_analyze(raw, metadata)
    assert first.status_code == second.status_code == 200
    result = first.json()
    assert result == second.json()
    assert result["captureId"] == "capture-1"
    assert result["region"] == "left_buccal_mucosa"
    assert result["quality"]["accepted"] is True
    assert result["status"] == "abstained"
    assert result["analysisOrigin"] == "unavailable"
    assert result["candidateMask"] is None
    assert result["descriptors"] is None
    assert result["anatomyPrediction"] == {
        "region": None,
        "confidence": 0.0,
        "supported": False,
        "selectedRegionMatches": False,
    }
    assert "segmentation_release_gate_unmet" in result["abstentionReasons"]
    assert "anatomy_release_gate_unmet" in result["abstentionReasons"]
    assert result["appearanceOutput"]["enabled"] is False
    assert result["appearanceOutput"]["gatePassed"] is False
    assert result["appearanceOutput"]["topLabel"] is None
    assert result["diseaseResearchOutput"]["gatePassed"] is False
    assert result["disclaimer"] == "This result is not a diagnosis."
    assert first.headers["cache-control"] == "no-store"


def test_request_logging_omits_body_filename_and_capture_identifier(
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret_capture_id = "must-not-appear-in-request-logs"
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="stoma3d_api"):
        response = _post_analyze(
            _synthetic_capture(),
            _analyze_metadata(captureId=secret_capture_id),
        )
    assert response.status_code == 200
    rendered_logs = "\n".join(record.getMessage() for record in caplog.records)
    assert "request_complete method=POST path=/v1/analyze status=200" in rendered_logs
    assert secret_capture_id not in rendered_logs
    assert "capture.png" not in rendered_logs
    assert "fixtureSha256" not in rendered_logs

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="stoma3d_api"):
        request_id_response = client.get(
            "/healthz", headers={"X-Request-ID": secret_capture_id}
        )
    assert request_id_response.headers["x-request-id"] != secret_capture_id
    assert secret_capture_id not in "\n".join(
        record.getMessage() for record in caplog.records
    )


def test_runtime_exception_details_never_enter_logs(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    api_main = importlib.import_module("stoma3d_api.main")
    marker = "SENSITIVE_RUNTIME_MARKER"

    def fail_analysis(*_args, **_kwargs):
        raise RuntimeError(marker)

    def fail_comparison(*_args, **_kwargs):
        raise ValueError(marker)

    monkeypatch.setattr(api_main, "analyze_sanitized_image", fail_analysis)
    monkeypatch.setattr(api_main, "compare_sanitized_images", fail_comparison)
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="stoma3d_api"):
        analysis = _post_analyze(_synthetic_capture(), _analyze_metadata())
        comparison = _post_compare(
            _synthetic_capture(), _compare_metadata(userConfirmedMatch=True)
        )

    assert analysis.status_code == comparison.status_code == 200
    rendered = "\n".join(
        logging.Formatter().format(record) for record in caplog.records
    )
    assert "analysis_runtime_failed exception_type=RuntimeError" in rendered
    assert "comparison_runtime_failed exception_type=ValueError" in rendered
    assert marker not in rendered

    caplog.clear()
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/test-error",
            "headers": [],
            "query_string": b"",
            "scheme": "https",
            "server": ("inference.test", 443),
            "client": ("127.0.0.1", 1),
            "state": {},
        }
    )
    with caplog.at_level(logging.ERROR, logger="stoma3d_api"):
        response = asyncio.run(
            api_main.unhandled_error_handler(request, RuntimeError(marker))
        )
    assert response.status_code == 500
    rendered = "\n".join(
        logging.Formatter().format(record) for record in caplog.records
    )
    assert "unhandled_service_error exception_type=RuntimeError" in rendered
    assert marker not in rendered


def test_quality_rejection_abstains_before_candidate_analysis() -> None:
    response = _post_analyze(_uniform_capture(), _analyze_metadata())
    assert response.status_code == 200
    result = response.json()
    assert result["quality"]["accepted"] is False
    assert "image_too_blurry" in result["quality"]["reasons"]
    assert result["candidateMask"] is None
    assert result["descriptors"] is None
    assert result["status"] == "abstained"


@pytest.mark.parametrize(
    ("metadata", "expected_code"),
    [
        ({"contractVersion": "2.0.0"}, "invalid_metadata"),
        ({"contractVersion": "1.0.0"}, "invalid_metadata"),
    ],
)
def test_invalid_metadata_uses_safe_error_envelope(
    metadata: dict[str, object], expected_code: str
) -> None:
    response = _post_analyze(_synthetic_capture(), metadata)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == expected_code
    assert response.json()["error"]["requestId"] == response.headers["x-request-id"]


def test_upload_media_type_and_image_byte_limit_are_enforced() -> None:
    wrong_type = _post_analyze(
        _synthetic_capture(), _analyze_metadata(), "application/octet-stream"
    )
    assert wrong_type.status_code == 415
    assert wrong_type.json()["error"]["code"] == "unsupported_media_type"

    too_large = _post_analyze(b"0" * (MAX_IMAGE_BYTES + 1), _analyze_metadata())
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "image_too_large"


def test_compare_multipart_budget_stays_below_vercel_request_limit() -> None:
    metadata_json = json.dumps(_compare_metadata())
    metadata_json += " " * (MAX_METADATA_BYTES - len(metadata_json.encode("utf-8")))
    request = client.build_request(
        "POST",
        "/v1/compare",
        files={
            "baseline_image": (
                "baseline.jpg",
                b"0" * MAX_IMAGE_BYTES,
                "image/jpeg",
            ),
            "current_image": (
                "current.jpg",
                b"1" * MAX_IMAGE_BYTES,
                "image/jpeg",
            ),
        },
        data={"metadata": metadata_json},
    )
    encoded_body = request.read()

    assert len(encoded_body) <= MAX_COMPARE_REQUEST_BYTES
    assert MAX_COMPARE_REQUEST_BYTES < VERCEL_REQUEST_BODY_LIMIT_BYTES


def test_streamed_request_body_is_bounded_without_content_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_main = importlib.import_module("stoma3d_api.main")
    monkeypatch.setattr(api_main, "MAX_ANALYZE_REQUEST_BYTES", 1024)

    def chunks():
        yield b"x" * 700
        yield b"y" * 700

    response = client.post(
        "/v1/analyze",
        content=chunks(),
        headers={"Content-Type": "multipart/form-data; boundary=unused"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"
    assert response.headers["cache-control"] == "no-store"


def test_spooled_multipart_file_is_closed_after_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_main = importlib.import_module("stoma3d_api.main")
    observed_files: list[object] = []
    observed_rollover: list[bool] = []
    original_read_upload = api_main._read_upload

    async def observed_read_upload(upload):
        observed_files.append(upload.file)
        observed_rollover.append(bool(getattr(upload.file, "_rolled", False)))
        return await original_read_upload(upload)

    monkeypatch.setattr(api_main, "_read_upload", observed_read_upload)
    pixels = np.random.default_rng(42).integers(
        0, 256, size=(700, 700, 3), dtype=np.uint8
    )
    raw = io.BytesIO()
    Image.fromarray(pixels, mode="RGB").save(raw, format="PNG", compress_level=0)
    assert len(raw.getvalue()) > 1024 * 1024

    response = _post_analyze(raw.getvalue(), _analyze_metadata())
    assert response.status_code == 200
    assert observed_rollover == [True]
    assert len(observed_files) == 1
    assert bool(getattr(observed_files[0], "closed")) is True


def test_sanitization_strips_exif_and_normalizes_to_single_frame_jpeg() -> None:
    source = Image.new("RGB", (180, 140), (120, 80, 90))
    exif = Image.Exif()
    exif[270] = "sensitive source description"
    exif[274] = 6
    raw = io.BytesIO()
    source.save(raw, format="JPEG", exif=exif)

    sanitized = sanitize_image(raw.getvalue())
    with Image.open(io.BytesIO(sanitized.jpeg_bytes)) as result:
        assert result.format == "JPEG"
        assert len(result.getexif()) == 0
        assert result.mode == "RGB"
        assert result.size == (140, 180)


def test_manual_analysis_requires_exact_bytes_origin_region_and_declared_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_main = importlib.import_module("stoma3d_api.main")

    def fail_runtime(*_args, **_kwargs):
        raise RuntimeError("simulated model failure")

    monkeypatch.setattr(api_main, "analyze_sanitized_image", fail_runtime)
    fixture = _canonical_fixture_bytes()
    exact_metadata = _analyze_metadata(
        inputOrigin="bundled_demo",
        fixtureSha256=CANONICAL_DEMO_SHA256,
    )
    disabled = _post_analyze(fixture, exact_metadata)
    assert disabled.status_code == 403
    assert disabled.json()["error"]["code"] == "demo_fixtures_disabled"

    monkeypatch.setattr(api_main, "DEMO_FIXTURES_ENABLED", True)
    exact = _post_analyze(fixture, exact_metadata)
    assert exact.status_code == 200
    assert exact.json()["analysisOrigin"] == "manual_fixture"
    assert exact.json()["status"] == "complete"

    live = _post_analyze(fixture, _analyze_metadata(inputOrigin="live_capture"))
    assert live.status_code == 200
    assert live.json()["analysisOrigin"] == "unavailable"
    assert live.json()["status"] == "failed"

    arbitrary = _synthetic_capture()
    arbitrary_hash = hashlib.sha256(arbitrary).hexdigest()
    unknown_demo = _post_analyze(
        arbitrary,
        _analyze_metadata(inputOrigin="bundled_demo", fixtureSha256=arbitrary_hash),
    )
    assert unknown_demo.status_code == 422
    assert unknown_demo.json()["error"]["code"] == "unrecognized_bundled_demo"

    mismatch = _post_analyze(
        fixture,
        _analyze_metadata(inputOrigin="bundled_demo", fixtureSha256="0" * 64),
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "fixture_hash_mismatch"


def test_comparison_requires_confirmation_and_registration_gates() -> None:
    raw = _synthetic_capture()
    unconfirmed = _post_compare(raw, _compare_metadata(userConfirmedMatch=False))
    assert unconfirmed.status_code == 200
    suggestion = unconfirmed.json()
    assert suggestion["candidateMatchScore"] is None
    assert suggestion["comparable"] is False
    assert suggestion["normalizedChange"] is None
    assert "user_confirmation_required" in suggestion["suppressionReasons"]
    assert (
        "lesion_reidentification_release_gate_unmet" in suggestion["suppressionReasons"]
    )
    assert "segmentation_release_gate_unmet" in suggestion["suppressionReasons"]
    assert suggestion["repeatabilityGatePassed"] is False
    assert suggestion["repeatedCaptureAreaError"] is None
    assert suggestion["registrationAlignment"] is None
    assert "repeated_capture_area_error_gate_unmet" in suggestion["suppressionReasons"]

    confirmed = _post_compare(raw, _compare_metadata(userConfirmedMatch=True))
    assert confirmed.status_code == 200
    comparison = confirmed.json()
    assert comparison["inlierRatio"] >= 0.60
    assert comparison["reprojectionErrorRatio"] <= 0.03
    assert comparison["userConfirmedMatch"] is True
    assert comparison["comparable"] is False
    assert comparison["normalizedChange"] is None
    assert "user_confirmation_required" not in comparison["suppressionReasons"]
    assert comparison["repeatabilityGatePassed"] is False
    assert comparison["repeatedCaptureAreaError"] is None
    assert "repeated_capture_area_error_gate_unmet" in comparison["suppressionReasons"]


def test_comparison_validates_prior_analysis_reference_identity() -> None:
    raw = _synthetic_capture()
    mismatched = _compare_metadata()
    mismatched["baselineAnalysis"]["captureId"] = "someone-elses-capture"  # type: ignore[index]
    invalid = _post_compare(raw, mismatched)
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "invalid_metadata"

    metadata = _compare_metadata(userConfirmedMatch=True)
    for key, area in (("baselineAnalysis", 0.03), ("currentAnalysis", 0.04)):
        reference = metadata[key]
        assert isinstance(reference, dict)
        reference.update(
            status="complete",
            qualityAccepted=True,
            candidateNormalizedArea=area,
        )
    response = _post_compare(raw, metadata)
    assert response.status_code == 200
    result = response.json()
    assert result["normalizedChange"] is None
    assert result["comparable"] is False
    assert "segmentation_release_gate_unmet" in result["suppressionReasons"]
    assert (
        "registered_baseline_candidate_area_unavailable" in result["suppressionReasons"]
    )
    assert "current_candidate_area_unavailable" in result["suppressionReasons"]
    assert result["repeatabilityGatePassed"] is False
    assert result["repeatedCaptureAreaError"] is None
    assert "repeated_capture_area_error_gate_unmet" in result["suppressionReasons"]


def test_live_comparison_recomputes_areas_instead_of_trusting_prior_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = _synthetic_capture()
    metadata = _compare_metadata(userConfirmedMatch=True)
    metadata["baselineAnalysis"]["candidateNormalizedArea"] = 0.9  # type: ignore[index]
    metadata["currentAnalysis"]["candidateNormalizedArea"] = 0.1  # type: ignore[index]

    response = _post_compare(raw, metadata)
    assert response.status_code == 200
    result = response.json()
    assert result["comparable"] is False
    assert result["normalizedChange"] is None
    assert result["analysisOrigin"] == "unavailable"
    assert "segmentation_release_gate_unmet" in result["suppressionReasons"]
    assert (
        "lesion_reidentification_release_gate_unmet" not in result["suppressionReasons"]
    )


def test_manual_comparison_is_also_exact_hash_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_main = importlib.import_module("stoma3d_api.main")

    def fail_runtime(*_args, **_kwargs):
        raise RuntimeError("simulated registration failure")

    monkeypatch.setattr(api_main, "compare_sanitized_images", fail_runtime)
    fixture = _canonical_fixture_bytes()
    exact_metadata = _compare_metadata(
        inputOrigin="bundled_demo", userConfirmedMatch=True
    )
    for key in ("baselineAnalysis", "currentAnalysis"):
        reference = exact_metadata[key]
        assert isinstance(reference, dict)
        reference.update(
            status="complete",
            analysisOrigin="cached_model_result",
            qualityAccepted=True,
            candidateNormalizedArea=0.031,
            modelVersions={"fixture": "bundled-demo-left-cheek-v1"},
        )
    disabled = _post_compare(fixture, exact_metadata)
    assert disabled.status_code == 403
    assert disabled.json()["error"]["code"] == "demo_fixtures_disabled"

    monkeypatch.setattr(api_main, "DEMO_FIXTURES_ENABLED", True)
    exact = _post_compare(
        fixture,
        exact_metadata,
    )
    assert exact.status_code == 200
    assert exact.json()["analysisOrigin"] == "manual_fixture"
    assert exact.json()["comparable"] is False
    assert exact.json()["normalizedChange"] is None
    assert exact.json()["descriptorChanges"] is None
    assert exact.json()["repeatabilityGatePassed"] is False
    assert exact.json()["repeatedCaptureAreaError"] is None
    assert "fixture_comparison_not_eligible" in exact.json()["suppressionReasons"]
    assert (
        "repeated_capture_area_error_gate_unmet" in exact.json()["suppressionReasons"]
    )

    manual_metadata = json.loads(json.dumps(exact_metadata))
    for key in ("baselineAnalysis", "currentAnalysis"):
        manual_metadata[key]["analysisOrigin"] = "manual_fixture"
    manual = _post_compare(fixture, manual_metadata)
    assert manual.status_code == 200
    assert manual.json()["analysisOrigin"] == "manual_fixture"
    assert manual.json()["comparable"] is False

    blocked_metadata = json.loads(json.dumps(exact_metadata))
    blocked_metadata["currentAnalysis"]["status"] = "abstained"
    blocked = _post_compare(fixture, blocked_metadata)
    assert blocked.status_code == 200
    assert blocked.json()["comparable"] is False
    assert blocked.json()["normalizedChange"] is None
    assert blocked.json()["descriptorChanges"] is None
    assert "current_prior_analysis_not_complete" in blocked.json()["suppressionReasons"]

    arbitrary = _post_compare(
        _synthetic_capture(),
        _compare_metadata(inputOrigin="bundled_demo", userConfirmedMatch=True),
    )
    assert arbitrary.status_code == 422
    assert arbitrary.json()["error"]["code"] == "unrecognized_bundled_demo"


def test_signer_configuration_is_optional_but_required_mode_fails_closed() -> None:
    assert ResponseSigner.from_environment({}) is None
    with pytest.raises(RuntimeError, match="exactly true or false"):
        ResponseSigner.from_environment({REQUIRE_SIGNING_ENV: "TRUEE"})
    with pytest.raises(RuntimeError, match=PRIVATE_KEY_ENV):
        ResponseSigner.from_environment({REQUIRE_SIGNING_ENV: "true"})

    private_key_bytes = bytes(range(32))
    encoded = base64.b64encode(private_key_bytes).decode("ascii")
    signer = ResponseSigner.from_environment({PRIVATE_KEY_ENV: encoded})
    assert signer is not None
    assert len(signer.key_id) == 16
    assert signer.key_id == hashlib.sha256(signer.public_key_bytes).hexdigest()[:16]
    with pytest.raises(RuntimeError, match=KEY_ID_ENV):
        ResponseSigner.from_environment(
            {PRIVATE_KEY_ENV: encoded, KEY_ID_ENV: "0000000000000000"}
        )


def test_signed_json_response_verifies_exact_bytes_and_detects_tampering(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_main = importlib.import_module("stoma3d_api.main")
    # Build the signer through the same raw-key environment path used in production.
    private_key = Ed25519PrivateKey.generate()
    raw_private_key = private_key.private_bytes(
        Encoding.Raw, PrivateFormat.Raw, NoEncryption()
    )
    signer = ResponseSigner.from_environment(
        {PRIVATE_KEY_ENV: base64.b64encode(raw_private_key).decode("ascii")}
    )
    assert signer is not None
    monkeypatch.setattr(api_main, "RESPONSE_SIGNER", signer)

    request_id = "4ec31409-a9af-4a6e-bc35-3aa962079657"
    response = client.get("/healthz", headers={"X-Request-ID": request_id})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-stoma3d-key-id"] == signer.key_id
    signature = base64.b64decode(response.headers["x-stoma3d-signature"], validate=True)
    message = ResponseSigner.message(request_id, response.content)
    assert message == (
        b"stoma3d-response-v1\n" + request_id.encode("ascii") + b"\n" + response.content
    )
    public_key = Ed25519PublicKey.from_public_bytes(signer.public_key_bytes)
    public_key.verify(signature, message)

    with pytest.raises(InvalidSignature):
        public_key.verify(signature, message + b" ")
    with pytest.raises(InvalidSignature):
        public_key.verify(
            signature,
            ResponseSigner.message("different-request-id", response.content),
        )


def test_inference_concurrency_configuration_and_bound() -> None:
    assert load_max_concurrent_inference({}) == DEFAULT_MAX_CONCURRENT_INFERENCE
    assert load_max_concurrent_inference({MAX_CONCURRENT_INFERENCE_ENV: "3"}) == 3
    for invalid_value in ("0", "33", "not-an-integer"):
        with pytest.raises(RuntimeError, match=MAX_CONCURRENT_INFERENCE_ENV):
            load_max_concurrent_inference({MAX_CONCURRENT_INFERENCE_ENV: invalid_value})

    executor = BoundedInferenceExecutor(max_concurrency=2)
    lock = threading.Lock()
    active = 0
    peak = 0

    def cpu_work(value: int) -> int:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        try:
            time.sleep(0.025)
            return value * 2
        finally:
            with lock:
                active -= 1

    async def exercise() -> list[int]:
        return await asyncio.gather(
            *(executor.run(cpu_work, value) for value in range(8))
        )

    assert asyncio.run(exercise()) == [value * 2 for value in range(8)]
    assert peak == 2


def test_cancelled_inference_holds_its_slot_until_worker_exits() -> None:
    executor = BoundedInferenceExecutor(max_concurrency=1)
    first_started = threading.Event()
    release_first = threading.Event()
    second_started = threading.Event()

    def first_work() -> str:
        first_started.set()
        assert release_first.wait(timeout=2)
        return "first"

    def second_work() -> str:
        second_started.set()
        return "second"

    async def exercise() -> None:
        first = asyncio.create_task(executor.run(first_work))
        assert await asyncio.to_thread(first_started.wait, 1)
        first.cancel()
        await asyncio.sleep(0.02)
        second = asyncio.create_task(executor.run(second_work))
        await asyncio.sleep(0.02)
        assert not second_started.is_set()

        release_first.set()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert await second == "second"
        assert second_started.is_set()

    asyncio.run(exercise())


def test_inference_queue_rejects_when_capacity_stays_busy() -> None:
    executor = BoundedInferenceExecutor(max_concurrency=1, queue_timeout_seconds=0.01)
    started = threading.Event()
    release = threading.Event()

    def blocking_work() -> None:
        started.set()
        assert release.wait(timeout=2)

    async def exercise() -> None:
        first = asyncio.create_task(executor.run(blocking_work))
        assert await asyncio.to_thread(started.wait, 1)
        with pytest.raises(InferenceCapacityError):
            await executor.run(lambda: None)
        release.set()
        await first

    asyncio.run(exercise())
