# October 9 Python dependency fixes

The [Python check for `b88fdfb`](https://github.com/rohit47108/stoma3d/actions/runs/38013547487) passed the application tests, contracts, migrations, and lint checks, then failed the dependency audit. The platform export contained 17 advisories across PyJWT 2.13.0 and urllib3 2.7.0. The later container checks therefore did not run in that workflow.

## Changes

- PyJWT is locked to 2.15.1, with a minimum of 2.15.1 in the platform package. The upstream fixes cover token/key parsing and JWKS handling; 2.15.1 also preserves valid padded-token compatibility. See the [PyJWT release notes](https://pyjwt.readthedocs.io/en/stable/changelog.html#v2-15-1).
- urllib3 is locked to 2.8.0. An explicit platform dependency floor prevents boto3's HTTP transport from resolving below that reviewed version. The upstream fixes address proxy TLS verification, bounded chunk parsing, and decompression. See the [urllib3 release notes](https://urllib3.readthedocs.io/en/stable/changelog.html).
- Both the workspace lock and the independent platform-container lock were generated with uv. No unrelated package versions changed. The generator reordered workspace package entries; that is not a second set of dependency upgrades.

Authentication code, accepted algorithms, required claims, account permissions, response signing, encryption, and model gates are unchanged. The live inference service has neither affected package in its production export and was not replaced by this dependency update.

## Verification

The signed, deeply nested-token test first failed on PyJWT 2.13.0 with an uncaught `RecursionError`. After the update it produces the application's controlled validation error. Existing local-token and OIDC trust-boundary tests still pass, as does the full platform test run for that isolated update.

The frozen production exports for inference, platform, and worker each passed pip-audit 2.10.0 with no known vulnerabilities reported. No advisories were ignored. Root and all three standalone service locks passed their checks. The inference requirements export remained byte-identical.

The final full, research-enabled Python run passed 349 tests with one PostgreSQL-only skip and the existing Starlette test-client deprecation warning. An earlier full run exposed a timing-sensitive worker test: it expected two renewals during a 25 ms sleep and passed in isolation. The replacement test waits for two real lease renewals, verifies their identity and TTL, and has a bounded timeout. All 73 worker tests pass; worker implementation code is unchanged. Ruff lint and formatting passed for 161 files.

Dependency notices and the SBOM were regenerated using the frozen full research environment, rather than dropping optional training packages from the inventory. The final notice check uses the normal root environment and retains all 648 previously inventoried legal texts; only package versions and the lock hash changed. They remain separate from private model weights and medical images.

For source `c82ced0404b42c9ac8b411d32c2207048baf4d41`, both [Python checks](https://github.com/rohit47108/stoma3d/actions/runs/38015498487) and the [repository safety audit](https://github.com/rohit47108/stoma3d/actions/runs/38015498497) succeeded. CI passed 349 tests with the optional Torch test skipped, while the PostgreSQL test and migrations passed. The local research-enabled run covers that Torch test. CI also completed all three dependency audits, default model-gate checks, the inference container smoke test, and the complete container-stack build.

These are dependency and application checks, not proof of cloud-account deployment, physical-phone behavior, or medical validity. The [usability verification record](USABILITY_VERIFICATION_2026-10-01.md) records final full-suite and deployed checks separately.
