# Browser PDF export — October 9, 2026

## Change

Guest scans now offer **Create PDF report**, followed by **Download PDF**. **Print report** remains available. No account, report server, new environment variable, or stored-data migration is required.

The report uses the current saved scan: region coverage, intake, accepted photos, candidate overlays when present, supported visual descriptors, approximate image-relative area, confirmation status, provenance, uncertainty, limitations, and model versions. Failed or abstained analysis is not presented as a normal finding. Export never creates an observation or substitutes a sample result.

Generation runs locally. PDF code loads only when requested. An in-memory download URL is released when the map closes, the scan changes, or local data is cleared. Cancellation during generation cannot create a late download. An exported file is intentionally a separate, unencrypted copy in the user's files; clearing app data cannot delete that downloaded copy.

## Why this path

The earlier browser report depended on the print dialog. Clicking that action timed out in the in-app browser automation; this does not prove printing fails in every browser. A direct file download gives users another route and allows the saved file itself to be checked.

The existing stack remains in place. `pdf-lib` is pinned at 1.17.1, with five new locked packages and their legal notices. It has no install script and requires no hosted service. This is a mature release, not a claim of recent upstream maintenance.

The two-step action retains a normal download link after asynchronous generation, rather than depending on a browser permitting an automatic download after the original tap. Unsupported PDF text or unreadable saved images produce a retry message; the HTML print path remains available.

## Source checks

- New export tests began with the missing implementation, then passed with the implementation: six PDF-content tests, three cancellation/download-lifetime tests, and one initial-action markup test.
- Generated PDFs reopen successfully in the PDF library. Tests check all eight region IDs, partial scans, photos, descriptors, confirmation state, approximate units, model details, abstention, long-content pagination, unreadable inputs, and cancellation. The implementation iterates the shared canonical region order rather than saved capture order.
- The full JavaScript run passed 644 tests: 24 scripts, 33 contracts, 188 web, and 399 mobile.
- Workspace TypeScript, web ESLint, formatting, and the public-mode production build passed. The build generated 34 routes.
- Frozen installation and the dependency audit passed under the existing audit policy. No new audit exceptions were added. Third-party notices and the SBOM are current.

Tests use a generated solid-color JPEG, not a medical image. Its image and analysis metadata exist only in test code and are never a production fallback.

## Deployed runtime checks

Source `93fdb859e596f28da09df1af50aad3389181ba20` was pushed to the existing repository. Deployment `dpl_DWhaKiZNeTv9na6LyZ6Dzm4PxU9j` reached READY at [its immutable URL](https://stoma3d-67ontlott-rohit-singhs-projects-48f82479.vercel.app), with the public alias [Stoma3D](https://stoma3d.vercel.app/scan).

Reloading the public URL preserved the existing 2/8 scan. **3D Map → Create PDF report → Download PDF** downloaded a real file through the application, without a print-dialog or developer-protocol export. The report reopened as three Letter-size pages, 469,670 bytes, SHA-256 `ca48c850b5e1d273dd3bd3021133cebad07dddd8b8b985886b4aee3927197f76`.

All three pages were rendered and visually inspected. Both saved photos, capture IDs, timestamps, the partial coverage list, original per-capture model versions, and 99%/87% confidence values were present without clipping or overlap. These records had no candidate mask; the report did not invent one. Candidate overlay and long-content paths remain synthetic test coverage, not live findings. Poppler emitted two unavailable display-font warnings, but the rendered Helvetica report showed no missing characters.

At a requested 390-pixel outer viewport, the measured content width was 375 pixels with the scrollbar reserved. Content had no horizontal overflow; both report controls measured 44 CSS pixels high. Tab moved from the download link to the print button with a visible focus ring, and the controls stayed above the bottom navigation. This is a desktop responsive check, not Safari or Android device coverage. The temporary viewport override was reset.

Leaving the map and reopening it offered **Create PDF report** again rather than retaining the prior download control. The saved 2/8 scan remained unchanged; no new photos, observations, pins, or deletions were made in these checks.

Local evidence is ignored by Git:

- `outputs/usability-checks/Stoma3D-browser-report-93fdb85-2026-10-09.pdf`
- `outputs/usability-checks/report-93fdb85-page-1.png` through `page-3.png`
- `outputs/usability-checks/web-report-ready-93fdb85-2026-10-09.png`
- `outputs/usability-checks/web-report-controls-390-93fdb85-2026-10-09.png`

The [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38017267155) and [TypeScript checks](https://github.com/rohit47108/stoma3d/actions/runs/38017267187) both succeeded for this source. TypeScript CI also completed locked installation, contract generation, all JavaScript tests, hosted-mode web lint/build, the dependency audit, Expo public configuration, Android/iOS JavaScript exports, and formatting. Those exports are not installed-device tests.

## Remaining coverage

Actual iPhone/Safari file saving, Android/Chrome saving, native reports, and physical-camera journeys remain separate pending checks. A valid PDF does not establish tagged-PDF accessibility or clinical validity.

## Recovery

If this increment breaks reports, revert its focused source commit and push through the existing deployment pipeline. The prior print action and saved encrypted scans remain compatible; no records or keys need to be migrated or deleted. The inference deployment is unchanged.

## API references

- [PDF document creation, image embedding, and saving](https://pdf-lib.js.org/docs/api/classes/pdfdocument)
- [SVG path drawing](https://pdf-lib.js.org/docs/api/classes/pdfpage#drawsvgpath)
- [Font-metric wrapping](https://pdf-lib.js.org/docs/api/classes/pdffont#widthoftextatsize)
- [Download links](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#download)
- [Releasing object URLs](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)
