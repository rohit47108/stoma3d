---
name: Stoma3D
description: Calm, instrument-like surfaces for guided mouth scans and visible observations.
colors:
  porcelain: "#f7faf8"
  scan-porcelain: "#f8faf8"
  paper: "#ffffff"
  paper-soft: "#eef5f2"
  graphite: "#142d31"
  graphite-soft: "#50666a"
  teal: "#096d67"
  teal-dark: "#075650"
  teal-light: "#dceee9"
  line: "#cddbd7"
  amber: "#a55710"
  amber-soft: "#fff0d9"
typography:
  headline:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    fontSize: "clamp(28px, 4vw, 42px)"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  title:
    fontSize: "24px"
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontSize: "13px"
    fontWeight: 650
  eyebrow:
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.09em"
rounded:
  field: "8px"
  control: "10px"
  panel: "14px"
spacing:
  tight: "8px"
  control-gap: "12px"
  inset: "16px"
  action-inset: "20px"
  section-gap: "24px"
  section-inset: "32px"
  spacious: "48px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.teal-dark}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-text:
    textColor: "{colors.teal}"
    padding: "8px 0"
  select:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.field}"
    padding: "10px 36px 10px 12px"
  report-sheet:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.field}"
    padding: "clamp(20px, 4vw, 40px)"
  photo:
    rounded: "{rounded.panel}"
    width: "100%"
---

# Design System: Stoma3D

## Overview

**Creative North Star: "The Guided Scan Workspace"**

Porcelain paper, graphite type, mineral teal actions, fine rules, and
instrument-like controls retain the established Stoma3D identity. The public root
now opens the existing scan workspace directly; the retired marketing hero is not
the reference for new screens. Task surfaces are calm and specific, with generous
photo areas and short, readable instructions.

The separate, visibly labeled Sample demo uses the same visual language. Synthetic
artwork and prepared observations explain the journey without posing as real
patient records or live analysis. Authenticated patient and clinician workspaces
remain denser operating surfaces: mineral paper sidebars, plain ledgers, and
precise status language rather than smaller landing pages.

**Key Characteristics:**

- Porcelain and white surfaces, graphite text, restrained mineral teal.
- Compact system-sans headings and instrument-like controls.
- Fine rules and whitespace before decorative containers.
- Photo-first review, reachable navigation, explicit sample provenance.

## Colors

The palette remains cool, quiet, and paper-like; the frontmatter records the actual
global and scan-scoped values rather than treating their porcelain grounds as identical.

### Primary

- **Mineral Teal** (`teal`): primary actions, active destinations, progress, and
  selected regions. **Deep Mineral Teal** (`teal-dark`) is the primary hover state.
- **Pale Mineral Teal** (`teal-light`): supporting selection tones in the
  authenticated workspace. Scan and demo selection fills use related pale tints.

### Neutral

- **Porcelain** (`porcelain`) and **Scan Porcelain** (`scan-porcelain`): global
  ground and the deliberately light scan/demo shell, respectively.
- **White Paper** (`paper`): headers, navigation, fields, and report sheets.
- **Mineral Paper** (`paper-soft`): inset information and workspace surfaces.
- **Graphite** (`graphite`): primary reading text. **Soft Graphite**
  (`graphite-soft`): supporting copy, captions, and metadata.
- **Fine Rule** (`line`): divisions, control borders, and ledger structure.

### Named Rules

**The Purposeful Accent Rule.** Teal carries ordinary actions and selection; amber
is reserved for attention, focus, pending review, or a required decision. Dedicated
destructive controls use the existing muted red, not an additional brand accent.

Amber and its pale attention surface are semantic state colors, not a second
decorative palette. Global styles adapt to dark appearance; the scan/demo shell
explicitly retains its light palette. Do not infer a dark scan theme from the
global dark-mode variables.

## Typography

**Body and Headline Font:** the local system sans stack in the frontmatter.
Technical IDs in authenticated ledgers may use the existing system monospace stack.

**Character:** compact, slightly tightened headings with familiar, readable body
copy. No new display face is needed to distinguish a sample screen from a real one.

### Hierarchy

- **Headline:** the fluid frontmatter role describes demo headings. Scan headings
  share its size range with a slightly looser line height (1.16) and tracking
  (-0.03em); keep this existing distinction.
- **Title:** section headings use the frontmatter role; smaller timeline and
  selected-region headings step down (21px).
- **Body:** the global frontmatter role anchors reading. Demo paragraphs use a
  slightly more open line height (1.6). Supporting instructions stay around
  58–65 characters per line where practical.
- **Label:** small semibold status and sample labels; supporting captions range
  from 12–14px according to context.
- **Eyebrow:** uppercase, tracked teal labels identify region and sample context.
  Tabular numerals keep progress counts and region indices steady.

## Layout

The root and `/scan` render the same scan experience. A compact brand bar and four
destinations—Home, Scan, 3D Map, History—organize the workspace. The optional Sample
demo is entered separately, not inserted ahead of consent or capture.

Scan content is centered with a maximum width (1120px). At desktop width (900px
and up), a stable left rail (168px) sits below the header (76px); result and map
views use two columns. Below that breakpoint, a fixed four-item bottom navigation
replaces the rail. Content and scroll clearance track its measured height and safe
area so focused controls are not hidden. Very narrow screens (420px and below)
reduce side insets (16px) and let actions grow into available width.

Demo content has a maximum width (1080px), a scrollable chapter strip, and a fixed
control bar. Photo/review columns collapse at compact width (700px and below).
The eight-region selector wraps to four columns at narrow width (430px and below).
Back and Next remain distinct from Restart and Skip; the compact control bar
stacks its progress row above a two-column action row. Keep its measured clearance
instead of assuming a fixed footer height.

Spacing follows the repeated steps in the frontmatter: tight control gaps,
comfortable panel insets, and larger section breaks. Lines and whitespace organize
ordinary content; containers are used for actual photos, reports, fields, and controls.

The legacy authenticated workspace retains its stable desktop sidebar and compact
bottom navigation with a small top bar. Its responsive layout remains independent
of the scan rail's breakpoint.

## Elevation & Depth

Scan and demo surfaces are predominantly flat, separated by paper tones and fine
rules. A small anchored map-control popup uses a restrained shadow
(`0 4px 16px rgb(20 45 49 / 12%)`); it is not the default treatment for every panel.
Existing global ambient shadows remain available to legacy artifact surfaces.
Photo crops use a dark masking scrim, and image labels use a dark graphite backing
for legibility; neither establishes glass as a general surface material.

**The Paper Before Lift Rule.** Use tone, spacing, and rules to establish hierarchy
before adding elevation; preserve the limited depth of actual overlays and artifacts.

## Shapes

Controls retain gently curved corners (`control`); fields, small navigation states,
and the demo report use the tighter `field` radius. Substantial photo and map
surfaces use `panel`. Reports remain paper-like rather than pill-shaped. Circular
region indices and timeline dots are functional location/progress markers.

## Components

### Buttons

Clear, reachable, and restrained. Primary and secondary buttons share the
frontmatter padding and control radius, with a minimum height (48px). Primary
buttons use teal on white lettering; secondary buttons use white paper, graphite,
and a fine border. Text actions are underlined teal with a minimum target (44px).
Scan buttons have a subtle pressed scale (0.985) and short ease-out transitions
(160ms); disabled states reduce opacity and remove pressed movement.

Keyboard focus is explicit: the scan uses an amber outline, while the demo uses a
teal outline (3px with offset). Reduced motion removes scan/demo transitions and
animation. Do not substitute decorative entrance choreography for task feedback.

### Inputs / Fields

Native selects use paper, graphite, a fine border, and the field radius, with a
minimum height (48px). Checkboxes and ranges use teal accents. Comparison requires
a separate, readable confirmation row; color or a draggable divider alone is not
the confirmation control.

### Navigation

The four-destination scan navigation pairs a symbol with a text label and a pale
teal active fill. The demo chapter strip is horizontally scrollable, with a filled
current chapter and persistent text labels. The fixed tour controls expose Next,
Back, Skip, Restart, progress, and an exit route rather than trapping the user in
automatic playback.

### Sample Badge and Photography

The small pale-teal Sample badge identifies the tour at the header and report.
The contact sheet includes all eight synthetic mouth-region views; individual
review screens use a generous square photo surface. Photo labels use a dark
backing; example outlines pair a white dashed stroke with a teal edge. The baseline
outline uses amber as a comparison distinction, not a disease color code.

### Observation Map, History, and Comparison

The generic procedural oral map sits on a pale mineral stage beside selectable
region rows on desktop and above them on compact screens. Provide reachable zoom,
rotation, and text alternatives. Never present it as reconstructed patient anatomy.

History is a ruled vertical timeline with small thumbnails, dates, and explicit
sample visit labels in the demo. The comparison slider shows one synthetic image
with two authored outlines. Example change is revealed only after the user
confirms the same observation; its approximate, illustrative provenance stays visible.

### Reports and States

The on-page demo report is a white, fine-bordered sheet with photo, descriptors,
comparison state, and sample provenance. Its local PDF and print actions remain
separate from the persistent tour navigation; print hides controls and keeps the
report. Keep sample labeling and limitations in both on-page and downloaded output.

Consent, results, and reports state: "This result is not a diagnosis." Do not repeat
that sentence on every navigation or capture screen. Empty/error states name what
is missing, what was protected, and the next action. Legacy workspace loading uses
restrained skeleton lines. Real clinician workspaces remain empty until a valid
patient share exists; the sample tour does not populate them. Private authenticated
routes retain ownership checks and `Cache-Control: private, no-store`.

## Do's and Don'ts

### Do:

- **Do** preserve the porcelain, graphite, mineral teal, and system-sans identity.
- **Do** open directly into the scan workspace and keep the sample tour visibly separate.
- **Do** keep photos, focus indicators, text labels, and fixed controls readable at compact widths.
- **Do** identify synthetic artwork, authored outlines, and prepared values wherever they appear.
- **Do** preserve the dense, quiet authenticated ledgers and honest empty/error states.

### Don't:

- **Don't** restore the retired marketing hero or use it as the default page template.
- **Don't** introduce decorative medical color coding, gradients, or general glass surfaces.
- **Don't** mix sample observations into saved real scans or replace a failed result with examples.
- **Don't** label the generic map a digital twin or imply clinical validity through visual polish.
- **Don't** repeat the non-diagnostic warning on every capture or navigation screen.
