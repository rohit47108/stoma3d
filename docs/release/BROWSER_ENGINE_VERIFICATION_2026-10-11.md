# Browser scan verification, October 11, 2026

The deployed guest scan completed real eight-region upload journeys in three browser engines. Native and physical-phone checks remain separate; this record is not final release sign-off.

## Source and deployment

Tested application source: `35ae24850f89c65eb7d6cc64a7a4994e06436f06` in the existing [Stoma3D repository](https://github.com/rohit47108/stoma3d).

Production deployment `dpl_5mh45oKBVDJFwGvHiWHsmAY6z25a` reached READY and was assigned to [stoma3d.vercel.app](https://stoma3d.vercel.app). Its [immutable URL](https://stoma3d-9mlecel54-rohit-singhs-projects-48f82479.vercel.app) identifies the tested build. Both [TypeScript checks](https://github.com/rohit47108/stoma3d/actions/runs/38190688282) and the [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38190688313) succeeded.

Two runtime findings were corrected:

- Completed scans opened the camera from History. Source `90f2d7f` opens their map instead; unfinished scans still resume at the missing region.
- Firefox reported blocked dynamic-code probes from Zod. Component-level setup in `32c06fd` passed its unit test but ran too late in the production bundle. Source `35ae248` moves synchronous setup to Next's [client instrumentation hook](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client), before hydration. The deployed Firefox trace records no dynamic-code probes or console errors. CSP remains unchanged; no `unsafe-eval` permission was added.

Contracts, stored-data schemas, encryption, deletion, signatures, analysis gates, dependencies, and inference deployment are unchanged. No migration or model replacement was required.

## Complete browser journeys

Repository-owned Playwright ran fresh, isolated, headless contexts at 390 × 844 pixels. These are browser-engine tests, not physical-device tests or native Safari/iPhone coverage.

| Engine   | Version       | Accepted live results | Interactive map | Runtime/console errors |
| -------- | ------------- | --------------------: | --------------- | ---------------------: |
| Chromium | 151.0.7922.34 |                   8/8 | 3D              |                      0 |
| Firefox  | 153.0         |                   8/8 | 3D              |                      0 |
| WebKit   | 26.5          |                   8/8 | 3D              |                      0 |

Each journey verified:

1. Guest Home, consent, and no-symptom intake without sign-in
2. An empty map with eight selectable regions and working zoom controls
3. Unsupported and unreadable files rejected before any analysis request, with decoding errors distinct from blur
4. Eight permitted mouth-photo uploads through review and actual analysis
5. HTTP 200, accepted quality, matching region, `complete` status, `live_model` provenance, distinct capture IDs, and `Cache-Control: no-store`
6. Explicit right-cheek observation confirmation; unconfirmed candidates remained unpinned
7. Reload and History resume at 7/8, followed by the missing lower-arch capture
8. Completed-map rendering, local PDF download, and saved-session reopening after reload
9. History's completed-scan action opening the map, with the confirmed observation and its original result still linked

The three sessions produced 24 live analysis requests using the same eight approved, licensed inputs. They are not 24 independent images or patients. No successful response was mocked, and no failed request received a fixture result. The existing analysis/signature path remained in use.

All three PDFs reopened as nine-page reports. Structural checks found three distinct sessions, 24 distinct captures, eight region pages and images per report, live-model provenance, deployed model versions, and page numbering. All 27 pages were rendered and visually inspected; no clipping, overlapping headings/footers, or missing image/overlay content was observed.

## Recovery, deletion, and layout

A separate isolated browser session tested controlled HTTP 503, malformed-response, and offline failures. Each retained the same review photo, kept coverage at 0/8, and showed no result or observation-confirmation action. An unmocked retry then completed real analysis without choosing the photo again. Reload retained that accepted capture.

The app's deletion action removed only this isolated test scan; History stayed empty after another reload. No phone, cloud, or pre-existing user records were deleted. This runtime check establishes removal from the app; the existing encryption/key-deletion tests provide the storage-level checks.

With WebGL disabled, the 2D backup map remained usable for all eight regions. Layout checks at 320, 390, 768, and 1280 pixels found no horizontal overflow and region controls at least 44 CSS pixels tall. Reduced-motion preference and keyboard access to Skip to content passed. An unavailable camera retained retry and upload options. No analysis requests occurred during these checks.

Viewport screenshots confirmed that Skip to content stays offscreen unless focused; an apparent overlap in a full-page screenshot was a capture artifact, not a visible map control.

These checks do not replace physical camera switching, OS permission handling, real HEIC-library tests, screen-reader testing, or all accessibility checks.

## Repository checks

- 698 JavaScript tests passed: scripts 24, contracts 33, mobile 427, web 214.
- Workspace TypeScript, Prettier, web ESLint, and the public-mode production build passed.
- The existing dependency audit and repository artifact/provenance audit passed, with no new audit exceptions.
- Python service/ML checks earlier in the same testing session passed 349 tests, with one external PostgreSQL test skipped and the known Starlette warning. Python code did not change in these web corrections.
- Independent source review approved both corrections; production browser checks were performed separately.

## Android and remaining checks

The existing API 36.1 x86_64 test emulator received the latest native Home/report package without clearing app data. Installation succeeded. The installed base APK matched `Stoma3D-2026-10-10-home-restore-x86_64.apk`, SHA-256 `3890cbb2e20f007be224e6349c77e2fd8b344b1acf92c0a940e906f05f32f361`, built from mobile source `73f0290`.

The computer-control connection failed before initialization. No new on-screen Android Home, report-pagination, restart, or ten-flow checks are claimed for this package. Browser testing continued through the independent repository-owned runner; no alternative native UI controller was used.

The owner deferred iPhone/Expo setup and will test the iPhone later. Remaining release work includes the updated native report/restart checks, repeated native journeys, physical-phone camera and permission tests, and the outstanding device/accessibility coverage in the approved plan. Earlier native and service evidence is recorded in [the October 10 verification record](REAL_IMAGE_FLOW_VERIFICATION_2026-10-10.md).

## Local evidence

Licensed images, reports, screenshots, session/capture IDs, and helper outputs remain in ignored `outputs/usability-checks`, outside Git:

- `browser-full-flows-2026-10-11-v5`: passing three-engine journeys, downloaded PDFs, and rendered report pages
- `firefox-csp-trace-2026-10-11-v2.json`: passing deployed initialization trace
- `browser-analysis-recovery-2026-10-11-v3`: controlled failures, real retry, and isolated deletion
- `browser-fallback-layout-2026-10-11-v2`: backup map, keyboard, reduced-motion, camera-unavailable, and width checks
- `browser-skip-link-check-2026-10-11.json`: actual viewport visibility check

Earlier failed runs remain separate from the passing evidence; they were not overwritten or counted as successful checks.
