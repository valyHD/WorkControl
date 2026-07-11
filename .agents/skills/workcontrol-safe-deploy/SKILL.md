---
name: workcontrol-safe-deploy
description: Use automatically only when the user asks to deploy, publish, put live, upload to Firebase, or deploy WorkControl Hosting, Functions, rules, indexes, or Storage rules. Always run workcontrol-quality-check first, choose the smallest target set, and require final explicit confirmation. Do not use for readiness checks without deployment intent or ordinary implementation work.
---

# WorkControl Safe Deploy

## Expected input

- An explicit request to deploy, the intended environment or Firebase project, and the feature or changes expected to go live.
- Any desired target restrictions such as Hosting only or named Functions.

## Mandatory workflow

1. Read the root `AGENTS.md`, `functions/AGENTS.md` when relevant, and all deployment configuration before taking action.
2. Inspect the current branch, `git status`, complete diff, Firebase project selection, aliases, configuration, and recent build state. Never hide a dirty tree.
3. Identify exactly which deployable surfaces changed: Hosting, named Functions, Firestore rules, Firestore indexes, Storage rules, or other configured targets.
4. Run the `workcontrol-quality-check` workflow and stop on a build failure, test regression, secret exposure, wrong project, missing authentication, or ambiguous deploy scope.
5. Select the smallest target set:
   - Frontend-only changes: Hosting only.
   - Function changes: only the named Functions when supported.
   - Rule or index changes: only the corresponding target.
   - Multiple surfaces: only the changed surfaces.
6. Present the Firebase project, included changes, excluded dirty changes, exact deploy command, and expected impact. Ask for final explicit confirmation after this plan, even when the initial request expressed deployment intent.
7. Execute only the confirmed command. If authentication or project selection requires the user, stop and provide the exact command or confirmation needed without requesting credentials.
8. Stop immediately on failure. Do not broaden the target or retry a full deploy to bypass an error.
9. After success, verify the Firebase output and the affected public flow without modifying production data.

## Final checks

- Confirm the deployed project and targets match the approved plan.
- Report the Hosting URL or deployed Functions and rules when Firebase provides them.
- State any component intentionally not deployed and any post-deploy manual check.

## Forbidden

- Do not deploy without the final explicit confirmation step.
- Do not run a full Firebase deploy for frontend-only work or include unrelated dirty changes.
- Do not print or store credentials, alter production data, skip failed quality checks, commit, or push unless separately requested.

## Output

Before approval, report the exact proposed scope and command. After execution, report status, project, targets, URL or components, verification, warnings, and rollback considerations.
