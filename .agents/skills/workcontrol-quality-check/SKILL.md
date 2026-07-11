---
name: workcontrol-quality-check
description: Use automatically when the user asks to verify WorkControl changes, run all checks, assess readiness, decide whether commit or deploy is safe, or perform a quality check. Inspect the diff, secrets, lint, tests, build, and relevant E2E flows. Combine with workcontrol-code-review for semantic review and run before workcontrol-safe-deploy. Do not use to implement features or publish changes.
---

# WorkControl Quality Check

## Expected input

- The change scope, target branch or diff, intended release surface, and any critical workflows named by the user.
- Optional known failures, skipped checks, or environment limitations.

## Mandatory workflow

1. Read the root and applicable nested `AGENTS.md` files.
2. Inspect the current branch, `git status`, staged and unstaged diffs, and untracked files. Do not alter or discard user changes.
3. Compare the diff with the stated scope. Flag unrelated edits, generated output, unexpected lockfile changes, accidental Firebase changes, and missing tests.
4. Search changed content for exposed secrets, credentials, `.env` values, personal data, production identifiers, and unsafe logging without printing sensitive values.
5. Review for TypeScript errors, unused imports, dead code, fragile DOM manipulation, missing error handling, permission gaps, race conditions, and incompatible data changes.
6. Run `git diff --check`, `npm run lint`, `npm run test:run`, and `npm run build`.
7. Run focused tests and relevant stable Playwright smoke or critical-flow tests when the changed surface is user-facing.
8. Inspect failures and separate pre-existing failures from regressions introduced by the current diff using evidence.
9. Do not make fixes unless the user asked for remediation. If remediation is requested, keep it limited to findings and rerun every affected check.

## Final checks

- Confirm each required command passed, failed, or could not run; never imply an unrun check passed.
- State whether the changes are safe for commit and separately whether they are safe for deployment.
- List residual manual checks and environment-dependent risks.

## Forbidden

- Do not expose secret values in output.
- Do not ignore failing checks, weaken tests or lint rules, or classify a regression as pre-existing without evidence.
- Do not commit, push, deploy, or use Firebase production.

## Output

Lead with pass or fail, then list blocking findings, important warnings, commands and exact outcomes, test coverage, manual checks, and commit/deploy readiness.
