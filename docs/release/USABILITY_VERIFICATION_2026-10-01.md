# Stoma3D usability verification

Snapshot started: 2026-10-01. Updated: 2026-10-10. This record covers the approved usability and reliability plan in `C:\Users\rohit\Projects\oralsight`. It records completed software checks, real-image results, deployments, and remaining checks separately. It is not a completed release sign-off.

The [October 10 real-image scan record](REAL_IMAGE_FLOW_VERIFICATION_2026-10-10.md) adds ten consecutive complete browser upload scans, report inspection, 65 live-service image controls, the installed Android picker correction, and native report generation/reopening after restart. That report revealed a layout defect. The `f8ce5ff` correction is installed, but fresh report layout and restart checks remain open after another owner stop. The later `73f0290` Home/report update passed source checks and both Android builds; installation and visual checks remain open. Physical-camera and iPhone checks also remain incomplete.

The October 9 browser recheck ran on web source `7de21caff4cf64f31f8ef9f90581baac18963a4f`. Native recovery source is committed through `0d796f57a3ff1f790c677c9d5a25530f0cb76156`, with subsequent build corrections through `6d4e99e1de9cbc6d9ed67bb92e525ec4e9107974`. The anatomy preprocessing correction is committed as `3c8a4817ce36ad09fe0cefa5ffb6d70fdd8180d7`; its release evidence is `2fa35d7af97239a7726ea68d2cbcdf6ee968c7dd`. Checks and remaining runtime coverage are recorded below. Earlier implementation commits in the existing [public Stoma3D repository](https://github.com/rohit47108/stoma3d) include:

- `a7ac64c`: Fix capture quality and deployed privacy checks
- `2a462e1`: Simplify mobile scanning and protect photo recovery
- `40d7db6`: Add guest web scans with verified analysis and 3D results
- `ccf48a6`: Strengthen guest photo checks and retake guidance
- `d882fbd`: Include visual descriptions in browser reports
- `71f6303`: Keep observation map zoom within viewing limits
- `b34e423`: Offer browser scans from account entry
- `e395c20`: Add bounded camera startup and stale-photo cancellation
- `841e782`: Clarify connection-failure retry guidance
- `98165e2`: Add map rotation controls and intake heading focus
- `0c9567c`: Recover photo review edits and anatomy mismatches
- `377662a`: Distinguish oversized photos from decoding failures
- `472d7a3`: Protect saved scans from stale tab updates

The deployed web fixes passed source checks. The October 3 scan saved all eight regions. October 5 checks verified stale-tab rejection, retained-photo retry, and preservation of both tabs' accepted photos. Physical-camera and remaining platform checks are incomplete.

## Real browser results

The [production guest scan workspace](https://stoma3d.vercel.app/scan) called the deployed inference service. Test inputs were licensed SMART-OM mouth images outside Git. This record contains no patient identifiers, source image filenames, or image bytes. The following results cover the October 1 and October 2 runs:

| Check                     | Observed result                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Start without an account  | Home, intake, and capture opened without cloud sign-in                                                             |
| Map before capture        | Interactive base map rendered with zero accepted regions                                                           |
| Eight-region upload scan  | All eight canonical regions returned verified live-model results and saved; coverage reached 8/8                   |
| Dorsal and ventral tongue | Both uploaded images reached analysis and saved to their selected regions                                          |
| Left cheek                | Model returned a candidate mask with approximately 41.1% normalized image area                                     |
| Right cheek               | Model returned a candidate mask with approximately 22.8% normalized image area                                     |
| Observation confirmation  | Explicit confirmation saved the left-cheek observation; the unconfirmed right-cheek candidate did not become a pin |
| Completed map             | Map showed all eight accepted regions and one confirmed observation pin                                            |
| Resume after reload       | The completed scan remained at 8/8 after reload                                                                    |
| History                   | Saved captures reopened with their analysis; the left-cheek observation matched the result and map                 |
| Final-build reopening     | The existing 8/8 scan reopened on the replacement production build and generated the verified report               |
| Map zoom limits           | Thirty zoom-out taps and thirty zoom-in taps kept the map visible at the bounds; the normal view was restored      |
| Account entry             | `/signin` offered a browser scan without an account and accurately stated that cloud sync was not enabled          |
| Phone-width layout        | At 390 × 844 CSS pixels, checked workspace screens had no horizontal overflow                                      |
| Browser errors            | No warning or error entries were observed during the checked uploads                                               |

The first dorsal-tongue attempt exposed a missing privacy detector in the live deployment. The app showed a privacy-service error and retained the review photo for retry. After the deployment fix, the same upload returned a verified live result. An empty candidate mask was not labeled normal or harmless, and a failed request did not receive a fixture result.

During local development, a sixth analysis completed while the development server reloaded, but its storage write failed. The saved scan stayed at 5/8. The completed storage fix retains the review photo and does not count an unsaved result as durable progress. Focused storage tests also cover failed writes, deletion during a save, and stale writes from another tab.

The initial nine-page browser report exposed missing descriptor details during text extraction and a rendered-page check. The corrected report was then exported from the saved 8/8 scan on the October 2 deployed build using Chrome DevTools Protocol (CDP) print-to-PDF.

The October 2 report artifact is `outputs/usability-checks/browser-eight-region-verified.pdf`, 1,414,160 bytes. Reopening it with `pypdf` confirmed nine pages, all eight captures and regions, complete live-model provenance, and descriptors on both cheek pages. The report retained the confirmed left-cheek observation and unconfirmed right-cheek candidate. Visual inspection of all nine rendered pages found legible photos, masks, and descriptors with no overlap or clipping. Keep this licensed-image test artifact outside Git.

CDP export verifies the deployed print layout and generated PDF file. It does not verify the browser’s interactive print dialog, phone PDF saving, or native app report generation.

### October 3 production recheck

The current deployment passed the following browser checks with licensed-image uploads and temporary, tab-scoped test controls:

| Check                     | Observed result                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unanswered camera request | The configured 20s deadline ended startup and showed accurate retry/upload guidance                                                                 |
| Startup cancellation      | Cancel closed startup; choosing a photo during startup cancelled it and opened photo review                                                         |
| Connection failure        | A temporary analysis-network block showed “Could not connect. Your photo is still here; try again.” at 2/8                                          |
| Retry after reconnection  | The same retained photo returned a verified live result and saved at 3/8; explicit confirmation added the left-cheek pin                            |
| Map rotation and zoom     | Canvas arrow keys and all four rotation buttons rotated the map; zoom also worked                                                                   |
| Phone-width controls      | Rotation buttons measured 44 × 44 CSS pixels; the checked map had no horizontal overflow at 390 × 844 CSS pixels                                    |
| Dark-preference focus     | Emulated dark preference retained the amber `#a55710` canvas focus ring and `color-scheme: light`                                                   |
| Intake focus and consent  | The heading received focus on mount, Continue, the optional third step, and Back; Tab reached consent, and Continue stayed disabled without consent |
| Fresh eight-region scan   | A new 0/8 scan returned eight verified live-model results and saved all eight canonical regions at 8/8                                              |
| Observation confirmation  | The left-cheek candidate covered approximately 41.1% and was confirmed; the approximately 22.8% right-cheek candidate stayed unconfirmed            |
| Completed map             | The fresh scan showed all eight accepted regions and only the confirmed left-cheek pin                                                              |
| Reload and History        | Home resumed an older unfinished 3/8 scan; History retained the fresh October 3 scan at 8/8 and reopened it correctly                               |

These camera checks exercised stalled startup and cancellation, not a real-camera frame. All temporary network blocking and browser emulation were reset after testing.

The fresh report is `outputs/usability-checks/browser-eight-region-2026-10-03.pdf`, 1,414,279 bytes. `pypdf` confirmed nine pages, eight unique captures, eight `live_model` results, all eight regions, one confirmed observation, and one unconfirmed candidate.

Visual inspection of all nine rendered pages found legible content with no clipping or overlap. Both cheek pages showed the correct masks, descriptors, and confirmation states; all eight region headings appeared. Keep this licensed-image test artifact and its rendering intermediates outside Git.

This report used CDP export. The automated print-control click timed out, so the interactive print dialog remains unverified.

## Photo-check evidence

Quality version `opencv-quality-yunet-v4-512` measures focus and lighting on a normalized image with a maximum edge of 512 pixels. The focus cutoff remains 0.054. Model analysis retains its separate higher-resolution image path.

The [quality-check record](../quality/QUALITY_CHECKS_2026-10-01.md) covers 80 licensed mouth images across all eight regions and 80 deliberately blurred copies. All source images passed the focus check, and all severe-blur controls failed it. One source image failed the glare check; another failed the obstruction check. These are software image checks, not measured physical-camera acceptance rates.

Browser uploads of severely blurred, dark, overexposed, and 64 × 64 pixel controls were rejected. Rejected controls did not increase the new scan’s coverage above 0/8. An unreadable JPEG produced a decode error rather than a blur warning and did not become a saved capture. Specific lighting and image-size messages now pass regression tests.

A rotated dorsal-tongue image was corrected using Rotate 90° and Apply crop. It then returned a signed live analysis and saved as the first accepted region of a separate scan. The October 3 network retry above covers one interrupted analysis request, not every interruption case.

Production rechecks on that separate scan returned these messages:

- Dark image: “Use even lighting and try another photo.”
- 64 × 64 pixel image: “Choose a higher-resolution photo or take a new one.”

Both rejected candidates remained reviewable, left coverage at 1/8, and preserved the accepted dorsal-tongue capture. Replacing a candidate cleared it and returned to the capture screen; Choose a photo then opened the picker.

Later October 3 production checks also covered these cases:

- A public-domain full-face image received mouth-only crop guidance. Its photo remained reviewable, and saved progress stayed at 3/8. Applying a crop reset confirmation; the cropped image was not submitted for a second analysis.
- A deliberately clipped-lighting mouth image received “Move away from direct light and try another photo.” Progress stayed at 3/8. This software control is not a physical glare study.
- A lower-arch image submitted as right cheek received a supported anatomy mismatch. Selecting “Change to lower arch” retained the same photo and reset consent without saving. Fresh confirmation and signed analysis saved the correct region at 4/8, preserving the earlier captures and confirmed observation.
- Read-only inspection found three encrypted browser records, each with a 12-byte initialization vector and encrypted binary payload. The AES-GCM key was non-extractable, and localStorage contained no entries. No decrypted images or patient identifiers were printed.

### October 5 concurrent-tab recovery

Both production tabs opened the same scan at 5/8 before either saved a new photo. The following sequence used real licensed-image uploads and the signed model service, not injected analysis:

1. The first tab saved upper lip and reached 6/8.
2. The second tab submitted lower lip from its stale 5/8 scan. Its storage write was rejected rather than overwriting the first tab.
3. The second tab loaded the latest 6/8 scan and showed “This scan changed in another tab. The latest saved photos are loaded; try again.” Its review image source was unchanged.
4. Retrying that same photo saved lower lip and reached 7/8.
5. The map showed both lip captures, all five earlier accepted regions, and the existing confirmed left-cheek observation. No unconfirmed candidate became a pin.
6. Reloading reopened the scan at 7/8 and resumed upper arch. A final live-model upload saved that region at 8/8. The completed map retained the same confirmed observation.

The local screenshot artifacts are `outputs/usability-checks/web-stale-tab-retry-2026-10-05.jpg`, `outputs/usability-checks/web-concurrent-map-2026-10-05.jpg`, and `outputs/usability-checks/web-concurrent-complete-2026-10-05.jpg`. Keep licensed-image screenshots outside Git. This sequence verifies one actual stale-save conflict and a resumed scan, not a fresh eight-region run or ten consecutive end-to-end scans.

### October 5 local deletion

The owner explicitly approved clearing the three browser test scans. The production Clear device data confirmation removed those records and reset both open tabs to the empty state. History showed “No scans yet” in both tabs, including after reload.

Read-only storage inspection confirmed three encrypted records before deletion and zero afterward. The deletion generation changed. The code clears the old key and records in one transaction; initialization can create a new installation key afterward, so key presence alone is not evidence of retained data. The zero-record count remained after reopening. No cloud or phone data was changed, and no original test images or downloaded report artifacts were deleted.

The screenshot is `outputs/usability-checks/web-deletion-empty-history-2026-10-05.jpg`. This check covers browser deletion and cross-tab reset, not physical-phone deletion or interrupted native cleanup.

### October 9 browser recheck

The fresh scan created after the approved October 5 deletion reopened at 1/8 on the production website. Continue scan opened the next unfinished region, the underside of the tongue.

A different licensed underside-of-tongue image initially reached the live analysis service but was rejected by anatomy validation: “This photo could not be matched to the selected mouth region. Try a closer, well-lit view.” The review photo remained available with retry and replacement actions, and saved coverage remained 1/8. This was an observed usable-image rejection, not proof that the image was anatomically wrong. The investigation and successful correction are recorded below. No acceptance gate was lowered and no substitute result was supplied.

The screenshot is `outputs/usability-checks/web-region-retry-2026-10-09.jpg`. The newer scan was not deleted under the earlier three-record deletion approval.

Reopening Home and selecting Explore 3D map rendered the partial map at 1/8, with the saved tongue-top result and the remaining seven regions available. The screenshot is `outputs/usability-checks/web-partial-map-2026-10-09.png`. This verifies reopening the existing partial record, not a new completed scan.

A local diagnostic using the hash-validated anatomy artifact predicted ventral tongue for the same source image, but with confidence approximately 0.582, below the release bundle's fixed 0.77 abstention threshold. It therefore abstained. The local anatomy artifact hash and version matched the deployed model card. This diagnostic used the backend's sanitized source pixels, not an exported copy of the browser's review image.

### October 9 anatomy preprocessing correction

Investigation found that training/evaluation used antialiased Pillow bilinear resizing, while the deployed anatomy adapter used OpenCV linear resizing. With the same frozen weights and calibration, training-matched resizing gave the local input approximately 0.880 confidence. The fix adds an explicit release-declared resize mode; existing segmentation and legacy manifests keep OpenCV linear behavior. The 0.77 cutoff and all release gates remain unchanged.

The existing patient-disjoint holdout was rechecked: 376 images from 47 patients across all eight regions. The corrected preparation retained macro F1 0.984174 and minimum region recall 0.930233. Correct accepted images increased from 362 to 365, but incorrect accepted images also increased from two to three; overall accuracy did not improve. This is a preprocessing-consistency correction and regression recheck, not a new independent study or clinical validation. The [engineering review](../../services/inference/release/anatomy-preprocessing-review-2026-10-09.md) records the full evidence and client-preparation limits.

The exact staged production build `dpl_JCfM326iqVnnvCwEHiRTwiLwH5r4` loaded both pinned model hashes and YuNet successfully. Signed health, model-card, and live-analysis bytes verified against the unchanged public key, and modified response bytes failed verification. The licensed clear input completed; a wrong-region submission was unsupported; severe-blur and dark controls abstained before model analysis and exposed no masks. These checks passed again on the production alias after promoting the same build without rebuilding. Release ID is `stoma3d-anatomy-resize-release-2026-10-09`; anatomy version is `smart-om-mobilenetv3-pillow-2026.10.09`. Segmentation version and weights are unchanged.

The same previously rejected source photo was then uploaded through the public browser UI, not injected or replaced. It returned a live-model result at approximately 87% analysis confidence and saved the underside region, advancing the existing scan from 1/8 to 2/8. The result had no thresholded candidate area; it was not called normal or harmless. View on 3D map selected the correct region. Reload preserved both accepted photos; Recent observation reopened the new result, and the map still showed both regions as accepted. No observation pin was fabricated or added.

Screenshots are `outputs/usability-checks/web-anatomy-correction-result-2026-10-09.png` and `outputs/usability-checks/web-anatomy-correction-map-2026-10-09.png`. The earlier partial-map recheck is `outputs/usability-checks/web-partial-map-published-2026-10-09.png`. Keep licensed-image screenshots outside Git. This verifies one corrected browser upload and persistence, not ten consecutive scans or physical-phone capture.

An initial unaliased staging attempt selected the web project through automatic link discovery. It was not promoted and was removed. The correct service deployment used the repository root with an explicit inference project and service config. Both public URLs stayed on their previous releases until the tested inference build was promoted.

## October 9 native recovery source checks

Native source changes through `0d796f57a3ff1f790c677c9d5a25530f0cb76156` add:

- Lifecycle checks for delayed camera, picker, crop, analysis, and ghost-overlay work; encrypted retry photos can recover after interruption without publishing stale results.
- A shared pending-save guard so a remounted capture screen does not reopen a photo already waiting to become a saved result.
- Queued local changes, including rollback and protected-file cleanup, and awaited session, settings, and observation saves.
- Latest-state cloud merges with durable deletion tombstones, normalized readback, and a visible recovery screen if storage reload or reset fails.
- Cloud account ownership and upload-plan checks to stop delayed work after sign-out, deletion, or changes to planned records. Staging and sending also check for changes during awaited work.
- Map-history selection tied to the requested capture and report invalidation across linked observations and comparisons.

The final full JavaScript command passed 634 tests: scripts 24, shared contracts 33, web 178, and mobile 399. Full workspace TypeScript, Prettier, and `git diff --check` passed. Focused tests first reproduced the reset/readback and stale-sync failures before the fixes passed. Controlled native/storage/network boundaries exercise these overlaps; they do not prove physical-device behavior or undo already-sent requests.

The Python code was rechecked on October 9 after the anatomy correction: 348 tests passed, one PostgreSQL-dependent test was skipped, and Ruff lint/format passed. Web ESLint and the public-mode production build passed, with 34 generated routes. Shared schema generation, dependency checks, and license-notice verification also passed. No secrets, medical test images, environment files, or generated app packages are included in these source commits.

The ignored local mobile environment still pointed at old inference and website hostnames. Its public values were corrected to `https://stoma3d-inference.vercel.app/api`, `https://stoma3d.vercel.app`, and `https://stoma3d.vercel.app/shared`. The inference value matches the checked-in preview and production profiles; the public response-verification key was unchanged. An October 9 health check confirmed live anatomy and segmentation readiness, privacy readiness, required response signing, and no demo fixtures. This does not establish clinical validity.

Fresh Android build results are recorded separately from these source checks below; current installed-app results remain incomplete. The existing [native mutation decision](../decisions/0001-native-mutation-ownership.md) explains the internal ownership changes; persisted schema version 4 and public contracts are unchanged.

### October 9 Android packaging

The first ARM64 release attempt failed in APK compression with `OutOfMemoryError: Java heap space`, not a TypeScript or native compilation error. The Windows release helper now bounds the build to a 4 GB Gradle heap and two workers. A repeat completed successfully.

That repeat exposed a separate stale-bundle problem: Gradle skipped JavaScript generation after the ignored local website URLs changed. The Expo configuration plugin now refreshes the release bundle without forcing all native dependencies to recompile. Both build regressions were reproduced by focused tests before their fixes passed.

A fresh ARM64 build then completed with exit code zero in 1m 24s. Its embedded bundle contains the production website and inference origin and the current public response key, with neither old website nor old inference hostname present. Its native libraries target only ARM64; APK signature and package details are checked separately below. Cloud sync is unconfigured in this guest test build, and a sharing URL is not asserted from compiled-string inspection.

The x86_64 build then completed with exit code zero in 1m 37s. Its embedded public configuration passed the same checks, and its native libraries target only x86_64. Android's signature verifier accepted both packages with the same Android Debug certificate. The ARM64 package identifies as `org.stoma3d.prototype`, version `0.1.0`, version code `1`, label `Stoma3D`. These are locally signed test packages, not store artifacts.

Both packages were built from source `6d4e99e1de9cbc6d9ed67bb92e525ec4e9107974`, with the corrected ignored public environment. Keep them outside Git:

| Artifact                                       | Bytes       | SHA-256                                                            |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `outputs/native/Stoma3D-2026-10-09-arm64.apk`  | 97,476,085  | `73f20e4a5fbbdbb3084a5d1793fdfcaa7b3b2c71019ab7d15e2cde8995a74eca` |
| `outputs/native/Stoma3D-2026-10-09-x86_64.apk` | 101,967,975 | `051307b0cbe8369ac2216e8aeffcc73ad99b4ba37bcd6e003fe02cf87399f9da` |

These builds still emit upstream Gradle deprecation and terminal-color warnings. The warnings did not fail the builds. Current installed-app checks remain incomplete: the emulator became unavailable before the fresh package could be tested. An earlier emulator result is not treated as proof for this new source.

The current iOS JavaScript export also completed with exit code zero, producing one 8.7 MB bundle and 42 assets. This verifies bundling for iOS, not native iPhone compilation, Apple signing, installation, or camera behavior. Expo login remains deferred by the owner.

## October 9 dependency and test follow-up

The Python workflow for `b88fdfb` passed its application checks but failed the production dependency audit. The platform export contained advisories in PyJWT 2.13.0 and urllib3 2.7.0; its subsequent container checks were skipped, not successful. Targeted updates now lock PyJWT 2.15.1 and urllib3 2.8.0, with matching platform dependency floors and standalone locks. Authentication logic and the deployed inference service are unchanged. See the [dependency review](DEPENDENCY_REVIEW_2026-10-09.md) for sources and checks.

The final local full Python run passed 349 tests, with one PostgreSQL-only skip and the existing Starlette test-client warning. It includes the optional research test. All three frozen production dependency exports passed pip-audit without ignored advisories. Ruff lint and format passed for 161 files; all standalone locks and the byte-identical inference requirements export were verified.

A timing-sensitive worker test failed once in the first full run and passed in isolation. It now synchronizes on two observed lease renewals instead of expecting them within a 25 ms processor sleep, retaining a bounded timeout and checking identity, TTL, and completion. Worker implementation code is unchanged. Source changes are in `5bf4bb5` (PyJWT), `01ae028` (urllib3), and `7543531` (the test).

For `c82ced0404b42c9ac8b411d32c2207048baf4d41`, [Python checks](https://github.com/rohit47108/stoma3d/actions/runs/38015498487) and the [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38015498497) both succeeded. CI passed 349 tests, skipping only the optional Torch case covered locally. Its PostgreSQL test and migration checks passed. All production dependency audits, default-gate checks, inference container smoke tests, and complete-stack builds finished successfully.

The corresponding website deployment `dpl_8Myw8HqYHYc9ogidUQCueyqhJMfZ` was READY at [its immutable URL](https://stoma3d-fbaz5ybq1-rohit-singhs-projects-48f82479.vercel.app). A fresh reload of the public scan URL preserved the existing 2/8 scan. Recent observation reopened the real ventral-tongue result, showing the released Pillow anatomy version, live-model provenance, and 87% confidence. View on 3D map selected the underside region and retained both accepted regions. Screenshot: `outputs/usability-checks/web-published-map-c82ced0-2026-10-09.png`. No further photos, findings, pins, or deletions were added in this recheck.

The final root-environment notice regeneration retains all 648 prior legal texts, changing only reviewed package version references and the lock hash. These checks do not substitute for the pending physical-phone, installed-app, and repeated-flow coverage above.

## October 9 direct browser PDF download

Guest scans now offer a local PDF download separately from printing. Source `93fdb859e596f28da09df1af50aad3389181ba20` passed 644 JavaScript tests, full workspace TypeScript, web lint, formatting, dependency and repository audits, and the public-mode production build. The existing legal inventory retained all 648 prior texts and added four, with five newly locked packages.

The deployed public URL preserved the existing 2/8 scan. Creating and downloading its report through the visible controls produced a reopenable three-page PDF containing both saved photos and their original analysis details. Every page was rendered and inspected. Keyboard access, 44-pixel control heights, no horizontal overflow at a narrow viewport, and reset of the prepared-report control after leaving the map were checked. This was a desktop browser check, not phone or native report coverage. No new image was uploaded and no scan was deleted.

The [PDF export record](BROWSER_PDF_EXPORT_2026-10-09.md) contains the deployment, file hash, screenshots, dependency choice, and remaining limits. The inference service, contracts, encrypted storage, and native builds were unchanged by this web increment.

## Earlier Android emulator results

The rebuilt Android application package (APK) used the production inference endpoint and current response-verification key. These checks ran on an emulator, not a physical phone:

- Home, consent, and the no-symptom intake opened without model or protocol selection
- The front camera opened first; switching to the back camera changed the emulator’s virtual camera preview
- Stability, tilt, and the stability bar were the remaining live sensor controls
- The empty 3D map rendered before capture
- The selected-photo picker opened without requesting broad photo-library access
- A licensed dorsal-tongue upload passed local quality and privacy checks
- The upload returned a signed live analysis, saved at 1/8, and opened the corresponding region on the 3D map

These checks do not verify real camera focus, physical sensors, iPhone permissions, or a complete native eight-region scan. Native report generation and reopening after an app restart still need runtime verification.

## Earlier source and build checks

The October 3 full JavaScript run passed 404 tests. Full TypeScript checks, web lint, formatting, and the configured production build also passed. Python and native results below remain evidence from the preceding run:

| Check                       | Evidence at this snapshot                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Locked JavaScript install   | `pnpm install --frozen-lockfile --ignore-scripts` passed                                                    |
| JavaScript tests            | Scripts 22, contracts 33, web 143, mobile 206: 404 passed                                                   |
| TypeScript                  | Full workspace type-check run passed on October 3                                                           |
| Python tests                | 343 passed, 1 skipped; the skip requires external PostgreSQL bootstrap infrastructure                       |
| Python lint and format      | Ruff check and format checks passed; Python source is unchanged since that run                              |
| Formatting                  | `pnpm format:check` and `git diff --check` passed after the October 3 fixes                                 |
| Web lint                    | Full ESLint check passed after the October 3 fixes                                                          |
| Web production build        | Public-mode Next.js production build passed with 34 generated routes                                        |
| GitHub safety audit         | [October 3 safety-audit run](https://github.com/rohit47108/stoma3d/actions/runs/37133276198) succeeded      |
| GitHub TypeScript checks    | [October 3 TypeScript run](https://github.com/rohit47108/stoma3d/actions/runs/37133276199) succeeded        |
| Shared contracts            | Generation completed without changing checked schemas                                                       |
| JavaScript dependency audit | Dependency audit passed                                                                                     |
| Repository audit            | Artifact, inventory, map-hash, and license-notice checks passed                                             |
| Independent review          | Earlier storage/anatomy reviews passed; October 3 static camera, transport, and map review found no blocker |
| Signing-profile regression  | Tests passed after correcting both Expo Application Services (EAS) public-key pins                          |
| iOS JavaScript export       | Expo export passed; this is not an installable iPhone build                                                 |
| Android ARM64 build         | Rebuilt local test APK passed; physical-device installation is unverified                                   |
| Android x86_64 build        | Rebuilt release APK installed on the emulator and passed the runtime checks above                           |

The production build used `STOMA3D_WEB_MODE=public` and `NEXT_PUBLIC_SITE_URL=https://stoma3d.vercel.app`. The initial default local build correctly refused missing hosted-platform configuration. No configuration guard was bypassed.

Native regression tests require supported, matching anatomy before a new capture becomes saved coverage. A failed transport retry preserves a previously accepted capture. Save rollback retains the protected review image. These changes are included in the rebuilt Android artifact below.

Web regressions cover report/result descriptor parity, bounded map zoom and rotation, exact anatomy-region matching, and actionable quality messages. October 3 tests also cover camera timeout, cancellation, late stream release, stale photo preparation, connection-failure copy, and consent-heading markup. Production interface checks remain separate from these source tests.

## Deployments and build artifacts

The October 9 web deployment `dpl_Ci7K9cN7ek7APtNSYjP96HinLmMd` was ready at [Stoma3D](https://stoma3d.vercel.app/scan) for the browser recheck and successful anatomy retry. It contains source commit `7de21caff4cf64f31f8ef9f90581baac18963a4f`; its immutable URL is [the October 9 Stoma3D web build](https://stoma3d-gkcjbiisd-rohit-singhs-projects-48f82479.vercel.app). Repository safety and TypeScript GitHub checks for that source completed successfully. The October 5 concurrent-tab checks used the preceding `472d7a3` deployment `dpl_GKvU5XdMYsiUd4TjLyYUSAJ9Pyu6`.

That source passed 178 web tests across 29 files, web TypeScript, ESLint, Prettier, and the public-mode production build. Both [repository safety](https://github.com/rohit47108/stoma3d/actions/runs/37232110690) and [TypeScript](https://github.com/rohit47108/stoma3d/actions/runs/37232110828) GitHub workflows succeeded. These earlier web checks do not verify the newly committed native changes.

The preceding deployment `dpl_4BVZbCXqygmMfQcZtHEs6HhqHkH6` contains source commit `98165e27af64c3e3eb6a74ae31e560b60d117653`. Its immutable deployment is [the October 3 Stoma3D web build](https://stoma3d-gltwzxthx-rohit-singhs-projects-48f82479.vercel.app). The fresh eight-region scan and earlier October 3 interface checks ran against that deployment.

The preceding web deployment `dpl_GmEduqcKZ4s9PXujc7ty3yT95d7n` contains source commit `b34e423de135cc303544f0ccd7cb35d0ed617871`. Its immutable deployment is [the October 2 Stoma3D web build](https://stoma3d-puyndlyrh-rohit-singhs-projects-48f82479.vercel.app).

The initial eight-region browser scan ran against production deployment `dpl_6Jj24nsC9CShFz8hSubkPn5MkV9x`, not only the local development server. Its stored records reopened on the October 2 replacement deployment. The earlier verified report, bounded zoom, account-entry route, and dark/low-resolution recovery checks ran against that replacement build. A fresh eight-region scan was not repeated on October 2; the October 3 run now records one on the current build.

The inference deployment `dpl_2byfoVn6jBcH3QTmoZykHYAL4mqk` is unchanged by these web fixes. Its [production health endpoint](https://stoma3d-inference.vercel.app/api/healthz) passed the October 5 recheck with:

- `privacyReady: true` and `analysisReady: true`
- Required response signing with signing configured
- Release `stoma3d-segmentation-release-2026-07-28`
- Enabled anatomy and segmentation heads
- No readiness reasons and no demo fixtures

The inference deployment includes both private model artifacts and the bundled YuNet face detector. Upload exclusions no longer remove nested `assets` directories. The [deployment handoff](../DEPLOYMENT.md) explains preserving that bundle when replacing inference.

The previously rebuilt Android APK is a local test artifact, not a store release. It is 97,372,209 bytes and uses local test signing. Its production inference URL and public response key matched the deployed service in the preceding run. Keep the generated package out of Git:

```text
outputs/native/Stoma3D-2026-10-01-arm64.apk
SHA-256:
11c03c2a92c751a14048cdf1c713b241ae88b354b86efd926fa4ad835346b684
```

Expo login remains incomplete; the owner chose to do it later. No installable iPhone artifact or Apple signing setup has been verified.

## Checks still required

Complete these checks before treating the approved usability plan as finished:

The [October 9 browser photo-recovery record](BROWSER_PHOTO_RECOVERY_2026-10-09.md) adds bounded preparation and cleanup tests, plus local upload, crop, rotation, and resume checks. It does not replace the device checks below.

- Check browser print dialogs, actual phone PDF saving, and native report generation separately from the verified direct desktop download and earlier CDP export
- Exercise the remaining negative image cases, network and signature failures, and retry paths beyond the recorded retained-photo retry
- Check encrypted saved data, deletion, interrupted captures, and migrated records against dedicated test data
- Complete native upload, results, map, report, and restart journeys, keeping emulator checks separate from physical-camera checks
- Complete ten consecutive native end-to-end flows per platform; the October 10 record verifies the browser upload series
- Test real front and back cameras, focus, permissions, interruption, and iPhone HEIC uploads on physical phones
- Check screen readers, large text, reduced motion, and required browser/device coverage beyond the recorded focus, map keyboard, and phone-width checks
- Produce the installable iPhone build after Expo login and Apple signing setup
- Record all final artifact hashes, tested device/browser coverage, and unresolved issues

Cloud-account and worker deployments have their own acceptance checks. Guest scanning works independently of them, and this record does not certify those services as deployed. No software check here establishes clinical accuracy or diagnostic use.
