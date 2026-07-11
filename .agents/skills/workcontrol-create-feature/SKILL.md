---
name: workcontrol-create-feature
description: Use automatically when the user asks to add, implement, create, extend, or enable new WorkControl behavior, modules, integrations, workflows, or product logic. Design and implement through existing services, types, permissions, and UI patterns. Combine with workcontrol-firebase-feature for Firebase-backed work and workcontrol-ui-modernization for substantial presentation changes. Do not use for isolated bug fixes, review-only requests, or deployment.
---

# WorkControl Create Feature

## Expected input

- The requested capability, intended users, acceptance criteria, constraints, and any known UI or data requirements.
- Optional examples, screenshots, business rules, permission rules, and notification expectations.

## Mandatory workflow

1. Read the root and applicable module `AGENTS.md` files, then inspect the current route, module, services, types, validators, tests, and reusable UI.
2. Before editing, summarize the proposed user flow and impact on UI, data, backend, permissions, notifications, audit, and tests. Resolve blocking ambiguity instead of guessing.
3. Search for existing components, hooks, services, types, and similar workflows. Extend them when ownership and contracts match; avoid parallel implementations.
4. Define the feature contract: required, optional, and custom fields; validation; loading, empty, success, and error states; history or events; attachments; notifications; settings; and permission boundaries.
5. Check compatibility with existing records and future multi-company scoping. Plan additive defaults or migration handling before changing persisted shapes.
6. Implement in small module-aligned changes. Keep UI, services, types, and validation separate, and route Firebase access through dedicated services.
7. Add error handling, permission checks, audit behavior for sensitive actions, and accessible mobile-first UI consistent with WorkControl.
8. Add focused unit or component tests and Playwright coverage for critical flows. Update existing tests when contracts intentionally change.
9. Run focused tests, `npm run lint`, `npm run test:run`, and `npm run build`; run relevant Playwright tests.

## Final checks

- Verify every acceptance criterion and all user-visible states.
- Confirm existing records and existing workflows still work.
- Review the diff for duplication, dead code, unused imports, secrets, and undocumented Firebase changes.

## Forbidden

- Do not invent a second service, type, or component when an appropriate owner exists.
- Do not access Firebase directly from a component when a service boundary exists.
- Do not use fragile DOM workarounds, hardcoded credentials, or production data in tests.
- Do not commit, push, or deploy unless separately requested.

## Output

Report the analyzed architecture, implemented flow, files and contracts changed, tests and commands, compatibility decisions, risks, and manual verification steps.
