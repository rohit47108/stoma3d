# Repeated scan verification, October 13, 2026

Thirty complete browser upload journeys passed against the public Stoma3D website: ten each in Chromium, Firefox, and WebKit. Android photo editing also reached a real result and the correct partial map. These checks do not replace physical-phone or iPhone testing.

## Tested release

Application commit: `b8fede9f464ee6073433185409053730d26c7ad9` in the existing [Stoma3D repository](https://github.com/rohit47108/stoma3d).

The [public website](https://stoma3d.vercel.app) resolved to READY deployment `dpl_5JSuAc8GmgmuvvccDk8K4zzYvt52`, built from that commit. Its [immutable URL](https://stoma3d-crcy3t77l-rohit-singhs-projects-48f82479.vercel.app) identifies the deployment; the tests used the public alias. [TypeScript CI](https://github.com/rohit47108/stoma3d/actions/runs/38386052106) and the [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38386051985) succeeded.

Web source, shared contracts, and the lockfile have no changes between the previously verified `1125d32020cf5afe67bb412b04e822e0f90848a4` and this commit. The later changes concern mobile behavior and verification records. No deployment secrets, models, quality thresholds, request limits, or stored-data formats changed during this test increment.

## Complete browser journeys

Each run used a fresh, isolated guest browser context at 390 × 844 pixels and the same eight approved licensed mouth-only images. The selected passing series contains 30 distinct sessions and 240 distinct captures, not 240 independent images or patients.

| Engine   | Version          | Consecutive complete journeys | Real accepted results | Map |
| -------- | ---------------- | ----------------------------: | --------------------: | --- |
| Chromium | 151.0.7922.34    |                            10 |                    80 | 3D  |
| Firefox  | 153.0            |                            10 |                    80 | 3D  |
| WebKit   | 27.2, build 2374 |                            10 |                    80 | 3D  |

Every journey covered:

- Home and an empty interactive map before capture.
- Consent and brief intake, with no account required.
- Unsupported-file and unreadable-image rejection before analysis.
- Eight ordinary uploads, review, and real inference responses.
- Explicit confirmation of the right-cheek observation.
- Reload at 7/8, reopening from History, and resuming the remaining region.
- An 8/8 map, PDF download, and reopening the saved result after another reload.

All 240 selected responses returned HTTP 200, accepted quality, matching region and capture identifiers, `complete` status, `live_model` provenance, and `Cache-Control: no-store`. No successful analysis was mocked or replaced with a bundled result. The passing journeys recorded no page exceptions or console errors.

### Request-limit finding

The first unpaced batch completed ten Chromium journeys and five Firefox journeys, then received HTTP 429 during Firefox journey six. That attempt remains recorded as failed and is not counted in the passing Firefox series. An early recovery test's live retry also failed during this high-volume period.

The application retains a guest request limit. It was not disabled, enlarged, bypassed with another identity, or changed for testing. A fresh Firefox/WebKit series spaced analysis request starts by six seconds and completed ten consecutive journeys per engine. The ten Chromium journeys come from the original successful series. This records both the failed attempt and the passing rerun; it does not claim every request in every attempt succeeded.

## PDF verification

All 30 downloaded PDFs reopened successfully as nine-page reports. Structural checks covered all 270 pages, all eight region headings and photos per report, page numbering, model versions, live-model provenance, and exact ordered capture-ID agreement with that run's analysis responses. Session and capture identifiers were unique across the selected series.

Runs 1, 5, and 10 from each engine were rendered and visually inspected: nine complete reports, 81 pages. No missing photos/outlines, clipped content, overlapping headings, or obscured footers were observed in those pages. The other 21 reports passed structural checks but were not individually visually reviewed.

## Recovery and local deletion

Fresh isolated contexts passed seven checks in each engine:

1. Controlled HTTP 503: keep the photo, enable retry, and leave coverage/results/pins unchanged.
2. Controlled HTTP 429: the same recoverable behavior.
3. Controlled HTTP 504 timeout response: the same recoverable behavior.
4. Malformed HTTP 200 analysis data: reject it without creating a completed result or pin.
5. Browser offline mode: keep the same selected photo through the network failure.
6. Restore connectivity and retry: receive a real `complete` / `live_model` result without selecting the photo again.
7. Delete only that isolated test scan through the app: History stays empty after reload.

All three live retries passed, with no page exceptions. These add three real analysis requests beyond the repeated series. Fault responses were injected only into the isolated test browser, not into the deployed service. The controlled 504 check tests the displayed error and retained-photo behavior, not the full elapsed client/server timeout. The malformed-response check does not establish end-to-end signature-tampering coverage by itself. User browser, cloud, and native scans were not deleted.

## Android photo-editing check

The installed x86_64 release is the build documented in [the fresh Android scan record](ANDROID_FRESH_SCAN_VERIFICATION_2026-10-13.md). Existing saved scans were preserved.

A separate new scan used the ordinary Android photo picker. Cancelling the picker returned to capture without an error and allowed reopening it. The selected top-of-tongue photo was rotated 90 degrees and rechecked. Cancelling the crop kept that rotated candidate unchanged. Reopening the crop, enlarging its box, dragging it, and applying it produced a tissue-only crop and another photo check.

After review, the edited upload reached the deployed analysis service and showed a completed top-of-tongue result with no candidate outlined. Its map showed the correct current scan at 1/8, without borrowing completed coverage or pins from older scans. This is one edited upload and a partial scan, not another complete eight-region journey or a live-camera check.

## Evidence and remaining coverage

Licensed images, test identifiers, screenshots, reports, and generated scripts remain ignored under `outputs/usability-checks`, outside Git:

- `browser-repeated-flows-2026-10-13`: ten selected Chromium successes and the original request-limit failure.
- `browser-repeated-flows-2026-10-13-paced`: ten Firefox and ten WebKit successes; all 30 reopened/rendered report checks.
- `browser-recovery-2026-10-13-v2-{chromium,firefox,webkit}`: passing recovery and isolated deletion records.
- `browser-recovery-2026-10-13-chromium`: preserved unsuccessful early live retry.

The WebKit runner is the isolated build already described in [the browser usability record](BROWSER_USABILITY_VERIFICATION_2026-10-12.md); application dependencies did not change. Windows WebKit is not iPhone Safari.

The preceding application commit passed 748 JavaScript tests, workspace TypeScript, Prettier, and 349 Python tests, with one external PostgreSQL skip. This increment changes no application source. Physical front/back camera checks, actual phone permissions/interruption, phone HEIC-library handling, screen readers, ten repeated native journeys, and the deferred iPhone build/tests remain separate requirements. These results do not claim clinical accuracy or final all-platform release approval.
