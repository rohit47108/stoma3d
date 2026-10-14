# Fresh Android scan verification, October 13, 2026

One fresh standard eight-region scan completed through the Android app using licensed uploaded mouth photos and the deployed analysis service. This extends [the earlier Android checks](./ANDROID_USABILITY_VERIFICATION_2026-10-13.md); it does not replace physical-phone or repeated-flow testing.

## Scan and result checks

The installed `Stoma3D-2026-10-13-map-scope-v2-x86_64.apk` was built from application source `bf1700811c9abfee506a9f8d7d2a8a9135ee88dd`. The test used the existing `Stoma3D_Verify_20261010` simulator, preserved its older scan, and did not change camera permission. The user had authorized these licensed inputs and their sanitized transmission to the configured Stoma3D inference service. No photos or exported reports are committed.

| Region                     | Observed result                           |
| -------------------------- | ----------------------------------------- |
| Top of tongue              | Completed; no candidate outline           |
| Underside of tongue        | Completed; no candidate outline           |
| Left inner cheek           | Completed; no candidate outline           |
| Right inner cheek          | Candidate outline; approximate area 22.9% |
| Inside upper lip           | Completed; no candidate outline           |
| Inside lower lip           | Candidate outline; approximate area 11.2% |
| Upper dental arch and gums | Candidate outline; approximate area 3.8%  |
| Lower dental arch and gums | Completed; no candidate outline           |

Each input passed the ordinary photo-picker, review, region confirmation, analysis, and protected-save path. No blur or privacy-service failure was observed for these eight inputs. Empty-outline results said the photo was analyzed; they did not claim normal tissue or an all-clear. These are the same permitted test cases used for browser checks, not eight independent patients or live camera captures.

At 4/8, the map showed Current scan and four covered regions. The right-cheek outline could be hidden and restored. After explicit confirmation, its pin appeared on the map; the region's saved-observation link reopened the matching photo, outline, and approximate area. Tapping the 3D pin selects its region; the observation card opens the photo. The lower-lip and upper-arch suggestions were left unconfirmed and were not automatically added as pins.

At completion, the map showed 8/8 and only the confirmed right-cheek pin. Zoom and rotation changed the rendered view. Home offered Start scan and retained the last result.

## PDF and restart checks

The completed scan generated a protected report at 6:30:35 AM. Export opened Android's share sheet; Print opened an 11-page preview. Save as PDF created `downloadfile (1).pdf` without replacing the older exported files. The new copy was transferred into ignored test outputs and reopened for structural and visual review.

All 11 rendered pages were inspected. All eight region photos, three candidate overlays, one confirmed map pin, page numbers, model versions, and limitation text were present. No clipped or overlapping text was observed. The initial export is 236743 bytes with SHA-256 `2c22c925c77c83324795e6f35b05a65737f68d06856fde3b0b36ef60ed925a96`.

The app was dismissed from Android recent apps. A read-only process check confirmed its process had exited. Reopening from the launcher restored Home, the saved lower-arch result, and the ready report with its original 6:30:35 generation time, without regenerating it or clearing data.

## Wording correction found during testing

The map called uploaded images accepted live captures. The PDF called them Live user capture. A working saved-observation link was titled Review unavailable because review priority is disabled, which looked like a failed link.

The associated increment reuses one input-label helper for History and PDF: Uploaded photo, Camera photo, Video frame, Sample photo, or Photo when older metadata does not identify the method. Map coverage says accepted photo. A saved pin with disabled review priority says Observation saved. It changes no stored status, model output, review rule, comparison gate, encryption, deletion, signature check, or public contract.

Twelve new regressions failed before the correction. The three focused test files then passed 53 tests. Full JavaScript checks passed 748 tests: 24 scripts, 33 contracts, 467 mobile, and 224 web. Workspace TypeScript, Prettier, and diff checks passed. Python checks passed 349 tests, with one external PostgreSQL skip and the existing Starlette warning. A separate read-only review independently passed the same 53 focused tests and found no required change.

The earlier map increment passed [TypeScript CI](https://github.com/rohit47108/stoma3d/actions/runs/38356685770) and [repository safety CI](https://github.com/rohit47108/stoma3d/actions/runs/38356685774).

## Corrected Android builds and runtime recheck

Both new embedded release builds passed. These supersede the map-scope-v2 artifacts for the wording correction:

| Artifact                                     |     Bytes | SHA-256                                                            |
| -------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `Stoma3D-2026-10-13-photo-labels-x86_64.apk` | 102677263 | `dcb8c7452f70ebb815ca7775385c9969e7ec2a54194db438849c7b8488c83107` |
| `Stoma3D-2026-10-13-photo-labels-arm64.apk`  |  98185373 | `322f4fa4f1369511e5bb9c700b48a140dbe1f359232009d5705675c8033a4539` |

The x86_64 build was installed without clearing data. Home retained the completed scan and latest result. The map retained 8/8 coverage and the confirmed pin. Selecting that pin selected the right-cheek region; its detail card displayed 1 accepted photo and Observation saved. The renamed link reopened the same right-cheek image, outline, and approximate 22.9% area.

The ready 6:30:35 report survived installation. Update report generated a new protected PDF at 6:46:08 AM. Export and Print still opened an 11-page preview. Save as PDF created a separate `downloadfile (2).pdf`, leaving the older files intact. All 11 pages were rendered and inspected again; all eight input labels read Uploaded photo. Region images, candidate overlays, the confirmed pin, page numbering, and text layout were preserved. The corrected export is 236546 bytes with SHA-256 `45c6b1e5b21b4b6a445251b66516989354f71ab177643add5a10931efeaa4399`.

ARM64 is a successful build, not a physical-phone runtime check. The release check did not replace or redeploy inference models. No web, inference, dependency, or environment configuration changed in this increment.

## Second scan and simulator recovery

A second scan began at approximately 7:12 AM. Picker cancellation and reopening retained the scan. A rotated, cropped top-of-tongue photo completed analysis, and its partial map showed 1/8 without the older scan's pin. The underside-of-tongue photo also completed.

Two camera-switch actions reopened their previews. Read-only Android camera diagnostics showed one active Stoma3D camera client per switch, using camera IDs 10 and 1. These are virtual cameras, not physical-phone focus, mirroring, or exposure checks.

The left-cheek photo completed real analysis with no candidate outline, then Next region advanced to the right cheek. The right-cheek photo reached review but was not analyzed before testing was interrupted. This second scan is not a completed eight-region run.

Later, the simulator process stopped. Android Studio started and exited without exposing a usable window; its underlying startup fault remains unresolved. The existing Android SDK launcher opened the same `Stoma3D_Verify_20261010` device with its existing data partition and no wipe option. Android reported boot completion after 118516 ms. The [Android emulator documentation](https://developer.android.com/studio/run/emulator-commandline#startup-options) distinguishes startup and snapshot options from data deletion.

Computer controls stopped when the owner pressed Escape, before the saved Stoma3D session could be reopened. This boot check does not prove the second scan survived restart. No subsequent native input bypassed that stop.

## Remaining coverage

This record proves one new complete uploaded-image simulator scan, not ten consecutive native flows. Repeated runs, degraded inputs, recovery and native accessibility checks remain. Physical camera focus, switching, interruption, and iPhone HEIC behavior require device testing. iPhone testing remains deferred by the user. No iOS binary, store release, physical Android runtime, or all-platform release sign-off is claimed.
