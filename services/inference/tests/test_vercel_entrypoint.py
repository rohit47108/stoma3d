import importlib.util
import json
import os
import subprocess
import sys
import tomllib
from pathlib import Path
from types import ModuleType

from fastapi.testclient import TestClient

from stoma3d_api.deployment import packaged_release_manifest


def load_vercel_entrypoint(service_root: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "stoma3d_vercel_entrypoint_under_test",
        service_root / "vercel_entrypoint.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the Vercel entrypoint module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_vercel_runtime_uses_uvicorn_without_websocket_extras() -> None:
    service_root = Path(__file__).resolve().parents[1]
    project = tomllib.loads(
        (service_root / "pyproject.toml").read_text(encoding="utf-8")
    )

    runtime_dependencies = project["project"]["dependencies"]

    assert "uvicorn==0.51.0" in runtime_dependencies
    assert not any(
        "uvicorn[" in dependency.lower() for dependency in runtime_dependencies
    )
    assert any(
        dependency.lower().startswith("uvicorn")
        for dependency in project["project"]["optional-dependencies"]["dev"]
    )


def test_deployment_helper_import_does_not_initialize_the_application() -> None:
    service_root = Path(__file__).resolve().parents[1]
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(service_root / "src")
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; import stoma3d_api.deployment; "
                "print('stoma3d_api.main' in sys.modules)"
            ),
        ],
        cwd=service_root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout.strip() == "False"


def test_vercel_function_configuration_targets_the_fastapi_entrypoint() -> None:
    service_root = Path(__file__).resolve().parents[1]
    project = tomllib.loads(
        (service_root / "pyproject.toml").read_text(encoding="utf-8")
    )
    config = json.loads((service_root / "vercel.json").read_text(encoding="utf-8"))

    assert project["tool"]["vercel"]["entrypoint"] == "vercel_entrypoint:app"
    assert config["framework"] == "fastapi"
    assert config["functions"] == {
        "vercel_entrypoint.py": {
            "includeFiles": "{private-release/**,release/**,src/stoma3d_api/assets/**}",
            "maxDuration": 60,
        }
    }


def test_vercel_upload_excludes_development_only_files() -> None:
    service_root = Path(__file__).resolve().parents[1]
    patterns = {
        line.strip()
        for line in (service_root / ".vercelignore")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip() and not line.startswith("#")
    }

    assert {".pytest_cache/", ".vercel/", "**/__pycache__/", "tests/"} <= patterns
    assert "private-release/" not in patterns
    assert "release/" not in patterns


def test_repository_upload_includes_shared_map_and_privacy_assets() -> None:
    repository = Path(__file__).resolve().parents[3]
    patterns = (repository / ".vercelignore").read_text(encoding="utf-8").splitlines()
    assert "assets/" not in patterns
    assert "/assets/" not in patterns
    assert (repository / "assets/mouth/manifest.json").is_file()


def test_vercel_entrypoint_accepts_public_api_prefix() -> None:
    service_root = Path(__file__).resolve().parents[1]
    client = TestClient(load_vercel_entrypoint(service_root).app)

    assert client.get("/api/healthz").status_code == 200
    assert client.get("/api/v1/model-card").status_code == 200


def test_vercel_entrypoint_applies_analyze_body_budget_after_mount() -> None:
    service_root = Path(__file__).resolve().parents[1]
    client = TestClient(load_vercel_entrypoint(service_root).app)
    response = client.post(
        "/api/v1/analyze",
        files={"image": ("capture.jpg", b"not-an-image" * 10_000, "image/jpeg")},
        data={
            "metadata": json.dumps(
                {
                    "contractVersion": "1.1.0",
                    "captureId": "mounted-request",
                    "selectedRegion": "dorsal_tongue",
                    "inputOrigin": "live_capture",
                    "requestedHeads": ["segmentation", "anatomy"],
                }
            )
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_image"


def test_vercel_entrypoint_prefers_private_release_bundle(tmp_path: Path) -> None:
    public_manifest = tmp_path / "release" / "release-manifest.json"
    private_manifest = tmp_path / "private-release" / "release-manifest.json"
    public_manifest.parent.mkdir()
    private_manifest.parent.mkdir()
    public_manifest.write_text("{}", encoding="utf-8")
    private_manifest.write_text("{}", encoding="utf-8")

    assert packaged_release_manifest(tmp_path) == private_manifest


def test_vercel_entrypoint_falls_back_to_public_release_manifest(
    tmp_path: Path,
) -> None:
    public_manifest = tmp_path / "release" / "release-manifest.json"
    public_manifest.parent.mkdir()
    public_manifest.write_text("{}", encoding="utf-8")

    assert packaged_release_manifest(tmp_path) == public_manifest


def test_vercel_entrypoint_finds_release_in_function_working_directory(
    tmp_path: Path,
    monkeypatch,
) -> None:
    service_root = tmp_path / "handler"
    working_root = tmp_path / "function"
    service_root.mkdir()
    manifest = working_root / "release" / "release-manifest.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text("{}", encoding="utf-8")
    monkeypatch.chdir(working_root)

    assert packaged_release_manifest(service_root) == manifest
