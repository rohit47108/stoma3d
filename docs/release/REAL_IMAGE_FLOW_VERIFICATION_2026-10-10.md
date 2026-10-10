# Real-image scan checks, October 10, 2026

This reference records the approved usability plan’s scan tests, Android corrections, and build artifacts. The website completed ten consecutive eight-region upload scans. Android and physical-phone coverage remain separate; this is not a final release sign-off or a clinical evaluation.

## Tested source and deployment

The latest software source is `c53cd514dd247f171f9fb95aaf1a982d52369432` in the existing [Stoma3D repository](https://github.com/rohit47108/stoma3d). It adds report timeout recovery to the picker correction in `9028e40539cac09d32fb60f28779601329d1a731`. Public contracts, stored-data schema, encryption, signing, analysis gates, and inference deployment are unchanged.

The production website deployment `dpl_d983HvamsvKa7FHL3xZesh6WfLt3` is READY for `c53cd51`. Its [immutable deployment](https://stoma3d-bjvzsxoh3-rohit-singhs-projects-48f82479.vercel.app) serves the [public scan workspace](https://stoma3d.vercel.app/scan). The repeated browser series began on `07a5f6d516502c1a62c0c1007effd0f38668ebfe` and continued on `9028e40`, with reloads between scans. Web implementation code did not change between these commits and `c53cd51`. The recorded ten-flow series is not a new UI exercise on the later deployment.

Both [TypeScript checks](https://github.com/rohit47108/stoma3d/actions/runs/38051687968) and the [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38051687953) succeeded for `c53cd51`.

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

The resumed native scan completed all eight regions with real analysis. Seven uploads ran through the updated package; its previously accepted tongue-top image survived the update. Explicit confirmation saved the right-cheek pin. Lower-lip and upper-arch candidates remained unconfirmed. The completed 3D map rendered at 8/8 with one pin; rotation and zoom controls changed its view. History reopened the saved captures and linked observation. Screenshot: `outputs/usability-checks/android-complete-map-9028e40-2026-10-10.png`. Native PDF generation and reopening after restart were not verified on this installed `9028e40` package before computer testing stopped. The later `c53cd51` package has build-only coverage. This is one resumed emulator scan, not ten fresh native scans or a physical-camera test.

## Native report timeout recovery

Source `c53cd514dd247f171f9fb95aaf1a982d52369432` fixes temporary report cleanup. The previous renderer deadline rejected the request without cancelling native PDF creation. A renderer finishing later could leave an unencrypted file outside the application’s temporary-file sweep.

The correction deletes late outputs, retries a transient deletion failure once, and records persistent cleanup failure without file paths or report content. Startup and background sweeps recover abandoned files in Expo Print’s cache directory. Active rendering and encryption leases protect in-use PDFs, including a renderer still running after its deadline. Cleanup validates filenames and deletes enumerated files rather than recursively deleting a live directory.

Nine regression tests cover on-time encryption and cleanup, late completion, transient and persistent deletion failures, recovery, active rendering/encryption, overlapping cleanup, and invalid paths. The original late-output test and three cleanup-failure tests failed before their corrections. A concurrent sweep/render test also reproduced a deletion race before the final fix. Independent source review approved the correction.

This source passed 679 JavaScript tests, full TypeScript and formatting checks, web lint, the existing dependency audit, and the repository safety audit. Python checks passed 349 tests with the same external database test skipped locally. Native rebuild and installed-report checks are recorded separately from those source checks.

Installing the report-recovery build initially stalled because Android’s package service returned `DEAD_OBJECT`; the simulator had 5.5 GB free. The stalled installation client was cancelled. The owner approved restarting only the simulator, preserving saved data. Its ordinary restart command also stalled, so the emulator was closed through its console and reopened with the same data directory, without a wipe or snapshot restore. The owner then stopped computer testing with Escape. The new package’s installation, PDF generation, and saved-scan reopening remain unverified; a completed build is not evidence of those outcomes.

## Android test packages

The following packages embed the production inference origin and public response-verification key. Android’s signature verifier accepted all four with the same Android Debug certificate. The package is `org.stoma3d.prototype`, version `0.1.0`, version code `1`, label `Stoma3D`. These are local test packages, not store releases.

| Ignored artifact                                               | Source    |       Bytes | SHA-256                                                            |
| -------------------------------------------------------------- | --------- | ----------: | ------------------------------------------------------------------ |
| `outputs/native/Stoma3D-2026-10-10-picker-fix-x86_64.apk`      | `9028e40` | 101,969,231 | `7874d42b8d802f21f4b8f0168e50d8f355e6d60924ceb029459d2566034a70b1` |
| `outputs/native/Stoma3D-2026-10-10-picker-fix-arm64.apk`       | `9028e40` |  97,477,341 | `c29c5de5f8276d68da916c8c47c97ac22a66738bc8348ce46f0e11e5e168c407` |
| `outputs/native/Stoma3D-2026-10-10-report-recovery-x86_64.apk` | `c53cd51` | 101,973,883 | `a7568715af14a3aae6fe17e0e0528a5ef47286e4d46846a967cac9b2fb5d6c53` |
| `outputs/native/Stoma3D-2026-10-10-report-recovery-arm64.apk`  | `c53cd51` |  97,481,997 | `75a27ccc9bfde53fc3a3ca094fabb20bf98986ceb9c91ce9a6b64cb5ca85125a` |

The picker-fix x86_64 build finished in 5m 8s; ARM64 finished in 1m 50s. Report-recovery x86_64 finished in 2m 42s; ARM64 finished in 4m 2s. Both report-recovery builds’ embedded report, temporary-file, and capture-route source matched the checked-in files. Their native library directories matched their named architectures. Upstream Gradle deprecation warnings remain. Only the picker-fix x86_64 package has installed-emulator flow coverage. Report-recovery installation and physical ARM64 camera checks remain unverified.

## iPhone bundle check

The existing `export:ios` script completed for `c53cd51`, bundling 2,518 modules and 42 assets. All 42 declared asset files exist in the saved export. The bytecode contains the production inference origin and public verification key.

The ignored export is `outputs/native/Stoma3D-2026-10-10-report-recovery-ios-export`. Its bytecode is 8,695,308 bytes, SHA-256 `fe14b3a2310588cd69ef1d6486ee9503392f1ceccc4ccc394c0135eab882d706`. This is the JavaScript-and-assets portion described in [Expo’s export documentation](https://docs.expo.dev/more/expo-cli/#exporting), not an installable iPhone application. Expo login remains deferred. Native compilation, Apple signing, installation, and iPhone camera/PDF tests remain open.

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
- Installed iPhone build after the deferred Expo login and Apple signing setup
- Physical front/back camera, focus, permissions, interruption, and sensor checks
- iPhone HEIC and phone PDF saving; Safari on iPhone and Chrome on Android
- Remaining runtime negative-image, network/signature, storage/deletion, and migration checks beyond the earlier recorded cases
- Screen-reader, large-text, reduced-motion, and device coverage beyond current source and browser checks

The [main usability record](USABILITY_VERIFICATION_2026-10-01.md) retains earlier recovery, quality, deletion, and deployment evidence. Passing this upload series does not replace those pending device checks.
