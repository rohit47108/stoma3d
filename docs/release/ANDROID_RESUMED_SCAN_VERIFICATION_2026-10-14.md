# Android scan recovery and report verification, October 14, 2026

The interrupted scan restored at 3/8, completed all eight regions with real analysis, and retained its results and report after an app restart. These checks used licensed uploaded images on the existing Android simulator, not a physical camera or iPhone.

## Simulator recovery and saved scan

The owner authorized simulator-only control again. The initial screen showed Android System UI and Pixel Launcher non-response dialogs. Read-only event records identified system-process startup timeouts. The device had 5.3 GB free, and no Stoma3D scan was cleared.

The Android SDK console stopped the confirmed `Stoma3D_Verify_20261010` instance. Its launcher session exited successfully, and the device disappeared from the connected-device list before restarting. The same data directory reopened with explicit cold-boot and no-snapshot-save options, without `-wipe-data`. Android reported boot completion after 64330 ms. The [emulator startup documentation](https://developer.android.com/studio/run/emulator-commandline#startup-options) distinguishes persistent app data from boot snapshots. The underlying system startup fault is not claimed fixed.

Stoma3D remained installed. Opening its launcher icon restored Home with 3 of 8 regions saved and the matching left-cheek result. Continue scan opened region four, the right cheek. The previously unsaved review candidate was selected again through the photo picker.

## Completed scan and map

The remaining right-cheek, upper-lip, lower-lip, upper-arch, and lower-arch photos completed real analysis through the ordinary picker, review, region confirmation, analysis, and protected-save path. None received a blur or privacy-service failure. The first three captures remained from October 13; the five resumed captures are dated October 14.

At 4/8, the current-scan map showed four accepted regions. Confirming the right-cheek observation added its pin. Returning to Scan selected the next missing region, the upper lip. The lower-lip and upper-arch suggestions remained unconfirmed.

At completion, the current-scan map showed 8/8 and only the confirmed right-cheek pin. Zoom and rotation changed the rendered view. Selecting the pin selected the right cheek. Its saved-observation link reopened the matching October 14 photo, outline, and approximate 22.9% area, without showing an older scan's result.

## Report export and restart

The completed scan generated a protected report at 12:45:24 AM. Export opened Android's share sheet, and Print opened an 11-page preview. Local saving created `downloadfile (3).pdf`; read-only file inspection confirmed the older exports remained intact. No cloud recipient was selected.

The new export is 224301 bytes with SHA-256 `ffa52fd2eef5eb865a9f6f01a82b61e21f75f4dfbc80862ac2aafcb53c7f98cb`. Structural checks found all eight accepted live-model records and images, the expected deployed model versions, and all page numbers. Visual inspection covered all 11 rendered pages, including three candidate overlays and one confirmed map pin. No clipped or overlapping text was observed. Photos, PDF copies, and rendered pages remain in ignored local test outputs.

The simulator's separate toolbar produced an out-of-bounds control error. Its Help window documented the working Overview shortcut. Dismissing Stoma3D through Android recent apps removed its process; a read-only process check returned no Stoma3D process ID. Reopening from the launcher restored Home and the October 14 lower-arch photo and completed result.

The report reopened with its original 12:45:24 generation time, without regeneration. Export decrypted the saved report into a new temporary share file, and Print reopened its 11-page preview with the same session and coverage. No scans, app data, or permissions were cleared.

## Pin-status wording correction

Page review found that the report's pin table said review unavailable for a confirmed, saved observation. The app's corresponding map link already said Observation saved. This confused disabled review-priority scoring with an unavailable saved observation.

The correction shares the map's existing status wording with the report. It does not change persisted status, observation links, review rules, medical gates, model outputs, encryption, response checks, or deletion. Six new regressions failed before the correction; the three focused files then passed 59 tests.

Source commit `939dbdb14404e1754aca6bf7041b58ba47af7083` passed 779 JavaScript tests, workspace TypeScript checks, Prettier, web lint, the production Next.js build, and 349 Python tests. One external PostgreSQL test was skipped, and one known Starlette deprecation warning remained. Repository safety and configured dependency checks passed. GitHub TypeScript run `38549602777` and repository-safety run `38549602729` completed successfully.

The updated x86_64 package installed over the existing app without resetting its data. Home retained the last lower-arch result, and the saved report remained available. Manual retry generated the corrected report at 6:39:09 AM. Export, Print, and local saving created a separate `downloadfile (4).pdf`, then returned to the app's report screen. Its 224994-byte export has SHA-256 `d0aecf69feb3fd44a818b7b36324ee542519bc34ecbb7fe7bbd9d4bf5fe98b42`. All 11 pages were rendered and visually inspected. The confirmed pin says Observation saved; review priority still says disabled / unavailable. All eight photos, model records, page numbers, and the correct session remained present, with no clipped or overlapping text observed.

A second process-close and launcher restart retained the corrected report's 6:39:09 generation time. The first report update after that cold app restart completed at 6:47:39 AM without a timeout. This checks saved-data recovery and one cold-start generation, not repeated-flow completion.

## Intermittent report timeout

The first report update after installing the new package reached the existing 60-second native-print deadline. The app displayed Report creation took too long. Try again., kept the original 12:45:24 report, and restored its export and update controls. One manual retry succeeded. The later cold-start update also succeeded, so the timeout has not been reproduced on demand and its cause remains unresolved.

Read-only logs showed WebView startup but no explanatory Stoma3D crash or new app ANR. The installed renderer is `expo-print` 57.0.1 with Android WebView 154.0.8037.106. The [official 57.0.2 changelog](https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo-print/CHANGELOG.md) lists no user-facing change; no speculative dependency upgrade was made.

Code inspection found a possible native sequencing risk: Expo's [Android renderer](https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo-print/android/src/main/java/expo/modules/print/PrintPDFRenderTask.kt) calls `onWrite` immediately after `onLayout`, without waiting for its completion callback. Android's [print adapter lifecycle](<https://developer.android.com/reference/android/print/PrintDocumentAdapter#onLayout(android.print.PrintAttributes,%20android.print.PrintAttributes,%20android.os.CancellationSignal,%20android.print.PrintDocumentAdapter.LayoutResultCallback,%20android.os.Bundle)>) requires layout completion before subsequent adapter work. This is a diagnostic lead, not a proven explanation for this timeout. The deadline and late-plaintext cleanup remain intact. Reliable repeated PDF creation remains a release check.

## Updated native artifacts

All artifacts remain in ignored `outputs/native`; none are committed or described as an app-store release.

| Artifact                                                |     Bytes | SHA-256                                                            | Verified scope                                                                                                                   |
| ------------------------------------------------------- | --------: | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `Stoma3D-2026-10-14-pin-status-x86_64.apk`              | 102677131 | `19c047b0084c3b094d796d640b89de0e1a3113c762f0c836241f376ccea8fb42` | Android release build and signature; simulator update, retained records, corrected exported report                               |
| `Stoma3D-2026-10-14-pin-status-arm64.apk`               |  98185241 | `02fd786f928d885b8dc87938e4048e4308b0198e55b00b9d5ef929564e9054ca` | Android release build and signature only; no physical-phone install                                                              |
| iOS export `index-2e1335ab04fc05b374ab9d4f249e2f96.hbc` |   9400421 | `1a08f2eb938b466fc98ed063eda3c09657c36959c1a183f276ff5eb5677b63a6` | Production JavaScript/assets export only; all 42 declared assets present, configured inference URL and verification key included |

The Android build source map matched the report, status helper, and map route at the stated source commit. The [Expo export documentation](https://docs.expo.dev/more/expo-cli/#exporting) distinguishes exported JavaScript/assets from native compilation; the iOS export is not an installable signed iPhone build.

The same source commit produced Vercel deployment `dpl_4Gxs2rgo5oPpZkT3cTSP8KXAtPaF`, reported READY at `https://stoma3d-d5led7atc-rohit-singhs-projects-48f82479.vercel.app`. Web application source was unchanged by this mobile correction. Deployment status does not replace the separate browser journey evidence.

## Remaining device coverage

This is one completed resumed scan, not ten consecutive fresh native flows. Native repetition, degraded-image and recovery checks, accessibility, and physical-phone camera testing remain. iPhone testing and native signing remain deferred. These results do not establish patient-level accuracy or an all-platform release sign-off.
