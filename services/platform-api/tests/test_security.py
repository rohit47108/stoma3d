from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.rsa import generate_private_key

from stoma3d_platform.security import (
    TokenValidationError,
    TokenValidator,
    issue_local_test_token,
)


async def test_local_token_validates_required_claims(settings) -> None:
    token = issue_local_test_token(
        settings,
        subject="auth0|patient-7",
        roles=("patient", "ignored-future-role"),
    )
    claims = await TokenValidator(settings).validate(token)
    assert claims.subject == "auth0|patient-7"
    assert claims.roles == frozenset({"patient", "ignored-future-role"})


async def test_deeply_nested_token_is_a_validation_error(settings) -> None:
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=")
    depth = 10_000
    payload = b'{"nested":' + b"[" * depth + b"0" + b"]" * depth + b"}"
    signing_input = header + b"." + base64.urlsafe_b64encode(payload).rstrip(b"=")
    signature = hmac.new(
        settings.local_test_signing_secret.get_secret_value().encode(),
        signing_input,
        hashlib.sha256,
    ).digest()
    token = (
        signing_input + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")
    ).decode("ascii")
    with pytest.raises(TokenValidationError):
        await TokenValidator(settings).validate(token)


@pytest.mark.parametrize("changed", ["issuer", "audience", "expired"])
async def test_local_token_rejects_wrong_trust_boundary(settings, changed: str) -> None:
    kwargs = {"subject": "auth0|patient-7"}
    if changed == "issuer":
        kwargs["issuer"] = "https://attacker.invalid"
    elif changed == "audience":
        kwargs["audience"] = "some-other-api"
    else:
        kwargs["lifetime"] = timedelta(seconds=-1)
    token = issue_local_test_token(settings, **kwargs)
    with pytest.raises(TokenValidationError):
        await TokenValidator(settings).validate(token)


async def test_local_token_helper_is_disabled_for_oidc(settings) -> None:
    oidc_settings = settings.__class__(
        _env_file=None,
        environment=settings.environment,
        database_url=settings.database_url,
        auth_mode="oidc",
        oidc_issuer_url="https://identity.example/",
        oidc_jwks_url="https://identity.example/.well-known/jwks.json",
    )
    with pytest.raises(RuntimeError, match="disabled"):
        issue_local_test_token(oidc_settings, subject="auth0|patient-7")


async def test_remote_oidc_hook_uses_jwks_key_and_asymmetric_allowlist(
    settings,
) -> None:
    oidc_settings = settings.__class__(
        _env_file=None,
        environment=settings.environment,
        database_url=settings.database_url,
        auth_mode="oidc",
        oidc_issuer_url="https://identity.example/",
        oidc_jwks_url="https://identity.example/.well-known/jwks.json",
        oidc_algorithms=("RS256",),
        jwt_leeway_seconds=0,
    )
    private_key = generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": "auth0|remote-patient",
            "iss": oidc_settings.oidc_issuer_url,
            "aud": oidc_settings.oidc_audience,
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )

    class SigningKey:
        key = private_key.public_key()

    class JwksClient:
        def get_signing_key_from_jwt(self, _token: str):
            return SigningKey()

    validator = TokenValidator(oidc_settings)
    validator._jwks_client = JwksClient()
    claims = await validator.validate(token)
    assert claims.subject == "auth0|remote-patient"


async def test_remote_oidc_never_falls_back_to_an_unconfigured_roles_claim(
    settings,
) -> None:
    oidc_settings = settings.__class__(
        _env_file=None,
        environment=settings.environment,
        database_url=settings.database_url,
        auth_mode="oidc",
        oidc_issuer_url="https://identity.example/",
        oidc_jwks_url="https://identity.example/.well-known/jwks.json",
        oidc_algorithms=("RS256",),
        jwt_leeway_seconds=0,
    )
    private_key = generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": "auth0|generic-roles-only",
            "iss": oidc_settings.oidc_issuer_url,
            "aud": oidc_settings.oidc_audience,
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "roles": ["admin"],
        },
        private_key,
        algorithm="RS256",
        headers={"kid": "generic-roles-test"},
    )

    class SigningKey:
        key = private_key.public_key()

    class JwksClient:
        def get_signing_key_from_jwt(self, _token: str):
            return SigningKey()

    validator = TokenValidator(oidc_settings)
    validator._jwks_client = JwksClient()
    claims = await validator.validate(token)
    assert claims.roles == frozenset()


async def test_stale_privileged_roles_are_removed_from_an_otherwise_valid_token(
    settings,
) -> None:
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": "auth0|stale-admin-role",
            "iss": settings.local_test_issuer_url,
            "aud": settings.oidc_audience,
            "iat": now - timedelta(minutes=20),
            "exp": now + timedelta(minutes=20),
            settings.oidc_role_claim: ["patient", "admin", "clinician"],
        },
        settings.local_test_signing_secret.get_secret_value(),
        algorithm="HS256",
    )

    claims = await TokenValidator(settings).validate(token)
    assert claims.roles == frozenset({"patient"})
