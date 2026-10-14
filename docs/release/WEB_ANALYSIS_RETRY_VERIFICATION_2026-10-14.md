# Recovering a dropped analysis connection, October 14, 2026

The browser client now retries one interrupted connection automatically. The deployed WebKit check reproduced the earlier network failure and completed the same analysis without a second Retry click. The change does not retry server errors, cancelled requests, or invalid results.

## Change and source checks

Application commit `a1ff83134248bd01ea5da7a40a144d53012350f0` changes only the guest browser analysis client and its tests. Every attempt uses fresh form data, the same sanitized photo, region, capture ID, request ID, and cancellation signal. The existing 115-second deadline covers both attempts. Successful responses still pass the shared schema, capture identity, region, and provenance checks before saving.

The analysis endpoint saves no server-side captures or jobs. Its retry policy follows the idempotent-resource exception in [HTTP Semantics, section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2). Fresh request bodies follow the [Fetch body documentation](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#setting_a_body). This policy is not applied to account, sharing, or job-creation endpoints.

Ten focused regressions failed before the change. The client then passed 22 tests, with 29 passing client/relay tests. Full checks passed 773 JavaScript tests, 349 Python tests, TypeScript, Prettier, web lint, the public production build, and repository/dependency audits. Python retained the external PostgreSQL skip and existing Starlette warning. Source review found no required correction. No dependency, model, environment, database, stored schema, encryption, deletion, or server-limit change was included.

## Deployed timeout and connection checks

Deployment `dpl_3JrZPQdvYSVHCSKqmXzspGwXo9qL` reached READY and received [the public alias](https://stoma3d.vercel.app). Its [immutable URL](https://stoma3d-4swc6q6i6-rohit-singhs-projects-48f82479.vercel.app) identifies the tested build. [TypeScript CI](https://github.com/rohit47108/stoma3d/actions/runs/38508977709) and [repository safety CI](https://github.com/rohit47108/stoma3d/actions/runs/38508977700) passed.

Browser-only interception held a licensed mouth-only upload until the actual deadline. After timeout, all three engines kept the same photo, showed 0/8, and created no result or pin. Removing interception restored real requests to the deployed service. No successful result was mocked.

In the first simultaneous release run, WebKit reported the same HTTP/2 framing error recorded [before the correction](./BROWSER_ELAPSED_TIMEOUT_VERIFICATION_2026-10-13.md). Its automatic recovery sent the same capture ID and region, received a real complete result, and saved 1/8 after one Retry click. Reload retained that result. The underlying browser transport error remains observable; the client recovers from it rather than changing transport settings.

That simultaneous run is not counted as a three-engine pass. Firefox received a service-unavailable HTTP 503 and retained its photo. Chromium received a real complete result, but its driver failed because Playwright did not expose the streamed upload body. Both original failed records remain available locally.

The follow-up spaced real retries six seconds apart and recorded unavailable body inspection instead of inventing request metadata. All three engines passed:

| Engine                 | Actual deadline | Result after one Retry click   | Reload          |
| ---------------------- | --------------: | ------------------------------ | --------------- |
| Chromium 151.0.7922.34 |       115158 ms | HTTP 200, complete, live model | 1 of 8 captured |
| Firefox 153.0          |       115866 ms | HTTP 200, complete, live model | 1 of 8 captured |
| Windows WebKit 27.2    |       115324 ms | HTTP 200, complete, live model | 1 of 8 captured |

Responses remained no-store, and no page exception occurred. Visual review covered retry results. Chromium did not expose its successful streamed multipart body; response binding remains covered by client/relay regressions. WebKit exposed both transport attempts in the simultaneous run, proving unchanged capture identity during automatic recovery.

## Complete scan checks

One complete uploaded-image scan passed in each of Chromium, Firefox, and Windows WebKit against this deployed application commit. All 24 analysis responses were real, complete, live-model results. The tests reused the eight licensed mouth-only cases; they are not a new patient cohort or physical-camera tests.

Each engine passed empty-map selection, unsupported-file rejection, a distinct decoding-error message, eight-region progression, explicit right-cheek observation confirmation, the interactive 3D map, 7/8 reload and resume, 8/8 completion, history, PDF export, and saved-result reopening. No page exception or console error occurred. Real request starts were spaced six seconds apart; this run does not establish simultaneous-user capacity.

Each PDF contained nine pages. Structural checks matched all 24 capture IDs and three sessions to the recorded results. Visual inspection covered all 27 rendered pages, including region photos, candidate overlays, confirmation labels, model versions, and page footers. No clipped or overlapping text was observed. Photos, PDFs, screenshots, and detailed request records remain in ignored local outputs, not the public repository.

## Scope still open

The owner has authorized simulator-only testing again after the earlier Escape stop. Native repetition, the interrupted Android scan's restart, native accessibility, and physical-phone camera checks remain open. iPhone testing remains deferred. Browser-engine evidence does not establish iPhone Safari or native iOS behavior.
