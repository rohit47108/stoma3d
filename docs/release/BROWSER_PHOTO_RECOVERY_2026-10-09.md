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

Timeout and cancellation coverage above uses controlled browser-API boundary tests. It does not establish a physical-camera check or a live browser fault-injection result.

## Release recovery

If this increment breaks photo preparation, revert its focused source commit through the existing deployment pipeline. No saved records or encryption keys need migration or deletion. The separately deployed inference service remains unchanged.

## API references

- [Image decoding](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode)
- [Canvas JPEG encoding](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
- [File-reader cancellation](https://developer.mozilla.org/en-US/docs/Web/API/FileReader/abort)
- [Abortable application APIs](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal#implementing_an_abortable_api)
