# Assistant Integration Plan

## 1. Fundația existentă

Asistentul actual are elementele corecte pentru integrare controlată:

- contract versionat V3;
- Structured Output pentru interpretare;
- `AssistantToolRegistry` unic și aliases;
- pipeline permission -> resolve -> validate -> preview/confirm -> execute -> audit;
- adapters pentru navigation, entities, forms, timesheets și servicii;
- confirmare și clarificare la ambiguitate;
- form drafts prin event/state, nu completare arbitrară a primului input;
- matrice cu peste 150 comenzi românești;
- fallback audio opt-in;
- audit hook.

Integrarea V4 nu trebuie să reintroducă DOM fallback sau Firebase direct în
`VoiceCommandAssistant.tsx`.

## 2. Tool-uri noi

| Tool ID | Risc | Scop |
| --- | --- | --- |
| `documents.openInbox` | low | Deschide inboxul de documente cu filtre. |
| `documents.uploadDraft` | medium | Deschide flow-ul de upload pentru entitate; fișierul este ales de utilizator. |
| `documents.listForEntity` | low | Listează metadata permisă, paginată. |
| `documents.getReview` | low | Afișează draftul și diferențele. |
| `documents.acceptFields` | high | Acceptă câmpurile selectate, după confirmare. |
| `documents.rejectFields` | medium | Respinge sugestii, cu motiv opțional. |
| `documents.retryJob` | medium | Retry idempotent pentru job eșuat eligibil. |
| `documents.rollbackApply` | high | Revine la before dacă nu există conflict. |
| `documents.findExpiring` | low | Query agregat/paginat în Expiry Center. |
| `documents.replace` | high | Încarcă un document nou și marchează superseded după confirmare. |
| `notifications.createExpiryRule` | high | Creează policy după preview complet. |
| `notifications.updateExpiryRule` | high | Modifică praguri/destinatari. |

Aliasurile de contract cerute de produs se mapează în același registry, fără implementări
duplicate:

| Nume produs | Tool canonic |
| --- | --- |
| `uploadVehicleDocument` | `documents.uploadDraft` |
| `classifyDocument` | pas server-side al jobului; read-only în UI |
| `analyzeDocument` | pornește/urmărește jobul, nu apelează modelul direct din client |
| `applyDocumentFields` | `documents.acceptFields` |
| `confirmProposedChanges` | confirmarea orchestratorului + `documents.acceptFields` |
| `rollbackDocumentChanges` | `documents.rollbackApply` |
| `scheduleExpiryNotifications` | `notifications.createExpiryRule` |
| `changeNotificationPreset` | `notifications.updateExpiryRule` |
| `showDocumentsExpiring` | `documents.findExpiring` |
| `scanReceipt` | `documents.uploadDraft` cu `receipt` |
| `updateVehicle` | tool-ul existent `vehicles.update` |
| `createMaintenanceEvent` | tool server-side dedicat, după schema maintenance |

Uploadul de pe telefon nu poate fi executat invizibil: asistentul deschide picker-ul printr-o
acțiune declarată și utilizatorul confirmă fișierul ales.

## 3. Exemple de comenzi și planuri

### „Încarcă RCA la Loganul cu B33”

1. resolve vehicle prin query limitat;
2. dacă sunt mai multe rezultate, cere alegere;
3. navighează la Vehicle Documents;
4. pornește `documents.uploadDraft` cu type hint `rca`;
5. așteaptă alegerea fișierului;
6. afișează jobul, fără apply automat.

### „Ce documente expiră luna viitoare?”

1. verifică actor/company;
2. rulează `documents.findExpiring` cu interval calendaristic Europe/Bucharest;
3. returnează maximum 20 + total/count;
4. oferă deschiderea Expiry Center.

### „Acceptă data RCA și actualizează mașina”

1. folosește ultimul document/job din context numai dacă referința este neambiguă;
2. citește review-ul;
3. arată `nextRcaDate vechi -> nou`, confidence și sursă;
4. cere confirmare explicită;
5. execută `documents.acceptFields` server-side;
6. afișează audit/operation ID și posibilitatea de rollback.

### „Anunță-mă cu 30 și 7 zile înainte de ITP”

1. identifică firma și scope-ul (toate vehiculele sau unul);
2. dacă scope-ul lipsește, clarifică;
3. preview recipients, praguri și canal;
4. confirmare;
5. creează rule server-side și schedules incrementale.

Comenzile triviale precum „deschide documentele mașinii” se rezolvă local din action
registry, fără apel AI. Modelul este folosit pentru clasificare semantică, câmpuri multiple,
referințe ambigue și planuri compuse. Telemetria salvează latența, modelul, tokenii și
rezultatul, nu transcripturi/documente sensibile mai mult decât politica de retenție.

## 4. Contract de input

Exemplu pentru apply:

```json
{
  "version": "3",
  "commandType": "update",
  "intent": "apply_document_fields",
  "toolCalls": [
    {
      "id": "documents.acceptFields",
      "input": {
        "jobId": "job-id",
        "fieldNames": ["nextRcaDate"],
        "expectedEntityId": "vehicle-id"
      }
    }
  ],
  "targetPage": "/vehicles/vehicle-id?tab=documents",
  "entityReferences": [{ "type": "vehicle", "id": "vehicle-id", "query": "B33" }],
  "missingInformation": [],
  "confidence": 0.98,
  "confirmationRequired": true,
  "response": "Voi actualiza data RCA după confirmare."
}
```

Schema tool-ului are `additionalProperties: false`. Serverul nu acceptă câmpuri arbitrare
sau path-uri Firestore din model.

## 5. Context și memorie controlată

Contextul poate păstra numai IDs și tipuri:

- `lastEntity {type,id}`;
- `lastDocumentId`;
- `lastIngestionJobId`;
- `lastReviewId`;
- `lastNavigationPath`.

Nu păstrează documentul brut, imaginea, tokenuri, URL-uri permanente sau date sensibile în
prompt history. Expiră după sesiune/TTL. Un pronume precum „acesta” folosește contextul
numai dacă entitatea este încă accesibilă și neambiguă.

## 6. Permission și confirmare

| Acțiune | Permission | Confirmare |
| --- | --- | --- |
| list/open | read entity/company | nu, dacă nu expune date sensibile |
| upload draft | update entity/document permission | da pentru fișier și destinație |
| review | read job/entity | nu |
| accept/apply | update field + document permission | obligatoriu |
| rollback | manager/admin sau actor eligibil | obligatoriu |
| rule create/update | manager/admin company | obligatoriu |
| delete original | admin/manager policy | confirmare dublă |

Permisiunea se verifică înainte de entity resolution costisitor și din nou în Function.

## 7. Audit

Asistentul trimite cererea controlată; serverul stabilește actorul, compania, timestampul,
before/after și operation ID. `aiCommandLogs` păstrează:

- traceId, toolId, risk, status;
- IDs, nu document content;
- câmpurile cerute și rezultatul validării;
- confirmation timestamp;
- apply/rollback operation ID;
- model/contract version pentru interpretare.

Clientul nu scrie direct în `auditLogs` sau `aiCommandLogs`.

## 8. UI

Cardul de confirmare afișează:

- comanda înțeleasă;
- entitatea și documentul;
- câmp vechi -> nou;
- confidence per câmp;
- validări/avertismente;
- risc și motivul confirmării;
- cost AI deja consumat, dacă este disponibil;
- Confirmă / Modifică selecția / Anulează.

Rezultatele multiple sunt butoane accesibile și pot fi alese vocal („prima”, „cea cu B33”).

## 9. API/Functions recomandate

- `createDocumentIngestionJob`;
- `getDocumentReview`;
- `applyDocumentFields`;
- `rejectDocumentFields`;
- `retryDocumentIngestionJob`;
- `rollbackDocumentApply`;
- `createExpiryNotificationRule`;
- `updateExpiryNotificationRule`.

Toate au App Check readiness, rate limit, input schema, company isolation, idempotency și
audit server-side.

## 10. Teste

- contract/tool ID necunoscut;
- permission denied înainte de resolve;
- două vehicule similare -> clarificare;
- „documentul acesta” fără context -> clarificare;
- navigation nu modifică formulare;
- confidence mic -> review, nu apply;
- high-risk fără confirmare -> blocked;
- retry păstrează același document;
- apply dublu -> duplicate/no-op;
- rollback conflict;
- command matrix română pentru talon/RCA/ITP/CASCO/rovinietă/service;
- lipsă Web Speech -> fallback opt-in;
- zero DOM arbitrary fallback și zero Firebase direct în componenta UI.

## 11. Livrare incrementală

1. adaugă tool schemas și mocks, fără execuție;
2. conectează inbox/list/review read-only;
3. conectează upload draft;
4. conectează apply/rollback server-side;
5. conectează reguli expirări;
6. activează pentru admin canary;
7. extinde pe roluri după audit și metrici.

Condiție permanentă: `GPS_FUNCTIONAL_DIFF_ZERO`.
