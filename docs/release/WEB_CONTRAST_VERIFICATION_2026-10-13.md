# Website contrast verification, October 13, 2026

Two landing-page labels are now readable in both light and dark mode. The scan interface, stored data, inference service, and medical gates are unchanged.

## Finding and correction

Lighthouse 13.5.0 found two contrast failures on the public landing page:

- The illustrated phone kept a light background but inherited light text in dark mode. Its region label measured approximately 1.08:1 contrast.
- Session date and Coverage in the report preview measured approximately 4.34:1 on its dark-mode light-paper surface.

The [WCAG normal-text minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) is 4.5:1. The correction scopes the existing dark ink token to the fixed-light phone preview and uses the existing stronger secondary-text token for report labels. It does not change the site's overall theme or add a new palette.

Both new regression tests failed before the correction. They passed afterward. The full checks passed 750 JavaScript tests, workspace TypeScript, Prettier, web ESLint, the public-mode production build, and 349 Python tests. One external PostgreSQL test was skipped; the existing Starlette warning remains. This increment received source self-review, not a new independent review.

## Deployed release

Application commit: `f1706f973477fa77b9367dc149843a3a20fd5031`, pushed to the existing repository.

READY deployment `dpl_BqUeJ7a7kzVKmrQmwfnx7KGVBHZL` received [the public alias](https://stoma3d.vercel.app). Its [immutable URL](https://stoma3d-f4rplv468-rohit-singhs-projects-48f82479.vercel.app) identifies the build. [TypeScript CI](https://github.com/rohit47108/stoma3d/actions/runs/38457685602) and [repository safety CI](https://github.com/rohit47108/stoma3d/actions/runs/38457685223) succeeded.

Eight deployed browser checks covered light/dark preferences at widths 320, 768, 1024, and 1440 pixels, with reduced motion enabled. They used the shipped stylesheet without local CSS overrides. Phone-label contrast was 14.18:1; report-label contrast was 6.09:1 on white and 5.85:1 on the darker-mode paper. No horizontal overflow or page exception was observed.

Phone and report previews were visually inspected at 320 and 1440 pixels in both themes. Their text remained readable and their layouts intact. Early candidate-stylesheet override runs were not counted as passing production verification.

## Scan-flow recheck after deployment

One fresh eight-region journey passed in each of Chromium, Firefox, and WebKit after this release: 24 real `complete` / `live_model` results using the same approved licensed cases. Each journey retained unsupported/decode rejection, explicit observation confirmation, 7/8 reload and resume, 8/8 completion, interactive 3D, PDF download, and saved-result reopening. There were no page exceptions or console errors. Successful analysis was not mocked, and responses remained no-store.

The three downloaded PDFs reopened as nine-page reports. Their session and capture identifiers were distinct, all eight capture IDs matched the corresponding response records, and all region photos, model versions, and page numbers were present. All 27 rendered pages were visually inspected; no missing images/outlines or clipped content was observed.

## Audit scope and remaining performance work

Three cold Lighthouse mobile audits ran for each of `/` and `/scan` before and after the change, using the same CLI and bundled Chromium. All three post-change landing-page audits scored 100 for automated accessibility, best practices, and SEO. The scan page scored 100 for automated accessibility and best practices. Its SEO score was 63; the scan workspace is intentionally not a search-indexed patient-content page. These automated scores do not establish screen-reader coverage or full accessibility conformance.

This correction is a readability fix, not a performance optimization. The post-change median largest-contentful-paint time was approximately 2.15 seconds for the landing page and 3.04 seconds for the scan home. Footer layout shifts appeared in one of three baseline landing audits and two of three post-change audits. They remain a finding requiring targeted profiling; the change does not claim to fix them. Total-blocking-time lab measurements are not real-user interaction latency.

Local audit JSON, contrast measurements, and preview screenshots remain ignored under `outputs/usability-checks`:

- `lighthouse-mobile-2026-10-13`: baseline audits.
- `lighthouse-mobile-2026-10-13-contrast-release`: audits of this deployed release.
- `browser-landing-contrast-production-2026-10-13`: eight passing checks without overrides and the reviewed screenshots.
- `browser-full-flows-2026-10-13-contrast-release`: passing post-release journeys and reopened/rendered PDFs.

The [repeated scan record](BROWSER_REPEATED_FLOW_VERIFICATION_2026-10-13.md) and [image-quality record](BROWSER_IMAGE_QUALITY_VERIFICATION_2026-10-13.md) document the real analysis path separately. Native repetition/accessibility and deferred iPhone testing remain open.
