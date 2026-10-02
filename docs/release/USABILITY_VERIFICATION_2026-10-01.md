# Stoma3D usability verification

Snapshot started: 2026-10-01. Updated: 2026-10-02. This record covers the approved usability and reliability plan in `C:\Users\rohit\Projects\oralsight`. It records completed software checks, real-image results, deployments, and remaining checks separately. It is not a completed release sign-off.

The tested source commit is `b34e423de135cc303544f0ccd7cb35d0ed617871`. These focused implementation commits are pushed to the existing [public Stoma3D repository](https://github.com/rohit47108/stoma3d):

- `a7ac64c`: Fix capture quality and deployed privacy checks
- `2a462e1`: Simplify mobile scanning and protect photo recovery
- `40d7db6`: Add guest web scans with verified analysis and 3D results
- `ccf48a6`: Strengthen guest photo checks and retake guidance
- `d882fbd`: Include visual descriptions in browser reports
- `71f6303`: Keep observation map zoom within viewing limits
- `b34e423`: Offer browser scans from account entry

The final web review fixes pass source checks and are deployed. The saved eight-region scan reopened on the replacement build, and its final report passed text and visual checks. Map zoom, account entry, and photo-rejection messages also passed production UI checks. A fresh complete eight-region recapture was not repeated on this replacement build.

## Real browser results

The [production guest scan workspace](https://stoma3d.vercel.app/scan) called the deployed inference service. Test inputs were licensed SMART-OM mouth images outside Git. This record contains no patient identifiers, source image filenames, or image bytes.

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

The initial nine-page browser report exposed missing descriptor details during text extraction and a rendered-page check. The corrected report was then exported from the saved 8/8 scan on the final deployed build using Chrome DevTools Protocol (CDP) print-to-PDF.

The final artifact is `outputs/usability-checks/browser-eight-region-verified.pdf`, 1,414,160 bytes. Reopening it with `pypdf` confirmed nine pages, all eight captures and regions, complete live-model provenance, and descriptors on both cheek pages. The report retained the confirmed left-cheek observation and unconfirmed right-cheek candidate. Visual inspection of all nine rendered pages found legible photos, masks, and descriptors with no overlap or clipping. Keep this licensed-image test artifact outside Git.

CDP export verifies the deployed print layout and generated PDF file. It does not verify the browser’s interactive print dialog, phone PDF saving, or native app report generation.

## Photo-check evidence

Quality version `opencv-quality-yunet-v4-512` measures focus and lighting on a normalized image with a maximum edge of 512 pixels. The focus cutoff remains 0.054. Model analysis retains its separate higher-resolution image path.

The [quality-check record](../quality/QUALITY_CHECKS_2026-10-01.md) covers 80 licensed mouth images across all eight regions and 80 deliberately blurred copies. All source images passed the focus check, and all severe-blur controls failed it. One source image failed the glare check; another failed the obstruction check. These are software image checks, not measured physical-camera acceptance rates.

Browser uploads of severely blurred, dark, overexposed, and 64 × 64 pixel controls were rejected. Rejected controls did not increase the new scan’s coverage above 0/8. An unreadable JPEG produced a decode error rather than a blur warning and did not become a saved capture. Specific lighting and image-size messages now pass regression tests.

A rotated dorsal-tongue image was corrected using Rotate 90° and Apply crop. It then returned a signed live analysis and saved as the first accepted region of a separate scan. Glare-heavy, full-face, and interrupted-request UI cases still need recorded results.

Production rechecks on that separate scan returned these messages:

- Dark image: “Use even lighting and try another photo.”
- 64 × 64 pixel image: “Choose a higher-resolution photo or take a new one.”

Both rejected candidates remained reviewable, left coverage at 1/8, and preserved the accepted dorsal-tongue capture. Replacing a candidate cleared it and returned to the capture screen; Choose a photo then opened the picker.

## Android emulator results

The rebuilt Android application package (APK) used the production inference endpoint and current response-verification key. These checks ran on an emulator, not a physical phone:

- Home, consent, and the no-symptom intake opened without model or protocol selection
- The front camera opened first; switching to the back camera changed the emulator’s virtual camera preview
- Stability, tilt, and the stability bar were the remaining live sensor controls
- The empty 3D map rendered before capture
- The selected-photo picker opened without requesting broad photo-library access
- A licensed dorsal-tongue upload passed local quality and privacy checks
- The upload returned a signed live analysis, saved at 1/8, and opened the corresponding region on the 3D map

These checks do not verify real camera focus, physical sensors, iPhone permissions, or a complete native eight-region scan. Native report generation and reopening after an app restart still need runtime verification.

## Source and build checks

The latest full JavaScript run after the final web review fixes passed 382 tests. Type checks, lint, formatting, and the production build also passed:

| Check                       | Evidence at this snapshot                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Locked JavaScript install   | `pnpm install --frozen-lockfile --ignore-scripts` passed                                                    |
| JavaScript tests            | Scripts 22, contracts 33, web 121, mobile 206: 382 passed                                                   |
| TypeScript                  | Final web build type check passed; unchanged workspaces passed the preceding full type-check run            |
| Python tests                | 343 passed, 1 skipped; the skip requires external PostgreSQL bootstrap infrastructure                       |
| Python lint and format      | Ruff check and format checks passed; Python source is unchanged since that run                              |
| Formatting                  | `pnpm format:check` passed after the final web review fixes                                                 |
| Web lint                    | Full ESLint check passed after the final web review fixes                                                   |
| Web production build        | Final Next.js production build passed with 34 generated routes                                              |
| Shared contracts            | Generation completed without changing checked schemas                                                       |
| JavaScript dependency audit | Dependency audit passed                                                                                     |
| Repository audit            | Artifact, inventory, map-hash, and license-notice checks passed                                             |
| Independent review          | Targeted storage, save-recovery, and anatomy-acceptance review found no high-priority defect in those fixes |
| Signing-profile regression  | Tests passed after correcting both Expo Application Services (EAS) public-key pins                          |
| iOS JavaScript export       | Expo export passed; this is not an installable iPhone build                                                 |
| Android ARM64 build         | Rebuilt local test APK passed; physical-device installation is unverified                                   |
| Android x86_64 build        | Rebuilt release APK installed on the emulator and passed the runtime checks above                           |

Native regression tests require supported, matching anatomy before a new capture becomes saved coverage. A failed transport retry preserves a previously accepted capture. Save rollback retains the protected review image. These changes are included in the rebuilt Android artifact below.

The final web regressions cover report/result descriptor parity, bounded zoom around the selected map target, exact anatomy-region matching, and actionable quality messages. Runtime checks against the new deployment remain separate from these source tests.

## Deployments and build artifacts

The web deployment `dpl_GmEduqcKZ4s9PXujc7ty3yT95d7n` is ready at [Stoma3D](https://stoma3d.vercel.app/scan). It contains the final reviewed source commit `b34e423de135cc303544f0ccd7cb35d0ed617871`. The immutable deployment is [the October 2 Stoma3D web build](https://stoma3d-puyndlyrh-rohit-singhs-projects-48f82479.vercel.app).

The eight-region browser scan ran against the preceding production deployment `dpl_6Jj24nsC9CShFz8hSubkPn5MkV9x`, not only the local development server. Its stored records reopened on the replacement deployment. The verified report, bounded zoom, account-entry route, and dark/low-resolution recovery checks above ran against that replacement build. A fresh eight-region recapture on the replacement deployment remains unverified.

The inference deployment `dpl_2byfoVn6jBcH3QTmoZykHYAL4mqk` is ready at [the production health endpoint](https://stoma3d-inference.vercel.app/api/healthz). The October 2 health check reported:

- `privacyReady: true` and `analysisReady: true`
- Required response signing with signing configured
- Release `stoma3d-segmentation-release-2026-07-28`
- Enabled anatomy and segmentation heads
- No readiness reasons and no demo fixtures

The inference deployment includes both private model artifacts and the bundled YuNet face detector. Upload exclusions no longer remove nested `assets` directories. The [deployment handoff](../DEPLOYMENT.md) explains preserving that bundle when replacing inference.

The Android APK is a local test artifact, not a store release. It is 97,372,209 bytes and uses local test signing. Its production inference URL and current public response key match the deployed service. Keep the generated package out of Git:

```text
outputs/native/Stoma3D-2026-10-01-arm64.apk
SHA-256:
11c03c2a92c751a14048cdf1c713b241ae88b354b86efd926fa4ad835346b684
```

Expo login remains incomplete; the owner chose to do it later. No installable iPhone artifact or Apple signing setup has been verified.

## Checks still required

Complete these checks before treating the approved usability plan as finished:

- Repeat a fresh complete eight-region scan against the final web deployment
- Check browser print dialogs, phone PDF saving, and native report generation separately from the verified CDP export
- Exercise the remaining negative image cases, network failures, signature failures, and retry paths through the interface
- Check encrypted saved data, deletion, interrupted captures, and migrated records against dedicated test data
- Complete native upload, results, map, report, and restart journeys, keeping emulator checks separate from physical-camera checks
- Complete ten consecutive end-to-end flows per platform; no completed series is recorded here
- Test real front and back cameras, focus, permissions, interruption, and iPhone HEIC uploads on physical phones
- Check screen readers, large text, reduced motion, keyboard navigation, and narrow-screen layouts on the required browsers and devices
- Produce the installable iPhone build after Expo login and Apple signing setup
- Record all final artifact hashes, tested device/browser coverage, and unresolved issues

Cloud-account and worker deployments have their own acceptance checks. Guest scanning works independently of them, and this record does not certify those services as deployed. No software check here establishes clinical accuracy or diagnostic use.
