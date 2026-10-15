# Fresh Android scan and restart checks, October 14, 2026

One new standard eight-region scan completed on the updated Android app using licensed uploaded mouth photos. Its results, confirmed observation, and report reopened after closing and restarting the app. This follows the [resumed-scan checks and build details](./ANDROID_RESUMED_SCAN_VERIFICATION_2026-10-14.md). It is not physical-camera testing or ten consecutive native flows.

## Tested build and inputs

The existing `Stoma3D_Verify_20261010` simulator ran `Stoma3D-2026-10-14-pin-status-x86_64.apk`, built from source commit `939dbdb14404e1754aca6bf7041b58ba47af7083`. Its SHA-256 is `19c047b0084c3b094d796d640b89de0e1a3113c762f0c836241f376ccea8fb42`. The owner authorized simulator testing and these licensed photos' sanitized transmission to the configured Stoma3D inference service. No app data, saved scans, or permissions were cleared.

The test reused the eight permitted mouth photos from earlier browser and Android checks. These are not a new patient cohort. It used the no-symptoms test intake without choosing a model or capture protocol. Existing consent remained recorded; no new consent or permission prompt appeared.

## Picker, progression, and analysis

Home opened the short intake, then region one. Opening the Android photo picker and cancelling with Back restored the camera screen with enabled controls. Opening the picker again, selecting the tongue photo, confirming its known region and permission, and choosing Use photo completed analysis.

The map showed 1/8 and no pins from older scans. Home showed 1 of 8 regions saved and Continue scan. That action resumed region two, the tongue underside, without repeating intake.

All eight inputs completed the ordinary picker, review, region-confirmation, analysis, and protected-save path. No blur, privacy-service, decode, or request failure appeared:

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

A double-tap on Next region after the right-cheek result opened region five, the upper lip. It did not skip a region. This single check is not evidence of all double-tap or concurrency paths.

## Map and observation links

The right-cheek and upper-arch suggestions remained unconfirmed. Confirming the lower-lip observation saved its pin. At 6/8, the map showed only that pin, and Scan resumed the upper arch. At completion, the current-scan map showed 8/8 and the same lower-lip pin, without old right-cheek pins.

Rotation changed the rendered view. Selecting the lower-lip pin selected that region; its Observation saved link reopened the matching new photo and approximate 11.2% outline. The selected-region panel showed one accepted photo and one linked observation. The lower-lip pin sits close to the bottom rotation/zoom controls: an initial attempted selection activated rotation, while selecting its upper portion selected the pin. Larger separation or hit-target review remains part of native usability testing.

## Report generation and export

The new scan's first report generation completed at 7:12:00 AM without a timeout. Export opened Android's share sheet; Print showed an 11-page preview. Save as PDF created `downloadfile (5).pdf` without replacing older exports. Saving returned to the app's report screen.

The export is 237246 bytes with SHA-256 `208f6dfb66cf23e00d7c9e27cac86108062bb7edad109ca28876b72f7329d3e5`. Structural checks verified eight accepted live-model records and images, all October 14 capture timestamps, model versions, page numbers, and a fresh session rather than the earlier resumed session. The pin table contained only the confirmed lower-lip observation, with Observation saved wording; review priority remained disabled / unavailable.

Visual review covered all 11 rendered pages. The three candidate outlines matched their photos, and the map showed only the lower-lip pin. No clipped or overlapping text was observed. Photos, report copies, and rendered pages remain in ignored test outputs rather than GitHub.

## Restart and stored-report recovery

Dismissing only Stoma3D through Android recent apps closed its process; a read-only process check returned no app process ID. Reopening from the launcher restored Home and the completed lower-arch photo and result.

The report reopened with its original 7:12:00 generation time, without regeneration. Export opened a new temporary share file, and Print reopened the same 11-page report with the fresh session and lower-lip pin. No cloud recipient was selected.

## Remaining checks

This adds one fresh flow on the updated package. It does not satisfy the ten-consecutive-flow requirement, native degraded-image and service-recovery matrix, screen-reader checks, or physical-phone camera testing. iPhone testing and native signing remain deferred.

The earlier report-update timeout remains recorded in the [resumed-scan report](./ANDROID_RESUMED_SCAN_VERIFICATION_2026-10-14.md#intermittent-report-timeout). Successful retry, cold-start generation, and this fresh report do not establish that the intermittent fault is fixed.
