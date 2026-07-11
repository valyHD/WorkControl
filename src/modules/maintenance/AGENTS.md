# Instrucțiuni locale - Maintenance

Aceste reguli completează `../../../AGENTS.md` și se aplică modulului Maintenance.
Regulile globale rămân obligatorii.

## Domeniul modulului

- clienți, adrese și lifturi;
- revizii și verificări lunare;
- rapoarte PDF, poze și istoric;
- firme, branding, logo și ștampilă;
- piese și comenzi asociate mentenanței.

## Reguli de date și compatibilitate

- Păstrează compatibilitatea cu documentele existente, inclusiv câmpurile plate legacy și
  structurile noi cu mai multe adrese/lifturi.
- Nu migra implicit toate documentele dintr-un render sau dintr-o citire.
- Clientul, adresa și numărul liftului trebuie validate înainte de creare.
- Identificatorii și istoricul rapoartelor trebuie să rămână stabili.
- Nu șterge rapoarte, poze, branding sau revizii ca efect secundar al unei editări de
  client.

## Rapoarte și branding

- Generarea PDF trebuie să rămână deterministă și testabilă fără Gmail real.
- Separă generarea PDF, încărcarea fișierelor, salvarea istoricului și trimiterea emailului.
- Nu trimite email înainte de confirmarea utilizatorului și validarea destinatarilor.
- Brandingul trebuie selectat prin firma asociată și trebuie să aibă fallback sigur când
  logo-ul sau ștampila lipsesc.
- Erorile Gmail, Storage sau PDF nu trebuie să lase un istoric fals marcat ca reușit.

## Revizii și piese

- Datele de expirare se validează și se interpretează în `Europe/Bucharest` unde sunt
  afișate utilizatorului.
- Verificările lunare trebuie să folosească aceleași reguli în dashboard și rapoarte.
- Comenzile de piese trebuie auditate și legate de client/lift când datele există.

## Testare minimă

- Mock pentru Firestore, Storage, Gmail și PDF în teste unitare/de componentă.
- Teste pentru date legacy și structuri cu mai multe lifturi.
- Test E2E pe emulator pentru creare client; trimiterea Gmail reală nu intră în testele
  automate.
