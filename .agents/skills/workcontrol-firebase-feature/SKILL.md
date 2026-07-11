---
name: workcontrol-firebase-feature
description: Use automatically when a WorkControl task changes or diagnoses Firebase Auth, Firestore, Storage, Functions, Hosting, rules, indexes, notifications, audit logs, server timestamps, or persisted Firebase data. Combine with workcontrol-create-feature for new capabilities or workcontrol-debug-bug for defects. Do not use alone for broad product or UI work, ordinary local logic, or deploy execution.
---

# WorkControl Firebase Feature

## Expected input

- The business operation, actors, required data, access rules, side effects, and acceptance criteria.
- Any known collections, Functions, Storage paths, legacy records, or migration constraints.

## Mandatory workflow

1. Read the root `AGENTS.md`, `functions/AGENTS.md`, and applicable module instructions.
2. Inspect existing Firebase initialization, services, converters, types, Functions, rules, indexes, emulator configuration, and tests before proposing changes.
3. Define the data contract and document every collection, document key, field, type, optional/default value, ownership scope, timestamp, and retention implication introduced or changed.
4. Preserve existing records. Prefer additive changes and tolerant reads; provide a migration and rollback strategy for any incompatible change.
5. Keep Firestore and Storage operations in dedicated services. Use callable or server-side Functions for privileged, secret-bearing, cross-record, or trusted side effects when justified.
6. Validate and normalize all inputs at trust boundaries. Enforce authentication, authorization, tenant or company scope, and least privilege in both code and rules.
7. Use server timestamps where authoritative ordering or audit time matters. Add audit records for sensitive updates without storing unnecessary personal data.
8. Make retries safe. Use transactions, batches, deterministic identifiers, or idempotency keys for operations that can be repeated or partially fail.
9. Update Firestore and Storage rules and indexes when required, keeping client code and security rules consistent.
10. Test against the Firebase Emulator Suite with isolated fixtures. Cover allowed access, denied access, invalid input, retries, errors, and compatibility with older records.
11. Run focused tests, `npm run lint`, `npm run test:run`, and `npm run build`; run Functions or rules tests as applicable.

## Final checks

- Confirm no test or command targeted production Firebase.
- Confirm secrets are read from supported environment or Firebase secret management and are absent from the diff and logs.
- Review costs, query bounds, indexes, race conditions, error recovery, and audit behavior.

## Forbidden

- Do not hardcode credentials, tokens, project secrets, production identifiers, or permissive rules.
- Do not write directly from UI components when a service owns the operation.
- Do not delete or rewrite production data, run migrations, or deploy without separate explicit approval.

## Output

Report the Firebase components affected, documented data contract, security model, compatibility plan, emulator tests, commands and results, required indexes or configuration, and remaining manual steps.
