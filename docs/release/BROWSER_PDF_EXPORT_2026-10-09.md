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
- Generated PDFs reopen successfully in the PDF library. Tests check all eight region IDs in canonical order, partial scans, photos, descriptors, confirmation state, approximate units, model details, abstention, long-content pagination, unreadable inputs, and cancellation.
- The full JavaScript run passed 644 tests: 24 scripts, 33 contracts, 188 web, and 399 mobile.
- Workspace TypeScript, web ESLint, formatting, and the public-mode production build passed. The build generated 34 routes.
- Frozen installation and the dependency audit passed under the existing audit policy. No new audit exceptions were added. Third-party notices and the SBOM are current.

Tests use a generated solid-color JPEG, not a medical image. Its image and analysis metadata exist only in test code and are never a production fallback.

## Runtime checks still to record

Download a report from the deployed guest scan through the visible action, reopen it, inspect every page, and verify that the scan remains saved after reloading. Check the report controls at a narrow viewport. These checks must be recorded separately from unit tests.

Actual iPhone/Safari file saving, Android/Chrome saving, native reports, and physical-camera journeys remain separate pending checks. A valid PDF does not establish tagged-PDF accessibility or clinical validity.

## Recovery

If this increment breaks reports, revert its focused source commit and push through the existing deployment pipeline. The prior print action and saved encrypted scans remain compatible; no records or keys need to be migrated or deleted. The inference deployment is unchanged.

## API references

- [PDF document creation, image embedding, and saving](https://pdf-lib.js.org/docs/api/classes/pdfdocument)
- [SVG path drawing](https://pdf-lib.js.org/docs/api/classes/pdfpage#drawsvgpath)
- [Font-metric wrapping](https://pdf-lib.js.org/docs/api/classes/pdffont#widthoftextatsize)
- [Download links](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#download)
- [Releasing object URLs](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)
