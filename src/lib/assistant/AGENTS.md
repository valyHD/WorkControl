# Instrucțiuni locale - Assistant

Aceste reguli completează `../../../AGENTS.md` și se aplică asistentului WorkControl.
Regulile globale rămân obligatorii.

## Pipeline obligatoriu

Asistentul trebuie să urmeze fluxul:

1. transcript fără execuție;
2. interpretare structurată;
3. rezolvare entități și câmpuri;
4. validare de date și permisiuni;
5. plan de execuție;
6. clarificare sau confirmare;
7. execuție prin servicii controlate;
8. audit și rezultat.

## Reguli de siguranță

- Nu completa arbitrar primul input găsit și nu folosi ordinea DOM ca logică de business.
- DOM fallback este dezactivat implicit și poate fi folosit numai pentru acțiuni declarate,
  fără alternativă React/service, care nu pot modifica accidental date.
- Navigarea nu are voie să modifice câmpuri, să trimită formulare sau să declanșeze
  form-fill.
- Folosește schemele de formular, registry-ul de acțiuni, entity resolver și field
  resolver înaintea oricărei interacțiuni vizuale.
- Nu ghici între rezultate multiple. Prezintă opțiunile și cere alegerea utilizatorului.
- Confidence sub pragul sigur trebuie să producă o clarificare, nu execuție.
- Orice creare, modificare, ștergere, trimitere sau acțiune cu efect trebuie validată și
  confirmată conform riscului.
- Verifică rolul și proprietatea entității înainte de execuție.
- Execuția trebuie să folosească serviciul modulului; nu scrie direct în Firestore din
  parser sau din UI-ul asistentului.
- Auditul trebuie să includă transcriptul, intentul, entitatea, câmpurile, valorile
  înainte/după, statusul și eroarea, fără secrete.

## Contracte și testare

- Interpretarea AI trebuie normalizată la un contract TypeScript stabil și validată
  defensiv.
- Păstrează sinonimele și fuzzy matching-ul în resolvere testabile, nu în regex-uri
  răspândite prin componente.
- Adaugă teste pentru fiecare intent, sinonim, ambiguitate și permisiune nouă.
- Testele obligatorii de regresie includ: navigare fără modificarea inputurilor, lipsa
  execuției înainte de confirmare, rezultate multiple și comenzi ambigue.
- Mock-uiește OpenAI/Firebase Functions în testele unitare; nu depinde de rețea sau de
  chei reale.
