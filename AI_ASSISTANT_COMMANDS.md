# WorkControl AI Assistant Commands

Asistentul vocal intelege comenzi naturale in romana, le transforma intr-un intent structurat, rezolva entitati din Firestore, valideaza campurile, cere confirmare pentru actiuni medium/high-risk si logheaza rezultatul in `aiCommandLogs`.

## Arhitectura

Runtime-ul este in `src/lib/assistant/runtime/`:

- `assistantIntentParser.ts` normalizeaza raspunsul AI.
- `assistantEntityResolver.ts` cauta masini, scule, proiecte si useri.
- `assistantFieldResolver.ts` mapeaza vorbirea naturala la campurile reale.
- `assistantValidator.ts` valideaza valori, confidence, campuri lipsa si risc.
- `assistantExecutor.ts` executa prin servicii, nu prin DOM, pentru masini/scule/proiecte.
- `assistantConversationMemory.ts` tine ultima entitate, ultima pagina si ultima comanda.
- `assistantAudit.ts` scrie logurile in `aiCommandLogs`.
- `assistantPermissions.ts` aplica regulile de rol.
- `assistantFuzzy.ts` normalizeaza diacritice, numere auto si potriviri aproximative.

## Navigare

- `du-ma la pontajul meu` deschide pagina Pontajul meu.
- `deschide masina mea la tracker live` deschide trackerul masinii tale.
- `du-ma pe harta cu toate GPS-urile la Dacia Spring` deschide harta flotei si focalizeaza masina potrivita.
- `arata-mi ultima activitate a lui Razvan` deschide istoricul filtrat pe userul potrivit.

## Masini si GPS

- `modifica km masinii B 33 LGR in 6180` actualizeaza km curenti dupa confirmare.
- `schimba ITP la Toyota Corolla pe 12.08.2026` actualizeaza data ITP dupa confirmare.
- `schimba soferul dubei cu 04 in numar in Razvan` cauta masina dupa indiciu si seteaza soferul.
- `la Logan schimba kilometrii la 6200 si ITP-ul pe 20 septembrie 2026` modifica mai multe campuri dintr-o comanda.
- `deschide detalii live la Logan` deschide pagina live GPS/OBD.

## Scule

- `du-ma la scula flex Bosch` deschide scula potrivita sau cere clarificare daca sunt mai multe.
- `schimba statusul flexului Bosch in defecta` actualizeaza statusul dupa confirmare.
- `seteaza codul bormasinii Bosch in BOSCH-02` actualizeaza codul intern dupa confirmare.
- `muta scula Makita la Nelus` schimba detinatorul curent dupa confirmare.

## Pontaj si proiecte

- `creeaza proiect Service 2 si porneste pontajul` creeaza proiectul daca lipseste si porneste pontajul.
- `selecteaza proiectul Vali Mare Boss si da start pontaj` porneste pontajul pe proiectul potrivit.
- `opreste pontajul` opreste pontajul activ, daca exista.
- `arata ultimul pontaj al lui Razvan` deschide pontajele globale filtrate.

## Profil

- `schimba functia mea in electrician` actualizeaza functia din profil.
- `seteaza departamentul meu pe Service si Intretinere Lifturi` actualizeaza departamentul.

## Mentenanta, concedii si cheltuieli

- `creeaza client mentenanta Lift Nord cu lift A12` deschide formularul de client si precompleteaza ce poate.
- `genereaza raport revizie pentru clientul Lift Nord` deschide generatorul de raport.
- `du-ma la concedii pe 15 august` deschide formularul de concediu cu perioada detectata.
- `du-ma la scanare bonuri` deschide zona de upload bonuri.

## Control pagina curenta

- `cauta Razvan` cauta in campul vizibil de filtrare.
- `completeaza telefon cu 0722...` completeaza campul potrivit din pagina curenta.
- `apasa salveaza` apasa butonul vizibil de salvare dupa confirmare.

## Siguranta

- Navigarea, cautarea si scroll-ul sunt low-risk si pot rula direct.
- Editarile, creare proiect, creare notificare, start/stop pontaj cer confirmare.
- Stergerile si schimbarea de roluri sunt high-risk si trebuie tratate doar prin fluxuri dedicate cu drepturi de admin.

## Limitari

- Browserul nu permite incarcarea automata a ultimei poze din telefon; utilizatorul trebuie sa aleaga fisierul.
- Daca sunt 2-5 rezultate apropiate, asistentul cere clarificare in loc sa aleaga la intamplare.
- Daca `confidence` este sub `0.65`, comanda nu se executa automat.
- Completarea DOM ramane fallback pentru formulare simple unde nu exista executor dedicat.

## Adaugare Actiuni Noi

1. Adauga intentul in `src/lib/assistant/aiCommandRegistry.ts`.
2. Extinde schema si promptul din `functions/index.js`.
3. Adauga campurile in `assistantFieldResolver.ts`.
4. Adauga cautarea entitatii in `assistantEntityResolver.ts`, daca este un modul nou.
5. Executa prin serviciul modulului in `assistantExecutor.ts`.
6. Adauga validari in `assistantValidator.ts`.
7. Adauga exemple in `assistantCommandTests.ts` si in acest document.
