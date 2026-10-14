# Recovering after a stalled browser analysis, October 13, 2026

The browser app stops waiting after its 115-second deadline and keeps the photo available for retry. Chromium and Firefox completed the first real retry. Windows WebKit reported a connection error on its first retry, then completed the next retry without another upload. This record distinguishes timeout handling from network recovery; it does not establish physical-phone behavior.

The [October 14 retry correction](./WEB_ANALYSIS_RETRY_VERIFICATION_2026-10-14.md) adds one bounded automatic transport recovery. This earlier record describes the behavior before that change.

## Deployed source and test setup

The checks used [the public scan workspace](https://stoma3d.vercel.app/scan) at commit `bf3de22152dda4ce6db7495a16ab7ae2ff24bb58`. Vercel deployment `dpl_8M95Ph6kFjRWkc9Z1TxiRa9o8yho` was READY and owned that alias. Its application source matches the preceding `f75779dcd8ddc70a8079d5a04ee0e91a0872a1a2` release; the intervening commit changed documentation only.

Each isolated browser context uploaded the same licensed top-of-tongue case through the ordinary review screen. A browser-only network interception held the initial analysis request without sending it to the relay. The test supplied no response, mask, score, or analysis result. It used the documented [Playwright route interception](https://playwright.dev/docs/api/class-page#page-route), not a modified application timer or a simulated HTTP 504 response.

After the actual deadline, the test released and removed interception. Retry used the deployed relay and inference service. Screenshots, JSON records, the driver, and licensed images remain in ignored local outputs.

## Timeout and retry results

All three engines kept the identical review image, showed 0/8, enabled Retry, and created neither a result nor an observation pin:

| Engine         | Version       | Observed deadline | Real retry                                           | Saved result after reload |
| -------------- | ------------- | ----------------: | ---------------------------------------------------- | ------------------------- |
| Chromium       | 151.0.7922.34 |         115505 ms | First retry completed                                | 1 of 8 regions captured   |
| Firefox        | 153.0         |         115836 ms | First retry completed                                | 1 of 8 regions captured   |
| Windows WebKit | 27.2          |         115287 ms | First retry had a connection error; second completed | 1 of 8 regions captured   |

The successful responses returned HTTP 200, `status: complete`, `analysisOrigin: live_model`, `region: dorsal_tongue`, and `Cache-Control: private, no-store, max-age=0`. No page exception occurred. Visual review covered timeout and retry screens. Home showed the saved region after reload.

## WebKit connection finding

The Windows WebKit runner reported `Error in the HTTP2 framing layer` on the first retry after the prolonged interception. The failure occurred before an analysis response arrived. The app showed its connection-error message, kept the photo, and still showed 0/8. A second user-triggered retry completed against the real service and saved the region.

The first-retry failure appeared in three isolated runs. Its underlying transport cause remains unresolved. This is not proof of the same behavior in Safari on an iPhone, nor proof that the network issue is fixed. No server limit, signing check, privacy check, or model gate was changed to make the test pass.

The initial Chromium and Firefox drivers checked for the wrong Home label after reload. Home correctly displayed 1 of 8 regions captured; the driver incorrectly expected 1/8. The corrected runs passed. The original failed records remain available locally rather than being counted as complete passes.

## Source and service checks

The repository passed 756 JavaScript tests, 349 Python tests, workspace TypeScript, Prettier, web lint, the public production build, diff checks, and the repository safety audit. Python retained one external PostgreSQL skip and the existing Starlette deprecation warning.

The deployed inference health check reported analysis and privacy ready, required response signing, a loaded release manifest, and disabled demo fixtures. The model-card relay enabled segmentation and anatomy. These service checks do not replace [the full uploaded-image scan checks](./BROWSER_REPEATED_FLOW_VERIFICATION_2026-10-13.md) or physical-device testing.

## Remaining checks

Physical camera behavior, iPhone Safari, native iPhone installation, and repeated Android app flows remain open. [The Android verification record](./ANDROID_FRESH_SCAN_VERIFICATION_2026-10-13.md) separates completed simulator checks from the interrupted second scan. No all-platform completion or release sign-off is claimed.
