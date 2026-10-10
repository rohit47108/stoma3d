# Clear browser photo progress and cancellation

This increment follows the [browser photo recovery work](BROWSER_PHOTO_RECOVERY_2026-10-09.md). It improves feedback without changing analysis, storage, or the native applications.

## User-visible changes

- Uploads show “Preparing photo…” while being decoded and re-encoded.
- Camera startup and photo preparation have a Cancel action. Cancellation returns keyboard focus to “Open camera.”
- The hidden file picker stays out of keyboard navigation and is disabled during preparation; the visible “Choose a photo” button remains its entry point.
- Crop and rotation show “Updating photo…” and keep submission disabled until editing finishes.
- A newer editing error takes priority over an earlier analysis error. Starting analysis clears the old editing error so a later service error remains visible.
- Status regions remain mounted while idle so updates can be announced without moving focus.

The existing cancellation signals, stale-callback guards, metadata removal, signed-response verification, encryption, deletion, and observation confirmation remain in place. No schema, endpoint, acceptance threshold, key, or model artifact changed.

## Source checks

Eleven regression tests were added. They failed against the preceding behavior before their corresponding fixes. The focused camera and photo-review run passed all 17 tests. These are render-state and lifecycle-wiring tests, not mounted-browser or physical-camera tests. A separate code review found the stale-edit-error case; both first submission and retry are now covered.

The full JavaScript run passed 666 tests: 24 scripts, 33 contracts, 210 web, and 399 mobile. Workspace TypeScript, web ESLint, formatting, the repository safety audit, dependency audit under the existing policy, Ruff, and the public-mode production build passed. No dependency or audit exception changed.

The full service/ML suite passed 349 tests, with the PostgreSQL integration check skipped and the existing Starlette/httpx deprecation warning. Locked research dependencies were already present; no lockfile or Python source changed.

The first TypeScript/build attempts found malformed, ignored Next.js development type files. The stopped development server's affected generated route and validator files were cleared; production generation and both build and workspace TypeScript checks then passed. No application configuration was changed to suppress the error.

## Local browser checks

The user approved temporarily stalling photo processing in a localhost-only tab. The repository's non-medical app icon was the only input. No “Use photo” action or analysis request was performed.

- A paused decoder showed preparation progress, disabled the primary action and upload controls, and left Cancel enabled.
- Keyboard cancellation immediately restored the capture screen, focused “Open camera,” and ignored the released late callback.
- A normal upload opened photo review.
- A paused encoder during rotation showed “Updating photo…” and disabled editing/submission controls.
- The actual 20-second edit timeout kept the exact original photo, cleared temporary canvas pixels, and restored the controls. The observed timeout was approximately 20.05 seconds.
- With normal encoding restored, rotation succeeded and cleared the editing error.
- Desktop and 375-pixel-wide views were inspected. The narrow view had no horizontal overflow; the checked primary controls exceeded 44 CSS pixels.
- Returning home kept the local scan at 0/8. All temporary browser method overrides and test state were removed, the viewport override was reset, and the test tab and development server were closed.

Ignored local screenshots:

- `outputs/usability-checks/web-preparing-cancel-desktop-2026-10-09.png`
- `outputs/usability-checks/web-preparing-cancel-phone-width-2026-10-09.png`
- `outputs/usability-checks/web-updating-photo-desktop-2026-10-09.png`
- `outputs/usability-checks/web-updating-photo-phone-width-2026-10-09.png`
- `outputs/usability-checks/web-photo-editing-timeout-feedback-2026-10-09.png`

These checks establish interface feedback and recovery, not screen-reader announcements on assistive hardware, physical camera behavior, or anatomy/segmentation performance. Phone camera checks, an installed iPhone build, and the specified repeated complete scans remain open in the full usability plan.

## Published website checks — October 10

Source commit `52cb57be02442d5389757130353354de3bbb6815` deployed as `dpl_GwD2VymTLubsBR81yNSJX5e87zb7`, with state READY and the `stoma3d.vercel.app` production alias. GitHub's TypeScript checks (`38022605923`) and repository safety audit (`38022605657`) completed successfully for that exact commit. The TypeScript workflow also verified Expo public configuration and generated production Expo bundles; that does not establish installed-phone coverage.

Reloading [the public scan page](https://stoma3d.vercel.app/scan) preserved the existing 2/8 scan and recent result. Continue scan resumed at the left cheek. The hidden file input had a tab index of -1 and an idle status region was present. Choosing the same non-medical icon displayed “Preparing photo…” with enabled Cancel, then opened review as a 1254 × 1254 JPEG. A keyboard-adjusted 1% side crop produced 1229 × 1254, and rotation produced 1254 × 1229. Rotation displayed “Updating photo…” while the editing controls were disabled, then returned to idle without an error.

Returning home kept the original 2/8 progress. The map rendered those same accepted regions, and the tongue-underside result reopened with its original October 9, 9:28:04 PM timestamp, 87% confidence, live-model origin, anatomy version `smart-om-mobilenetv3-pillow-2026.10.09`, and segmentation version `smart-om-autooral-unetplusplus-b4-2026.07.28`. No new analysis, observation pin, or deletion was performed. Browser console inspection returned no warnings or errors.

The published map was also inspected at a 375-pixel viewport without horizontal overflow. Its zoom buttons measured 44 × 44 CSS pixels, and “View result” exceeded 44 pixels in height. The temporary viewport override was reset afterward.

The public model-card relay returned HTTP 200 with `Cache-Control: no-store, max-age=0, private`. The unchanged inference health check reported analysis and privacy ready, signing required and configured, demo fixtures disabled, and the existing `stoma3d-anatomy-resize-release-2026-10-09` manifest loaded. This increment did not redeploy the inference service or replace its private artifacts.

Ignored production screenshots:

- `outputs/usability-checks/web-photo-review-published-52cb57b-2026-10-10.png`
- `outputs/usability-checks/web-map-preserved-published-52cb57b-2026-10-10.png`
- `outputs/usability-checks/web-map-phone-width-published-52cb57b-2026-10-10.png`

## References

- [ARIA status regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role)
- [React DOM refs](https://react.dev/reference/react/useRef#manipulating-the-dom-with-a-ref)
- [React effects](https://react.dev/reference/react/useEffect)

## Recovery

Revert the focused source commit through the existing deployment pipeline if this increment causes a regression. Saved scans and encryption keys require no migration or deletion. The inference deployment and previously prepared native builds remain unchanged.
