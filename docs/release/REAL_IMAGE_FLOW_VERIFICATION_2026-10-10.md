# Real-image scan checks, October 10, 2026

This reference records the approved usability plan’s scan tests, Android corrections, and build artifacts. The website completed ten consecutive eight-region upload scans. Android and physical-phone coverage remain separate; this is not a final release sign-off or a clinical evaluation.

## Tested source and deployment

The latest software source is `f8ce5ff6a2d911b8b7aa32bcf430aa511494dacd` in the existing [Stoma3D repository](https://github.com/rohit47108/stoma3d). It corrects native report layout after the report timeout recovery in `c53cd514dd247f171f9fb95aaf1a982d52369432` and picker correction in `9028e40539cac09d32fb60f28779601329d1a731`. Public contracts, stored-data schema, encryption, signing, analysis gates, and inference deployment are unchanged.

The production website deployment `dpl_d983HvamsvKa7FHL3xZesh6WfLt3` is READY for `c53cd51`. Its [immutable deployment](https://stoma3d-bjvzsxoh3-rohit-singhs-projects-48f82479.vercel.app) serves the [public scan workspace](https://stoma3d.vercel.app/scan). The repeated browser series began on `07a5f6d516502c1a62c0c1007effd0f38668ebfe` and continued on `9028e40`, with reloads between scans. Web implementation code did not change between these commits and `c53cd51`. The recorded ten-flow series is not a new UI exercise on the later deployment.

Both [TypeScript checks](https://github.com/rohit47108/stoma3d/actions/runs/38051687968) and the [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38051687953) succeeded for `c53cd51`.

The later `f8ce5ff` production deployment `dpl_4bfBMUwNVj7Z6At6JemQmd9VQQSv` reached READY at its [immutable URL](https://stoma3d-qhc8qni87-rohit-singhs-projects-48f82479.vercel.app). Its [TypeScript checks](https://github.com/rohit47108/stoma3d/actions/runs/38081965637) and [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38081965657) succeeded. This increment changes native reports, not the web scan implementation; no new browser journey is attributed to this deployment.

The analysis service retains release `stoma3d-anatomy-resize-release-2026-10-09`. The tested results record anatomy `smart-om-mobilenetv3-pillow-2026.10.09` and segmentation `smart-om-autooral-unetplusplus-b4-2026.07.28`. The existing signature key and private model bundle remain in place. No inference redeployment was needed for the picker correction.

## Ten consecutive browser scans

The owner approved sending sanitized copies of the licensed mouth-only test photos to the existing Stoma3D inference service. Inputs come from the controlled SMART-OM validation inventory, under its recorded CC BY 4.0 license. Source files, identifiers, generated reports, and screenshots remain outside Git.

Each of ten fresh guest sessions completed this sequence:

1. Home, consent, and no-symptom intake
2. Eight uploads in canonical region order, with photo review and confirmation
3. Eight complete live-model results through the signed-response path
4. The completed map with eight accepted regions
5. Local PDF generation and direct download
6. Reload, then reopening the saved 8/8 session

The ten reports contain ten distinct session IDs and 80 distinct capture IDs. The same eight permitted inputs were reused across the series. These checks establish repeatability for those inputs, not performance across 80 independent images or patients. They test uploads, not camera frames.

Candidate outputs remained consistent across the series: right cheek approximately 22.9%, lower lip approximately 11.3%, and upper arch approximately 2.0% of the image. The other five regions had no thresholded candidate area. No candidate in these ten sessions was confirmed, so none became a map pin. No failed request received a fixture result.

All ten downloaded reports reopen as nine-page PDFs. Automated inspection checked eight region headings, eight images, eight complete live-model provenance entries, model versions, coverage, and page numbers in each report. All 90 pages were rendered and visually inspected, with no observed clipping, overlap, or missing photo/overlay content. Files are `outputs/usability-checks/fresh-complete-scan-{1..10}-2026-10-10.pdf`; rendering directories and the verification helper are ignored local artifacts.

An additional interrupted session, started October 5, resumed from 2/8 to 8/8. Its earlier captures retained their original timestamps and model versions. Explicit right-cheek confirmation added one pin; unconfirmed candidates did not. Its downloaded nine-page report also reopened and passed visual inspection. This resumed session is not part of the ten fresh-scan count.

The final production reload retained all eleven completed sessions in History. A saved right-cheek result reopened with its mask, 22.9% approximate area, live-model provenance, and released model versions. The latest completed map rendered all eight accepted regions. No browser warning or error entries were observed in the final check. Screenshot: `outputs/usability-checks/web-ten-scan-map-9028e40-2026-10-10.png`.

## Live-service image controls

A direct service probe checked eight approved images and seven derived versions of each, plus one unreadable JPEG. Each response passed signature verification against its original bytes and the shared response schema. Appending a byte to each response failed verification. Health and model-card responses confirmed the existing release, enabled anatomy/segmentation heads, and disabled fixture fallback.

| Input case                                                | Checked | Observed outcome                                                           |
| --------------------------------------------------------- | ------: | -------------------------------------------------------------------------- |
| Clear mouth-only image                                    |       8 | Eight complete live-model results                                          |
| Crop retaining the central 90% of width and height        |       8 | Eight complete live-model results                                          |
| Image rotated 90 degrees                                  |       8 | Four complete results; four anatomy mismatches with no mask or descriptors |
| Severe blur                                               |       8 | Eight abstentions with a blur reason and no mask or descriptors            |
| Dark image                                                |       8 | Eight abstentions with a lighting reason and no mask or descriptors        |
| Overexposed image                                         |       8 | Eight abstentions with a lighting reason and no mask or descriptors        |
| White glare patch covering about one quarter of the image |       8 | Eight abstentions with a glare reason and no mask or descriptors           |
| 64 × 64 pixel image                                       |       8 | Eight abstentions with a size reason and no mask or descriptors            |
| Unreadable JPEG                                           |       1 | Signed HTTP 422 `invalid_image` error                                      |

The total is 65 image checks: 20 complete, 40 abstained, four unsupported, and one decode error. All clear and cropped inputs completed, including both tongue regions. Rotated left cheek, right cheek, upper lip, and upper arch failed anatomy validation; they were not counted as accepted captures. These results do not establish rotation-invariant segmentation. The interface’s rotation correction still needs device verification.

No result used a cached or manual fixture, and no disabled research head returned output. All transmitted image copies were re-encoded without EXIF metadata. Derived images stayed in memory; the probe saved only case names, canonical regions, statuses, and check outcomes in the ignored `outputs/usability-checks/live-image-controls-2026-10-10.json`. This checks service behavior, not UI recovery, saved-scan state, camera behavior, or patient-level accuracy.

## Android picker correction

The installed app reproduced a false departure warning after selecting a photo: the review image remained available, but the screen said it had been cleared. Android’s system picker can temporarily background the app; [React Native’s AppState documentation](https://reactnative.dev/docs/0.86/appstate#app-states) describes this temporary Activity behavior.

The correction distinguishes waiting for the picker from preparing a returned image. Opening or cancelling an empty picker no longer implies a lost review. Successful new preparation clears an earlier departure notice. Backgrounding during post-picker preparation still cancels the work, removes temporary data, and rejects its late result.

Four new regression cases cover selected and cancelled picker returns, replacement after a legitimate departure warning, and interruption during deferred sanitization. Tests reproduced the failures before the correction passed. Independent source review identified an overly broad initial suppression; the final code narrows it to the picker-wait phase.

The original emulator lacked room for the updated package. The approved cache trim did not free enough space, and installation failed with insufficient storage. No existing app data was erased or uninstalled. A separate API 36.1 x86_64 emulator received the test package and permitted test inputs.

The October 10 package installed successfully over the October 9 package on that isolated emulator. Home retained its existing 1/8 scan, and Continue opened the next unfinished region. Picker selection returned a clean review; cancelling an empty picker returned usable capture controls without a false warning.

The resumed native scan completed all eight regions with real analysis. Seven uploads ran through the updated package; its previously accepted tongue-top image survived the update. Explicit confirmation saved the right-cheek pin. Lower-lip and upper-arch candidates remained unconfirmed. The completed 3D map rendered at 8/8 with one pin; rotation and zoom controls changed its view. History reopened the saved captures and linked observation. Screenshot: `outputs/usability-checks/android-complete-map-9028e40-2026-10-10.png`. PDF generation and restart checks subsequently ran on the installed `c53cd51` update, as recorded below. This is one resumed emulator scan, not ten fresh native scans or a physical-camera test.

## Native report timeout recovery

Source `c53cd514dd247f171f9fb95aaf1a982d52369432` fixes temporary report cleanup. The previous renderer deadline rejected the request without cancelling native PDF creation. A renderer finishing later could leave an unencrypted file outside the application’s temporary-file sweep.

The correction deletes late outputs, retries a transient deletion failure once, and records persistent cleanup failure without file paths or report content. Startup and background sweeps recover abandoned files in Expo Print’s cache directory. Active rendering and encryption leases protect in-use PDFs, including a renderer still running after its deadline. Cleanup validates filenames and deletes enumerated files rather than recursively deleting a live directory.

Nine regression tests cover on-time encryption and cleanup, late completion, transient and persistent deletion failures, recovery, active rendering/encryption, overlapping cleanup, and invalid paths. The original late-output test and three cleanup-failure tests failed before their corrections. A concurrent sweep/render test also reproduced a deletion race before the final fix. Independent source review approved the correction.

This source passed 679 JavaScript tests, full TypeScript and formatting checks, web lint, the existing dependency audit, and the repository safety audit. Python checks passed 349 tests with the same external database test skipped locally. Native rebuild and installed-report checks are recorded separately from those source checks.

Installing the report-recovery build initially stalled because Android’s package service returned `DEAD_OBJECT`; the simulator had 5.5 GB free. The stalled installation client was cancelled. The owner approved restarting only the simulator, preserving saved data. Its ordinary restart command also stalled, so the emulator was closed through its console and reopened with the same data directory, without a wipe or snapshot restore. The owner stopped computer testing with Escape, then explicitly approved resuming simulator testing.

The `c53cd51` update then installed successfully without clearing app data. The installed base APK's SHA-256 matched the saved x86_64 package. History reopened the protected tongue-top photo and its original result. The existing 8/8 session generated a protected report at 3:32:38 PM on October 10. The Android share sheet opened its temporary PDF, and the local print dialog saved an 18-page copy. The ignored export is `outputs/usability-checks/android-report-c53cd51-2026-10-10.pdf`, 1,061,926 bytes.

After stopping and relaunching only the app process, Home retained the recent lower-arch result. Its protected photo and analysis reopened. The report reopened with the same 3:32:38 PM timestamp, without regeneration, and sharing it again opened the same 18-page print preview with 8/8 coverage and the confirmed right-cheek pin. No scans or permissions were cleared or changed. This verifies saved-report reopening on the emulator, not physical-phone PDF saving.

Visual inspection found a report defect: the fixed notice overlapped headings, and observation details spilled onto mostly empty continuation pages. The report contents remained present, but its layout did not pass review.

## Native report layout correction

Source `f8ce5ff` removes the fixed HTML footer, sets explicit 13px print text and compact paragraph spacing, and wraps long values. After native pagination, the existing `pdf-lib` version already used by the website adds the short notice and page number within each page's reserved bottom margin. The stamped file replaces the same owned temporary PDF before encryption. Read, stamping, or write errors reject the report and retain the existing finally-cleanup behavior; no additional plaintext file is created.

Eight added regression cases cover the HTML layout, per-page notices and numbering, original PDF content, unreadable and empty documents, and read/stamp/write failures. They failed before their corrections. Source review approved the final change. Full checks passed 687 JavaScript tests (scripts 24, contracts 33, mobile 420, web 210), workspace TypeScript and Prettier, the existing dependency audit, current notices/SBOM, and the repository safety audit. Python passed 349 tests with the existing external PostgreSQL test skipped and one known Starlette warning.

A separate compatibility check ran the new PDF step against the existing Android export. All 18 pages retained their original text, page dimensions, and eight image references. Every added page notice and number occupied the reserved bottom margin. The ignored compatibility PDF is `outputs/usability-checks/android-report-footer-compatibility-2026-10-10.pdf`. This check retains the old HTML layout: it does not prove updated native pagination or execution on Android or iPhone.

The owner stopped computer testing again with Escape before the new package was installed. Fresh report generation, every-page visual inspection, and restart reopening on `f8ce5ff` remain required. Simulator input has not resumed since that stop.

## Android test packages

The following packages embed the production inference origin and public response-verification key. Android’s signature verifier accepted all six with the same Android Debug certificate. The package is `org.stoma3d.prototype`, version `0.1.0`, version code `1`, label `Stoma3D`. These are local test packages, not store releases.

| Ignored artifact                                               | Source    |       Bytes | SHA-256                                                            |
| -------------------------------------------------------------- | --------- | ----------: | ------------------------------------------------------------------ |
| `outputs/native/Stoma3D-2026-10-10-picker-fix-x86_64.apk`      | `9028e40` | 101,969,231 | `7874d42b8d802f21f4b8f0168e50d8f355e6d60924ceb029459d2566034a70b1` |
| `outputs/native/Stoma3D-2026-10-10-picker-fix-arm64.apk`       | `9028e40` |  97,477,341 | `c29c5de5f8276d68da916c8c47c97ac22a66738bc8348ce46f0e11e5e168c407` |
| `outputs/native/Stoma3D-2026-10-10-report-recovery-x86_64.apk` | `c53cd51` | 101,973,883 | `a7568715af14a3aae6fe17e0e0528a5ef47286e4d46846a967cac9b2fb5d6c53` |
| `outputs/native/Stoma3D-2026-10-10-report-recovery-arm64.apk`  | `c53cd51` |  97,481,997 | `75a27ccc9bfde53fc3a3ca094fabb20bf98986ceb9c91ce9a6b64cb5ca85125a` |
| `outputs/native/Stoma3D-2026-10-10-report-layout-x86_64.apk`   | `f8ce5ff` | 102,676,027 | `6563dcdeb28cd00179f09a45a1e46dd2b33e13d9b0e3b6fce948cff229822610` |
| `outputs/native/Stoma3D-2026-10-10-report-layout-arm64.apk`    | `f8ce5ff` |  98,184,137 | `fbef966f940e97b13c17650540aef63e71c2855310c55f256c1ffbee090e53b5` |

The picker-fix x86_64 build finished in 5m 8s; ARM64 finished in 1m 50s. Report-recovery x86_64 finished in 2m 42s; ARM64 finished in 4m 2s. Both report-recovery builds’ embedded report, temporary-file, and capture-route source matched the checked-in files. Report-layout x86_64 finished in 5m 47s; ARM64 finished in 2m 4s. Their embedded report, PDF-footer, and temporary-file source matched the committed source. All packages' native library directories matched their named architectures. Upstream Gradle deprecation warnings remain. Picker-fix and report-recovery x86_64 packages have the installed-emulator coverage recorded above. Report-layout installation and physical ARM64 camera checks remain unverified.

## iPhone bundle check

The existing `export:ios` script completed for `c53cd51`, bundling 2,518 modules and 42 assets. All 42 declared asset files exist in the saved export. The bytecode contains the production inference origin and public verification key.

The ignored export is `outputs/native/Stoma3D-2026-10-10-report-recovery-ios-export`. Its bytecode is 8,695,308 bytes, SHA-256 `fe14b3a2310588cd69ef1d6486ee9503392f1ceccc4ccc394c0135eab882d706`.

The later `f8ce5ff` export completed with 2,692 modules and 42 verified assets. The ignored output is `outputs/native/Stoma3D-2026-10-10-report-layout-ios-export`. Its bytecode is 9,399,583 bytes, SHA-256 `fc6b5cee9d256eee22103c668f828b2626783a3a2f4b76c14a5093f8ce8e1960`; its production inference origin and public response key are present. These exports are the JavaScript-and-assets portion described in [Expo’s export documentation](https://docs.expo.dev/more/expo-cli/#exporting), not installable iPhone applications. Expo login remains deferred. Native compilation, Apple signing, installation, and iPhone camera/PDF tests remain open.

## Source checks

The picker-fix source `9028e40` passed these checks; build-artifact and installed-app checks continued after its implementation commit:

- 670 JavaScript tests: scripts 24, contracts 33, web 210, mobile 403
- Full workspace TypeScript and Prettier checks
- Web ESLint, dependency audit under the existing reviewed exceptions, and repository artifact/provenance audit
- 349 Python tests, with one external PostgreSQL bootstrap test skipped locally
- Both Android release builds, signature checks, and embedded capture-source comparison

The existing Starlette test-client warning remains. The website’s automatic production build reached READY. Web source did not change in this native increment.

## Remaining release checks

The approved plan still requires these results:

- Ten consecutive native full flows on each supported platform
- Installed `f8ce5ff` report generation, every-page visual review, and restart reopening
- Installed iPhone build after the deferred Expo login and Apple signing setup
- Physical front/back camera, focus, permissions, interruption, and sensor checks
- iPhone HEIC and phone PDF saving; Safari on iPhone and Chrome on Android
- Remaining runtime negative-image, network/signature, storage/deletion, and migration checks beyond the earlier recorded cases
- Screen-reader, large-text, reduced-motion, and device coverage beyond current source and browser checks

The [main usability record](USABILITY_VERIFICATION_2026-10-01.md) retains earlier recovery, quality, deletion, and deployment evidence. Passing this upload series does not replace those pending device checks.
