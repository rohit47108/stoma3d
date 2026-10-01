# Stoma3D

Stoma3D helps you take consistent mouth photos, inspect visible observations,
and keep a record of changes on iOS, Android, and the web. It is not a diagnostic
tool.

The scan flow is Home → Start or resume scan → Brief intake → Capture or upload
→ Review photo → Analysis → Results and 3D map. A standard scan keeps one accepted
photo for each of the eight mouth regions. You do not choose a model, protocol,
or physical scale during setup.

The app re-encodes photos without metadata, checks privacy and quality, verifies
the analysis response, and encrypts saved records on the device. A front/back
camera switch and saved-photo upload share the same review and analysis path.
The base 3D map opens before you finish a scan or connect to the analysis service.

The browser workspace is `/scan`; it does not require an account. Guest records
stay in encrypted IndexedDB storage on that browser. Cloud sync is a separate,
optional setup. See the [October usability verification record](docs/release/USABILITY_VERIFICATION_2026-10-01.md)
for completed checks and outstanding phone tests.

The installed app contains no sample mouth images and does not replace a failed
analysis with a made-up result. A disabled backend fixture exists only for
service and contract tests.

> **This result is not a diagnosis.** Stoma3D does not prove cancer,
> harmlessness, or the absence of disease.

## What works now

- Home, Scan, 3D Map, and History navigation with brief consent and symptom intake
- The fixed eight-region mouth capture workflow
- Front camera by default, front/back switching, and saved-photo input
- Shared photo review, crop, rotate, retake, and region/privacy confirmation
- Stability and tilt guidance when the device supports it
- Local photo guidance with final quality and anatomy acceptance from the service
- Server-side image decoding, metadata stripping, face detection, and quality checks
- A released eight-region anatomy model that rejects mismatched mouth regions
- A released segmentation model that outlines one possible visible candidate
  region and derives approximate area, shape, color, and texture descriptors
- Encrypted local image, metadata, analysis, and PDF storage
- Offline, timeout, malformed-response, unavailable-analysis, retry, and retake states
- Signed API-response verification for non-loopback deployments
- Saved-session resume, result reopening, deletion, and encryption-key rotation
- An accessible oral observation map with all eight named regions
- A two-step longitudinal flow: gated re-identification suggestion, mandatory
  user review, then confidence-gated ORB/RANSAC comparison
- A local clinician-discussion PDF after all eight regions have accepted captures
- Account-free browser scanning, partial results, an interactive map, and a
  printable observation report
- Encrypted mobile retry drafts after local quality and privacy checks pass;
  interrupted analysis does not require another photo

These features are implemented in the current source. Local browser tests used
real, licensed mouth images and the deployed analysis service. The updated web
release and physical-phone camera checks are still pending in the dated record.

An image can count toward scan coverage after quality acceptance, explicit user
confirmation, and a matching anatomy result. Candidate outlining runs only when
both the quality and anatomy checks pass. An empty mask means only that the model
did not mark a candidate; it does not prove that the image is normal or harmless.
The app never invents a mask, disease class, or diagnosis.

## What is not available yet

The anatomy-validation head is enabled only for region matching. Its
patient-disjoint test reached macro F1 `0.9842`, with no region recall below
`0.9302`.

The competition inference deployment can enable non-diagnostic candidate
outlining. Its exact frozen test reached Dice `0.7192` and boundary F1 `0.6256`.
Positive-image scores were lower, so an empty mask is never treated as
reassurance.

The released weight uses the Autooral training split under its authors'
academic-research and non-commercial terms. A clean-license SMART-OM-only
replacement was trained and evaluated once on a fresh patient holdout, but it
reached Dice `0.6809` and boundary F1 `0.5616`, below the fixed `0.70`/`0.60`
gate. It was rejected. The competition weight is supplied to the deployed
inference service through a private model bundle and is not stored in this
public repository.

Disease-category research failed (`macro F1 0.3596`, calibration error
`0.0827`, inadequate held-out patients, and no signed clinical review).
Appearance classification and lesion re-identification lack the required labels
or longitudinal pairs. Those three heads remain disabled for real users.

The service checks a hash-verified release manifest before loading a model. A
future model can run only when its exact artifact, preprocessing contract,
metrics, review evidence, and release state validate. Missing or invalid evidence
causes an abstention.

The [October usability verification record](docs/release/USABILITY_VERIFICATION_2026-10-01.md)
tracks this implementation. Earlier snapshots remain in
[implementation status](docs/IMPLEMENTATION_STATUS.md),
[final verification](docs/FINAL_VERIFICATION.md), and the
[original-plan requirement audit](docs/REQUIREMENT_AUDIT.md); those documents are
not evidence that every October change has been tested or deployed.

## Repository

- `apps/mobile`: Expo and React Native application
- `apps/web`: public pages, guest scans, and optional account-enabled Next.js views
- `packages/contracts`: canonical TypeScript schemas and cross-field safety rules
- `services/inference`: stateless FastAPI, OpenCV, signing, and model-release service
- `services/platform-api`: accounts, sync, storage, sharing, review, jobs,
  analytics, and deletion APIs
- `services/worker`: durable PDF, MP4, GLB, export, and retention worker
- `ml`: patient-disjoint manifest, training, evaluation, calibration, and release-gate
  tooling
- `assets/mouth`: versioned oral observation map metadata
- `deploy`: production Compose, environment contract, and operator runbook
- `docs`: architecture, safety, privacy, release, licensing, and build instructions

No restricted medical image, patient dataset, database, secret, or generated build
belongs in Git. The public anatomy model is hash-pinned and listed in the asset
inventory; the competition segmentation model stays in the ignored private release
bundle. The repository's CC0 test fixture is not imported by or compiled into the
mobile app.

## Install and verify

Requirements:

- Node.js 22 to 24
- Corepack and pnpm 11.9.0
- Python 3.12 or 3.13
- `uv`
- Android Studio or Xcode for native builds

From the repository root:

```powershell
Set-Location C:\Users\rohit\Projects\oralsight
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck

py -3.12 -m pip install --upgrade uv
py -3.12 -m uv sync --frozen --all-packages --extra dev
py -3.12 -m uv run --frozen --all-packages pytest `
  services/inference/tests services/platform-api/tests services/worker/tests ml/tests

python .github/scripts/audit_repository.py
```

To create a clean source archive after verification:

```powershell
.\scripts\package-source.ps1 -OutputPath ..\Stoma3D-source.zip
```

The packager uses Git's non-ignored source-file list, so it omits local
dependencies, exports, caches, secrets, medical data, databases, and model
training artifacts. It includes the audited, redistributable ONNX files used for
face-presence privacy checks and anatomy matching. The private candidate-mask
bundle is intentionally excluded.

## Run locally

Start the stateless service:

```powershell
$env:STOMA3D_DEPLOYMENT_MODE = "development"
$env:STOMA3D_REQUIRE_RESPONSE_SIGNING = "false"
$env:STOMA3D_ENABLE_DEMO_FIXTURES = "false"
$env:STOMA3D_RELEASE_MANIFEST_PATH = (
  Resolve-Path "services/inference/private-release/release-manifest.json"
).Path
py -3.12 -m uv run --frozen --package stoma3d-inference `
  uvicorn stoma3d_api.main:app --reload --port 8000 --no-access-log --no-server-header
```

In another terminal, create or run an Expo development build:

```powershell
$env:EXPO_PUBLIC_INFERENCE_URL = "http://127.0.0.1:8000"
pnpm dev:mobile
```

To run the browser workspace against the deployed inference service, set these
values in the web development process:

```powershell
$env:STOMA3D_WEB_MODE = "public"
$env:NEXT_PUBLIC_SITE_URL = "http://localhost:3000"
$env:STOMA3D_INFERENCE_URL = "https://stoma3d-inference.vercel.app/api"
$env:STOMA3D_RESPONSE_SIGNING_PUBLIC_KEY_B64 = `
  "52Fs9oXU4tUX7yIFi22hHZDkCA0waE2KutGo3VIWYzU="
pnpm --filter @stoma3d/web dev
```

Open [the local scan workspace](http://localhost:3000/scan). The public key is
safe to publish; it verifies responses and cannot sign them. The guest relay
requires signed responses even when its inference destination is loopback.

This app requires a development build; Expo Go is not enough for SQLCipher and the
other native modules. On Android hardware, `adb reverse tcp:8000 tcp:8000` lets the
phone use the loopback URL. A physical iPhone needs an HTTPS service endpoint.

Every non-loopback mobile build requires:

- an HTTPS inference URL;
- an Ed25519 private key stored only on the service;
- the matching raw public key pinned with
  `EXPO_PUBLIC_RESPONSE_SIGNING_PUBLIC_KEY_B64`; and
- production ingress rate, connection, and timeout limits.

The checked-in EAS profiles contain public inference configuration. A complete
account/cloud build also needs the platform, OIDC, web, and share-viewer values
documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Private signing keys
belong only in the deployment secret store. Never commit populated secret files.

## Deployment

The native app is distributed as an Android or iOS build, not as a Vercel website.
Vercel can host the Next.js web product and the stateless OpenCV inference API.
The account API and continuous worker are stateful container services and are not
replaced by Vercel. The signed inference release is live at
[the inference health endpoint](https://stoma3d-inference.vercel.app/api/healthz).
Guest browser scans use `POST /api/scan/analyze`, a server-only relay to that
service. It verifies the original signed response bytes and checks the shared
schema before returning a result. The relay selects released heads from the
signed model card; visitors do not select models. The platform and worker remain
separate container deployments.

The supplied Vercel configurations keep the web and inference releases separate.
The mobile/API pipeline caps each image at 1.75 MB so two-image comparisons fit
within the documented request-body limit. Release verification rechecks the live
health, model card, analysis, no-store, and detached-signature behavior before
promotion.

See the complete [deployment handoff](docs/DEPLOYMENT.md),
[mobile build instructions](docs/MOBILE_BUILD_AND_DEPLOY.md), and inference
service [deployment notes](services/inference/README.md).

Optional accounts, cloud sync, clinician review, QR sharing, server-rendered reports,
encrypted exports, and durable jobs run through the separate platform and worker
services. `compose.yaml` is the local stack. The hardened production surface and its
external PostgreSQL, TLS Redis, private S3, OIDC, backup, restore, and retention
requirements are documented in
[`deploy/production/RUNBOOK.md`](deploy/production/RUNBOOK.md).

## Safety boundary

- Review priority remains disabled unless a versioned clinician-approved rule file
  is installed.
- Learned outputs remain disabled unless their locked evaluation and review gates
  pass.
- A failed live request never receives a fixture result.
- Measurements are image-normalized unless a versioned reference-card calibration
  passed for a historical capture. Ordinary new scans have no scale-card control
  or millimeter measurement. Historical calibrated records retain their context.
- Passing software tests does not establish clinical accuracy, regulatory status,
  effectiveness, or HIPAA compliance.

## Distribution

Stoma3D source code is available under the MIT License. The public repository
does not contain the Autooral-assisted segmentation weight. The academic
competition deployment loads that weight from a private, hash-verified model
bundle. See [`docs/PUBLIC_DISTRIBUTION.md`](docs/PUBLIC_DISTRIBUTION.md).
