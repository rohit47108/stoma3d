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

## References

- [ARIA status regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role)
- [React DOM refs](https://react.dev/reference/react/useRef#manipulating-the-dom-with-a-ref)
- [React effects](https://react.dev/reference/react/useEffect)

## Recovery

Revert the focused source commit through the existing deployment pipeline if this increment causes a regression. Saved scans and encryption keys require no migration or deletion. The inference deployment and previously prepared native builds remain unchanged.
