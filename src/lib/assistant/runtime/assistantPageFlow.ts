import {
  assistantPathMatchesPattern,
  getAssistantPageActions,
  type AssistantPageActionType,
} from "./assistantPageActionRegistry";

export type AssistantNextStep = {
  id: string;
  label: string;
  selector: string;
  actionType: AssistantPageActionType;
  message: string;
};

type AssistantPageFlowDefinition = {
  pagePattern: string;
  when?: (params: URLSearchParams) => boolean;
  steps: AssistantNextStep[];
  fallbackMessage?: string;
};

function searchParamsFromInput(queryParams?: URLSearchParams | string | Record<string, string | undefined>) {
  if (queryParams instanceof URLSearchParams) return queryParams;
  if (typeof queryParams === "string") return new URLSearchParams(queryParams.startsWith("?") ? queryParams.slice(1) : queryParams);
  const params = new URLSearchParams();
  Object.entries(queryParams || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

const ASSISTANT_PAGE_FLOWS: AssistantPageFlowDefinition[] = [
  {
    pagePattern: "/expenses/scan",
    steps: [
      {
        id: "upload-receipt",
        label: "Incarca poza bon",
        selector: "[data-assistant-action='upload-receipt']",
        actionType: "file",
        message: "Acum apasa Incarca poza bon.",
      },
      {
        id: "scan-receipt",
        label: "Scaneaza documentul",
        selector: "[data-assistant-action='scan-receipt']",
        actionType: "button",
        message: "Dupa ce alegi fisierul, apasa Scaneaza si salveaza.",
      },
      {
        id: "expense-review",
        label: "Verifica datele documentului",
        selector: "[data-assistant-section='expense-scan']",
        actionType: "section",
        message: "Verifica userul, proiectul si firma inainte de salvare.",
      },
      {
        id: "scan-receipt",
        label: "Salveaza documentul",
        selector: "[data-assistant-action='scan-receipt']",
        actionType: "button",
        message: "Pentru salvare apasa butonul Scaneaza si salveaza.",
      },
    ],
  },
  {
    pagePattern: "/my-leave",
    steps: [
      {
        id: "leave-start-date",
        label: "Alege perioada",
        selector: "[data-assistant-field='leave-start-date']",
        actionType: "field",
        message: "Am deschis concediul. Completeaza perioada, apoi motivul.",
      },
      {
        id: "leave-end-date",
        label: "Data sfarsit",
        selector: "[data-assistant-field='leave-end-date']",
        actionType: "field",
        message: "Verifica data de sfarsit a concediului.",
      },
      {
        id: "leave-reason",
        label: "Completeaza motivul",
        selector: "[data-assistant-field='leave-reason']",
        actionType: "field",
        message: "Completeaza motivul daca este nevoie.",
      },
      {
        id: "leave-signature",
        label: "Semneaza cererea",
        selector: "[data-assistant-field='leave-signature']",
        actionType: "field",
        message: "Semneaza cererea inainte de trimitere.",
      },
      {
        id: "submit-leave-request",
        label: "Trimite cererea",
        selector: "[data-assistant-action='submit-leave-request']",
        actionType: "button",
        message: "Dupa completare apasa Programeaza concediu sau Trimite cererea.",
      },
    ],
  },
  {
    pagePattern: "/users/:userId/edit",
    steps: [
      {
        id: "fullName",
        label: "Nume complet",
        selector: "[data-assistant-field='fullName']",
        actionType: "field",
        message: "Verifica numele utilizatorului.",
      },
      {
        id: "role",
        label: "Rol",
        selector: "[data-assistant-field='role']",
        actionType: "field",
        message: "Alege rolul corect.",
      },
      {
        id: "roleTitle",
        label: "Functie / post",
        selector: "[data-assistant-field='roleTitle']",
        actionType: "field",
        message: "Am evidentiat campul Functie. Dupa completare apasa Salveaza.",
      },
      {
        id: "department",
        label: "Departament",
        selector: "[data-assistant-field='department']",
        actionType: "field",
        message: "Am evidentiat campul Departament. Dupa completare apasa Salveaza.",
      },
      {
        id: "active",
        label: "Activ",
        selector: "[data-assistant-field='active']",
        actionType: "field",
        message: "Verifica daca utilizatorul este activ.",
      },
      {
        id: "save-user",
        label: "Salveaza utilizatorul",
        selector: "[data-assistant-action='save-user']",
        actionType: "button",
        message: "Dupa verificare apasa Salveaza.",
      },
    ],
  },
  {
    pagePattern: "/users/new",
    steps: [
      {
        id: "fullName",
        label: "Nume complet",
        selector: "[data-assistant-field='fullName']",
        actionType: "field",
        message: "Completeaza numele utilizatorului.",
      },
      {
        id: "role",
        label: "Rol",
        selector: "[data-assistant-field='role']",
        actionType: "field",
        message: "Alege rolul utilizatorului.",
      },
      {
        id: "roleTitle",
        label: "Functie / post",
        selector: "[data-assistant-field='roleTitle']",
        actionType: "field",
        message: "Completeaza functia utilizatorului.",
      },
      {
        id: "department",
        label: "Departament",
        selector: "[data-assistant-field='department']",
        actionType: "field",
        message: "Completeaza departamentul utilizatorului.",
      },
      {
        id: "save-user",
        label: "Creeaza utilizator",
        selector: "[data-assistant-action='save-user']",
        actionType: "button",
        message: "Dupa completare apasa Creeaza utilizator.",
      },
    ],
  },
  {
    pagePattern: "/maintenance",
    when: (params) => params.get("tab") === "report" || params.get("assistant") === "report",
    fallbackMessage: "Esti in mentenanta. Alege Genereaza raport, Piese, Clienti sau Firme.",
    steps: [
      {
        id: "maintenance-report-client",
        label: "Client raport",
        selector: "[data-assistant-field='maintenance-report-client']",
        actionType: "field",
        message: "Alege clientul pentru raport.",
      },
      {
        id: "maintenance-report-address",
        label: "Adresa raport",
        selector: "[data-assistant-field='maintenance-report-address']",
        actionType: "field",
        message: "Alege adresa clientului.",
      },
      {
        id: "maintenance-report-lift",
        label: "Lift raport",
        selector: "[data-assistant-field='maintenance-report-lift']",
        actionType: "field",
        message: "Alege liftul pentru raport.",
      },
      {
        id: "maintenance-report-technician",
        label: "Tehnician raport",
        selector: "[data-assistant-field='maintenance-report-technician']",
        actionType: "field",
        message: "Alege tehnicianul.",
      },
      {
        id: "maintenance-report-photos",
        label: "Poze raport",
        selector: "[data-assistant-field='maintenance-report-photos']",
        actionType: "file",
        message: "Adauga pozele raportului daca exista.",
      },
      {
        id: "maintenance-generate-review-report",
        label: "Genereaza raport",
        selector: "[data-assistant-action='maintenance-generate-review-report']",
        actionType: "button",
        message: "Dupa verificare apasa Genereaza raport revizie.",
      },
    ],
  },
  {
    pagePattern: "/maintenance",
    when: (params) => params.get("tab") === "clients" || params.get("assistant") === "client",
    steps: [
      {
        id: "maintenance-add-client",
        label: "Adauga client mentenanta",
        selector: "[data-assistant-action='maintenance-add-client']",
        actionType: "section",
        message: "Am deschis clientii. Apasa Adauga client nou pentru adrese si lifturi.",
      },
      {
        id: "maintenance-save-client",
        label: "Salveaza client",
        selector: "[data-assistant-action='maintenance-save-client']",
        actionType: "button",
        message: "Verifica datele si apasa Salveaza client.",
      },
      {
        id: "maintenance-history",
        label: "Lista clienti mentenanta",
        selector: "[data-assistant-section='maintenance-clients'], [data-assistant-action='maintenance-history']",
        actionType: "section",
        message: "Cauta clientul sau foloseste butoanele Detalii, Editeaza si Sterge.",
      },
    ],
  },
  {
    pagePattern: "/maintenance/manage",
    steps: [
      {
        id: "maintenance-add-client",
        label: "Adauga client mentenanta",
        selector: "[data-assistant-action='maintenance-add-client']",
        actionType: "section",
        message: "Apasa Adauga client nou pentru adrese si lifturi.",
      },
      {
        id: "maintenance-save-client",
        label: "Salveaza client",
        selector: "[data-assistant-action='maintenance-save-client']",
        actionType: "button",
        message: "Verifica datele si apasa Salveaza client.",
      },
    ],
  },
  {
    pagePattern: "/maintenance",
    when: (params) => params.get("tab") === "companies",
    steps: [
      {
        id: "maintenance-branding",
        label: "Firme / Branding",
        selector: "[data-assistant-action='maintenance-branding']",
        actionType: "section",
        message: "Configureaza firma, logo-ul si stampila pentru rapoarte.",
      },
    ],
  },
  {
    pagePattern: "/maintenance",
    when: (params) => params.get("tab") === "history",
    steps: [
      {
        id: "maintenance-history",
        label: "Istoric rapoarte",
        selector: "[data-assistant-action='maintenance-history']",
        actionType: "section",
        message: "Cauta raportul dupa client, luna, tip sau tehnician.",
      },
    ],
  },
  {
    pagePattern: "/maintenance",
    when: (params) => params.get("tab") === "checks",
    steps: [
      {
        id: "maintenance-checks",
        label: "Verificari lunare",
        selector: "[data-assistant-action='maintenance-checks']",
        actionType: "section",
        message: "Apasa Verifica luna curenta pentru lista de revizii lipsa.",
      },
    ],
  },
  {
    pagePattern: "/maintenance",
    when: (params) => params.get("tab") === "parts",
    steps: [
      {
        id: "maintenance-parts",
        label: "Piese mentenanta",
        selector: "[data-assistant-action='maintenance-parts']",
        actionType: "link",
        message: "Apasa Deschide comenzi piese pentru modulul dedicat.",
      },
    ],
  },
  {
    pagePattern: "/maintenance",
    steps: [
      {
        id: "maintenance-report-generator",
        label: "Genereaza raport",
        selector: "[data-assistant-action='maintenance-report-generator'], [data-assistant-section='maintenance-report-generator']",
        actionType: "section",
        message: "Esti in mentenanta. Alege Genereaza raport, Piese, Clienti sau Firme.",
      },
      {
        id: "maintenance-parts",
        label: "Piese",
        selector: "[data-assistant-action='maintenance-parts']",
        actionType: "link",
        message: "Pentru piese, apasa Piese.",
      },
      {
        id: "maintenance-add-client",
        label: "Adauga client",
        selector: "[data-assistant-action='maintenance-add-client']",
        actionType: "section",
        message: "Pentru client nou, apasa Adauga client.",
      },
      {
        id: "maintenance-branding",
        label: "Firme",
        selector: "[data-assistant-action='maintenance-branding']",
        actionType: "section",
        message: "Pentru logo si stampila, apasa Firme.",
      },
    ],
  },
];

function getMatchingFlow(pathname: string, params: URLSearchParams) {
  return ASSISTANT_PAGE_FLOWS.find((flow) => assistantPathMatchesPattern(flow.pagePattern, pathname) && (!flow.when || flow.when(params)));
}

export function getAssistantPageFlow(
  pathname: string,
  queryParams?: URLSearchParams | string | Record<string, string | undefined>
): AssistantNextStep[] {
  const params = searchParamsFromInput(queryParams);
  const flow = getMatchingFlow(pathname, params);
  if (flow) return flow.steps;

  return getAssistantPageActions(pathname).slice(0, 5).map((action) => ({
    id: action.id,
    label: action.label,
    selector: action.selector,
    actionType: action.actionType,
    message: `Am evidentiat ${action.label}.`,
  }));
}

export function getAssistantNextStepForPage(
  pathname: string,
  queryParams?: URLSearchParams | string | Record<string, string | undefined>
): AssistantNextStep[] {
  const params = searchParamsFromInput(queryParams);
  const assistantField = params.get("assistantField") || "";
  const flow = getAssistantPageFlow(pathname, params);

  if (assistantField) {
    const fieldStep = flow.find((step) => step.id === assistantField);
    if (fieldStep) {
      const saveStep = flow.find((step) => step.id.startsWith("save-"));
      return saveStep && saveStep.id !== fieldStep.id ? [fieldStep, saveStep] : [fieldStep];
    }
  }

  if (pathname === "/expenses/scan" && params.get("assistant") === "upload") {
    return flow.filter((step) => step.id === "upload-receipt" || step.id === "scan-receipt").slice(0, 2);
  }

  if (pathname === "/my-leave" && params.get("assistant") === "leave") {
    return flow.filter((step) => step.id === "leave-start-date" || step.id === "submit-leave-request");
  }

  return flow.slice(0, 2);
}

export function getAssistantNextStepMessage(
  pathname: string,
  queryParams?: URLSearchParams | string | Record<string, string | undefined>
) {
  const [step] = getAssistantNextStepForPage(pathname, queryParams);
  if (step) return step.message;

  const params = searchParamsFromInput(queryParams);
  const flow = getMatchingFlow(pathname, params);
  return flow?.fallbackMessage || "";
}

export function getAssistantStepMessageById(
  pathname: string,
  stepId: string,
  queryParams?: URLSearchParams | string | Record<string, string | undefined>
) {
  return getAssistantPageFlow(pathname, queryParams).find((step) => step.id === stepId)?.message || "";
}
