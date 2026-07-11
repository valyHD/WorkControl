---
name: workcontrol-task-router
description: Use automatically at the start of any non-trivial WorkControl task that needs procedure selection, especially bug, feature, Firebase, UI, review, quality, deploy, mixed, or multi-part requests. Classify the request, split mixed work into subtasks, select the minimum relevant WorkControl skills, order them safely, and state the selection. Do not execute delegated workflows, route trivial direct edits, or relax AGENTS.md rules.
---

# WorkControl Task Router

Classify and route the request. Do not implement, test, review, or deploy within this skill;
the selected skills own those workflows.

## Input

- The complete user request and available task context.
- Current repository location and applicable `AGENTS.md` files.

## Routing procedure

1. Read the root `AGENTS.md` before routing.
2. Interpret intent semantically. Treat the phrases below as indicators, not exact regexes.
3. Split a mixed request into independent subtasks and identify likely file overlap.
4. Select only the minimum relevant skills and order them using the rules below.
5. Announce `Skills selectate: <ordered skill names>` in the first progress update.
6. Briefly list the subtasks, routing reason, order, and any overlap requiring sequential work.
7. Load and follow each selected `SKILL.md` in order. The router itself performs no delegated
   execution.
8. If the request is a trivial direct edit, select no specialized skill and follow
   `AGENTS.md` directly.

## Classification

### Bug or incorrect behavior

Indicators include `nu merge`, `eroare`, `bug`, `se blocheaza`, `nu salveaza`,
`afiseaza gresit`, `nu se actualizeaza`, `a disparut`, `s-a stricat`, and
`reproduce si repara`.

- Primary: `workcontrol-debug-bug`.
- Add `workcontrol-firebase-feature` when Firebase is part of the failing flow.

### New functionality

Indicators include `adauga`, `implementeaza`, `creeaza`, `vreau sa poata`, `functie noua`,
`modul nou`, and `integrare noua`.

- Primary: `workcontrol-create-feature`.
- Add `workcontrol-firebase-feature` for Auth, Firestore, Storage, Functions, Hosting,
  rules, indexes, notifications, audit, or persisted Firebase data.
- Add `workcontrol-ui-modernization` only when substantial UI reorganization is also asked.

### UI and UX

Indicators include `modernizeaza`, `stilizeaza`, `arata mai bine`, `reorganizeaza pagina`,
`responsive`, `dashboard`, `carduri`, `tabele`, `grafice`, and reports that a page is hard
to understand.

- Primary: `workcontrol-ui-modernization` for presentation-only work.
- Use `workcontrol-create-feature` first when new behavior or product logic is required.

### Firebase

Indicators include Firebase Auth, Firestore, Storage, Functions, Cloud Functions, Hosting,
rules, indexes, notifications, audit log, and `serverTimestamp`.

- Use `workcontrol-firebase-feature` as the Firebase procedure.
- Do not use it alone for a large product request. Pair it with `workcontrol-create-feature`
  or `workcontrol-debug-bug` according to intent.

### Quality before commit or release

Indicators include `verifica modificarile`, `este gata`, `pot face commit`,
`ruleaza toate testele`, `verificare completa`, and `quality check`.

- Primary: `workcontrol-quality-check`.

### Deploy

Indicators include `deploy`, `publica`, `urca pe Firebase`, `pune live`, `hosting`, and
`functions deploy`.

- Required order: `workcontrol-quality-check`, then `workcontrol-safe-deploy`.
- Never execute deployment without the final explicit confirmation required by the deploy
  skill.

### Code review

Indicators include `fa review`, `analizeaza codul facut`, `verifica ce a modificat Codex`,
`cauta probleme`, `verifica branch-ul`, and `verifica implementarea altui agent`.

- Primary: `workcontrol-code-review`.
- Add `workcontrol-quality-check` only when executable verification is also requested.

## Combination order

- New Firebase feature: `workcontrol-create-feature` -> `workcontrol-firebase-feature`.
- Firebase bug: `workcontrol-debug-bug` -> `workcontrol-firebase-feature`.
- UI modernization without new logic: `workcontrol-ui-modernization`.
- UI modernization with new logic: `workcontrol-create-feature` ->
  `workcontrol-ui-modernization`.
- New Firebase feature with major UI work: `workcontrol-create-feature` ->
  `workcontrol-firebase-feature` -> `workcontrol-ui-modernization`.
- Review with executable checks: `workcontrol-code-review` -> `workcontrol-quality-check`.
- Deploy preparation: `workcontrol-quality-check` -> `workcontrol-safe-deploy`.

For mixed bug, feature, and UI work, route in this order: bug first, feature second,
Firebase procedure where relevant, UI last, then requested quality or deploy steps. When
subtasks can touch the same files, require sequential execution and one final verification
pass.

## Output

Use this concise structure:

```text
Skills selectate: workcontrol-debug-bug, workcontrol-firebase-feature
Subtaskuri: <short classified list>
Ordine: <ordered skills>
Motiv: <one sentence>
Risc de suprapunere: <none or affected area; use sequential execution>
```

Do not ask the user to choose a skill unless the intent remains genuinely ambiguous after
using the available context.
