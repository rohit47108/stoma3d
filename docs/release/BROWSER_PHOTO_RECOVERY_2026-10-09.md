# Recover from interrupted browser photo preparation

This record covers browser upload, capture preparation, crop, and rotation recovery from the [approved usability plan](USABILITY_VERIFICATION_2026-10-01.md). It records source checks separately from browser and physical-device checks.

## Prevent stalled photo preparation

Image decoding, JPEG encoding, and file reading now have a 20-second timeout per asynchronous step. A stalled step returns “Preparing this photo took too long. Try again or choose another.” It does not return an empty image, a blur score, or substitute analysis.

Camera preparation and uploads pass a cancellation signal through those steps. Closing the capture screen or hiding its tab cancels the wait. Synchronous action guards prevent a second preparation from starting before React updates the disabled controls.

Closing photo review cancels an unfinished crop or rotation. A failed edit leaves the original reviewed photo available. Late callbacks cannot publish a replacement photo or clear a newer preparation attempt.

Cleanup releases temporary image URLs, failed image sources, file-reader handlers, timers, and canvas pixels. Canvas cleanup also runs when drawing or context initialization fails. Browser decoding and canvas encoding do not expose native cancellation APIs; the application cancels its wait and discards late callbacks.

## Keep existing scan protections

This increment changes no stored schema, scan identifiers, acceptance thresholds, backend endpoints, signing keys, model artifacts, or persistence rules. Images still pass through orientation-aware canvas re-encoding before analysis. Response verification, encrypted storage, deletion, and explicit observation confirmation remain unchanged.

## Source verification

The regression suite checks the following:

- Stalled decoding, encoding, and reading
- Immediate cancellation and already-cancelled work
- Ignoring late successful callbacks after timeout or cancellation
- Releasing image URLs, readers, event handlers, timers, and canvas pixels
- Preserving explicit processing errors instead of reporting blur
- Successful resizing and JPEG preparation
- Existing format and decoded-size error handling

Five timeout/cancellation tests failed against the previous implementation before the fix. Two additional tests exposed uncleared canvas pixels on context and drawing failures. All 14 photo-processing tests then passed, including the three existing decoding tests. The combined photo and camera-lifecycle run passed 27 tests.

The full JavaScript run passed 655 tests: 24 scripts, 33 contracts, 199 web, and 399 mobile. Workspace TypeScript, web ESLint, formatting, the repository safety audit, and the public-mode production build passed. The build generated 34 routes. The dependency audit passed under the existing policy; no dependencies or audit exceptions changed.

Frozen Python test setup and the full service/ML suite passed: 348 tests, with PostgreSQL and optional PyTorch checks skipped. The test client emitted its existing Starlette/httpx deprecation warning. After that run, the same 130 locked research packages were restored; no lockfile changed. The launcher lacks a registered Python 3.12 runtime, so uv used the existing Python 3.12.14 environment through the available Python 3.13 launcher.

The metrics suite then passed all ten tests with PyTorch available, including its earlier skipped check. Ruff passed across all Python services and ML code. PostgreSQL integration remains a separate CI check.

## Local browser verification

The existing application ran in a separate localhost tab with a fresh guest scan. An unreadable JPEG produced a file-reading error, not blur, and left photo selection available. Choosing the repository’s non-medical PNG icon then opened photo review as a 1254 × 1254 re-encoded JPEG.

A 16% side crop produced an 853 × 1254 photo. Rotation produced a 1254 × 853 photo. Keyboard input changed the crop control, and both edits reset the crop sliders. Browser console inspection found no warnings or errors.

Returning home and resuming kept the scan at 0/8 and returned to capture without saving the reviewed icon. No analysis request, result, observation pin, production-record deletion, or medical-image transmission occurred. This verifies the preparation interface, not anatomy or segmentation performance.

These ignored local screenshots record the browser checks:

- `outputs/usability-checks/web-photo-decode-error-2026-10-09.png`
- `outputs/usability-checks/web-photo-crop-rotate-2026-10-09.png`

### Local browser fault-injection checks

After explicit user approval, a separate localhost tab temporarily stalled `Image.decode`, `canvas.toBlob`, and `FileReader.readAsDataURL`. Each stalled upload reached the timeout message and re-enabled camera and photo-selection controls. Late completions did not open photo review or replace that error.

Leaving capture during a second stalled decode returned home at 0/8. Releasing its callback did not change the screen or save the icon. The timed-out encoder's temporary canvas had zero width and height, and the timed-out reader's load, error, and abort handlers were cleared.

A normal upload then reached photo review again. Stalling rotation produced the timeout message while retaining the exact original photo and restoring edit controls. Leaving review during another stalled rotation discarded the edit; both abandoned canvases had zero dimensions, and late callbacks did not leave home or add a saved capture.

All three native browser methods were restored, the temporary test state was removed, and the localhost tab and development server were closed. Browser console inspection found no warnings or errors. No analysis was submitted, no medical image was transmitted, and the local scan remained at 0/8. These checks verify browser recovery, not physical-camera behavior.

Additional ignored screenshots:

- `outputs/usability-checks/web-photo-timeout-local-8c38426-2026-10-09.png`
- `outputs/usability-checks/web-photo-edit-timeout-local-8c38426-2026-10-09.png`

## Published website verification

Source commit `8c384261091f09994220c9af7edcb478d4502c8f` deployed successfully as Vercel deployment `dpl_2y8ZfKVwdXDtVfTvke3airnenaLY`. GitHub TypeScript checks and the repository safety audit both completed successfully for that exact commit.

On [the public scan page](https://stoma3d.vercel.app/scan), the existing 2/8 scan resumed at the left cheek. An unreadable JPEG produced the accurate file-reading message and left selection available. The non-medical repository icon opened review as a 1254 × 1254 JPEG; a 1% side crop produced 1229 × 1254, and rotation produced 1254 × 1229. Returning home kept the original 2/8 scan and recent result unchanged.

The map rendered with those same two accepted regions. Selecting the tongue underside opened its existing result, including its original timestamp, 87% confidence, live-model provenance, and deployed anatomy and segmentation versions. No new analysis, observation, or deletion was performed. Console inspection found no warnings or errors.

Ignored production screenshots:

- `outputs/usability-checks/web-photo-error-published-8c38426-2026-10-09.png`
- `outputs/usability-checks/web-map-preserved-published-8c38426-2026-10-09.png`

The full usability plan remains open: physical iPhone and Android camera checks, an installed iPhone build, and the specified repeated complete flows are not established by these browser checks. This increment does not change the previously prepared native builds or the inference deployment.

## Release recovery

If this increment breaks photo preparation, revert its focused source commit through the existing deployment pipeline. No saved records or encryption keys need migration or deletion. The separately deployed inference service remains unchanged.

## API references

- [Image decoding](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode)
- [Canvas JPEG encoding](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
- [File-reader cancellation](https://developer.mozilla.org/en-US/docs/Web/API/FileReader/abort)
- [Abortable application APIs](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal#implementing_an_abortable_api)
