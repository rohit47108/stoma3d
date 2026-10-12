# Changelog

All notable Stoma3D source-release changes are recorded here.

## Unreleased

### Fixed

- Opening a completed browser scan from History now shows its observation map;
  unfinished scans still resume at the next missing region.
- Home distinguishes returning users from first-time scans and opens the newest
  completed result even when saved records are restored out of order.
- Native reports use compact print spacing, keep page notices clear of
  headings, and add page numbers before encryption. A failed PDF update is
  discarded and its temporary file is removed.
- Reports finishing after a timeout now clean up their temporary PDF, with a
  deletion retry and next-launch recovery if device storage fails. Active report
  creation stays protected from background cleanup.
- Android photo selection no longer shows a false "photo cleared" warning when
  the system picker returns or is canceled. A newly prepared photo clears an
  older interruption warning without bypassing review or temporary-file cleanup.

## 0.1.0 - 2026-08-13

### Added

- Complete local-first eight-region iOS and Android observation workflow with
  encrypted storage, quality/privacy rejection, signed live analysis, reports,
  accessibility controls, deletion, and offline recovery.
- Responsive public, patient, clinician, and administrator web workspaces.
- Optional account/cloud platform with OIDC, PostgreSQL, private object storage,
  Redis-backed work, encrypted sync, sharing, reports, videos, generic 3D
  observation surfaces, analytics consent, and clinician review.
- Calibrated-card sizing path and fail-closed neutral-reference correction for
  approximate redness and brightness descriptors.
- User-confirmed longitudinal matching, gated registration, clipped comparison
  reveal, mask timeline, and explicit suppression when repeat-capture evidence
  is unavailable.
- Locked contracts, OpenAPI, migrations, model cards, threat/privacy material,
  deployment runbooks, CI, source packager, dependency notices, and CycloneDX
  inventory.

### Security

- Added SQLCipher runtime verification, encrypted files, strict OIDC/JWKS and
  current-role checks, bounded privileged tokens, Ed25519 inference-response
  verification, CSP/HSTS/no-index controls, request limits, rate limits,
  checksum-bound storage, safe logging, secret scanning, retention, and
  restart-safe account deletion.
- Account deletion immediately blocks normal work, revokes sharing and access,
  cancels work, prevents account resurrection, waits out outstanding upload
  capabilities, and verifies a final cleanup before completion.

### Release boundaries

- This is a non-diagnostic academic competition/research source release. It is
  not clinical validation or regulatory clearance.
- Quantitative longitudinal change, urgency, appearance, disease-category,
  learned quality/OOD/tissue, and automated re-identification remain disabled
  until their documented evidence gates pass.
- The current candidate-segmentation weight is restricted to the documented
  academic research/non-commercial scope pending written redistribution rights
  or a passing properly licensed replacement.
- A repository-wide source license has not been selected. Keep distribution
  private until the owners choose one and resolve the model-rights boundary.
