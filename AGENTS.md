# WorkControl - Instrucțiuni globale pentru agenți

## Domeniu și ierarhie

Acest fișier se aplică întregului repository. Fișierele `AGENTS.md` din directoare mai
specifice completează aceste reguli pentru modulul lor. Instrucțiunile locale nu pot
relaxa regulile de siguranță, testare sau compatibilitate definite aici.

## Contextul proiectului

- WorkControl este o aplicație modulară pentru managementul unei firme.
- Stack: React, Vite și TypeScript.
- Backend și infrastructură: Firebase Auth, Firestore, Firebase Storage, Firebase
  Functions și Firebase Hosting.
- Aplicația este web în prezent și trebuie să rămână pregătită pentru un client Android
  ulterior.

## Automatic skill selection

1. La inceputul fiecarui task, analizeaza cererea si identifica skill-urile WorkControl
   relevante din `.agents/skills`.
2. Utilizatorul nu trebuie sa scrie explicit `$skill-name`; foloseste automat orice skill
   a carui descriere se potriveste cererii.
3. Foloseste `workcontrol-task-router` pentru taskuri WorkControl netriviale, mixte sau care
   necesita alegerea intre proceduri.
4. Daca sunt necesare mai multe skill-uri, selecteaza setul minim si respecta ordinea
   definita de router. Nu activa toate skill-urile preventiv.
5. In primul mesaj de progres sau in raportul initial, precizeaza concis selectia in forma:
   `Skills selectate: workcontrol-debug-bug, workcontrol-firebase-feature`.
6. Nu cere utilizatorului sa aleaga skill-ul decat daca intentia ramane cu adevarat ambigua
   dupa inspectarea contextului disponibil.
7. Pentru cereri simple care nu justifica un workflow specializat, executa direct taskul
   respectand acest `AGENTS.md`.
8. Pentru taskuri mixte, separa subtaskurile, detecteaza suprapunerea de fisiere si executa
   secvential cand exista risc de conflict: bug, functionalitate, Firebase, UI, verificare,
   deploy.
9. Skill-urile completeaza instructiunile globale si locale; nu le pot relaxa sau inlocui.

## Mod de lucru obligatoriu

1. Analizează codul, tipurile, serviciile, rutele și testele existente înainte de
   implementare.
2. Verifică starea Git și păstrează toate modificările existente care nu aparțin taskului.
3. Refolosește serviciile, componentele, tipurile, validările și convențiile existente;
   nu crea duplicate.
4. Implementează schimbări mici, bine delimitate și compatibile cu arhitectura curentă.
5. Nu introduce workaround-uri fragile sau logică bazată pe presupuneri despre ordinea
   elementelor din pagină.
6. Preferă state React, props, hooks și servicii controlate. Nu manipula DOM-ul când
   acțiunea poate fi realizată prin React sau printr-un serviciu.
7. Nu accesa Firebase direct din componente dacă modulul are sau poate reutiliza un
   serviciu dedicat.
8. Păstrează separarea dintre UI, servicii, tipuri, validări și logică de domeniu.
9. Toate funcțiile noi care fac I/O sau pot eșua trebuie să trateze erorile și să ofere
   mesaje utile fără a expune date sensibile.
10. Nu face commit, push sau deploy fără cerere explicită.

## Compatibilitate și date

- Păstrează backward compatibility pentru rute, API-uri interne și documente existente.
- Nu modifica incompatibil schema Firestore fără plan de migrare, fallback pentru datele
  vechi și documentarea schimbării.
- Nu șterge câmpuri sau comportamente înainte de a verifica toate utilizările cu `rg`.
- Nu expune și nu introduce în repository chei, tokenuri, secrete, date personale sau
  credențiale.
- Nu utiliza Firebase production în teste. Folosește mock-uri sau Firebase Emulator Suite.

## Reguli UI/UX

- Păstrează un design modern de dashboard, profesional, aerisit și mobile-first.
- Refolosește componentele și tokenurile vizuale existente.
- Folosește carduri și KPI-uri numai când ajută scanarea și decizia, fără aglomerare.
- Formularele trebuie să aibă etichete clare, validări vizibile și acțiuni principale
  evidente.
- Folosește consecvent: albastru pentru acțiuni, verde pentru succes, portocaliu pentru
  avertizare și roșu pentru eroare.
- Păstrează consistența de layout, spațiere, stări și comportament între module.
- Verifică desktop și mobil pentru schimbările vizuale sau interactive.

## Reguli Firebase

- Izolează operațiile Firestore și Storage în servicii.
- Validează toate update-urile importante înainte de scriere.
- Folosește `serverTimestamp()` unde timpul serverului este relevant.
- Păstrează audit log pentru acțiunile sensibile și schimbările importante.
- Verifică autentificarea, rolul și permisiunile înainte de operații protejate.
- Nu scrie în colecții noi fără să documentezi numele, structura, proprietarul datelor și
  regulile de acces.
- Când adaugi o funcționalitate Firebase, verifică și regulile Firestore/Storage,
  indexurile și comportamentul în emulator.

## Reguli de testare

Pentru orice funcționalitate modificată:

1. Identifică testele existente și nivelul potrivit: unitate, componentă sau E2E.
2. Actualizează testele afectate și adaugă teste de regresie pentru buguri.
3. Rulează cel puțin:
   - `npm run lint`
   - `npm run test:run`
   - `npm run build`
4. Pentru flow-uri UI critice rulează și testele Playwright relevante.
5. Pentru teste cu Firebase folosește mock-uri sau `npm run test:e2e:emulator`.
6. Nu declara taskul terminat dacă verificările relevante nu trec. Dacă mediul blochează
   o verificare, raportează exact ce nu a rulat și de ce.

## Reguli pentru debugging

- Reproduce bugul înainte de reparare și notează condițiile reproducerii.
- Identifică și corectează cauza, nu doar simptomul vizibil.
- Adaugă un test de regresie care eșuează înaintea corecției și trece după aceasta.
- Verifică modulele care consumă același serviciu, tip sau contract.
- La final explică problema, cauza și fișierele implicate.

## Reguli pentru refactorizări

- Evită fișierele foarte mari și responsabilitățile amestecate.
- Nu face rescrieri masive sau reformatarea întregului proiect fără motiv explicit.
- Mută logica în pași mici, verificabili, cu teste între etape.
- Păstrează API-urile existente când este posibil.
- Înainte de ștergerea sau mutarea codului verifică toate importurile și utilizările.

## Raportul final al fiecărui task

Răspunsul final trebuie să precizeze, după caz:

- ce a fost analizat;
- cauza problemei;
- fișierele modificate;
- funcționalitățile implementate;
- testele adăugate sau actualizate;
- comenzile rulate și rezultatele lor;
- riscurile sau lucrurile rămase;
- ce trebuie verificat manual.
