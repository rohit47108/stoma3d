# Map loading verification, October 13, 2026

Scan home now waits to download the 3D engine until the user opens the map. Three complete real-image browser scans passed after deployment. This is a loading improvement, not a new analysis model or a claim of all-platform completion.

## Finding and correction

Although the renderer was already loaded on demand, a shared map helper imported `Spherical` from the Three.js runtime barrel. That pulled the 374,564-byte decoded core into scan home's initial JavaScript. Before the change, Lighthouse recorded about 102 KB of transfer for that core even though no map had been opened.

The helper now imports the existing exported `three/src/math/Spherical.js` module; the camera/control imports remain type-only. The installed Three.js 0.181.2 package explicitly exports `./src/*`, and the matching installed types resolve this path. The [upstream package exports](https://github.com/mrdoob/three.js/blob/r181/package.json) document the supported subpath. No dependency version, lockfile, model, data format, camera behavior, map geometry, or observation metadata changed.

The new import regression failed before the correction and passed afterward. All 12 focused map tests passed, including target-relative rotation, polar limits, zoom bounds, and versioned region/mesh/UV positions. A separate read-only review found no required changes. Source/barrel class identity differs, but current controls consume the spherical fields and do not rely on constructor identity; dependency upgrades should recheck the exported path.

Full checks passed 753 JavaScript tests, workspace TypeScript, Prettier, web ESLint, the public-mode production build, and 349 Python tests. One external PostgreSQL test was skipped; the existing Starlette warning remains. An initial local build used the wrong mode-variable name and correctly refused missing hosted configuration. It passed with `STOMA3D_WEB_MODE=public`; no validation was relaxed or deployment setting changed.

## Deployed release

Application commit: `98adbf21cc57f07fa7409f128c1ffe6e51e062a7`, pushed to the existing [repository](https://github.com/rohit47108/stoma3d).

READY deployment `dpl_DcucLcbNRvnkCPRfEasU5PoAKpn9` received [the public alias](https://stoma3d.vercel.app). Its [immutable URL](https://stoma3d-npsgkfya0-rohit-singhs-projects-48f82479.vercel.app) identifies the build. [TypeScript CI](https://github.com/rohit47108/stoma3d/actions/runs/38463020163) and [repository safety CI](https://github.com/rohit47108/stoma3d/actions/runs/38463020226) succeeded.

## Before/after measurements

The baseline was the preceding footer-only release `63d9765`. Three cold Lighthouse 13.5.0 mobile audits per route used the same CLI, bundled Chromium, fresh profiles, and default simulated throttling. Browser journey tests and production builds did not run during the post-change audit series.

| Scan-home metric       | Before, runs 1–3       | After, runs 1–3        |
| ---------------------- | ---------------------- | ---------------------- |
| Script transfer, bytes | 350696, 350678, 350707 | 249077, 249054, 249039 |
| Decoded script bytes   | 1252299 in each run    | 878514 in each run     |
| LCP, milliseconds      | 2885, 3047, 2899       | 2452, 2366, 2360       |
| CLS                    | 0, 0, 0                | 0, 0, 0                |
| TBT, milliseconds      | 374, 715, 403          | 181, 587, 853          |
| Performance score      | 86, 76, 85             | 95, 83, 78             |

Median initial script transfer fell about 29%, by approximately 102 KB. The median largest paint fell from 2.90 to 2.37 seconds (about 18%); the three timing ranges did not overlap. All three post-change scan paints were under 2.5 seconds in this lab series. These measurements support keeping this specific import change.

Blocking-time measurements remained noisy, and the performance-score median did not improve. This release does not claim a general responsiveness win or that all performance targets are met. Landing-page LCP was 2602, 2245, and 2363 milliseconds; it received no targeted speed change. All six audits retained CLS 0 and automated accessibility/best-practices scores of 100. Landing SEO remained 100; scan SEO remained 63 because it intentionally disallows indexing. Lab scores are not real-user or screen-reader verification.

## Map and scan behavior

Chromium 151.0.7922.34, Firefox 153.0, and Windows WebKit 27.2 each passed a fresh empty-map check. The old core chunk was absent at scan home and fetched only when the map opened, along with the renderer/control chunks. Each engine visibly rendered the map; all four rotation buttons, zoom in/out, and the focused canvas's keyboard rotation changed the rendered image. Region selection worked. Representative rendered maps were visually inspected.

Three additional fresh contexts deliberately made WebGL unavailable before application startup. All eight region controls remained available, and selecting the right cheek opened its detail. No page exceptions or console errors were recorded in any of these six checks. Actual viewport screenshots were inspected separately from full-page screenshots: a hidden fixed skip link appearing in a full-page capture was an off-viewport capture artifact, not a visible overlay in the user's viewport.

One complete eight-region upload journey per engine passed against the public alias: 24 actual `complete` / `live_model` results using the same approved licensed cases. Every journey included unsupported/decode rejection before analysis, explicit right-cheek confirmation, 7/8 reload/resume, 8/8 map completion, PDF download, and saved-result reopening. Successful responses were not mocked and retained `private, no-store, max-age=0`. The three journeys recorded no page exceptions or console errors.

All three PDFs reopened as nine-page reports. Structural checks matched the eight ordered capture IDs to each journey's responses, verified unique session/capture identifiers, region photos, model versions, live-model provenance, and page numbering. All 27 rendered pages were visually reviewed without missing photos/outlines, clipped content, or obscured footers. These are repeated uses of eight cases, not independent patient evaluation or live-camera tests.

## Evidence and follow-up

Ignored local evidence under `outputs/usability-checks`:

- `lighthouse-mobile-2026-10-13-footer-release`: baseline audits.
- `lighthouse-mobile-2026-10-13-map-import-release`: post-change audits.
- `browser-map-loading-2026-10-13`: three rendered-map and three forced-fallback checks, screenshots, and resource timing.
- `browser-fallback-viewport-2026-10-13`: actual-viewport screenshots and hidden skip-link bounds.
- `browser-full-flows-2026-10-13-map-import-release`: three passing full journeys and reopened/rendered reports.

The fallback's region list works, but several diagram numbers overlap; that visual cleanup remains a separate follow-up. Blocking-time variance also remains a performance finding. The Android window was covered by other user activity, so this increment made no native input changes and did not count a new Android journey. Repeated native/accessibility checks, physical cameras, phone HEIC handling, and deferred iPhone testing remain open. Windows WebKit is not iPhone Safari.

The overlapping fallback numbers were subsequently corrected and verified in [the separate diagram release](WEB_FALLBACK_LABEL_VERIFICATION_2026-10-13.md).

The [loading-layout record](WEB_LOADING_VERIFICATION_2026-10-13.md), [repeated scan record](BROWSER_REPEATED_FLOW_VERIFICATION_2026-10-13.md), and [image-quality record](BROWSER_IMAGE_QUALITY_VERIFICATION_2026-10-13.md) retain the separate evidence for earlier increments.
