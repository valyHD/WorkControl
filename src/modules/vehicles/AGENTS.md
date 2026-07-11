# Instrucțiuni locale - Vehicles

Aceste reguli completează `../../../AGENTS.md` și se aplică întregului modul Vehicles.
Regulile globale rămân obligatorii.

## Domeniul modulului

- vehicule, șoferi și responsabilități;
- GPS real și trasee afișate;
- kilometraj și odometru;
- mentenanță auto și documente;
- filtrare jitter, opriri, viteză și istoric.

## Reguli GPS

- Tratează timestamp-ul GPS, timestamp-ul serverului, viteza, contactul, odometrul și
  acuratețea ca semnale distincte.
- Ordonează și deduplică punctele înainte de calcul sau randare.
- Nu uni segmente separate prin salturi, perioade ascunse sau surse incompatibile.
- Nu desena mișcare și nu adăuga kilometri pentru jitter staționar. Punctele cu viteză
  zero și deplasări sub pragul acceptat trebuie stabilizate; pragul curent de regresie
  include clustere sub 20 metri.
- Orice schimbare a filtrării trebuie testată pentru staționare, deplasare reală, lipsă de
  semnal, revenirea semnalului și mai multe vehicule.
- Păstrează aceeași experiență vizuală pentru traseele acceptate, dar nu amesteca sursele
  sau intervalele în istoricul brut.

## Reguli kilometri

- Validează kilometrii în UI și în serviciu înainte de scriere.
- Kilometrajul trebuie să fie finit și mai mare sau egal cu zero.
- Nu dubla distanța între GPS, odometru, trasee active sau date agregate.
- Nu înlocui odometrul real OBD cu o estimare GPS fără etichetare și regulă explicită.
- Când kilometrajul scade, cere confirmare sau tratează situația ca excepție auditată.

## Istoric și compatibilitate

- Păstrează istoricul traseelor, evenimentelor, schimbărilor de șofer și mentenanței.
- Nu șterge sau rescrie date istorice pentru a corecta doar afișarea.
- Păstrează compatibilitatea cu documentele vehicul existente și câmpurile GPS opționale.
- Operațiile Firebase trebuie să treacă prin serviciile modulului, cu permisiuni, audit și
  gestionare de erori.

## Testare minimă

- Teste unitare pentru validări km, normalizare număr auto, distanță și jitter.
- Teste de componentă pentru formulare și randarea stărilor critice.
- Test Playwright pentru flow-uri GPS sau editări importante care traversează mai multe
  pagini ori servicii.
