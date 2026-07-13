# Dependency security status

Last verified: 2026-07-13

## Current result

| Scope | High | Critical | Moderate | Notes |
| --- | ---: | ---: | ---: | --- |
| Root production dependencies | 0 | 0 | 6 | `firebase-admin` upgraded from 13.10.0 to 14.1.0 |
| Firebase Functions production dependencies | 0 | 0 | 8 | Upgrade is blocked by the supported peer range of `firebase-functions` |
| Root dependencies including development tooling | 0 | 0 | 9 | Includes Firebase CLI and OpenTelemetry tooling chains |

The root upgrade removes the vulnerable Firestore 7 / google-gax 4 chain. The remaining
runtime findings are transitive through Google Cloud Storage, retry-request, teeny-request,
gaxios, and UUID.

## Why no forced audit fix is used

`npm audit` proposes a downgrade to `firebase-admin@10.3.0` in the root workspace. That is
not an acceptable security fix because it would replace the current supported SDK with an
older major version. In the Functions workspace it proposes `firebase-admin@14.1.0`, but
`firebase-functions@7.2.5` currently declares support only for Admin SDK 11, 12, and 13.

The repository must not use `npm audit fix --force` or package overrides that force
incompatible major versions into the Firebase dependency tree.

## Follow-up condition

Repeat the controlled upgrade when an official `firebase-functions` release declares
support for `firebase-admin` 14 or newer and Google Cloud Storage publishes a dependency
chain that clears the remaining advisories. The upgrade must include Functions tests,
emulator tests, build verification, and a Functions-only canary deployment before broad
production rollout.

Until then, CI and release reviews should treat any new high or critical production finding
as blocking. These documented moderate transitive findings are accepted temporarily and
must be rechecked during each Firebase SDK upgrade.
