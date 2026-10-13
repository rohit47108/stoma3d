# Browser usability verification, October 12, 2026

Real uploads and the revised scan controls passed the deployed browser checks below. This is browser evidence, not final all-platform release approval.

## Tested release

Application source: `1125d32020cf5afe67bb412b04e822e0f90848a4` in the existing [Stoma3D repository](https://github.com/rohit47108/stoma3d).

Production deployment `dpl_253hCrQvChNSTdVuntM4Qdaawbek` reached READY and received the [public alias](https://stoma3d.vercel.app). Its [immutable URL](https://stoma3d-qxt0gos22-rohit-singhs-projects-48f82479.vercel.app) identifies the tested build. [TypeScript CI](https://github.com/rohit47108/stoma3d/actions/runs/38211750730) and the [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38211750661) both succeeded.

Two focused changes addressed observed failures:

- `e638770`: let progress wrap below long headings; measure the bottom navigation when text size changes; place expanded map-rotation controls above the complete zoom-control group.
- `1125d32`: bring keyboard-focused controls above the bottom navigation when a browser's own focus scrolling ignores CSS scroll padding. Pointer-focused buttons do not move during a click; desktop content beside the sidebar is not scrolled.

The implementation uses documented [ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver), [focus-visible](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible), and [scrollIntoView](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView) behavior. Regression tests failed before the relevant fixes and passed afterward.

Contracts, stored-data formats, encryption, deletion, response signatures, medical release gates, application dependencies, and the inference deployment are unchanged. No migration or model replacement was needed. The preceding READY deployment, `dpl_2h3rYyp7aB4e4XMXuhkiFpRP1gUU`, remains the rollback reference for the keyboard-only correction.

## Real scan journeys

Fresh, isolated browser sessions at 390 × 844 pixels completed the full guest flow:

| Engine   | Version          | Accepted live results | Map | Runtime/console errors |
| -------- | ---------------- | --------------------: | --- | ---------------------: |
| Chromium | 151.0.7922.34    |                   8/8 | 3D  |                      0 |
| Firefox  | 153.0            |                   8/8 | 3D  |                      0 |
| WebKit   | 27.2, build 2374 |                   8/8 | 3D  |                      0 |

Each journey covered Home, consent, symptom intake, unsupported/unreadable file rejection, eight permitted uploads, photo review, real analysis, explicit observation confirmation, 7/8 reload and resume, completion, PDF download, and reopening the saved scan from History. Analysis responses had accepted quality, matching regions, distinct capture IDs, `complete` status, `live_model` provenance, and `Cache-Control: no-store`. No successful response was mocked or replaced with a fixture.

These were 24 requests using the same eight approved licensed images, not 24 independent images or patients. They test the application path, not clinical accuracy. Earlier consecutive browser journeys and service/privacy checks are recorded in [the October 10 record](REAL_IMAGE_FLOW_VERIFICATION_2026-10-10.md) and [the October 11 record](BROWSER_ENGINE_VERIFICATION_2026-10-11.md).

All three downloaded PDFs reopened as nine-page reports. Checks found three distinct sessions, 24 distinct captures, all eight region pages and images, deployed model versions, live-model provenance, and page numbering. All 27 pages were rendered and visually inspected; no clipped content, overlapping headings/footers, or missing photos/outlines were observed.

## Keyboard and layout checks

The deployed application passed 150 checks: ten screens, five layout modes, and three browser engines. Screens covered Home, consent, symptoms, duration/change, capture, expanded photo tools, expanded result details, the partial map, expanded rotation controls, and History.

Modes were 320-pixel normal text, 1280-pixel normal text, doubled text at 390 and 1280 pixels, and forced colors at 390 pixels. Doubled text was a controlled computed-font-size stress test, not OS text-size, browser zoom, or a claim of accessibility conformance. Reduced-motion preference was enabled throughout.

The checks found one visible main heading, no horizontal overflow, and primary buttons/summaries at least 44 CSS pixels wide and tall. Actual Tab events at narrow and doubled-text sizes kept control centers visible above the navigation. Actual arrow keys, rotation buttons, and pointer dragging changed the rendered map. A further real right-cheek analysis in each engine verified photo-outline toggling, explicit pin confirmation, and the linked partial result/map. No local stylesheet or focus-handler override was present in these passing production runs.

All ten primary screens were also visually inspected at phone and desktop widths. Expanded tools and result details can require vertical scrolling. Full-page screenshot stitching can place a fixed navigation bar across later content; viewport hit tests were used to check actual keyboard-control visibility.

## Test-runner finding

The original Windows WebKit runner produced blank map screenshots after resizing. Readback showed that the WebGL context remained healthy and still rendered the map. The same behavior is documented in [Playwright issue 42885](https://github.com/microsoft/playwright/issues/42885) and [its regression-test change](https://github.com/microsoft/playwright/pull/43085).

An isolated, ignored verification runtime used `playwright@1.65.0-alpha-2026-10-12` with WebKit build 2374. The identical deployed map then remained visible through repeated resizes and rotations. No rendering workaround, preserved drawing buffer, or application dependency upgrade was shipped. Chromium and Firefox used the original bundled runner.

WebKit on Windows does not establish native Safari or iPhone behavior; [Playwright's browser guidance](https://playwright.dev/docs/browsers#webkit) distinguishes platform-dependent coverage.

## Repository checks and remaining work

- 708 JavaScript tests passed: scripts 24, contracts 33, mobile 427, web 224.
- Workspace TypeScript, Prettier, web ESLint, and the public-mode production build passed.
- Python service/ML tests passed 349 checks; one external PostgreSQL test was skipped, and the known Starlette deprecation warning remains.
- These corrections received a source self-review. An independent review attempt did not complete; none is claimed for this increment.

Physical camera switching, phone permissions/interruption, actual phone HEIC-library handling, screen readers, native repeated journeys, and iPhone builds/testing remain separate release requirements. The owner deferred iPhone/Expo setup. The Android computer-control connection recovered on October 13; native testing resumed without clearing saved scans. Its outcomes will be recorded separately rather than inferred from these browser checks.

## Local evidence

Licensed photos, reports, capture identifiers, screenshots, and generated verification files stay in ignored `outputs/usability-checks`, outside Git:

- `browser-full-flows-2026-10-12-v2`: passing deployed journeys and reopened/rendered PDFs
- `browser-accessibility-layout-{chromium,firefox,webkit}-2026-10-12-production-v3`: passing deployed layout, keyboard, real-result, and map-control checks
- `map-rendering-diagnostic-webkit-production-2026-10-12-v4`: unchanged application tested with the corrected WebKit runner

Earlier failed runs and candidate-only runs remain separate. They were not overwritten or counted as passing production checks.
