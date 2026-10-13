# Fallback diagram verification, October 13, 2026

All eight numbers in the browser's 2D backup map are now separated and readable. The region list, 3D geometry, saved pins, analysis, and reports retain their existing behavior.

## Finding and correction

The backup diagram projected 3D region centers into a single front view. Tongue and dental-arch surfaces overlapped, hiding several numbers. A browser regression against the preceding live version failed at 320 pixels: markers 1 and 2 were only about 28 view-box units apart, less than their combined 32-unit diameter.

The fallback now uses a dedicated flat display layout with the same eight canonical regions and numbering. Its closest centers are 46 units apart, leaving at least 14 units between marker edges. This is a diagram layout, not a reconstructed mouth or a change to stored region/mesh/UV coordinates. The versioned 3D positions and pin calculations are unchanged.

Three focused regressions failed before the correction and passed afterward. All 15 map tests passed, including the existing rotation, zoom, and pin-position tests. Full checks passed 756 JavaScript tests, workspace TypeScript, Prettier, web ESLint, the public-mode production build, and 349 Python tests. One external PostgreSQL test was skipped; the existing Starlette warning remains. This layout increment received source self-review.

## Deployed release

Application commit: `f75779dcd8ddc70a8079d5a04ee0e91a0872a1a2`, pushed to the existing [repository](https://github.com/rohit47108/stoma3d).

READY deployment `dpl_GizZZM3X8Zu4tkYNsEpVaeNP8uaK` received [the public alias](https://stoma3d.vercel.app). Its [immutable URL](https://stoma3d-ihsrwv6gs-rohit-singhs-projects-48f82479.vercel.app) identifies the build. [TypeScript CI](https://github.com/rohit47108/stoma3d/actions/runs/38465826862) and [repository safety CI](https://github.com/rohit47108/stoma3d/actions/runs/38465827123) succeeded.

## Browser verification

Fresh Chromium, Firefox, and Windows WebKit contexts deliberately made WebGL unavailable before application startup. Each engine checked light/dark preferences at widths 320, 768, 1024, and 1440 pixels with reduced motion enabled: 24 passing layout checks.

Every check verified all eight ordered numbers, contained text bounds, separated marker centers, no intersecting number text, and an eight-button region list. Selecting the right cheek opened its detail, updated `aria-pressed`, and highlighted the corresponding marker. No horizontal overflow or page exception was recorded. Twelve diagram screenshots were visually inspected: both themes at 320 and 1440 pixels in each engine. The selected label retained its white fill; ordinary labels retained dark ink on white.

One fresh complete eight-region upload journey per engine also passed after this deployment: 24 actual `complete` / `live_model` results using the approved licensed cases. Each journey retained the ordinary 3D map and zoom controls, unsupported/decode rejection, explicit observation confirmation, 7/8 reload/resume, 8/8 completion, PDF download, and saved-result reopening. No successful inference response was mocked. Responses remained no-store; the journeys recorded no page exceptions or console errors.

The three reports reopened as nine-page PDFs. Structural checks matched all ordered capture IDs to their journey's responses and verified unique identifiers, region photos, model versions, live-model provenance, and page numbering. All 27 rendered pages were visually inspected without missing photos/outlines, clipped content, or obscured footers. These are repeated uses of the same eight cases, not independent patient evaluation or physical-camera tests.

## Evidence and remaining scope

Ignored local records under `outputs/usability-checks`:

- `browser-fallback-labels-2026-10-13-before`: the preserved pre-change failure and diagram.
- `browser-fallback-labels-2026-10-13-after`: 24 passing geometry/layout checks and reviewed diagrams.
- `browser-full-flows-2026-10-13-fallback-release`: three passing full journeys and reopened/rendered reports.

The [map-loading record](WEB_MAP_LOADING_VERIFICATION_2026-10-13.md) documents the separate download reduction; this diagram correction makes no new speed claim. Native repetition/accessibility, physical front/back cameras, phone photo-library handling, and deferred iPhone testing remain open. Windows WebKit is not iPhone Safari. This is not final all-platform approval.
