export type ContextualHelpItem = { title: string; description: string; actionLabel?: string; actionPath?: string };

const HELP_BY_PREFIX: Array<[string, ContextualHelpItem[]]> = [
  ["/my-timesheets", [
    { title: "Porneste pontajul", description: "Alege proiectul, verifica locatia si apasa Porneste pontaj." },
    { title: "Lucru fara internet", description: "Comanda este pastrata local si sincronizata cand revine conexiunea." },
  ]],
  ["/expenses", [
    { title: "Scaneaza un bon", description: "Incarca poza sau PDF-ul, verifica datele OCR si apoi salveaza." },
    { title: "Bon offline", description: "Fisierul ramane pe dispozitiv pana cand poate fi incarcat in siguranta." },
  ]],
  ["/vehicles", [{ title: "Flota", description: "Filtreaza dupa status, sofer, GPS sau documente si salveaza vederea folosita des." }]],
  ["/maintenance", [{ title: "Mentenanta", description: "Alege tabul pentru raport, clienti, lifturi, piese sau verificari." }]],
  ["/notifications", [{ title: "Notificari", description: "Inbox afiseaza ultimele alerte; marcheaza citit sau deschide resursa asociata." }]],
  ["/inbox", [{ title: "Inbox operational", description: "Elementele critice si cele care cer actiune sunt afisate primele." }]],
];

export function getContextualHelp(pathname: string): ContextualHelpItem[] {
  return HELP_BY_PREFIX.find(([prefix]) => pathname.startsWith(prefix))?.[1] || [
    { title: "WorkControl", description: "Foloseste Ctrl K pentru navigare sau asistentul vocal pentru actiuni controlate." },
  ];
}
