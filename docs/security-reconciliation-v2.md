# Security reconciliation V2

Last verified: 2026-07-13

## Scope

An older local WorkControl workspace contained unfinished Firebase security changes based on
an obsolete application revision. Those files were reviewed semantically against current
`main`; they were not merged or copied wholesale.

## Reconciliation result

| Legacy area | Current implementation | Decision |
| --- | --- | --- |
| Public account bootstrap | Login accepts only existing active internal profiles | Keep current implementation |
| Company isolation | Company-scoped Rules, operational views, migration tooling and adversarial emulator tests | Keep current implementation |
| Vehicle privileged writes | Callable transactions protect assignment, mileage and tracker commands | Keep current implementation |
| Timesheets | Atomic idempotent start/stop and field allowlists | Keep current implementation |
| Audit and AI logs | Actor, company, timestamps and snapshots are server-owned | Keep current implementation |
| Notifications | Server allowlist, company checks, idempotency and rate limiting | Keep current implementation |
| GPS metadata | Operational views exclude tracker and diagnostic secrets | Keep current implementation |
| FMC130 command tests | Current callable existed without a direct unit contract | Add the missing Functions regression test |

The older rollout documents were not imported because they described active employee
self-bootstrap and broad legacy reads that are no longer valid. The current source of truth
remains `company-isolation-migration.md` plus the executable Rules and emulator tests.

## Verified controls

- Unknown, pending and disabled accounts cannot read internal data.
- Company users cannot read cross-company users, vehicles, tools or maintenance data.
- Employees and managers cannot write privileged vehicle command documents directly.
- Tracker commands require an administrator with company access, a valid binding, an
  allowlisted command, a bounded duration and an idempotency key.
- Command creation, active lock and audit write are transactional.
- Client-created arbitrary audit, AI, system and notification content is rejected.
- GPS route, simulation, jitter, gateway and payload code are unchanged by this
  reconciliation.

## Deployment impact

This reconciliation changes tests and documentation only. It does not require a Functions,
Firestore Rules or Storage Rules deployment. The updated login visual baseline belongs to
the existing internal-only authentication behavior already present in `main`.

`GPS_FUNCTIONAL_DIFF_ZERO`
