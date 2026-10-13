# Browser image-quality verification, October 13, 2026

Fifty deliberately degraded uploads were rejected with useful correction messages. Ten clear replacements then reached real results, the partial 3D map, and saved History. This tests the browser upload path, not physical camera performance or clinical accuracy.

## Release and inputs

Tests used [the public Stoma3D website](https://stoma3d.vercel.app) at application commit `aa296f5ad656e383939a9ef2ecf4cb5b7f177f55`. READY deployment `dpl_FasagXGTHhUU3yRNH1S6zoMW5ouv` had that commit and the public alias; its [immutable URL](https://stoma3d-8azwfxycs-rohit-singhs-projects-48f82479.vercel.app) identifies the build. That commit only documents the earlier browser runs; web application code is unchanged from `b8fede9f464ee6073433185409053730d26c7ad9`.

Five deterministic controls were generated from each of the eight approved licensed, mouth-only test photos: Gaussian blur with radius 24, 5% brightness, 95% white blending, a white band covering one quarter of the image, and a 64 × 64-pixel image. They were encoded as JPEGs without EXIF and kept outside Git. These transformations reproduce obvious quality failures; they do not establish false-acceptance or false-rejection rates for a patient or device population.

Chromium 151.0.7922.34 covered all eight regions. Firefox 153.0 and Windows WebKit 27.2/build 2374 each repeated the five top-of-tongue controls and clear replacement. Each region/engine combination had its own isolated guest session at 390 × 844 pixels.

## Observed behavior

All 50 degraded cases returned an actual HTTP 200 analysis response with rejected quality, non-complete status, no candidate mask, no descriptors, and `Cache-Control: no-store`. The expected quality reason was present in every case. Responses were not mocked.

| Control        | Visible correction                                      |
| -------------- | ------------------------------------------------------- |
| Severe blur    | The photo is out of focus. Hold still and take another. |
| Dark           | Use even lighting and try another photo.                |
| Overexposed    | Move away from direct light and try another photo.      |
| Heavy glare    | Move away from direct light and try another photo.      |
| Low resolution | Choose a higher-resolution photo or take a new one.     |

Overexposed cases also exceeded the glare threshold, so the glare instruction took priority over the lighting instruction. Tiny cases also reported that the face check could not run; the app correctly asked for a higher-resolution photo rather than presenting that as a detected face or a blur measurement.

After each rejection, the review image stayed unchanged, retry remained enabled, coverage stayed at 0/8, and no analyzed-image or observation-confirmation control appeared. Choose another returned to capture with the same selected region.

After five rejected candidates, the original clear photo completed real analysis in every session: ten `complete` / `live_model` results with accepted quality and matching region. Coverage advanced to 1/8. The linked partial map exposed the matching result, and History still showed exactly one covered region after reload. No page exceptions were recorded in any of the ten passing sessions.

The passing run made 60 analysis requests, spaced by at least six seconds between starts. Request limits, model gates, quality thresholds, privacy checks, encryption, deletion, and response verification were not weakened or changed.

## Test-runner correction and evidence

The initial attempt stopped after the first blur response because an unscoped alert selector also matched Next.js's empty route announcer. The photo was correctly rejected. The selector was scoped to the main content; the original failed record was preserved rather than overwritten.

Ignored local evidence under `outputs/usability-checks`:

- `approved-degraded-inputs-2026-10-13`: generated controls and their checksum manifest.
- `browser-quality-controls-2026-10-13`: preserved selector failure.
- `browser-quality-controls-2026-10-13-v2`: all 60 passing checks and correction-screen images.

The [repeated-flow record](BROWSER_REPEATED_FLOW_VERIFICATION_2026-10-13.md) covers complete scans, reports, and retry/deletion separately. The [Android fresh-scan record](ANDROID_FRESH_SCAN_VERIFICATION_2026-10-13.md) covers native uploads and reports. Full-face/privacy-service controls, phone permissions, camera switching, native degraded-image journeys, screen readers, and deferred iPhone testing are not established by this browser-quality run.
