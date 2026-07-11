# WorkControl Codex Skill Routing

This document describes automatic selection for repository-scoped skills in
`.agents/skills`. The semantic trigger is each `SKILL.md` frontmatter description.
`agents/openai.yaml` keeps UI metadata and explicitly enables implicit invocation.

The router classifies and orders work; it does not execute another skill's workflow.
Explicit `$skill-name` invocation remains available.

## Routing matrix

| Request type | Primary skill | Secondary skills | Required order | Example indicators | Do not use when |
| --- | --- | --- | --- | --- | --- |
| Broken or incorrect behavior | `workcontrol-debug-bug` | `workcontrol-firebase-feature` when Firebase is involved | debug -> Firebase | nu merge, eroare, se blocheaza, nu salveaza, a disparut | The request is a net-new feature or visual-only change |
| New capability | `workcontrol-create-feature` | Firebase and UI skills as needed | create -> Firebase -> UI | adauga, implementeaza, creeaza, modul nou | The task is only a bug, review, quality check, or deploy |
| Visual modernization | `workcontrol-ui-modernization` | `workcontrol-create-feature` for new logic | create -> UI when logic is new | modernizeaza, responsive, dashboard, carduri | The request changes only backend logic or fixes an isolated defect |
| Firebase change | `workcontrol-firebase-feature` | create for features, debug for defects | create/debug -> Firebase | Firestore, Storage, Functions, rules, indexes | Ordinary local logic or broad UI work without Firebase impact |
| Readiness check | `workcontrol-quality-check` | code review when semantic review is requested | review -> quality | este gata, pot face commit, ruleaza testele | Feature implementation or publishing itself |
| Deployment | `workcontrol-safe-deploy` | `workcontrol-quality-check` is mandatory | quality -> deploy | deploy, publica, pune live, hosting | There is no explicit deployment intent |
| Review | `workcontrol-code-review` | quality for executable checks | review -> quality | fa review, verifica branch-ul, cauta probleme | The user asked to implement fixes rather than review only |
| Trivial direct edit | None | None | direct | change one label or static typo | The request has risk, multiple steps, or a specialized workflow |

## Mixed requests

Split mixed requests by intent. Route defects first, then new behavior, Firebase-specific
work, UI modernization, requested review or quality checks, and deployment last. Inspect
whether subtasks touch the same files. If they can overlap, execute sequentially and run one
final verification pass.

Example: `Modernizeaza pagina Masini, adauga filtre si repara actualizarea soferului.`

1. Driver update defect: `workcontrol-debug-bug`.
2. New filters: `workcontrol-create-feature`.
3. Page redesign: `workcontrol-ui-modernization`.
4. Likely overlap in vehicle page state and components: execute sequentially in that order.

## WorkControl examples

| # | Example request | Primary | Secondary | Order | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | GPS-ul deseneaza linii cand masina sta pe loc. | debug | none | debug | Incorrect GPS behavior |
| 2 | Traseul unei masini a disparut de pe harta. | debug | Firebase if persisted points are affected | debug -> Firebase | Regression with possible stored telemetry impact |
| 3 | Kilometrii masinii nu se salveaza. | debug | Firebase | debug -> Firebase | Broken persisted vehicle update |
| 4 | Creeaza documente pentru masini cu upload. | create | Firebase | create -> Firebase | New module using Storage and metadata |
| 5 | Reorganizeaza formularul masinii pe mobil. | UI | none | UI | Presentation-only responsive work |
| 6 | Pornirea pontajului da eroare Firestore. | debug | Firebase | debug -> Firebase | Firebase-backed defect |
| 7 | Orele pontajului activ nu se actualizeaza live. | debug | none | debug | Existing live calculation is broken |
| 8 | Adauga aprobarea proiectelor de pontaj. | create | Firebase | create -> Firebase | New persisted workflow and permissions |
| 9 | Concediul calculeaza gresit ultima zi. | debug | none | debug | Incorrect interval calculation |
| 10 | Adauga aprobarea concediilor de manager. | create | Firebase | create -> Firebase | New state, permission, and audit flow |
| 11 | Modernizeaza calendarul de concedii. | UI | none | UI | Visual modernization without new logic |
| 12 | Raportul PDF de mentenanta nu se genereaza. | debug | Firebase if a Function fails | debug -> Firebase | Existing report flow is broken |
| 13 | Adauga campuri custom la clientii de mentenanta. | create | Firebase | create -> Firebase | New data contract and UI |
| 14 | Trimite notificari pentru lifturile cu revizia expirata. | create | Firebase | create -> Firebase | New notifications and queries |
| 15 | Fa dashboardul Mentenanta mai clar. | UI | none | UI | Dashboard hierarchy and clarity |
| 16 | Bonul nu se incarca in Storage. | debug | Firebase | debug -> Firebase | Storage upload defect |
| 17 | Adauga istoric pentru scanarea bonurilor. | create | Firebase | create -> Firebase | New persisted event history |
| 18 | Un utilizator primeste acces interzis desi are rolul corect. | debug | Firebase | debug -> Firebase | Auth or rules regression |
| 19 | Creeaza permisiune noua pentru managerul de service. | create | Firebase | create -> Firebase | New authorization capability |
| 20 | Stilizeaza cardurile din dashboard. | UI | none | UI | Visual-only request |
| 21 | Verifica regulile Firestore modificate de alt agent. | review | quality | review -> quality | Security review plus executable validation |
| 22 | Adauga filtre Firestore pentru lifturi. | create | Firebase | create -> Firebase | New query behavior and likely indexes |
| 23 | Verifica toate modificarile inainte de commit. | quality | none | quality | Commit readiness |
| 24 | Publica doar frontendul pe Hosting. | deploy | quality | quality -> deploy | Explicit scoped publish request |
| 25 | Fa deploy numai la functia de notificari. | deploy | quality | quality -> deploy | Explicit named Function deployment |
| 26 | Fa review la branch-ul altui agent. | review | none | review | Review-only request |
| 27 | Fa review si ruleaza testele relevante. | review | quality | review -> quality | Semantic and executable verification |
| 28 | Repara soferul, adauga filtre si modernizeaza Masini. | debug | create, UI | debug -> create -> UI | Mixed task with likely file overlap |
| 29 | Audit log-ul notificarilor nu se scrie. | debug | Firebase | debug -> Firebase | Broken Firebase audit behavior |
| 30 | Schimba textul butonului Salveaza in Confirma. | none | none | direct | Trivial direct edit |
| 31 | Creeaza modul pentru inventarul de scule. | create | Firebase if persistence is required | create -> Firebase | New business module |
| 32 | Pagina GPS toate masinile este greu de folosit pe telefon. | UI | none | UI | Responsive usability issue without stated defect |

## Required conceptual routing tests

| # | Request | Primary | Secondary | Order | Reason |
| --- | --- | --- | --- | --- | --- |
| 1 | GPS-ul traseaza linii cand masina sta pe loc. | `workcontrol-debug-bug` | none | debug | Existing GPS behavior is incorrect |
| 2 | Adauga aprobarea concediilor de catre manager. | `workcontrol-create-feature` | `workcontrol-firebase-feature` | create -> Firebase | New persisted approval and permission workflow |
| 3 | Modernizeaza pagina Pontaje. | `workcontrol-ui-modernization` | none | UI | Presentation-only modernization |
| 4 | Adauga notificari Firebase pentru ITP. | `workcontrol-create-feature` | `workcontrol-firebase-feature` | create -> Firebase | New capability explicitly backed by Firebase |
| 5 | Verifica modificarile inainte de commit. | `workcontrol-quality-check` | none | quality | Explicit commit-readiness check |
| 6 | Fa deploy doar la hosting. | `workcontrol-safe-deploy` | `workcontrol-quality-check` | quality -> deploy | Explicit scoped deploy; confirmation remains mandatory |
| 7 | Verifica implementarea facuta de alt agent. | `workcontrol-code-review` | none | review | Review of another agent's implementation |
| 8 | Modernizeaza Mentenanta si adauga filtre Firestore. | `workcontrol-create-feature` | Firebase, UI | create -> Firebase -> UI | New query logic plus substantial UI work |
| 9 | Bonul nu se incarca in Storage. | `workcontrol-debug-bug` | `workcontrol-firebase-feature` | debug -> Firebase | Broken Storage-backed flow |
| 10 | Creeaza modul nou pentru documentele masinilor. | `workcontrol-create-feature` | `workcontrol-firebase-feature` | create -> Firebase | New documents module likely needs Storage and metadata |
| 11 | Verifica daca schimbarile sunt sigure si apoi pregateste deploy-ul. | `workcontrol-quality-check` | `workcontrol-safe-deploy` | quality -> deploy | Readiness followed by explicit deploy preparation |
| 12 | Schimba doar textul unui buton. | none | none | direct | Simple edit does not justify a specialized skill |

## Automatic behavior

1. Codex scans repository skill descriptions and can invoke them without `$skill-name`.
2. `workcontrol-task-router` handles non-trivial selection, mixed-task splitting, ordering,
   and a concise initial announcement.
3. The selected skill bodies provide the actual implementation, verification, review, or
   deployment procedures.
4. Every skill keeps `allow_implicit_invocation: true`; explicit invocation still overrides
   ambiguity.
5. Deployment always routes through quality first and still requires final explicit user
   confirmation.
6. If new or changed skills do not appear in the picker, restart Codex to force reindexing.
