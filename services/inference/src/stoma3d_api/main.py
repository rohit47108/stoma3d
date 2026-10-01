"""FastAPI entry point for the stateless Stoma3D inference service."""

from __future__ import annotations

import hashlib
import logging
import uuid
from pathlib import Path
from typing import Annotated, TypeVar

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .contracts import (
    CONTRACT_VERSION,
    AnalysisResult,
    AnalyzeMetadata,
    ApiError,
    ApiErrorDetail,
    CompareMetadata,
    ComparisonResult,
    InputOrigin,
    ModelCard,
    ModelHead,
    ReleaseGate,
)
from .configuration import load_service_configuration
from .fixtures import (
    has_canonical_demo_image_pair,
    ineligible_demo_comparison,
    is_exact_demo_analysis,
    is_exact_demo_comparison,
    manual_demo_analysis,
    manual_demo_comparison,
)
from .processing import (
    MAX_IMAGE_BYTES,
    MODEL_VERSIONS,
    SUPPORTED_MEDIA_TYPES,
    YUNET_MODEL_SHA256,
    ImageInputError,
    analyze_sanitized_image,
    compare_sanitized_images,
    failed_analysis,
    failed_comparison,
    privacy_check_ready,
    sanitize_image,
)
from .release_manifest import RELEASE_RUNTIME
from .rate_limit import (
    EphemeralRequestRateLimiter,
    load_rate_limit_configuration,
)
from .runtime import INFERENCE_EXECUTOR, InferenceCapacityError
from .signing import ResponseSigner

SERVICE_VERSION = "0.1.0"
VERCEL_REQUEST_BODY_LIMIT_BYTES = 4_500_000
MAX_METADATA_BYTES = 32 * 1024
MAX_ANALYZE_REQUEST_BYTES = MAX_IMAGE_BYTES + 128 * 1024
MAX_COMPARE_REQUEST_BYTES = 2 * MAX_IMAGE_BYTES + 256 * 1024
MAX_OTHER_REQUEST_BYTES = 64 * 1024

if MAX_COMPARE_REQUEST_BYTES >= VERCEL_REQUEST_BODY_LIMIT_BYTES:
    raise RuntimeError(
        "The compare request budget must remain below Vercel's 4.5 MB body limit."
    )

logger = logging.getLogger("stoma3d_api")
SERVICE_CONFIGURATION = load_service_configuration()
DEMO_FIXTURES_ENABLED = SERVICE_CONFIGURATION.demo_fixtures_enabled
REQUEST_RATE_LIMITER = EphemeralRequestRateLimiter(
    load_rate_limit_configuration(production=SERVICE_CONFIGURATION.production)
)
RESPONSE_SIGNER = ResponseSigner.from_environment()
if SERVICE_CONFIGURATION.production and RESPONSE_SIGNER is None:
    raise RuntimeError("Production mode requires a configured response signing key.")


def _process_live_analysis(raw: bytes, metadata: AnalyzeMetadata) -> AnalysisResult:
    sanitized = sanitize_image(raw)
    return analyze_sanitized_image(sanitized, metadata, RELEASE_RUNTIME)


def _process_live_comparison(
    baseline_raw: bytes,
    current_raw: bytes,
    metadata: CompareMetadata,
) -> ComparisonResult:
    sanitized_baseline = sanitize_image(baseline_raw)
    sanitized_current = sanitize_image(current_raw)
    return compare_sanitized_images(
        sanitized_baseline,
        sanitized_current,
        metadata,
        RELEASE_RUNTIME,
    )


class ServiceError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class RequestBodyTooLarge(Exception):
    """Raised by the ASGI receive boundary before multipart parsing completes."""


MetadataModel = TypeVar("MetadataModel", AnalyzeMetadata, CompareMetadata)


def _request_id(request: Request) -> str:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) else str(uuid.uuid4())


def _safe_client_request_id(value: str) -> str | None:
    """Accept only canonical random UUIDs so logged IDs cannot carry user data."""

    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError):
        return None
    if parsed.version != 4 or str(parsed) != value:
        return None
    return value


def _request_body_limit(path: str) -> int:
    if path in {"/v1/analyze", "/api/v1/analyze"}:
        return MAX_ANALYZE_REQUEST_BYTES
    if path in {"/v1/compare", "/api/v1/compare"}:
        return MAX_COMPARE_REQUEST_BYTES
    return MAX_OTHER_REQUEST_BYTES


class RequestBodyLimitMiddleware:
    """Count streamed ASGI bytes, including requests without Content-Length."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = _request_body_limit(str(scope.get("path", "")))
        received = 0
        limit_exceeded = False
        downstream_messages: list[Message] = []

        async def limited_receive() -> Message:
            nonlocal limit_exceeded, received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    limit_exceeded = True
                    raise RequestBodyTooLarge
            return message

        async def capture_send(message: Message) -> None:
            downstream_messages.append(message)

        try:
            await self.app(scope, limited_receive, capture_send)
        except RequestBodyTooLarge:
            limit_exceeded = True

        if limit_exceeded:
            request = Request(scope)
            response = _error_response(
                request,
                413,
                "request_too_large",
                "The request body exceeds the service safety limit.",
            )
            await response(scope, receive, send)
            return

        for message in downstream_messages:
            await send(message)


def _error_response(
    request: Request, status_code: int, code: str, message: str
) -> JSONResponse:
    body = ApiError(
        error=ApiErrorDetail(
            code=code,
            message=message,
            request_id=_request_id(request),
        )
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(mode="json", by_alias=True),
    )


def _parse_metadata(raw: str, model: type[MetadataModel]) -> MetadataModel:
    if len(raw.encode("utf-8")) > MAX_METADATA_BYTES:
        raise ServiceError(
            413, "metadata_too_large", "Metadata exceeds the 32 KB limit."
        )
    try:
        return model.model_validate_json(raw)
    except ValidationError as exc:
        raise ServiceError(
            422,
            "invalid_metadata",
            "Metadata does not match the public API contract.",
        ) from exc


async def _read_upload(upload: UploadFile) -> bytes:
    media_type = (upload.content_type or "").lower().split(";", 1)[0].strip()
    if media_type not in SUPPORTED_MEDIA_TYPES:
        raise ServiceError(
            415,
            "unsupported_media_type",
            "Only JPEG, PNG, and WebP image uploads are supported.",
        )

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            raise ServiceError(
                413,
                "image_too_large",
                "Each image is limited to 1.75 MB.",
            )
        chunks.append(chunk)
    if total == 0:
        raise ServiceError(422, "empty_image", "The uploaded image is empty.")
    return b"".join(chunks)


def _model_card() -> ModelCard:
    source_directory = Path(__file__).resolve().parent
    artifact_hashes: dict[str, str | None] = {
        "processing_source": hashlib.sha256(
            (source_directory / "processing.py").read_bytes()
        ).hexdigest(),
        "response_signing_source": hashlib.sha256(
            (source_directory / "signing.py").read_bytes()
        ).hexdigest(),
        "model_adapter_source": hashlib.sha256(
            (source_directory / "model_adapters.py").read_bytes()
        ).hexdigest(),
        "release_manifest_source": hashlib.sha256(
            (source_directory / "release_manifest.py").read_bytes()
        ).hexdigest(),
        "face_privacy_model": YUNET_MODEL_SHA256,
        **dict(RELEASE_RUNTIME.artifact_hashes),
    }
    enabled_heads = set(RELEASE_RUNTIME.enabled_heads)
    release_gates = [
        ReleaseGate(
            head=head,
            passed=head in enabled_heads,
            evaluated_at=RELEASE_RUNTIME.heads[head].evaluated_at,
            metrics=dict(RELEASE_RUNTIME.heads[head].metrics),
            unmet_requirements=list(RELEASE_RUNTIME.heads[head].unmet_requirements),
            reviewer_approved=RELEASE_RUNTIME.heads[head].reviewer_approved,
        )
        for head in ModelHead
    ]
    model_versions = {
        **MODEL_VERSIONS,
        **dict(RELEASE_RUNTIME.model_versions),
    }
    limitations = [
        "Comparison depends on visible local features and may abstain when registration is weak.",
        "Areas and changes are approximate. Millimeter estimates appear only when the versioned physical marker and same-plane checks pass.",
        "Executing a released ONNX head does not establish clinical validity.",
    ]
    if ModelHead.SEGMENTATION not in enabled_heads:
        limitations.append(
            "Live candidate masks remain hidden until a verified segmentation adapter is released."
        )
    if ModelHead.ANATOMY not in enabled_heads:
        limitations.append(
            "Live anatomy support remains unavailable until a verified anatomy adapter is released."
        )
    if (
        ModelHead.APPEARANCE not in enabled_heads
        or ModelHead.DISEASE_RESEARCH not in enabled_heads
    ):
        limitations.append(
            "Unreleased appearance or disease-category research heads remain disabled."
        )
    if ModelHead.QUALITY_CONTROL not in enabled_heads:
        limitations.append(
            "No released learned quality-control head is available; deterministic capture checks remain active."
        )
    if ModelHead.ORAL_TISSUE_SEGMENTATION not in enabled_heads:
        limitations.append(
            "No separate released oral-tissue segmentation head is available."
        )
    if ModelHead.OUT_OF_DISTRIBUTION not in enabled_heads:
        limitations.append(
            "Dataset similarity remains unavailable until a validated out-of-distribution head is released."
        )
    if ModelHead.SECONDARY_SEGMENTATION not in enabled_heads:
        limitations.append(
            "Model agreement remains unavailable until an independently trained secondary segmentation head is released."
        )
    if RELEASE_RUNTIME.repeated_capture_area_error is None:
        limitations.append(
            "Live normalized change remains hidden until repeated-capture area error is documented at 10% or less."
        )
    if not RELEASE_RUNTIME.manifest_loaded:
        limitations.insert(
            0,
            "No validated model release manifest is loaded; learned analysis is unavailable.",
        )
    elif not RELEASE_RUNTIME.analysis_ready:
        limitations.insert(
            0,
            "A release manifest is loaded, but required verified runtime adapters are not ready.",
        )
    return ModelCard(
        service_version=SERVICE_VERSION,
        intended_use=(
            "A non-diagnostic research prototype for structured oral photography, "
            "candidate-region visualization, and user-confirmed longitudinal comparison."
        ),
        forbidden_claims=[
            "The system diagnoses cancer or any disease.",
            "The system proves that an observation is harmless.",
            "The system provides clinically accurate physical measurements.",
            "The prototype is HIPAA compliant or clinically validated.",
        ],
        model_versions=model_versions,
        artifact_hashes=artifact_hashes,
        enabled_heads=list(RELEASE_RUNTIME.enabled_heads),
        release_gates=release_gates,
        comparison_repeated_capture_area_error=(
            RELEASE_RUNTIME.repeated_capture_area_error
        ),
        comparison_repeatability_gate_passed=(
            RELEASE_RUNTIME.repeated_capture_area_error is not None
        ),
        limitations=limitations,
    )


async def _sign_json_response(response: Response, request_id: str) -> Response:
    """Buffer one JSON response so its exact transmitted bytes can be signed."""

    content_type = response.headers.get("content-type", "").lower()
    if RESPONSE_SIGNER is None or not content_type.startswith("application/json"):
        return response

    existing_body = getattr(response, "body", None)
    if isinstance(existing_body, bytes):
        body = existing_body
    else:
        chunks: list[bytes] = []
        async for chunk in response.body_iterator:
            chunks.append(chunk.encode("utf-8") if isinstance(chunk, str) else chunk)
        body = b"".join(chunks)

    # Rebuild with the original bytes and headers. Response does not transform
    # bytes content, so the verified body is exactly the body that was signed.
    signed_response = Response(
        content=body,
        status_code=response.status_code,
        headers=dict(response.headers),
        background=response.background,
    )
    signed_response.headers["X-Stoma3D-Key-Id"] = RESPONSE_SIGNER.key_id
    signed_response.headers["X-Stoma3D-Signature"] = RESPONSE_SIGNER.sign(
        request_id, body
    )
    return signed_response


app = FastAPI(
    title="Stoma3D Inference Service",
    version=SERVICE_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(RequestBodyLimitMiddleware)


@app.middleware("http")
async def privacy_and_request_id_middleware(request: Request, call_next):
    supplied_request_id = request.headers.get("x-request-id", "")
    request.state.request_id = _safe_client_request_id(supplied_request_id) or str(
        uuid.uuid4()
    )

    retry_after = None
    if request.method == "POST" and request.url.path in {
        "/v1/analyze",
        "/v1/compare",
    }:
        client_identifier = request.client.host if request.client else "unknown"
        retry_after = REQUEST_RATE_LIMITER.check(client_identifier)

    content_length = request.headers.get("content-length")
    if retry_after is not None:
        response = _error_response(
            request,
            429,
            "rate_limit_exceeded",
            "Too many analysis requests. Please retry shortly.",
        )
        response.headers["Retry-After"] = str(retry_after)
    elif content_length:
        try:
            parsed_content_length = int(content_length)
        except ValueError:
            response = _error_response(
                request,
                400,
                "invalid_content_length",
                "Content-Length must be an integer.",
            )
        else:
            if parsed_content_length < 0:
                response = _error_response(
                    request,
                    400,
                    "invalid_content_length",
                    "Content-Length cannot be negative.",
                )
            elif parsed_content_length > _request_body_limit(request.url.path):
                response = _error_response(
                    request,
                    413,
                    "request_too_large",
                    "The multipart request exceeds the service safety limit.",
                )
            else:
                response = await call_next(request)
    else:
        response = await call_next(request)

    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Request-ID"] = request.state.request_id
    response = await _sign_json_response(response, request.state.request_id)
    # Method, path, status, and request ID are the only request facts logged.
    # Bodies, query strings, filenames, headers, hashes, and results are omitted.
    logger.info(
        "request_complete method=%s path=%s status=%s request_id=%s",
        request.method,
        request.url.path,
        response.status_code,
        request.state.request_id,
    )
    return response


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
    return _error_response(request, exc.status_code, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    request: Request, _exc: RequestValidationError
) -> JSONResponse:
    return _error_response(
        request,
        422,
        "invalid_request",
        "The multipart request does not match the endpoint contract.",
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    code = "not_found" if exc.status_code == 404 else "http_error"
    message = (
        "Endpoint not found."
        if exc.status_code == 404
        else "The request could not be completed."
    )
    return _error_response(request, exc.status_code, code, message)


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "unhandled_service_error exception_type=%s request_id=%s",
        type(exc).__name__,
        _request_id(request),
    )
    return _error_response(
        request,
        500,
        "internal_error",
        "The service could not complete the request.",
    )


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    privacy_ready = privacy_check_ready()
    analysis_ready = RELEASE_RUNTIME.analysis_ready and privacy_ready
    signing_configured = RESPONSE_SIGNER is not None
    production_ready = (
        SERVICE_CONFIGURATION.production
        and analysis_ready
        and signing_configured
        and not DEMO_FIXTURES_ENABLED
    )
    readiness_reasons: list[str] = []
    if not RELEASE_RUNTIME.manifest_loaded:
        readiness_reasons.extend(RELEASE_RUNTIME.load_reasons)
    if not RELEASE_RUNTIME.analysis_ready:
        readiness_reasons.append("required_analysis_heads_unavailable")
    if not privacy_ready:
        readiness_reasons.append("privacy_check_unavailable")
    if not signing_configured:
        readiness_reasons.append("response_signing_not_configured")
    if DEMO_FIXTURES_ENABLED:
        readiness_reasons.append("demo_fixtures_enabled")
    if not SERVICE_CONFIGURATION.production:
        readiness_reasons.append("deployment_mode_not_production")
    return {
        "status": "ok",
        "serverAlive": True,
        "serviceVersion": SERVICE_VERSION,
        "contractVersion": CONTRACT_VERSION,
        "retainsData": False,
        "deploymentMode": SERVICE_CONFIGURATION.deployment_mode.value,
        "analysisReady": analysis_ready,
        "privacyReady": privacy_ready,
        "productionReady": production_ready,
        "responseSigningConfigured": signing_configured,
        "responseSigningRequired": SERVICE_CONFIGURATION.response_signing_required,
        "demoFixturesEnabled": DEMO_FIXTURES_ENABLED,
        "releaseManifestLoaded": RELEASE_RUNTIME.manifest_loaded,
        "releaseId": RELEASE_RUNTIME.release_id,
        "enabledHeads": [head.value for head in RELEASE_RUNTIME.enabled_heads],
        "readinessReasons": list(dict.fromkeys(readiness_reasons)),
    }


@app.get("/v1/model-card", response_model=ModelCard)
async def model_card() -> ModelCard:
    return _model_card()


@app.post("/v1/analyze", response_model=AnalysisResult)
async def analyze(
    image: Annotated[
        UploadFile, File(description="Sanitized or source mouth-region image")
    ],
    metadata: Annotated[str, Form(description="AnalyzeMetadata JSON")],
) -> AnalysisResult:
    raw = b""
    try:
        parsed_metadata = _parse_metadata(metadata, AnalyzeMetadata)
        if (
            parsed_metadata.input_origin is InputOrigin.BUNDLED_DEMO
            and not DEMO_FIXTURES_ENABLED
        ):
            raise ServiceError(
                403,
                "demo_fixtures_disabled",
                "Bundled demonstration analysis is disabled on this service.",
            )
        raw = await _read_upload(image)
        actual_sha256 = hashlib.sha256(raw).hexdigest()
        if parsed_metadata.fixture_sha256 is not None:
            if parsed_metadata.input_origin is not InputOrigin.BUNDLED_DEMO:
                raise ServiceError(
                    422,
                    "fixture_metadata_not_allowed",
                    "fixtureSha256 is valid only for a bundled_demo input.",
                )
            if parsed_metadata.fixture_sha256 != actual_sha256:
                raise ServiceError(
                    422,
                    "fixture_hash_mismatch",
                    "fixtureSha256 does not match the uploaded bytes.",
                )
        if is_exact_demo_analysis(parsed_metadata, actual_sha256):
            return manual_demo_analysis(parsed_metadata)
        if parsed_metadata.input_origin is InputOrigin.BUNDLED_DEMO:
            raise ServiceError(
                422,
                "unrecognized_bundled_demo",
                "Bundled demonstration bytes are not on the exact fixture allowlist.",
            )

        try:
            return await INFERENCE_EXECUTOR.run(
                _process_live_analysis, raw, parsed_metadata
            )
        except ImageInputError as exc:
            raise ServiceError(422, "invalid_image", str(exc)) from exc
        except InferenceCapacityError as exc:
            raise ServiceError(
                503,
                "analysis_capacity_busy",
                "Analysis capacity is busy. Please retry shortly.",
            ) from exc
        except Exception as exc:
            logger.warning(
                "analysis_runtime_failed exception_type=%s", type(exc).__name__
            )
            return failed_analysis(parsed_metadata)
    finally:
        await image.close()
        raw = b""


@app.post("/v1/compare", response_model=ComparisonResult)
async def compare(
    baseline_image: Annotated[
        UploadFile, File(description="Earlier sanitized capture")
    ],
    current_image: Annotated[UploadFile, File(description="Current sanitized capture")],
    metadata: Annotated[str, Form(description="CompareMetadata JSON")],
) -> ComparisonResult:
    baseline_raw = b""
    current_raw = b""
    try:
        parsed_metadata = _parse_metadata(metadata, CompareMetadata)
        if (
            parsed_metadata.input_origin is InputOrigin.BUNDLED_DEMO
            and not DEMO_FIXTURES_ENABLED
        ):
            raise ServiceError(
                403,
                "demo_fixtures_disabled",
                "Bundled demonstration comparison is disabled on this service.",
            )
        baseline_raw = await _read_upload(baseline_image)
        current_raw = await _read_upload(current_image)
        baseline_sha256 = hashlib.sha256(baseline_raw).hexdigest()
        current_sha256 = hashlib.sha256(current_raw).hexdigest()
        if is_exact_demo_comparison(parsed_metadata, baseline_sha256, current_sha256):
            return manual_demo_comparison(parsed_metadata)
        if has_canonical_demo_image_pair(
            parsed_metadata, baseline_sha256, current_sha256
        ):
            return ineligible_demo_comparison(parsed_metadata)
        if parsed_metadata.input_origin is InputOrigin.BUNDLED_DEMO:
            raise ServiceError(
                422,
                "unrecognized_bundled_demo",
                "Bundled comparison bytes are not on the exact fixture allowlist.",
            )

        try:
            return await INFERENCE_EXECUTOR.run(
                _process_live_comparison,
                baseline_raw,
                current_raw,
                parsed_metadata,
            )
        except ImageInputError as exc:
            raise ServiceError(422, "invalid_image", str(exc)) from exc
        except InferenceCapacityError as exc:
            raise ServiceError(
                503,
                "analysis_capacity_busy",
                "Analysis capacity is busy. Please retry shortly.",
            ) from exc
        except Exception as exc:
            logger.warning(
                "comparison_runtime_failed exception_type=%s", type(exc).__name__
            )
            return failed_comparison(parsed_metadata)
    finally:
        await baseline_image.close()
        await current_image.close()
        baseline_raw = b""
        current_raw = b""
