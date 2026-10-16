# Android photo rejection and recovery, October 15, 2026

Five deliberately degraded top-of-tongue photos stayed out of saved results. The original clear replacement then reached a real result and the partial 3D map in the same scan. This verifies the Android upload path, not physical cameras, other native regions, or clinical accuracy.

## Reproduced fault and correction

The first blur attempt on the previous package displayed the internal code `image_too_blurry`. Code inspection and failing route tests showed that `analysisOrigin: unavailable` was handled before measured quality rejections. That origin can mean no learned head ran because the quality check stopped processing; it does not necessarily mean a transport failure.

Source commit `5766c6ff3683118a0c7a0d2f8124d43cdacca736` corrects that distinction. Recognized measurements such as blur, exposure, glare, small size, and face presence follow the rejection path even without learned output. A rejected candidate remains temporarily available for correction or replacement, but its retry draft is removed. Service failure, an unavailable privacy check, and transport failure alone preserve a retry draft rather than declaring the photo bad.

The route now uses the existing readable reason copy and displays the rejection once. It no longer adds an unconfirmed-anatomy message when quality prevented anatomy from running. Thresholds, models, response verification, encryption, and server endpoints were unchanged.

Six new assertions failed before the fix: five real-route cases retained a rejected retry draft, and the policy classified measured blur as a service failure. They passed after the correction. Further route tests cover service/privacy-check failures retaining their draft and a clear replacement reaching the result route. These tests control native/API boundaries; they are not physical-device storage tests.

## Native test conditions

The existing `Stoma3D_Verify_20261010` simulator received an in-place package update. No saved scans, app data, or permissions were cleared. Its new scan was created before midnight on October 14 and remained the same scan after the update and October 15 quality checks.

The owner approved the licensed mouth-only inputs and sanitized transmission to the configured Stoma3D inference service. The controls reuse the deterministic [browser quality-test inputs](./BROWSER_IMAGE_QUALITY_VERIFICATION_2026-10-13.md), not a new patient cohort. Their original checksum manifest is in ignored `outputs/usability-checks/approved-degraded-inputs-2026-10-13`. The five tongue files were hash-checked before import into the simulator.

## Observed outcomes

| Input                      | Stage and outcome                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Severe blur                | Server rejection; readable blurry-photo instruction; review image retained             |
| Dark                       | Server rejection; lighting, low-focus, and obstruction corrections; review retained    |
| Overexposed                | Server rejection; lighting, low-focus, and glare corrections; review retained          |
| White glare band           | Server rejection; change the angle or lighting instruction; review retained            |
| 64-by-64 image             | Local rejection: The photo is too small. Choose a larger image.; no Use photo control  |
| Original clear replacement | Actual completed analysis; no candidate outline; correct tongue photo and region shown |

The four server-rejected candidates stayed on Review photo with Crop, Rotate, and Choose another available. No result or observation-confirmation screen appeared. The small photo was rejected before upload. Replacement reset the prior correction and region confirmation rather than carrying them to the next photo.

After all five rejected candidates, Home and Scan still showed 0 of 8 saved. The 3D map rendered at 0/8 with no pins. Leaving capture and resuming opened the same unfinished top-of-tongue region without restoring the rejected temporary review.

After the clear replacement, the map showed 1/8 and the selected Tongue top region. No candidate pin was created for a result without an outline. This is one correction-and-recovery journey, not a complete eight-region scan or ten consecutive flows.

Dark and overexposed photos currently show several correction sentences together. Reducing that to the most useful next adjustment remains a wording/usability follow-up; the full measurements must remain available internally.

## Builds and checks

Artifacts remain in ignored `outputs/native`, not GitHub. Both Android packages use the existing local test certificate, not store-release signing.

| Artifact                                                  |     Bytes | SHA-256                                                            | Verified scope                                              |
| --------------------------------------------------------- | --------: | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `Stoma3D-2026-10-15-quality-recovery-x86_64.apk`          | 102678083 | `4c748b274435ba02f0f67cc4421a0ce961f3ec395d4b7019a459d6f1e075f107` | Signature, x86_64 contents, installed simulator flow        |
| `Stoma3D-2026-10-15-quality-recovery-arm64.apk`           |  98186193 | `f119aba88a0923ec4a9f08c74c3a9d6f116aab3589164c635ba4f8a277e59d34` | Signature and arm64-v8a contents; no physical-phone install |
| iOS export's `index-73b15e440e513d0914a7669eb8216ae4.hbc` |   9401422 | `2c01f83e67b42fa3ef988d0b7ad584f2b99759632772f3d2164f28001162a457` | JavaScript/assets only; not an installable iPhone build     |

Both Android packages contain bundle SHA-256 `b2b6ef3b6d54cec77bec199da4f4d808097e5f68fe7fa238e32fcfd8352979ee`. The release source map matches the updated capture route and analysis policy. All 42 iOS export assets were present, with the configured production inference URL and public response-verification key.

Verification completed for this change:

- 793 JavaScript tests: scripts 24, contracts 33, mobile 487, web 249.
- Workspace TypeScript, Prettier, web ESLint, and public-mode web production build passed.
- Python services/ML: 349 passed, one external-PostgreSQL test skipped, one existing deprecation warning.
- Repository artifact/provenance audit, dependency audit, and diff checks passed.
- Android x86_64/arm64 release builds and iOS JavaScript export passed.

The commit's [TypeScript checks](https://github.com/rohit47108/stoma3d/actions/runs/38680973448) and [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38680973484) also passed on GitHub. Vercel production deployment `dpl_37hBiSEuni4LBYZTVxZKpBRzQjAF` reached READY for the same source commit. The application change was mobile-only; deployment status is not additional runtime test coverage.

The earlier intermittent report timeout remains unresolved. Native service-error/signature-error runtime tests, screen readers, repeated complete scans, physical-camera checks, and iPhone testing are not established by this quality-control run.
