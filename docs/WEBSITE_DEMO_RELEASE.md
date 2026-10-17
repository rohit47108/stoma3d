# Website demo verification

The recording flow is deployed at [Stoma3D](https://stoma3d.vercel.app/). The root opens the scan workspace directly. Legacy `/scan` links redirect to `/`.

## Verified release

- Functional commit: `c856b75aa4aea1941e85fcbeaa4fda2b0a466b10`
- Production deployment: `dpl_4CuH3WpikABKzFXoTewnf1obot74`
- Verified October 17, 2026 against the public HTTPS URL
- Subsequent documentation and verification-script edits do not change the app bundle

## Browser results

Six fresh browser contexts passed the complete tour: Chromium, Firefox, and WebKit, each at 390px and 1440px widths. All six rendered the interactive 3D map. No browser runtime errors occurred.

Checks covered every canonical region, photo review, outline visibility, map zoom and keyboard rotation, region selection, history, confirmed comparison, slider use, on-page report, print visibility, and PDF download. Back, Skip, Restart, chapter jumps, and the final screen passed. The URL remained `/`.

The sample tour made zero scan API calls and added no real scan records. An additional controlled upload-error check retained the photo and real unfinished session. Restarting the tour did not remove that session.

A separate permitted-image regression test completed actual deployed analysis with `analysisOrigin: live_model`. Controlled service errors, rate limiting, timeout, malformed responses, and offline mode retained the photo without adding coverage or substituting sample output. Deletion of that isolated test scan remained effective after reload. Test images stay outside Git.

## Repository checks

- 822 JavaScript tests passed: 24 script, 33 contract, 505 existing mobile-unit, and 260 web tests
- All workspace TypeScript checks passed
- Website ESLint and production build passed
- Repository Prettier and asset-provenance audit passed
- 349 Python tests passed; one PostgreSQL-dependent test skipped
- Python emitted an existing Starlette/httpx deprecation warning

No native build, Android simulator work, or physical-phone camera testing formed part of this website release.

## Prepared versus real

The tour uses an AI-generated eight-region image atlas and authored observation values. Its comparison uses one image with two example outlines, not two patient photographs. Labels and the sample PDF identify that provenance. The tour never supplies fallback output to real scanning.

Camera/upload, encrypted browser storage, signed-response verification, and deletion remain on the real scan path. No real-scan storage schema, research gate, inference model, or deployment signing key changed.

## Recording considerations

Use the on-page report for the video. The embedded testing browser blocks opening PDF tabs; PDF download and on-page print visibility were verified. The public HTTPS flow passed WebKit; production builds served locally over HTTP intentionally encounter the HTTPS-upgrade policy, which was not weakened.

Load the tour once before a take, then choose Restart. If WebGL fails on another device, the region diagram remains available. Browser-emulated phone layouts do not establish physical-phone camera performance. No blocking issue remained in the tested recording flow.

The script and checklist are in [Record the Stoma3D demo](RECORDING.md). Local screenshots, downloaded sample PDFs, and machine-readable results are under ignored `outputs/website-demo-production-final/` and `outputs/website-demo-live-regression/`.

## Rollback

The prior production deployment is `dpl_C5d5AzW8GmzxUEBaD8pBm1xkH7iS` at commit `a25a075`. If root navigation, sample separation, or stored-scan access breaks, restore that deployment through Vercel and investigate before promoting another build. No data migration or key rotation is required for this UI rollback. That rollback restores the old landing page, so use it only for a release-blocking regression.
