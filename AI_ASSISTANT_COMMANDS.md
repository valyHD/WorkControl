# WorkControl Assistant V3

Asistentul WorkControl foloseste un agent controlat: asculta, interpreteaza un contract JSON
strict, valideaza permisiunile si datele, afiseaza planul, cere confirmare si abia apoi
executa prin servicii sau prin drafturi React controlate.

## Pipeline

1. Speech-to-text produce transcriptul, fara executie.
2. `interpretAssistantCommand` returneaza exclusiv contractul Assistant V3.
3. Orchestratorul valideaza contractul, confidence-ul, entitatea, campurile si permisiunile.
4. Registry-ul construieste preview-ul si planul de executie.
5. Actiunile medium/high-risk asteapta confirmarea explicita.
6. Tool-urile executa secvential si scriu un audit server-side redactat.

Confidence sub `0.85`, informatiile lipsa, entitatile multiple sau o ruta nepermisa opresc
executia si cer clarificare. Asistentul nu ghiceste.

## Arhitectura

- `src/components/VoiceCommandAssistant.tsx`: integrarea UI, microfon, transcript, confirmare,
  alegeri, istoric scurt si debug admin.
- `src/lib/assistant/core/`: contract, orchestrator, planner, validator, context, memorie si
  telemetrie.
- `src/lib/assistant/tools/assistantToolRegistry.ts`: registry unic cu schema, risc,
  permisiune, resolve, validate, preview, execute si audit.
- `src/lib/assistant/adapters/`: navigare, masini, scule, pontaje, proiecte, utilizatori,
  mentenanta, concedii si bonuri.
- `src/lib/assistant/speech/`: Web Speech, corectii de transcript si fallback server opt-in.
- `src/lib/assistant/ui/`: componentele vizuale reutilizabile.
- `functions/index.js`: interpretare OpenAI stricta si callables pentru audit.

## Tool-uri controlate

- `navigation.open`
- `vehicles.update`, `vehicles.draft`
- `tools.update`, `tools.draft`
- `timesheets.start`, `timesheets.stop`
- `timesheets.projects.create`, `timesheets.projects.update`, `timesheets.projects.draft`
- `users.update`, `users.draft`
- `maintenance.draft`, `leave.draft`, `expenses.draft`

Drafturile completeaza state-ul formularului prin evenimente tipizate si nu salveaza
automat. Actualizarile persistente folosesc serviciile existente ale modulelor.

## Exemple

- `Du-ma la pontajul meu` navigheaza, fara sa porneasca pontajul.
- `Schimba kilometrii Loganului la 6200` rezolva masina, afiseaza vechi -> nou si cere
  confirmare.
- `Creeaza proiect Service 2 si porneste pontajul` genereaza un plan multi-step si cere
  confirmare inainte de creare/start.
- `Adauga client Isomat, email office@isomat.ro, lift 210869` deschide si completeaza un
  draft controlat, fara salvare automata.
- `Schimba data` cere clarificare deoarece entitatea si campul nu sunt suficient de clare.

## Siguranta si observabilitate

- Nu exista completare sau click arbitrar in DOM.
- Navigarea este limitata la catalogul de rute permis rolului curent.
- Permisiunile sunt verificate inaintea executiei si din nou in planurile serviciilor.
- `aiCommandLogs` accepta scrieri numai din Functions; clientul poate raporta rezultatul
  prin callable doar pentru propria urma.
- Transcriptul este redactat, tool input values nu sunt persistate, iar urmele expira dupa
  30 de zile.
- Control Panel afiseaza maximum 100 de urme numai administratorilor.

## Testare

Matricea `assistantRomanianCommandMatrix.ts` contine 150 de comenzi romanesti pentru
navigare, masini, scule, pontaje, proiecte, mentenanta, concedii, utilizatori, bonuri si
notificari. Include sinonime, greseli, context, multi-step, permisiuni, duplicate si retry.

Pentru un tool nou:

1. extinde contractul si schema stricta din Functions;
2. adauga o definitie unica in registry si un adapter prin serviciul modulului;
3. adauga permisiuni, validare, preview, confirmare si audit;
4. adauga exemple in matrice si teste unitare/componenta;
5. ruleaza lint, testele, build-ul si E2E relevant.
