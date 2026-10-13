# Android usability verification, October 13, 2026

The Android simulator connection recovered. Saved results, the oral map, PDF export, and a fresh licensed tongue upload were checked through the app interface. This is simulator evidence, not a physical-phone or all-platform release sign-off.

## Tested builds

The first restart and PDF checks used the existing October 10 home-restore x86_64 build (`73f0290`). The History/report increment was delivered in `d6708e4f3c43a0212f6d29818fa4c1655ac18e48`. Its application changes are limited to `timeline.tsx`, `report.tsx`, and `resultCopy.ts`, with focused regression tests.

Both updated release builds succeeded using the existing Windows Android helper. They embed the configured production inference URL. The x86_64 build was installed with `adb install -r`, preserving app data; the ARM64 build was compiled but not run on a physical phone.

| Artifact                                       |     Bytes | SHA-256                                                            |
| ---------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `Stoma3D-2026-10-13-history-report-x86_64.apk` | 102675603 | `587a6e57e712a49830ce6c50e22b17fb15e235df09e45314b6f430adc87472b3` |
| `Stoma3D-2026-10-13-history-report-arm64.apk`  |  98183713 | `f4789b2f72779838e869411cbd674e99470ab49be42d18620f54b5820584c6cb` |

Artifacts remain ignored under `outputs/native`; no APK, photo, or report is added to GitHub. The emulator is `Stoma3D_Verify_20261010`, Google Play API 36.1, x86_64, using its existing saved data. UI actions used the computer-control tool; SDK commands were limited to starting the configured emulator, diagnostics, artifact transfer, and development installation.

## User-visible changes

| Before                                                                             | After                                                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Comparison explanations and a single-point chart appeared before saved photos.     | History opens to saved photos. Tools exposes comparisons, charts, and map-link details; Done returns to the list. |
| Uploaded photos were called live captures and displayed raw analysis-origin codes. | Rows distinguish uploaded, camera, sample, and cached input/output in plain language.                             |
| Several paragraphs and a regeneration button preceded PDF sharing.                 | A ready report offers Export PDF first and Update report second, with one short storage explanation.              |
| Rapid taps could start duplicate generation or export work before rerender.        | A synchronous operation guard blocks duplicate and overlapping work and releases after errors for retry.          |

No persisted-state migration, dependency change, model replacement, or medical-gate change is included. Encryption, deletion, response verification, report contents, and temporary-file cleanup use the existing implementations.

## Runtime checks

- Cold-started the existing emulator and opened the app through its launcher. Home restored the completed scan and recent result.
- Reopened the saved top-of-tongue image and its completed empty-outline result. It was not presented as an all-clear.
- Opened the 8/8 map, rotated it, selected the right-cheek region, and reopened its confirmed observation. Its photo, candidate outline, and approximate 22.9% area matched the report.
- Created a fresh protected PDF from the restored scan at 12:56:56 AM. Android's Print preview opened it as an 11-page document. A uniquely named copy was saved locally and transferred into ignored test outputs.
- Reopened, structurally checked, rendered, and visually inspected all 11 exported pages. All eight region images, candidate overlays, page numbers, model versions, uncertainty text, and page notices were present. No clipping or overlapping footer text was observed. The report SHA-256 is `e606f70324b2db60d986e0b97f44dbdf4f958ad3b4ee279e83fefe24fb4f4f4b`.
- After installing the updated x86_64 app, Home and History still opened the saved records. History began with photos; Tools and Done worked; the existing comparison button remained disabled because the restored records supplied only one scan per region.
- Reopened a saved result from the new History list. The protected report from 12:56:56 AM survived the app update.
- Updated the report through the revised screen, including a rapid double-tap. The UI disabled overlapping actions while creating the PDF and returned to ready at 1:42:38 AM. Export PDF opened the operating-system share sheet; Print reopened an 11-page preview. No cloud recipient was selected. Duplicate-operation counts are covered by focused route tests, not inferred from the preview alone.
- Started a new standard scan using the existing test consent and no-symptoms intake. Camera permission remained unavailable and unchanged. The Android photo picker opened without camera access.
- Selected the permitted top-of-tongue JPEG, confirmed the region/usage permission already authorized for these licensed test inputs, and used the normal review and analysis path. The deployed service returned a completed result dated October 13; the photo was not rejected as blurry. The result correctly showed no candidate outline rather than a fabricated outline or a normal/healthy conclusion.
- Opened that new result on the map. Rendering worked, but the map displayed cumulative 8/8 coverage from the previous scan rather than clearly identifying the active scan's 1/8 progress. This session-context problem is recorded for the next increment, not counted as a passing partial-map check.

The full-page PDF review belongs to the 12:56:56 export; the later updated export was checked in the system preview. These are restored-scan report checks and one fresh upload, not ten fresh eight-region Android scans.

## Automated verification and review

- Focused tests observed the original missing disclosure/actions and duplicate-work failures before the fix, then passed afterward: 22 tests across `resultCopy.test.ts` and `secondaryRoutes.test.ts`.
- Full JavaScript checks: 724 passed (24 scripts, 33 contracts, 443 mobile, 224 web).
- Workspace TypeScript checks, Prettier verification, and `git diff --check` passed.
- Python checks: 349 passed, one external PostgreSQL test skipped, one existing Starlette deprecation warning.
- Both embedded Android release builds passed. No phone installation or runtime result is claimed for ARM64.
- A separate read-only review found no blocking correctness, security, architectural, or test-coverage issue in the five-file native increment. That review did not mount the UI or test a physical device.

The revised wording follows the product's existing design and the selected design/writing guidance. The deployed browser evidence remains in [the October 12 record](./BROWSER_USABILITY_VERIFICATION_2026-10-12.md); no web or inference code changed in this increment.

## Remaining verification

Continue fresh uploads across all eight regions, repeated end-to-end runs, degraded-image and recovery checks, and native accessibility coverage. Camera switching and live capture still need permission and real-device checks. iPhone testing remains deferred by the user; no iOS device, store build, HEIC phone behavior, or physical Android result is claimed here.

## Follow-up: current-scan map context

The cumulative-coverage issue above is corrected in the increment committed with this section. A result opens the map for its own scan. An ordinary map-tab visit opens the active scan. History explicitly exposes the existing cumulative date replay. Photos, pin links, identifiers, mesh/UV metadata, and older scans are not changed.

Result-to-map navigation carries a short-lived event ID, separate from the saved capture ID. The map consumes that event using the documented [Expo Router focus effect](https://docs.expo.dev/versions/latest/sdk/router/#usefocuseffecteffect-do_not_pass_a_second_prop). This prevents retained tab parameters from selecting an old scan forever and supports reopening the same result more than once. Unrelated incoming records do not reset the selected saved scan.

Both final release builds passed and include the configured production inference URL. The intermediate map-scope candidate is superseded by these v2 artifacts:

| Artifact                                     |     Bytes | SHA-256                                                            |
| -------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `Stoma3D-2026-10-13-map-scope-v2-x86_64.apk` | 102677083 | `ae1c0ff04ee6a84fff49f7897eff7c5c7191d9cabf7f1d2754204d56b55862bb` |
| `Stoma3D-2026-10-13-map-scope-v2-arm64.apk`  |  98185193 | `bcbbbd09c0969e468d66a4a49f062786a6267e05109587961058626b12b49b8b` |

The x86_64 v2 build was installed without clearing data. Native interface checks confirmed:

- Home restored the new scan as 1 of 8 with its fresh tongue result.
- Opening the map through the bottom tab showed Current scan, 1/8 coverage, and no pin borrowed from the older scan. The 3D model rendered.
- History showed Across saved scans, cumulative 8/8 coverage, and the older confirmed pin. Previous scan showed the October 10 frame.
- Back to scan restored Current scan and 1/8, hiding that older pin.
- Returning Home kept the unfinished scan available. Continue scan opened Region 2 of 8, the underside of the tongue, rather than retaking the accepted top-of-tongue photo.

Full JavaScript checks passed with 736 tests (24 scripts, 33 contracts, 455 mobile, 224 web). Workspace TypeScript, Prettier, and diff checks passed. The Python recheck passed 349 tests with the same external skip and warning. A separate source review caught the retained-parameter defect in the first candidate; regressions failed before its correction and passed afterward. Re-review found no remaining blocker and independently passed 46 focused tests. The empty-current-scan, repeated same-result request, plain refocus, unrelated-record arrival, and historical pin-cutoff cases are automated route tests, not additional physical-device observations.

`97a9031` completes the prior controlled route-test analysis metadata and checks it against the shared schema; it changes no runtime response or model output. The preceding History/report source passed [TypeScript CI](https://github.com/rohit47108/stoma3d/actions/runs/38353965450) and [repository safety CI](https://github.com/rohit47108/stoma3d/actions/runs/38353965324). CI for the map increment is checked separately after pushing. No web, inference, stored-state, encryption, deletion, or signing implementation changed in the map increment. ARM64 remains build-only evidence.
