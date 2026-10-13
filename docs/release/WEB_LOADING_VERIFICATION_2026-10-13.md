# Website loading verification, October 13, 2026

The footer no longer appears midway through the page while the landing page loads. This change does not alter scans, analysis, stored records, or the map.

## Finding and correction

The shared loading/error layout reserved only 65% of the viewport height. During a streamed landing-page response, the footer could appear at about 605 pixels on an 823-pixel-high viewport, then move below the finished page. Two of three fresh browser profiles attributed a layout shift of approximately 0.265 to that footer movement. The separate Lighthouse series also observed it in two of three landing-page runs.

The dedicated `.loading-page` rule now reserves `100dvh`. Empty/error pages keep their existing 65% minimum. The loading screen still shows its normal content; no route, font, script, or security configuration was changed.

The new loading-height test failed before the correction; both focused tests passed afterward. The full checks passed 752 JavaScript tests, workspace TypeScript, Prettier, web ESLint, the public-mode production build, and 349 Python tests. One external PostgreSQL test was skipped; the existing Starlette warning remains. This small CSS increment received source self-review.

## Deployed release

Application commit: `63d976547714aa13d8d17087b548afc45b918ee0`, pushed to the existing [repository](https://github.com/rohit47108/stoma3d).

READY deployment `dpl_uR1rV4HnkJAzf8P8YSqbjAgPXRHp` received [the public alias](https://stoma3d.vercel.app). Its [immutable URL](https://stoma3d-nfrw9s5gi-rohit-singhs-projects-48f82479.vercel.app) identifies that build. [TypeScript CI](https://github.com/rohit47108/stoma3d/actions/runs/38460776884) and [repository safety CI](https://github.com/rohit47108/stoma3d/actions/runs/38460776806) succeeded.

Three fresh Chromium contexts loaded `/`, and three loaded `/scan`, without scrolling or local stylesheet overrides. The eight-second observation budget, viewport (412 × 823), dark preference, and fresh-context method matched the baseline. All six post-release profiles recorded no unexpected layout shifts. When the loader was observed, its main section reserved 823 pixels and the footer began below the viewport at about 892 pixels.

One cold landing request had about 2.93 seconds of server waiting and a 4.39-second largest paint. The other two landing paints were approximately 0.51 and 0.75 seconds. This CSS fix addresses movement, not server response time; those ordinary browser timings are not a claim of faster loading.

## Lighthouse recheck

Three cold mobile audits per route used Lighthouse 13.5.0 and the same bundled Chromium/default simulated-throttling settings. Every post-release audit recorded CLS 0. The automated accessibility and best-practices scores were 100 on both routes; landing-page SEO was 100. Scan SEO remained 63 because the scan workspace intentionally disallows indexing.

| Route   | LCP, milliseconds (runs 1–3) | TBT, milliseconds (runs 1–3) | Performance scores |
| ------- | ---------------------------- | ---------------------------- | ------------------ |
| `/`     | 2175, 2394, 2410             | 89, 795, 490                 | 98, 79, 85         |
| `/scan` | 2885, 3047, 2899             | 374, 715, 403                | 86, 76, 85         |

These are repeated lab observations on a development computer, not real-user measurements. Timing varied substantially; neither the performance score nor total blocking time establishes a speed improvement from this CSS correction. Scan-home loading remains a separate performance finding. Automated accessibility scores do not establish screen-reader coverage.

## Evidence and remaining scope

Ignored local records under `outputs/usability-checks`:

- `page-loading-profile-2026-10-13`: before-change profiles and footer attribution.
- `page-loading-profile-2026-10-13-footer-release`: six passing post-release profiles.
- `lighthouse-mobile-2026-10-13-contrast-release`: pre-fix mobile audits.
- `lighthouse-mobile-2026-10-13-footer-release`: six post-fix mobile audits.

The [contrast record](WEB_CONTRAST_VERIFICATION_2026-10-13.md) and [repeated scan record](BROWSER_REPEATED_FLOW_VERIFICATION_2026-10-13.md) document the preceding release and real-image journeys. This loading correction is not final all-platform approval. Physical camera checks, repeated native/accessibility checks, and deferred iPhone testing remain open.
