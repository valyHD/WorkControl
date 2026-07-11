# Instrucțiuni locale - Firebase Functions

Aceste reguli completează `../AGENTS.md` și se aplică tuturor Firebase Functions.
Regulile globale rămân obligatorii.

## Contracte și validare

- Validează autentificarea, rolul, forma payload-ului, tipurile, limitele și valorile
  permise la intrarea fiecărei funcții.
- Nu acorda încredere datelor venite din client, chiar dacă UI-ul le validează.
- Returnează erori controlate și coduri potrivite; nu expune stack traces, tokenuri,
  prompturi interne sau date personale.
- Definește contracte stabile și păstrează compatibilitatea cu clienții existenți.
- Limitează dimensiunea inputului, numărul de elemente și timpul operațiilor externe.

## Securitate și secrete

- Folosește Firebase Functions secrets/parameterized config pentru chei și credențiale.
- Nu hardcoda secrete și nu le scrie în loguri, răspunsuri sau documente Firestore.
- Verifică permisiunile înainte de orice operație Admin SDK.
- Minimizează datele trimise către servicii externe și elimină datele personale care nu
  sunt necesare.

## Fiabilitate

- Proiectează operațiile retry-safe și idempotente. Folosește identificatori stabili sau
  tranzacții pentru a preveni duplicatele.
- Separă validarea, logica de domeniu și efectele externe.
- Tratează timeout-urile, răspunsurile invalide și rate limiting-ul serviciilor externe.
- Folosește `serverTimestamp()` și tranzacții/batch-uri unde consistența o cere.
- Nu marca operația reușită înainte ca efectele obligatorii să fie confirmate.

## Testare și rulare locală

- Testează local cu Firebase Emulator Suite și date fictive.
- Mock-uiește serviciile externe precum OpenAI, Gmail sau alte API-uri.
- Nu folosi chei ori date production în teste.
- Verifică logurile emulatorului și scenariile de eroare, retry și request duplicat.
- Nu face deploy de Functions fără cerere explicită și fără verificarea build-ului și a
  testelor relevante.
