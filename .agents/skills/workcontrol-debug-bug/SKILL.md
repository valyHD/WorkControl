---
name: workcontrol-debug-bug
description: Use automatically when WorkControl behavior is broken, incorrect, blocked, missing, inconsistent, no longer updating, or regressed, including requests to reproduce or repair a bug. Reproduce the issue, find the root cause, add a regression test, and make the minimum safe fix. Combine with workcontrol-firebase-feature when Auth, Firestore, Storage, Functions, rules, or indexes are involved. Do not use for net-new features or visual-only redesigns.
---

# WorkControl Debug Bug

## Expected input

- A bug report, expected behavior, and any reproduction steps, screenshots, logs, affected records, or environment details available.
- Explicit constraints such as files or behavior that must remain unchanged.

## Mandatory workflow

1. Read the root `AGENTS.md` and every applicable nested `AGENTS.md` before inspecting or editing code.
2. Inspect `git status` and the relevant diff. Preserve unrelated and pre-existing user changes.
3. Map the complete affected flow from route and UI through React state, hooks, services, validators, Firebase Functions, rules, and persisted data as applicable.
4. Reproduce the bug before changing code. Record expected versus actual behavior and gather objective evidence from tests, logs, or a controlled local scenario.
5. Identify the root cause and blast radius. Distinguish the cause from visible symptoms and check all callers of the faulty code.
6. Add or update the smallest useful regression test and confirm it fails for the reported reason before the fix when practical.
7. Implement a minimal fix using existing types, services, and patterns. Include explicit error handling and preserve backward compatibility.
8. Run the focused regression test first, then the relevant module suite. Run `npm run lint`, `npm run test:run`, and `npm run build`; run Playwright for a critical UI flow.
9. Recheck the original reproduction and nearby behavior after the fix.

## Final checks

- Confirm the test protects the actual root cause.
- Inspect the final diff for accidental formatting, generated files, secrets, schema changes, and unrelated edits.
- State any verification that could not run and the resulting residual risk.

## Forbidden

- Do not replace diagnosis with a timing delay, arbitrary DOM manipulation, silent catch, duplicate service, or data-specific special case.
- Do not use Firebase production for reproduction or tests.
- Do not refactor unrelated code or alter a data contract without a compatible migration plan.
- Do not commit, push, or deploy unless the user separately requests it.

## Output

Report the reproduction, root cause, files changed, regression tests, commands and results, risks, and exact manual checks still needed.
