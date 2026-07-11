---
name: workcontrol-code-review
description: Use automatically when the user asks to review WorkControl code, a branch, a diff, or an implementation from Codex or another agent; find defects, security issues, regressions, compatibility risks, performance problems, and missing tests. Combine with workcontrol-quality-check when executable verification is requested. Do not modify code or deploy unless separately requested.
---

# WorkControl Code Review

## Expected input

- A branch, commit, pull request, diff, file set, or clearly described change scope.
- Optional acceptance criteria, known risks, and test evidence.

## Mandatory workflow

1. Read the root and all applicable nested `AGENTS.md` files.
2. Establish the review baseline and inspect the complete diff, status, surrounding implementation, callers, services, types, tests, and relevant data contracts.
3. Verify behavior against the stated requirements. Trace critical flows rather than reviewing changed lines in isolation.
4. Look first for user-visible bugs, data loss, permission bypasses, secret exposure, race conditions, stale React state, incorrect hook dependencies, duplicate subscriptions, and error-handling gaps.
5. Review Firebase access, rules, Functions validation, audit behavior, idempotency, query bounds, indexes, Storage paths, and compatibility with existing documents.
6. Check duplication, ownership boundaries, fragile DOM workarounds, unnecessary abstractions, performance, mobile and browser behavior, accessibility, and WorkControl design consistency.
7. Check tests for meaningful regression coverage, Firebase mocking or emulator isolation, stable assertions, and missing critical cases.
8. Run focused read-only verification commands when practical. Do not change files merely to make review evidence easier.
9. Confirm every finding is actionable, reproducible or strongly evidenced, and tied to a precise file and line.

## Finding order

1. Critical findings: security, data loss, broken core flow, production risk.
2. Important findings: likely bugs, regressions, compatibility, reliability, or performance issues.
3. Improvements: maintainability or UX issues with concrete value.
4. Test gaps and residual risk.

## Final checks

- Remove speculative or style-only noise unless it violates an explicit project rule.
- If no findings remain, say so clearly and identify untested or environment-dependent risk.
- Verify the review itself did not modify the worktree.

## Forbidden

- Do not edit code, commit, push, deploy, or use Firebase production unless the user separately requests implementation.
- Do not hide findings in a summary or lead with praise before defects.
- Do not claim certainty without evidence or invent requirements absent from code and task context.

## Output

Lead with findings ordered by severity and precise file/line references, then list open questions, test gaps, and a brief change summary.
