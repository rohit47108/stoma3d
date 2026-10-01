# Mobile build and deployment

Stoma3D is an installed iOS and Android app. Expo Application Services (EAS)
can produce its installable files; Vercel cannot turn the native app into a
website at a custom domain.

The mobile app also needs the separate inference service. For a real phone, that
service must be reachable over HTTPS and must sign its responses.

## What each build profile produces

The profiles are in `apps/mobile/eas.json`.

| Profile                 | Intended use                                     | Android            | iOS                                                       |
| ----------------------- | ------------------------------------------------ | ------------------ | --------------------------------------------------------- |
| `development`           | Local development with the Expo development menu | Installable APK    | Signed development build for registered devices           |
| `development-simulator` | Development on an iOS Simulator                  | Not used           | Simulator build                                           |
| `preview`               | Private testing without development tools        | Installable APK    | Signed internal-distribution build for registered devices |
| `production`            | Store submission                                 | Android App Bundle | App Store archive                                         |

The JavaScript bundle export commands in `apps/mobile/package.json` are checks,
not installable phone apps. Use EAS or a native local build for an APK, Android
App Bundle, simulator app, or iOS archive.

Expo documents these profile types in its
[EAS build configuration guide](https://docs.expo.dev/build/eas-json/).

## First-time setup

From the repository root:

```powershell
corepack enable
pnpm install --frozen-lockfile
Set-Location apps/mobile
pnpm dlx eas-cli@latest login
pnpm run eas:configure
```

Run the login and configuration commands with the Expo account that will own the
app. `eas:configure` creates the real EAS project link and project ID. No project
ID is committed in this repository because inventing one would make builds point
to the wrong account.

For credentials:

- EAS can create and store the Android signing keystore. Keep a separate,
  protected backup. A Google Play Console developer account is required to
  publish through Google Play.
- Physical-device and App Store iOS builds require an Apple Developer Program
  membership. EAS can create the distribution certificate and provisioning
  profile. Internal iOS builds also require each test device's UDID; register it
  with `pnpm dlx eas-cli@latest device:create` before rebuilding.
- The `development-simulator` profile does not install on a physical iPhone and
  does not replace the Apple credentials needed for device or App Store builds.

See Expo's official [build setup](https://docs.expo.dev/build/setup/) and
[app-credential](https://docs.expo.dev/app-signing/app-credentials/) guides.

## Mobile environment values

Copy `apps/mobile/.env.example` to a local `.env` for local work. Never commit
the populated file.

The checked-in `preview` and `production` profiles contain the currently verified
inference origin and public response-verification key. A full account-enabled build
also requires the platform, identity, web, and share values in the matching EAS
environment:

```text
EXPO_PUBLIC_INFERENCE_URL=https://stoma3d-inference.vercel.app/api
EXPO_PUBLIC_RESPONSE_SIGNING_PUBLIC_KEY_B64=52Fs9oXU4tUX7yIFi22hHZDkCA0waE2KutGo3VIWYzU=
EXPO_PUBLIC_PLATFORM_URL=https://api.example.org
EXPO_PUBLIC_OIDC_ISSUER=https://example.us.auth0.com
EXPO_PUBLIC_OIDC_CLIENT_ID=replace-with-public-native-client-id
EXPO_PUBLIC_OIDC_AUDIENCE=stoma3d-platform-api
EXPO_PUBLIC_WEB_URL=https://app.example.org
EXPO_PUBLIC_SHARE_VIEWER_URL=https://app.example.org/shared
```

`EXPO_PUBLIC_*` values are compiled into the app and are visible to anyone who
installs it. The inference URL and public key are safe to expose. A password,
API secret, or the Ed25519 private key is not.

The backend must receive the matching private configuration:

```text
STOMA3D_DEPLOYMENT_MODE=production
STOMA3D_REQUIRE_RESPONSE_SIGNING=true
STOMA3D_RESPONSE_SIGNING_PRIVATE_KEY_B64=BASE64_RAW_32_BYTE_ED25519_PRIVATE_KEY
STOMA3D_ENABLE_DEMO_FIXTURES=false
```

Store the private key only in the backend host's secret manager. Do not place it
in an Expo variable, app file, Git commit, build log, or Vercel public
environment variable. Stoma3D verifies the exact signed response bytes with
the pinned public key before it accepts the response.

Development builds still default to local loopback services. Configure preview and
production values in the owner's EAS environments instead of committing tenant IDs or
secrets. If an origin, audience, client ID, or public signing key changes, update the
corresponding EAS environment and `apps/mobile/.env.production.example`, then rebuild.
See Expo's
[environment-variable guide](https://docs.expo.dev/eas/environment-variables/).

## Run against a local backend

Start the inference service on port 8000 as described in
`services/inference/README.md`.

### Android emulator or physical Android phone

Connect the device with USB debugging enabled, then run:

```powershell
adb devices
adb reverse tcp:8000 tcp:8000
$env:EXPO_PUBLIC_INFERENCE_URL = "http://127.0.0.1:8000"
pnpm --filter @stoma3d/mobile start
```

`adb reverse` makes the phone's port 8000 reach the computer's port 8000. This
is why the app can use the loopback-only HTTP exception during development.
Repeat `adb reverse` after reconnecting or restarting the device.

Do not replace the URL with a plain-HTTP Wi-Fi or LAN address. Stoma3D rejects
non-loopback HTTP endpoints.

### Physical iPhone

An iPhone's `127.0.0.1` is the iPhone itself, and iOS has no `adb reverse`.
Deploy the backend to a reachable HTTPS address, configure that address and the
matching pinned public key, then rebuild the development client. A plain local
Wi-Fi HTTP address is intentionally unsupported.

## Build commands

Run these from `apps/mobile` after first-time EAS setup:

```powershell
# Installable development builds
pnpm run eas:build:android:development
pnpm run eas:build:ios:development

# iOS Simulator only
pnpm run eas:build:ios:simulator

# Private tester builds
pnpm run eas:build:android:preview
pnpm run eas:build:ios:preview

# Store artifacts
pnpm run eas:build:android:production
pnpm run eas:build:ios:production
```

The development and preview APKs can be installed directly on Android test
devices. iOS internal builds install only on provisioned devices. Production
artifacts still need store listings, privacy answers, review, and submission;
creating an artifact does not publish it.

Before requesting a remote build, run:

```powershell
pnpm run doctor
pnpm run config:public
pnpm run typecheck
pnpm run test
pnpm run export:android
pnpm run export:ios
```

Review `config:public` for the correct package identifiers, permissions, and
plugins. Do not paste its output into public bug reports if future configuration
adds private operational details.

## What Vercel can and cannot host

Vercel cannot host or install the iOS/Android binary. A custom web domain can
point to a public information site or the HTTPS API, but opening that domain is
not the same as installing Stoma3D.

The repository includes a root Vercel configuration for the web app that proxies
its public API paths to the separately deployed inference service. The inference
service also has its own Vercel configuration. Both are validated against Vercel's
current configuration schema.

```text
https://stoma3d-inference.vercel.app/api/healthz
https://stoma3d-inference.vercel.app/api/v1/model-card
```

The selected Vercel project must store the production mode, required signing key, key
ID, disabled fixture flag, inference limits, web Auth0 values, site origin, audience,
and platform origin as protected variables. The signing private key and web client
secret are server-only.

Every mobile image is re-encoded below 1.75 MB. Two comparison images plus
multipart metadata therefore remain below Vercel's 4.5 MB function request-body
ceiling. The API enforces the same per-image limit for non-mobile callers.

The inference-only deployment passed health, model-card, live analyze, and
fail-closed compare requests on July 28, 2026. Recheck those live routes before each
web promotion, then build a fresh web preview and run the full acceptance flow.
Proxy-level body logging, temporary storage,
connection limits, and rate limits still belong in the final host review. The container
route remains available when encrypted `tmpfs` and tighter host controls are required.

Follow [`DEPLOYMENT.md`](DEPLOYMENT.md) for the current web, inference, platform,
worker, DNS, OIDC, storage, migration, rollback, and ZIP handoff.

## External items still required

Code alone cannot supply these:

- an Expo account and the real EAS project created under that account;
- an Apple Developer Program membership, Apple signing credentials, and the
  physical iPhone UDIDs used for internal testing;
- an Android signing keystore and, for store release, a Google Play Console
  developer account;
- a real OIDC tenant, PostgreSQL, TLS Redis, private S3-compatible storage, DNS/TLS,
  ingress limits, backup/lifecycle rules, and a container host for account features;
- at least two physical iPhones and two physical Android devices for the planned
  quality, deletion, accessibility, interruption, and repeated-scan tests; and
- licensed patient-disjoint data, trained model artifacts, locked evaluation
  evidence, and clinical review before any learned medical output may be
  released.
- the owner's final iOS bundle ID, Android application ID, repository license, and
  approval to redistribute every released model artifact.

Until the model and review gates pass, the app must continue to abstain instead
of inventing a result. A successful native build proves that the software can be
installed; it does not prove medical accuracy or regulatory clearance.
