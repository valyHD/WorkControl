# Instrucțiuni locale - Timesheets

Aceste reguli completează `../../../AGENTS.md` și se aplică modulului Timesheets.
Regulile globale rămân obligatorii.

## Domeniul modulului

- pornirea, oprirea și istoricul pontajelor;
- proiecte și preferința de proiect;
- durate, locații și rapoarte de pontaj;
- contractele folosite de concedii și calendare.

## Reguli de domeniu

- Un utilizator nu poate avea mai mult de un pontaj activ.
- Pornirea și oprirea trebuie validate în serviciu, nu doar în componentă.
- Durata se calculează din timestamp-uri valide, nu poate fi negativă și trebuie să aibă
  o regulă clară de rotunjire.
- Pentru afișarea live, separă durata calculată temporar de valoarea persistată la oprire.
- Păstrează proiectul selectat explicit; nu porni pontajul pe un proiect vechi dacă
  utilizatorul a cerut altul.
- Locația poate lipsi sau poate eșua. Flow-ul de pontaj trebuie să gestioneze eroarea fără
  a bloca sau dubla operația.
- Păstrează explicațiile și marcajele de politică pentru porniri/opriri în afara
  intervalului normal.

## Timp și concedii

- Toate regulile de calendar și afișările locale folosesc timezone `Europe/Bucharest`.
- Evită conversiile implicite UTC care pot muta ziua de lucru.
- Concediile aparțin modulului Leave; nu duplica serviciile lui aici. Păstrează contractele
  comune pentru calendar, minute lucrate și rapoarte.
- Rapoartele trebuie să folosească aceleași definiții pentru zi, săptămână, lună și durată
  ca UI-ul principal.

## Testare minimă

- Teste pentru pontaj activ, start/stop, durată, schimbarea proiectului și timezone.
- Teste de componentă pentru cardul activ și confirmările de politică.
- Test E2E pe Firebase Emulator pentru start/stop și creare proiect.
