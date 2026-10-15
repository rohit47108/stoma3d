# Android map control separation, October 14, 2026

The lower-lip observation marker now selects at its center without activating rotation. Rotation and zoom controls occupy a separate row below the scene. This fixes the overlap observed in the [fresh Android scan](./ANDROID_FRESH_SCAN_VERIFICATION_2026-10-14.md#map-and-observation-links).

## Change and regression coverage

Source commit: `806a658205a09a43b5eb319bdf790bb73e1f3314`.

The scene keeps its existing 370-point phone, 300-point compact-landscape, and 440-point wide heights. A separate 72-point control row contains the existing 48-point buttons. Readouts and legends remain inside the scene. Geometry, named meshes, UV coordinates, asset version, and saved records did not change. The renderer manifest, inventory, and audit allowlist record the reviewed source checksum.

The previous absolute-positioned controls shared the scene's touch area. React Native documents that [absolute positioning removes an element from normal layout flow](https://reactnative.dev/docs/0.86/layout-props#position) and that [overlapping touch targets follow sibling precedence](https://reactnative.dev/docs/0.86/pressable#hitslop). The fix separates the two areas rather than shrinking the model or removing its controls.

Three new regression cases failed against the old layout and passed after the change. They render the real component through React with mocked native/GL boundaries and check scene/footer separation at phone, landscape, and wide sizes. They are not native Yoga, graphics-fallback, or physical-device hit-testing evidence.

## Simulator verification

The existing `Stoma3D_Verify_20261010` device received an in-place x86_64 package update. No data, permissions, or scans were cleared. The completed October 14 scan, eight accepted regions, and its single confirmed lower-lip pin remained available.

At the simulator's 414-by-945 window size:

- The scene retained its previous framing; controls appeared beneath it.
- Clicking the lower-lip marker's center selected Lower lip without changing the viewing angle.
- Rotate right changed the angle, and Rotate left restored it.
- Zoom in enlarged the model; Zoom out restored the previous scale.
- The named-region list retained all eight regions and only one lower-lip observation.
- The marker's saved-observation link reopened the matching lower-lip photo, outline, and approximate 11.2% area.

This is a focused map check using an existing real-analysis scan, not another complete scan. Landscape/tablet geometry was checked by regression tests, not by physical devices. The earlier intermittent PDF timeout remains unresolved; this layout change does not address it.

## Build artifacts

Artifacts remain in ignored `outputs/native`, not the public repository. Both Android packages use the existing local test signing certificate, not store-release signing.

| Artifact                                                  | Size (bytes) | SHA-256                                                             | Verification                                                         |
| --------------------------------------------------------- | -----------: | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Stoma3D-2026-10-14-map-controls-x86_64.apk`              |    102677195 | `d957e6c2aab9d500fdad1d30a75be589e9fbbbf3b0bd648d4a75ab5b1fa9d773f` | Signature, x86_64 contents, installed and exercised                  |
| `Stoma3D-2026-10-14-map-controls-arm64.apk`               |     98185305 | `3c9376aec2b2d2bde86286d01e24c9deee12cf8a7d327ac110d5a3c97de75aef`  | Signature and arm64-v8a contents; not installed on a physical phone  |
| iOS export's `index-a04f9e63d0377b00043a1f5a8aaf3598.hbc` |      9400511 | `c0dcbe9ff9557c6a5c48b66454e82cf0baf419d70d590226c4f4fc79da93b9a1`  | JavaScript export and all 42 assets; not an installable iPhone build |

Both Android packages contain the same compiled bundle, SHA-256 `c4083e94d05503a3f42c3555fb878711817472e61fe5085485df3b4cd6c4f714`. It matches the generated release bundle, whose source map includes the exact updated component. The iOS export contains the production inference URL and public response-verification key. Private keys were not bundled.

## Checks run

- `pnpm test`: 782 passed across scripts, contracts, mobile, and web.
- `pnpm typecheck`, `pnpm format:check`, and web ESLint: passed.
- Focused map tests: 26 passed, including the three new layout cases.
- Python service/ML tests: 349 passed, one external-PostgreSQL test skipped, one existing Starlette/httpx deprecation warning.
- Repository artifact/provenance audit, dependency audit, changed-file Ruff check, and `git diff --check`: passed.
- Android release builds for x86_64 and arm64-v8a, plus iOS JavaScript export: passed.
- Web production build: passed with the documented `STOMA3D_WEB_MODE=public` setting. An initial command without that setting correctly failed hosted-mode validation for missing platform configuration; validation was not weakened.

GitHub's [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38678028223) passed for this commit. The corresponding Vercel deployment, `dpl_7RgJHHrF8tRdtMQxZBwhrNJVwPTd`, reached READY in production. That deployment status is not additional browser or native runtime evidence; this change is mobile-only.

Remaining release checks still include repeated native flows, the native error/accessibility matrix, physical cameras, and iPhone runtime testing. A built package or passing simulator check does not substitute for those checks.
