# Stoma3D recording release

Implementation brief refined with Architect from the approved request.
The five-day window starts October 17; October 22 is the latest handoff.
Work in the existing pnpm/Next.js repository. No Android work or stack changes.

## Outcome

At https://stoma3d.vercel.app/ a new visitor sees scanning immediately.
The same clean URL hosts a separate guided sample tour with stable next, back,
skip, and restart controls. No account, camera permission, or inference request
is needed for that tour. Real scanning remains available from the same home.

## Recording path

Start → eight region/photo-review steps → prepared result → interactive map →
history → confirmed comparison → report. Each region can be reviewed individually.
Skip advances a tour step, not a real scan's acceptance status. Restart resets
only sample state. Exit returns to untouched real scans.

## Boundaries

Use synthetic mouth-only artwork and authored illustrative measurements, labeled
Sample demo throughout. Keep those records outside GuestSession and guest storage.
Do not fabricate live results, weaken response verification, or change quality,
privacy, encryption, deletion, or model gates. Show one concise result limitation.
Retain the current light, teal, compact task-oriented design. Avoid new services.

## Proof before handoff

Tests cover root routing, step bounds, all eight unique regions, back/skip/restart,
and sample/live separation. A fresh deployed browser must traverse the whole tour,
interact with the map, compare the same observation, and open its report.
Check phone layout, keyboard focus, missing assets, console errors, and no sample
analysis requests. Provide a short recording script and real-vs-sample note.
Do not call it ready to record based only on build or deployment success.
