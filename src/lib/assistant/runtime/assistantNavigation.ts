import { normalizeAssistantText } from "./assistantFuzzy";

export type AssistantKnownNavigationTarget = {
  label: string;
  path: string;
  result: string;
};

const KNOWN_PAGE_TARGETS: Array<AssistantKnownNavigationTarget & { terms: string[] }> = [
  {
    terms: ["dashboard", "pagina principala", "acasa"],
    label: "Deschid dashboard-ul.",
    path: "/dashboard",
    result: "Am deschis dashboard-ul.",
  },
  {
    terms: ["profilul meu", "profil meu", "contul meu", "profil personal", "datele mele"],
    label: "Deschid profilul meu.",
    path: "/my-profile",
    result: "Am deschis profilul meu.",
  },
  {
    terms: ["pontajul meu", "pontaajul meu", "pontaj meu", "pontajele mele", "pagina pontaj"],
    label: "Deschid pagina Pontajul meu.",
    path: "/my-timesheets",
    result: "Am deschis Pontajul meu.",
  },
  {
    terms: ["concedii", "concediul meu", "cerere concediu", "zi libera", "liber", "planificare concediu"],
    label: "Deschid concediile.",
    path: "/my-leave?assistant=leave#leave-form",
    result: "Am deschis Concedii.",
  },
  {
    terms: ["scanare bon", "scanare bonuri", "bonuri", "incarca bon", "incarca poza bon"],
    label: "Deschid scanarea de bonuri.",
    path: "/expenses/scan?assistant=upload",
    result: "Am deschis scanarea bonurilor.",
  },
  {
    terms: ["masini", "lista masini", "vehicule", "flota"],
    label: "Deschid lista de masini.",
    path: "/vehicles",
    result: "Am deschis lista de masini.",
  },
  {
    terms: ["proiecte", "lista proiecte"],
    label: "Deschid proiectele.",
    path: "/projects",
    result: "Am deschis Proiecte.",
  },
  {
    terms: ["scule", "unelte", "tools"],
    label: "Deschid pagina Scule.",
    path: "/tools",
    result: "Am deschis Scule.",
  },
  {
    terms: ["generare raport", "genereaza raport", "raport revizie", "raport interventie"],
    label: "Deschid generarea de raport.",
    path: "/maintenance?tab=report&assistant=report#maintenance-report-generator",
    result: "Am deschis generarea de raport.",
  },
  {
    terms: ["mentenanta piese", "piese mentenanta", "comenzi piese", "piese lift"],
    label: "Deschid comenzile de piese.",
    path: "/maintenance?tab=parts",
    result: "Am deschis comenzile de piese.",
  },
  {
    terms: ["adauga client mentenanta", "client nou mentenanta", "creeaza client mentenanta"],
    label: "Deschid clientii de mentenanta.",
    path: "/maintenance?tab=clients&assistant=client#maintenance-client-form",
    result: "Am deschis clientii de mentenanta.",
  },
  {
    terms: ["clienti mentenanta", "lista clienti mentenanta"],
    label: "Deschid clientii de mentenanta.",
    path: "/maintenance?tab=clients",
    result: "Am deschis clientii de mentenanta.",
  },
  {
    terms: ["firme mentenanta", "branding mentenanta", "deschide firme mentenanta"],
    label: "Deschid firmele si brandingul de mentenanta.",
    path: "/maintenance?tab=companies",
    result: "Am deschis firmele de mentenanta.",
  },
  {
    terms: ["istoric rapoarte", "istoricul rapoartelor", "rapoarte mentenanta"],
    label: "Deschid istoricul rapoartelor.",
    path: "/maintenance?tab=history",
    result: "Am deschis istoricul rapoartelor.",
  },
  {
    terms: ["verifica reviziile lunare", "verificari lunare", "revizii lunare", "verifica luna curenta"],
    label: "Deschid verificarile lunare.",
    path: "/maintenance?tab=checks",
    result: "Am deschis verificarile lunare.",
  },
  {
    terms: ["mentenanta"],
    label: "Deschid mentenanta.",
    path: "/maintenance",
    result: "Am deschis Mentenanta.",
  },
];

export function resolveAssistantKnownPageNavigation(text: string): AssistantKnownNavigationTarget | null {
  const normalized = normalizeAssistantText(text);
  return KNOWN_PAGE_TARGETS.find((page) => page.terms.some((term) => normalized.includes(normalizeAssistantText(term)))) || null;
}
