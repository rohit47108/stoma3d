# Mobile response deadlines, October 16, 2026

## Fault and correction

The native API client previously cleared its 18-second timeout as soon as response headers arrived. Reading the body and checking the signed response happened afterward, without a deadline. Its timer also only aborted the transport: a transport that ignored abort could leave the caller waiting indefinitely. Source commit `73260156e885e27ae0ea2215e71b000afa4a7a21` corrects this behavior.

Two new tests reproduced those distinct failures before implementation. Neither promise settled after 18,001 simulated milliseconds. The corrected private helper keeps one deadline through the advisory connectivity check, fetch, body reading, and signed JSON verification. It rejects at the deadline as well as aborting the underlying request. It also honors model-card cancellation before the request, before headers, and while reading the body.

The existing request deadline was not increased. Analysis and comparison still validate their shared schemas, identities, and origins after verified JSON is returned. Model-card retrieval and analysis remain separate requests, each with its own deadline. Timer execution cannot preempt synchronous JavaScript or a blocked native/UI thread; this is not a fix for every possible application freeze.

No server destination, model, release gate, signature policy, encryption, deletion behavior, or stored-data schema changed. No new dependency was added. The change does not address the separately observed intermittent Android PDF timeout.

## Controlled regression checks

The tests use the actual API client, contract schemas, transport policy, and Ed25519 verification. Only native file/network boundaries and fetch are controlled. The test signing seed is deterministic and is never a deployment credential. No test image or request is sent to an external service by these tests.

Eighteen API-client cases cover:

- Stalled headers and stalled body, including transports that ignore abort.
- Stalled advisory connectivity check, actual offline status, and an unavailable advisory check.
- Caller cancellation before the request, before headers, and during the body.
- Successful signed model-card verification, with timer/listener cleanup.
- Rejection of missing privacy headers, replayed request identity, changed signed bytes, invalid JSON, and an invalid model-card schema.
- Distinct connection and verified server errors.
- Timed-out analysis preserving local quality with no mask or descriptors, even after a late body resolves.
- Timed-out comparison suppressing all change output.

The five-file focused run passed 137 tests, including capture-route and encrypted-retry store recovery tests. These are controlled tests, not evidence of a native response-body stall reproduced on a physical phone.

The workspace JavaScript run passed 811 tests: scripts 24, contracts 33, mobile 505, and web 249. Workspace TypeScript and Prettier checks passed. The dependency and repository artifact/provenance audits passed.

The full Python services/ML run passed 349 tests, with one external-PostgreSQL test skipped and one existing Starlette/httpx deprecation warning. Web ESLint passed. Web and inference source were unchanged by this increment; the earlier full browser journeys were not repeated as new coverage.

## Native artifacts

The x86_64 and ARM64 Android release builds passed. They use the existing local Android test signing certificate, not store-release signing. Both APKs contain JavaScript bundle SHA-256 `a09a643443817a7016d2e099977650f59d3225f1bab2256a8599e7e63f7935b4`. The release source map matches the exact changed API client. Certificate and architecture contents were verified before use.

| Artifact                                          |     Bytes | SHA-256                                                            | Scope                                                                 |
| ------------------------------------------------- | --------: | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `Stoma3D-2026-10-16-response-deadline-x86_64.apk` | 102678523 | `e79068708c209dcefc97eb3ea250583e712bce2c9a88af8dfca5d378b9b22884` | Installed in place on the existing simulator                          |
| `Stoma3D-2026-10-16-response-deadline-arm64.apk`  |  98186633 | `9efed4c0c03ba36635f18b37c801b664ff7c7cf8f03cae19ab47601c71eb3a8f` | Build and contents verified; not installed on a physical phone        |
| iOS `index-26beb6d183c0e2d10a5346dc4670a6d2.hbc`  |   9401410 | `f426de616ae742ece7b96710f304524127380d5805fe706e1d5b828015f62da8` | JavaScript/assets export only, not an installable signed iPhone build |

The artifacts remain in ignored `outputs/native`, not the public repository. All 42 iOS export assets are present; its bundle contains the configured production inference URL and public response-verification key.

## Simulator continuity

The existing Android simulator initially displayed an Android System UI startup warning. Choosing Wait allowed the launcher and Stoma3D to recover without wiping or resetting the device. The saved partial scan reopened at 1/8 with its October 15 top-of-tongue result.

The temporary High contrast, Larger key text, and Reduce motion preferences were all restored to their original off positions through Settings. Standard animation speed and enabled haptic cues were left unchanged. Home and Settings were visually inspected with larger text/high contrast during the earlier check; that partial coverage is not a complete accessibility or screen-reader audit.

## Live upload check

After the in-place package update, Home still showed the existing 1/8 scan. Continue scan opened the next unfinished region, Tongue underside. The previously approved mouth-only photo passed local review, was sent to the configured production analysis service, and opened a real October 16 result for the underside of the tongue. The result correctly said no candidate area was outlined; no substitute or observation pin was created.

View on 3D map rendered the map with Tongue underside selected and 2/8 coverage. After closing only Stoma3D from Android recent apps and reopening it, Home still showed 2/8 and the October 16 underside-of-tongue recent result. That result reopened with the correct photo, region, date, and no-candidate outcome. No saved scans or app data were cleared for this check.

This is one uploaded-region continuity check, not a new complete scan, ten consecutive native journeys, or a real-camera test. The stalled-response cases above remain controlled API-client tests, not simulator fault injection. Physical-camera, iPhone, screen-reader, repeated complete native-scan, and PDF-timeout investigations remain separate release requirements.

## Sources

The [React Native 0.86 AbortController reference](https://reactnative.dev/docs/0.86/global-AbortController) points to the web-standard API. The [abort method reference](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort) covers aborting fetch and response-body consumption. The explicit promise deadline additionally ensures the application-facing operation settles when the controlled transport does not honor cancellation.
