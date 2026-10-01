"""Audit committed artifacts, fixture provenance, asset hashes, and region parity.

The script uses only the Python standard library so it can run before project dependency
installation. Locally it checks tracked and non-ignored untracked files; in CI that is
equivalent to the checked-out repository.
"""

from __future__ import annotations

import ast
import base64
import csv
import hashlib
import json
import re
import struct
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]

CANONICAL_REGION_COUNT = 8
EXPECTED_ASSET_VERSION = "procedural-v1"
EXPECTED_FIXTURE_ID = "bundled-demo-left-cheek-v1"
EXPECTED_FIXTURE_IMAGE_SHA256 = (
    "61b49da924681f2a8dc6aab6380d7f197483925677af3a4c0a9db63c55a10338"
)

# Exact, deliberately reviewed repository assets. Any content change requires a new
# checksum in the inventory and this allowlist; silently accepting drift is forbidden.
AUDITED_FILE_SHA256 = {
    ".impeccable/mocks/public-direction-a-editorial-lightbox.png": (
        "db7842485de8316ddb643f6ad84abd176c1d3a28d50da6a624f1b3a8342fc048"
    ),
    ".impeccable/mocks/public-direction-b-guided-scan.png": (
        "78e5ea2cc269a745a30a2394bf42ebd074f13a732d266dc31284c3d956042431"
    ),
    ".impeccable/mocks/public-direction-c-observation-archive.png": (
        "5267d20ba11091590d89186ad065b85fd703241cbdab89bd79a684f95aecb99b"
    ),
    "apps/web/src/app/icon.svg": (
        "73c118539f03fa5e54047ecd9f19408d781b1a847be89fe94d18709301d98d90"
    ),
    "apps/mobile/src/components/OralObservationMap.tsx": (
        "9b3e7bf1fe8f12dacd1309fce8a0a9f0e78a7f3c94ed2b3dc7ef6fb07d3568a1"
    ),
    "apps/mobile/assets/stoma3d-adaptive-foreground.png": (
        "0ef561cfc7d2fbcc18be62de2403a709559b4bd995885d7b964b31614e5f4ce3"
    ),
    "apps/mobile/assets/stoma3d-icon.png": (
        "279dc14ae6a284ee35758c4ce29d66c3a5b8b83ad686726a2c10688d21a83e91"
    ),
    "assets/mouth/manifest.json": (
        "32c214636eea04e729dafc9adaacd8b5429a066446b359d350c9e8185e875128"
    ),
    "assets/mouth/calibration/stoma3d-calibration-a4.pdf": (
        "2ceff689f42ae25ff3ae0070b41dfa75e4b59b38ca1c0e5352ed2580424432bc"
    ),
    "assets/mouth/calibration/stoma3d-calibration-letter.pdf": (
        "42cbc9717202ba6a81c599abc81d6b780023f3eae8980b4136a51fabc6d0e633"
    ),
    "assets/mouth/calibration/stoma3d-calibration-preview.png": (
        "8d23651efe5f9fac2636941384683d0144dfc3dc679179c485be18aac92f6ff1"
    ),
    "apps/web/public/calibration/stoma3d-calibration-a4.pdf": (
        "2ceff689f42ae25ff3ae0070b41dfa75e4b59b38ca1c0e5352ed2580424432bc"
    ),
    "apps/web/public/calibration/stoma3d-calibration-letter.pdf": (
        "42cbc9717202ba6a81c599abc81d6b780023f3eae8980b4136a51fabc6d0e633"
    ),
    "apps/web/public/calibration/stoma3d-calibration-preview.png": (
        "8d23651efe5f9fac2636941384683d0144dfc3dc679179c485be18aac92f6ff1"
    ),
    "packages/contracts/fixtures/bundled-demo.json": (
        "4021151554fd5de429467a4901fccd6d8ab0590ec7b32de609c5f68a34662ef3"
    ),
    "services/inference/release/anatomy.onnx": (
        "335cacfa5ceab8d32d6b903c65d482c246ac6ac2a7e7a831f6ede27d62a553a9"
    ),
    "services/inference/src/stoma3d_api/assets/face_detection_yunet_2023mar.onnx": (
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
    ),
}

AUDITED_TEXT_FILES = {
    "apps/web/src/app/icon.svg",
    "apps/mobile/src/components/OralObservationMap.tsx",
    "assets/mouth/manifest.json",
    "packages/contracts/fixtures/bundled-demo.json",
}

AUDITED_FILE_LICENSE = {
    ".impeccable/mocks/public-direction-a-editorial-lightbox.png": "CC0-1.0",
    ".impeccable/mocks/public-direction-b-guided-scan.png": "CC0-1.0",
    ".impeccable/mocks/public-direction-c-observation-archive.png": "CC0-1.0",
    "apps/web/src/app/icon.svg": "CC0-1.0",
    "apps/mobile/src/components/OralObservationMap.tsx": "CC0-1.0",
    "apps/mobile/assets/stoma3d-adaptive-foreground.png": ("OpenAI generated output"),
    "apps/mobile/assets/stoma3d-icon.png": "OpenAI generated output",
    "assets/mouth/manifest.json": "CC0-1.0",
    "assets/mouth/calibration/stoma3d-calibration-a4.pdf": "CC0-1.0",
    "assets/mouth/calibration/stoma3d-calibration-letter.pdf": "CC0-1.0",
    "assets/mouth/calibration/stoma3d-calibration-preview.png": "CC0-1.0",
    "apps/web/public/calibration/stoma3d-calibration-a4.pdf": "CC0-1.0",
    "apps/web/public/calibration/stoma3d-calibration-letter.pdf": "CC0-1.0",
    "apps/web/public/calibration/stoma3d-calibration-preview.png": "CC0-1.0",
    "packages/contracts/fixtures/bundled-demo.json": "CC0-1.0",
    "services/inference/release/anatomy.onnx": "CC BY 4.0",
    "services/inference/src/stoma3d_api/assets/face_detection_yunet_2023mar.onnx": (
        "MIT"
    ),
}

ALLOWED_EMBEDDED_IMAGE_JSON = {
    "packages/contracts/fixtures/bundled-demo.json",
}

FORBIDDEN_EXTENSIONS = {
    ".avi",
    ".bin",
    ".bmp",
    ".ckpt",
    ".db",
    ".dcm",
    ".dicom",
    ".feather",
    ".gif",
    ".glb",
    ".gltf",
    ".h5",
    ".hdf5",
    ".heic",
    ".heif",
    ".joblib",
    ".jpeg",
    ".jpg",
    ".mkv",
    ".mov",
    ".mp4",
    ".nii",
    ".npy",
    ".npz",
    ".onnx",
    ".osv",
    ".parquet",
    ".pdf",
    ".pickle",
    ".pkl",
    ".png",
    ".pt",
    ".pth",
    ".safetensors",
    ".sqlite",
    ".sqlite3",
    ".svg",
    ".tif",
    ".tiff",
    ".webp",
}

FORBIDDEN_DIRECTORY_NAMES = {
    "captures",
    "data",
    "datasets",
    "mlruns",
    "patient-data",
    "patient_data",
}


class Audit:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def require(self, condition: bool, message: str) -> None:
        if not condition:
            self.errors.append(message)


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def _sha256(path: Path, *, normalize_line_endings: bool = False) -> str:
    if normalize_line_endings:
        return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _repository_files() -> list[str]:
    process = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return sorted(
        value.decode("utf-8", errors="surrogateescape").replace("\\", "/")
        for value in process.stdout.split(b"\0")
        if value
    )


def _contains_embedded_image(value: Any, key: str = "") -> bool:
    if isinstance(value, dict):
        return any(
            _contains_embedded_image(child, str(child_key))
            for child_key, child in value.items()
        )
    if isinstance(value, list):
        return any(_contains_embedded_image(child, key) for child in value)
    if not isinstance(value, str):
        return False
    normalized_key = key.lower().replace("_", "")
    return (
        "base64" in normalized_key and len(value) > 256
    ) or value.lower().startswith("data:image/")


def audit_forbidden_artifacts(audit: Audit) -> None:
    for relative in _repository_files():
        path = Path(relative)
        absolute = ROOT / path
        if not absolute.is_file():
            continue
        lower_parts = {part.lower() for part in path.parts[:-1]}
        if lower_parts & FORBIDDEN_DIRECTORY_NAMES:
            audit.errors.append(
                f"Forbidden data/artifact directory contains: {relative}"
            )
        if (
            path.suffix.lower() in FORBIDDEN_EXTENSIONS
            and relative not in AUDITED_FILE_SHA256
        ):
            audit.errors.append(
                f"Forbidden binary/image/model/database artifact: {relative}"
            )
        if path.suffix.lower() == ".json":
            try:
                payload = json.loads(absolute.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                audit.errors.append(f"Invalid JSON while auditing {relative}: {exc}")
                continue
            if (
                _contains_embedded_image(payload)
                and relative not in ALLOWED_EMBEDDED_IMAGE_JSON
            ):
                audit.errors.append(
                    f"Embedded image/base64 JSON is not on the synthetic allowlist: {relative}"
                )


def audit_public_model_distribution(audit: Audit) -> None:
    """Keep deployment-only weights out of the public source package."""

    relative = "services/inference/release/release-manifest.json"
    try:
        manifest = json.loads(_read(relative))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        audit.errors.append(f"Public release manifest could not be read: {exc}")
        return
    segmentation = next(
        (
            head
            for head in manifest.get("heads", [])
            if head.get("head") == "segmentation"
        ),
        None,
    )
    audit.require(segmentation is not None, "Public manifest lacks segmentation state.")
    if segmentation is not None:
        audit.require(
            segmentation.get("enabled") is False,
            "Public manifest must not enable the private segmentation weight.",
        )
        audit.require(
            "artifactPath" not in segmentation and "artifactSha256" not in segmentation,
            "Public manifest must not reference the private segmentation artifact.",
        )
    audit.require(
        not (ROOT / "services/inference/release/segmentation.onnx").exists(),
        "Private segmentation weight must not be present in the public release folder.",
    )


def _typescript_regions(audit: Audit) -> tuple[str, ...]:
    source = _read("packages/contracts/src/index.ts")
    match = re.search(
        r"export\s+const\s+MOUTH_REGIONS\s*=\s*\[(.*?)\]\s*as\s+const",
        source,
        flags=re.DOTALL,
    )
    audit.require(match is not None, "Could not parse TypeScript MOUTH_REGIONS.")
    if match is None:
        return ()
    return tuple(re.findall(r'"([a-z][a-z0-9_]*)"', match.group(1)))


def _typescript_zod_enum(schema_name: str, audit: Audit) -> tuple[str, ...]:
    source = _read("packages/contracts/src/index.ts")
    match = re.search(
        rf"export\s+const\s+{re.escape(schema_name)}\s*=\s*z\.enum\(\[(.*?)\]\);",
        source,
        flags=re.DOTALL,
    )
    audit.require(match is not None, f"Could not parse TypeScript {schema_name}.")
    if match is None:
        return ()
    return tuple(re.findall(r'"([a-z][a-z0-9_-]*)"', match.group(1)))


def _python_constant_values(path: str, name: str, audit: Audit) -> tuple[str, ...]:
    tree = ast.parse(_read(path), filename=path)
    for node in tree.body:
        target: ast.expr | None = None
        if isinstance(node, ast.AnnAssign):
            target = node.target
        elif isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
        if isinstance(target, ast.Name) and target.id == name:
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, TypeError) as exc:
                audit.errors.append(f"Could not parse {path} {name}: {exc}")
                return ()
            return tuple(str(item) for item in value)
    audit.errors.append(f"{name} is missing from {path}.")
    return ()


def _service_enum_values(class_name: str, audit: Audit) -> tuple[str, ...]:
    path = "services/inference/src/stoma3d_api/contracts.py"
    tree = ast.parse(_read(path), filename=path)
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            values: list[str] = []
            for child in node.body:
                if (
                    isinstance(child, ast.Assign)
                    and len(child.targets) == 1
                    and isinstance(child.value, ast.Constant)
                    and isinstance(child.value.value, str)
                ):
                    values.append(child.value.value)
            return tuple(values)
    audit.errors.append(f"{class_name} enum is missing from {path}.")
    return ()


def audit_regions_and_assets(audit: Audit) -> None:
    manifest_path = ROOT / "assets/mouth/manifest.json"
    fixture_path = ROOT / "packages/contracts/fixtures/bundled-demo.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        audit.errors.append(f"Asset metadata could not be read: {exc}")
        return

    typescript = _typescript_regions(audit)
    ml_python = _python_constant_values(
        "ml/src/stoma3d_ml/constants.py", "MOUTH_REGIONS", audit
    )
    service_python = _service_enum_values("MouthRegion", audit)
    manifest_regions = tuple(
        str(item.get("regionId", "")) for item in manifest.get("targetRegions", [])
    )
    audit.require(
        len(typescript) == CANONICAL_REGION_COUNT
        and len(set(typescript)) == len(typescript),
        "Canonical TypeScript region list must contain eight unique values.",
    )
    audit.require(
        typescript == ml_python == service_python == manifest_regions,
        "Region order/value mismatch across TypeScript, ML Python, service Python, or asset manifest: "
        f"ts={typescript}, ml={ml_python}, service={service_python}, asset={manifest_regions}",
    )

    appearance_typescript = _typescript_zod_enum("appearanceClassSchema", audit)
    appearance_ml = _python_constant_values(
        "ml/src/stoma3d_ml/constants.py", "APPEARANCE_CLASSES", audit
    )
    appearance_service = _service_enum_values("AppearanceClass", audit)
    audit.require(
        appearance_typescript == appearance_ml == appearance_service,
        "Appearance taxonomy mismatch across TypeScript, ML Python, or service Python: "
        f"ts={appearance_typescript}, ml={appearance_ml}, service={appearance_service}",
    )

    disease_typescript = _typescript_zod_enum("diseaseResearchClassSchema", audit)
    disease_ml = _python_constant_values(
        "ml/src/stoma3d_ml/constants.py", "DISEASE_CLASSES", audit
    )
    disease_service = _service_enum_values("DiseaseResearchClass", audit)
    audit.require(
        disease_typescript == disease_ml == disease_service,
        "Disease taxonomy mismatch across TypeScript, ML Python, or service Python: "
        f"ts={disease_typescript}, ml={disease_ml}, service={disease_service}",
    )

    audit.require(
        manifest.get("assetVersion") == EXPECTED_ASSET_VERSION,
        f"Asset version must be {EXPECTED_ASSET_VERSION!r}.",
    )
    audit.require(
        manifest.get("license") == "CC0-1.0", "Asset license must be CC0-1.0."
    )
    audit.require(
        manifest.get("containsPatientData") is False,
        "Asset must declare no patient data.",
    )
    audit.require(
        manifest.get("implementationPath")
        == "apps/mobile/src/components/OralObservationMap.tsx",
        "Asset implementationPath is incorrect.",
    )
    renderer_path = ROOT / str(manifest.get("implementationPath", "missing"))
    if renderer_path.is_file():
        renderer_sha = _sha256(renderer_path)
        audit.require(
            manifest.get("implementationSha256") == renderer_sha,
            "Procedural renderer checksum does not match the asset manifest.",
        )
    else:
        audit.errors.append("Procedural renderer path does not exist.")
    mesh_ids = [
        str(item.get("meshId", "")) for item in manifest.get("targetRegions", [])
    ]
    audit.require(
        len(mesh_ids) == CANONICAL_REGION_COUNT and len(set(mesh_ids)) == len(mesh_ids),
        "Asset manifest must map eight unique mesh IDs.",
    )

    audit.require(
        fixture.get("id") == EXPECTED_FIXTURE_ID, "Bundled fixture ID changed."
    )
    audit.require(
        fixture.get("license") == "CC0-1.0", "Bundled fixture must be CC0-1.0."
    )
    provenance = str(fixture.get("provenance", "")).lower()
    audit.require(
        "synthetic" in provenance and "no patient" in provenance,
        "Bundled fixture provenance must explicitly state synthetic/no-patient origin.",
    )
    audit.require(
        fixture.get("region") in typescript, "Bundled fixture region is not canonical."
    )
    try:
        image = base64.b64decode(str(fixture.get("base64", "")), validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        audit.errors.append(f"Bundled fixture base64 is invalid: {exc}")
        image = b""
    image_sha = hashlib.sha256(image).hexdigest()
    audit.require(
        fixture.get("sha256") == image_sha == EXPECTED_FIXTURE_IMAGE_SHA256,
        "Bundled fixture decoded-image SHA-256 changed or is inconsistent.",
    )
    audit.require(
        image.startswith(b"\x89PNG\r\n\x1a\n"), "Bundled fixture is not a PNG."
    )
    if len(image) >= 24 and image.startswith(b"\x89PNG\r\n\x1a\n"):
        width, height = struct.unpack(">II", image[16:24])
        audit.require(
            (width, height) == (160, 160), "Bundled fixture must remain 160×160."
        )


def audit_hashes_and_inventory(audit: Audit) -> None:
    for relative, expected in AUDITED_FILE_SHA256.items():
        path = ROOT / relative
        audit.require(path.is_file(), f"Audited file is missing: {relative}")
        if path.is_file():
            audit.require(
                _sha256(path, normalize_line_endings=relative in AUDITED_TEXT_FILES)
                == expected,
                f"Audited file checksum changed; update the audit deliberately: {relative}",
            )

    inventory_path = ROOT / "docs/licenses-model-cards/ASSET_DATA_INVENTORY.csv"
    try:
        with inventory_path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
    except (OSError, UnicodeError, csv.Error) as exc:
        audit.errors.append(f"Asset inventory could not be read: {exc}")
        return
    by_path = {row.get("path_or_uri", ""): row for row in rows}
    for relative, expected in AUDITED_FILE_SHA256.items():
        row = by_path.get(relative)
        audit.require(
            row is not None, f"Audited file lacks an inventory row: {relative}"
        )
        if row is None:
            continue
        audit.require(
            row.get("sha256") == expected, f"Inventory checksum mismatch: {relative}"
        )
        audit.require(
            row.get("eligible_for_use") == "yes",
            f"Audited asset is not eligible: {relative}",
        )
        audit.require(
            row.get("license_name") == AUDITED_FILE_LICENSE[relative],
            f"Asset license mismatch: {relative}",
        )
    for row in rows:
        path = row.get("path_or_uri", "")
        audit.require(
            "TBD" not in " ".join(row.values()), f"Inventory row contains TBD: {path}"
        )
        audit.require(
            path
            not in {"assets/mouth/oral-observation-map.glb", "apps/mobile/assets/demo"},
            f"Inventory references a removed/nonexistent asset path: {path}",
        )


def audit_dependency_inventory(audit: Audit) -> None:
    notice_path = ROOT / "docs/licenses-model-cards/THIRD_PARTY_NOTICES.md"
    sbom_path = ROOT / "docs/licenses-model-cards/THIRD_PARTY_SBOM.cdx.json"
    audit.require(notice_path.is_file(), "Third-party notice file is missing.")
    audit.require(sbom_path.is_file(), "Third-party SBOM is missing.")
    if not notice_path.is_file() or not sbom_path.is_file():
        return

    lock_hashes = {
        "stoma3d:pnpm-lock-sha256": _sha256(ROOT / "pnpm-lock.yaml"),
        "stoma3d:uv-lock-sha256": _sha256(ROOT / "uv.lock"),
    }
    try:
        sbom = json.loads(sbom_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        audit.errors.append(f"Third-party SBOM could not be read: {exc}")
        return
    properties = {
        str(item.get("name", "")): str(item.get("value", ""))
        for item in sbom.get("metadata", {}).get("properties", [])
        if isinstance(item, dict)
    }
    notice = notice_path.read_text(encoding="utf-8")
    for name, expected in lock_hashes.items():
        audit.require(
            properties.get(name) == expected,
            f"Third-party SBOM is stale for {name}.",
        )
        audit.require(
            expected in notice,
            f"Third-party notices are stale for {name}.",
        )
    audit.require(
        sbom.get("bomFormat") == "CycloneDX" and sbom.get("specVersion") == "1.5",
        "Third-party SBOM must be CycloneDX 1.5.",
    )
    audit.require(
        len(sbom.get("components", [])) > 0,
        "Third-party SBOM contains no dependency components.",
    )


def main() -> int:
    audit = Audit()
    try:
        audit_forbidden_artifacts(audit)
        audit_public_model_distribution(audit)
    except (OSError, subprocess.CalledProcessError) as exc:
        audit.errors.append(f"Could not enumerate repository files: {exc}")
    audit_regions_and_assets(audit)
    audit_hashes_and_inventory(audit)
    audit_dependency_inventory(audit)
    if audit.errors:
        print("Repository audit failed:", file=sys.stderr)
        for error in audit.errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(
        "Repository audit passed: no forbidden artifacts; audited hashes, fixture provenance, "
        "inventory, and cross-language taxonomy parity are valid."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
