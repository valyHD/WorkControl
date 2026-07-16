import type { AssistantCommandIntent } from "../assistantCommandService";
import type { AssistantV3CommandType, AssistantV3PageContext } from "./assistantV3Types";

export const ASSISTANT_ROMANIAN_COMMAND_CATEGORIES = [
  "navigation",
  "vehicles",
  "tools",
  "timesheets_projects",
  "maintenance_lifts_reports",
  "leave",
  "users",
  "expenses",
  "notifications",
] as const;

export const ASSISTANT_ROMANIAN_COMMAND_SCENARIOS = [
  "standard",
  "synonym",
  "incomplete",
  "misspelling",
  "context",
  "multi_step",
  "relative_date",
  "navigation_from_form",
  "risk",
  "permission_denied",
  "duplicate",
  "retry",
] as const;

export type AssistantRomanianCommandCategory =
  (typeof ASSISTANT_ROMANIAN_COMMAND_CATEGORIES)[number];
export type AssistantRomanianCommandScenario =
  (typeof ASSISTANT_ROMANIAN_COMMAND_SCENARIOS)[number];
export type AssistantRomanianCommandExecution =
  "navigate" | "after_confirmation" | "clarification" | "blocked";
export type AssistantRomanianCommandBlockReason =
  "permission_denied" | "duplicate" | "unsupported" | "retry_requires_confirmation";

export type AssistantRomanianCommandContext = {
  pageContext?: Partial<AssistantV3PageContext>;
  entityMatches?: readonly string[];
  permission?: "allowed" | "denied";
  activeTimesheet?: boolean;
  duplicateOf?: string;
  previousAttempt?: "failed" | "succeeded";
};

export type AssistantRomanianCommandExpectation = {
  commandType: AssistantV3CommandType;
  intent: AssistantCommandIntent;
  toolIds: readonly string[];
  execution: AssistantRomanianCommandExecution;
  confidence: number;
  confirmationRequired: boolean;
  missingInformation: readonly string[];
  blockReason?: AssistantRomanianCommandBlockReason;
};

export type AssistantRomanianCommandCase = {
  id: number;
  category: AssistantRomanianCommandCategory;
  command: string;
  scenarios: readonly AssistantRomanianCommandScenario[];
  context?: AssistantRomanianCommandContext;
  expected: AssistantRomanianCommandExpectation;
};

const navigation = (
  id: number,
  category: AssistantRomanianCommandCategory,
  command: string,
  intent: AssistantCommandIntent,
  scenarios: readonly AssistantRomanianCommandScenario[],
  context?: AssistantRomanianCommandContext
): AssistantRomanianCommandCase => ({
  id,
  category,
  command,
  scenarios,
  context,
  expected: {
    commandType: "navigation",
    intent,
    toolIds: ["navigation.open"],
    execution: "navigate",
    confidence: 0.97,
    confirmationRequired: false,
    missingInformation: [],
  },
});

const confirmation = (
  id: number,
  category: AssistantRomanianCommandCategory,
  command: string,
  commandType: AssistantV3CommandType,
  intent: AssistantCommandIntent,
  toolIds: readonly string[],
  scenarios: readonly AssistantRomanianCommandScenario[],
  context?: AssistantRomanianCommandContext
): AssistantRomanianCommandCase => ({
  id,
  category,
  command,
  scenarios,
  context,
  expected: {
    commandType,
    intent,
    toolIds,
    execution: "after_confirmation",
    confidence: 0.95,
    confirmationRequired: true,
    missingInformation: [],
  },
});

const clarification = (
  id: number,
  category: AssistantRomanianCommandCategory,
  command: string,
  commandType: AssistantV3CommandType,
  intent: AssistantCommandIntent,
  missingInformation: readonly string[],
  scenarios: readonly AssistantRomanianCommandScenario[],
  context?: AssistantRomanianCommandContext
): AssistantRomanianCommandCase => ({
  id,
  category,
  command,
  scenarios,
  context,
  expected: {
    commandType,
    intent,
    toolIds: [],
    execution: "clarification",
    confidence: 0.62,
    confirmationRequired: false,
    missingInformation,
  },
});

const blocked = (
  id: number,
  category: AssistantRomanianCommandCategory,
  command: string,
  commandType: AssistantV3CommandType,
  intent: AssistantCommandIntent,
  toolIds: readonly string[],
  blockReason: AssistantRomanianCommandBlockReason,
  scenarios: readonly AssistantRomanianCommandScenario[],
  context?: AssistantRomanianCommandContext
): AssistantRomanianCommandCase => ({
  id,
  category,
  command,
  scenarios,
  context,
  expected: {
    commandType,
    intent,
    toolIds,
    execution: "blocked",
    confidence: 0.96,
    confirmationRequired: commandType !== "navigation",
    missingInformation: [],
    blockReason,
  },
});

export const ASSISTANT_ROMANIAN_COMMAND_MATRIX: readonly AssistantRomanianCommandCase[] = [
  navigation(1, "navigation", "Du-ma la dashboard", "open_dashboard", ["standard"]),
  navigation(2, "navigation", "Deschide panoul de control", "open_page", ["synonym"]),
  navigation(3, "navigation", "Arata-mi masinile", "open_page", ["standard"]),
  navigation(4, "navigation", "Mergi la masina mea", "open_my_vehicle", ["synonym"]),
  navigation(5, "navigation", "Vreau harta GPS pentru toate masinile", "open_gps_maps", [
    "standard",
  ]),
  navigation(6, "navigation", "Deschide inventarul de scule", "open_page", ["synonym"]),
  navigation(7, "navigation", "Du-ma la pontaje", "open_page", ["standard"]),
  navigation(8, "navigation", "Arata proiectele active", "open_page", ["standard"]),
  navigation(9, "navigation", "Intra la mentenanta", "open_page", ["synonym"]),
  navigation(10, "navigation", "Deschide istoricul rapoartelor", "open_page", ["standard"]),
  navigation(11, "navigation", "Mergi la concediile mele", "open_leave", ["standard"]),
  navigation(12, "navigation", "Deschide cheltuielile", "open_expense_scan", ["standard"]),
  navigation(13, "navigation", "Arata utilizatorii", "open_page", ["standard"]),
  navigation(14, "navigation", "Du-ma la notificari", "open_page", ["standard"]),
  navigation(15, "navigation", "Deschide firmele", "open_page", ["standard"]),
  navigation(
    16,
    "navigation",
    "Iesi din editarea masinii si du-ma la dashboard",
    "open_dashboard",
    ["navigation_from_form"],
    { pageContext: { route: "/vehicles/v1/edit", openForm: { id: "vehicle", mode: "edit" } } }
  ),
  navigation(
    17,
    "navigation",
    "Lasa formularul de concediu si mergi la mentenanta",
    "open_page",
    ["navigation_from_form"],
    { pageContext: { route: "/my-leave", openForm: { id: "leave-request", mode: "create" } } }
  ),
  navigation(18, "navigation", "Deschide unde am ramas", "open_page", ["context"], {
    pageContext: { memory: { lastPage: "/projects" } },
  }),

  navigation(19, "vehicles", "Deschide masina Dacia Spring", "open_vehicle", ["standard"]),
  navigation(20, "vehicles", "Arata Wolsvagenul alb", "open_vehicle", ["misspelling"]),
  navigation(21, "vehicles", "Deschide trackerul pentru B 33 LGR", "open_vehicle_tracker", [
    "standard",
  ]),
  navigation(22, "vehicles", "Arata detaliile live ale Loganului", "open_vehicle_live", [
    "standard",
  ]),
  confirmation(
    23,
    "vehicles",
    "Schimba kilometrii Loganului la 6200",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    ["standard"]
  ),
  confirmation(
    24,
    "vehicles",
    "Pune ITP-ul lui B33LGR pe 20 septembrie 2026",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    ["standard"]
  ),
  confirmation(
    25,
    "vehicles",
    "Schimba RCA la Toyota pana maine",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    ["relative_date"]
  ),
  confirmation(
    26,
    "vehicles",
    "Seteaza rovinieta Daciei pana lunea viitoare",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    ["relative_date"]
  ),
  confirmation(
    27,
    "vehicles",
    "Pune-l pe Mihai sofer la B44ABC",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    ["standard"]
  ),
  confirmation(
    28,
    "vehicles",
    "Marcheaza duba cu 04 ca fiind in service",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    ["synonym"]
  ),
  confirmation(
    29,
    "vehicles",
    "Marcheaza B44ABC avariata",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    ["risk"]
  ),
  confirmation(
    30,
    "vehicles",
    "Schimba numarul Daciei in B99XYZ",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    ["risk"]
  ),
  clarification(
    31,
    "vehicles",
    "Pune kilometrii la 90000",
    "entity_update",
    "update_vehicle",
    ["vehicle"],
    ["incomplete"]
  ),
  clarification(
    32,
    "vehicles",
    "Deschide Loganul",
    "navigation",
    "open_vehicle",
    ["vehicle"],
    ["incomplete"],
    { entityMatches: ["Logan B33LGR", "Logan B44ABC"] }
  ),
  confirmation(
    33,
    "vehicles",
    "Pune-i si ITP-ul pe 10 august",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    ["context"],
    { pageContext: { memory: { lastEntity: { type: "vehicle", id: "v1", label: "B33LGR" } } } }
  ),
  blocked(
    34,
    "vehicles",
    "Creeaza masina Dacia Logan B55ABC",
    "create_entity",
    "create_vehicle",
    [],
    "unsupported",
    ["standard"]
  ),
  blocked(
    35,
    "vehicles",
    "Adauga din nou masina B55ABC",
    "create_entity",
    "create_vehicle",
    [],
    "duplicate",
    ["duplicate"],
    { duplicateOf: "vehicle:B55ABC" }
  ),
  blocked(
    36,
    "vehicles",
    "Schimba kilometrii lui B33LGR la 7000",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    "permission_denied",
    ["permission_denied"],
    { permission: "denied" }
  ),
  blocked(
    37,
    "vehicles",
    "Incearca iar schimbarea kilometrilor",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    "retry_requires_confirmation",
    ["retry", "context"],
    {
      previousAttempt: "failed",
      pageContext: {
        memory: {
          lastEntity: { type: "vehicle", id: "v1", label: "B33LGR" },
          lastCommand: "Schimba kilometrii la 7000",
        },
      },
    }
  ),
  blocked(
    38,
    "vehicles",
    "Repeta actualizarea de mai devreme",
    "entity_update",
    "update_vehicle",
    ["vehicles.update"],
    "duplicate",
    ["retry", "duplicate"],
    { previousAttempt: "succeeded" }
  ),

  navigation(39, "tools", "Deschide sculele", "open_page", ["standard"]),
  navigation(40, "tools", "Arata flexul Bosch", "open_tool", ["standard"]),
  navigation(41, "tools", "Cauta bormasina Bosh", "open_tool", ["misspelling"]),
  confirmation(
    42,
    "tools",
    "Marcheaza flexul Bosch defect",
    "entity_update",
    "update_tool",
    ["tools.update"],
    ["standard"]
  ),
  confirmation(
    43,
    "tools",
    "Muta bormasina Hilti la Ionut",
    "entity_update",
    "update_tool",
    ["tools.update"],
    ["standard"]
  ),
  confirmation(
    44,
    "tools",
    "Schimba responsabilul flexului pe Mihai",
    "entity_update",
    "update_tool",
    ["tools.update"],
    ["synonym"]
  ),
  confirmation(
    45,
    "tools",
    "Pune locatia sculei Makita in depozit",
    "entity_update",
    "update_tool",
    ["tools.update"],
    ["standard"]
  ),
  confirmation(
    46,
    "tools",
    "Seteaza garantia bormasinii pana maine",
    "entity_update",
    "update_tool",
    ["tools.update"],
    ["relative_date"]
  ),
  clarification(
    47,
    "tools",
    "Marcheaz-o defecta",
    "entity_update",
    "update_tool",
    ["tool"],
    ["incomplete"]
  ),
  clarification(
    48,
    "tools",
    "Deschide flexul Bosch",
    "navigation",
    "open_tool",
    ["tool"],
    ["incomplete"],
    { entityMatches: ["Flex Bosch F123", "Flex Bosch F456"] }
  ),
  confirmation(
    49,
    "tools",
    "Muta-o si la depozit",
    "entity_update",
    "update_tool",
    ["tools.update"],
    ["context"],
    {
      pageContext: { memory: { lastEntity: { type: "tool", id: "t1", label: "Flex Bosch F123" } } },
    }
  ),
  blocked(
    50,
    "tools",
    "Creeaza scula flex Bosch cod F999",
    "create_entity",
    "create_tool",
    [],
    "unsupported",
    ["standard"]
  ),
  blocked(
    51,
    "tools",
    "Mai adauga o data scula cu cod F123",
    "create_entity",
    "create_tool",
    [],
    "duplicate",
    ["duplicate"],
    { duplicateOf: "tool:F123" }
  ),
  blocked(
    52,
    "tools",
    "Schimba locatia sculei Hilti in atelier",
    "entity_update",
    "update_tool",
    ["tools.update"],
    "permission_denied",
    ["permission_denied"],
    { permission: "denied" }
  ),
  blocked(
    53,
    "tools",
    "Reincearca mutarea sculei",
    "entity_update",
    "update_tool",
    ["tools.update"],
    "retry_requires_confirmation",
    ["retry"],
    { previousAttempt: "failed" }
  ),
  navigation(
    54,
    "tools",
    "Iesi din formularul sculei si deschide masinile",
    "open_page",
    ["navigation_from_form"],
    { pageContext: { route: "/tools/t1/edit", openForm: { id: "tool", mode: "edit" } } }
  ),

  navigation(55, "timesheets_projects", "Deschide pontajul meu", "open_my_timesheets", [
    "standard",
  ]),
  navigation(56, "timesheets_projects", "Arata toate pontajele", "open_page", ["standard"]),
  navigation(57, "timesheets_projects", "Du-ma la proiecte", "open_page", ["standard"]),
  navigation(58, "timesheets_projects", "Deschide proiectul Service Lifturi", "open_project", [
    "standard",
  ]),
  navigation(59, "timesheets_projects", "Arata pontaju meu", "open_my_timesheets", ["misspelling"]),
  confirmation(
    60,
    "timesheets_projects",
    "Porneste pontaj pe proiectul Service 2",
    "timesheet_action",
    "start_timesheet",
    ["timesheets.start"],
    ["standard"]
  ),
  clarification(
    61,
    "timesheets_projects",
    "Porneste pontajul",
    "timesheet_action",
    "start_timesheet",
    ["project"],
    ["incomplete"]
  ),
  confirmation(
    62,
    "timesheets_projects",
    "Opreste pontajul activ",
    "timesheet_action",
    "stop_timesheet",
    ["timesheets.stop"],
    ["standard"],
    { activeTimesheet: true }
  ),
  blocked(
    63,
    "timesheets_projects",
    "Opreste iar pontajul",
    "timesheet_action",
    "stop_timesheet",
    ["timesheets.stop"],
    "duplicate",
    ["duplicate"],
    { activeTimesheet: false, previousAttempt: "succeeded" }
  ),
  confirmation(
    64,
    "timesheets_projects",
    "Creeaza proiectul Revizie Lifturi Sector 3",
    "create_entity",
    "create_project",
    ["timesheets.projects.create"],
    ["standard"]
  ),
  clarification(
    65,
    "timesheets_projects",
    "Creeaza un proiect",
    "create_entity",
    "create_project",
    ["projectName"],
    ["incomplete"]
  ),
  blocked(
    66,
    "timesheets_projects",
    "Creeaza proiectul Service 2",
    "create_entity",
    "create_project",
    ["timesheets.projects.create"],
    "duplicate",
    ["duplicate"],
    { duplicateOf: "project:Service 2" }
  ),
  confirmation(
    67,
    "timesheets_projects",
    "Creeaza proiectul Montaj Nord si porneste pontajul pe el",
    "timesheet_action",
    "start_timesheet",
    ["timesheets.projects.create", "timesheets.start"],
    ["multi_step"]
  ),
  confirmation(
    68,
    "timesheets_projects",
    "Opreste pontajul curent si porneste-l pe Service 3",
    "timesheet_action",
    "start_timesheet",
    ["timesheets.stop", "timesheets.start"],
    ["multi_step", "risk"],
    { activeTimesheet: true }
  ),
  confirmation(
    69,
    "timesheets_projects",
    "Marcheaza proiectul Service Lifturi finalizat",
    "entity_update",
    "update_project",
    ["timesheets.projects.update"],
    ["standard"]
  ),
  confirmation(
    70,
    "timesheets_projects",
    "Redenumeste proiectul Service 2 in Service 2026",
    "entity_update",
    "update_project",
    ["timesheets.projects.update"],
    ["risk"]
  ),
  blocked(
    71,
    "timesheets_projects",
    "Pune proiectul Vali inactiv",
    "entity_update",
    "update_project",
    ["timesheets.projects.update"],
    "permission_denied",
    ["permission_denied"],
    { permission: "denied", pageContext: { role: "angajat" } }
  ),
  confirmation(
    72,
    "timesheets_projects",
    "Pune-l si pe acesta finalizat",
    "entity_update",
    "update_project",
    ["timesheets.projects.update"],
    ["context"],
    {
      pageContext: {
        memory: { lastEntity: { type: "project", id: "p1", label: "Service Lifturi" } },
      },
    }
  ),
  clarification(
    73,
    "timesheets_projects",
    "Deschide proiectul Service",
    "navigation",
    "open_project",
    ["project"],
    ["incomplete"],
    { entityMatches: ["Service 2", "Service 3"] }
  ),
  blocked(
    74,
    "timesheets_projects",
    "Porneste automat pontajul maine la opt",
    "timesheet_action",
    "start_timesheet",
    [],
    "unsupported",
    ["relative_date", "risk"]
  ),
  blocked(
    75,
    "timesheets_projects",
    "Incearca din nou sa pornesti pontajul",
    "timesheet_action",
    "start_timesheet",
    ["timesheets.start"],
    "retry_requires_confirmation",
    ["retry"],
    { previousAttempt: "failed" }
  ),
  blocked(
    76,
    "timesheets_projects",
    "Repeta pornirea pontajului",
    "timesheet_action",
    "start_timesheet",
    ["timesheets.start"],
    "duplicate",
    ["retry", "duplicate"],
    { previousAttempt: "succeeded", activeTimesheet: true }
  ),
  navigation(
    77,
    "timesheets_projects",
    "Iesi din formular si du-ma la lista de proiecte",
    "open_page",
    ["navigation_from_form"],
    { pageContext: { route: "/projects/new", openForm: { id: "project", mode: "create" } } }
  ),
  navigation(
    78,
    "timesheets_projects",
    "Arata ultimul pontaj al lui Razvan",
    "open_user_activity",
    ["standard"]
  ),

  navigation(79, "maintenance_lifts_reports", "Deschide mentenanta", "open_page", ["standard"]),
  navigation(80, "maintenance_lifts_reports", "Cauta clientul Isomat la mentenanta", "open_page", [
    "standard",
  ]),
  navigation(81, "maintenance_lifts_reports", "Arata piesele pentru lifturi", "open_page", [
    "standard",
  ]),
  navigation(82, "maintenance_lifts_reports", "Deschide firmele de mentenanta", "open_page", [
    "standard",
  ]),
  navigation(83, "maintenance_lifts_reports", "Arata istoricul rapoartelor de lift", "open_page", [
    "standard",
  ]),
  navigation(84, "maintenance_lifts_reports", "Deschide verificarile lunare", "open_page", [
    "standard",
  ]),
  confirmation(
    85,
    "maintenance_lifts_reports",
    "Adauga clientul Isomat cu liftul 210869",
    "create_entity",
    "create_maintenance_client",
    ["maintenance.draft"],
    ["standard"]
  ),
  confirmation(
    86,
    "maintenance_lifts_reports",
    "Completeaza Isomat, email office@isomat.ro si lift 210869",
    "form_fill",
    "fill_maintenance_client_form",
    ["maintenance.draft"],
    ["standard"]
  ),
  confirmation(
    87,
    "maintenance_lifts_reports",
    "Adauga lifturile 123 si 456 la clientul Isomat",
    "create_entity",
    "create_maintenance_client",
    ["maintenance.draft"],
    ["multi_step"]
  ),
  confirmation(
    88,
    "maintenance_lifts_reports",
    "Genereaza raportul de revizie pentru Isomat",
    "form_fill",
    "open_maintenance_report",
    ["maintenance.report.prepare"],
    ["standard"]
  ),
  confirmation(
    89,
    "maintenance_lifts_reports",
    "Pregateste raport de interventie pentru liftul 210869",
    "form_fill",
    "open_maintenance_report",
    ["maintenance.report.prepare"],
    ["standard"]
  ),
  navigation(
    90,
    "maintenance_lifts_reports",
    "Deschide raportul de interventie de ieri pentru Isomat",
    "open_maintenance_report",
    ["relative_date"]
  ),
  navigation(91, "maintenance_lifts_reports", "Du-ma la mentenata lifturilor", "open_page", [
    "misspelling",
  ]),
  clarification(
    92,
    "maintenance_lifts_reports",
    "Adauga un client de mentenanta",
    "create_entity",
    "create_maintenance_client",
    ["name", "liftNumbers"],
    ["incomplete"]
  ),
  clarification(
    93,
    "maintenance_lifts_reports",
    "Genereaza raportul de revizie",
    "form_fill",
    "open_maintenance_report",
    ["maintenanceClient"],
    ["incomplete"]
  ),
  clarification(
    94,
    "maintenance_lifts_reports",
    "Deschide clientul Isomat",
    "navigation",
    "open_page",
    ["maintenanceClient"],
    ["incomplete"],
    { entityMatches: ["Isomat Nord", "Isomat Sud"] }
  ),
  blocked(
    95,
    "maintenance_lifts_reports",
    "Schimba si telefonul clientului in 0722000000",
    "entity_update",
    "update_current_page_field",
    [],
    "unsupported",
    ["context"],
    {
      pageContext: {
        memory: { lastEntity: { type: "maintenanceClient", id: "m1", label: "Isomat" } },
      },
    }
  ),
  blocked(
    96,
    "maintenance_lifts_reports",
    "Adauga din nou Isomat cu liftul 210869",
    "create_entity",
    "create_maintenance_client",
    ["maintenance.draft"],
    "duplicate",
    ["duplicate"],
    { duplicateOf: "maintenanceClient:Isomat:210869" }
  ),
  blocked(
    97,
    "maintenance_lifts_reports",
    "Completeaza clientul Isomat cu liftul 210869",
    "form_fill",
    "fill_maintenance_client_form",
    ["maintenance.draft"],
    "permission_denied",
    ["permission_denied"],
    { permission: "denied" }
  ),
  blocked(
    98,
    "maintenance_lifts_reports",
    "Reincearca adaugarea clientului",
    "create_entity",
    "create_maintenance_client",
    ["maintenance.draft"],
    "retry_requires_confirmation",
    ["retry"],
    { previousAttempt: "failed" }
  ),
  navigation(
    99,
    "maintenance_lifts_reports",
    "Iesi din formularul clientului si deschide rapoartele",
    "open_page",
    ["navigation_from_form"],
    {
      pageContext: {
        route: "/maintenance",
        openForm: { id: "maintenance-client", mode: "create" },
      },
    }
  ),
  navigation(
    100,
    "maintenance_lifts_reports",
    "Deschide raportul pentru clientul selectat",
    "open_maintenance_report",
    ["context"],
    { pageContext: { selectedEntity: { type: "maintenanceClient", id: "m1", label: "Isomat" } } }
  ),

  navigation(101, "leave", "Deschide calendarul de concedii", "open_leave", ["standard"]),
  confirmation(
    102,
    "leave",
    "Programeaza concediu pentru maine",
    "form_fill",
    "schedule_leave",
    ["leave.draft"],
    ["relative_date"]
  ),
  confirmation(
    103,
    "leave",
    "Completeaza concediu pentru poimaine",
    "form_fill",
    "fill_leave_form",
    ["leave.draft"],
    ["relative_date"]
  ),
  confirmation(
    104,
    "leave",
    "Programeaza concediu din 24 pana pe 30 august",
    "form_fill",
    "schedule_leave",
    ["leave.draft"],
    ["standard"]
  ),
  confirmation(
    105,
    "leave",
    "Pune concediu de lunea viitoare pana vineri",
    "form_fill",
    "schedule_leave",
    ["leave.draft"],
    ["relative_date"]
  ),
  confirmation(
    106,
    "leave",
    "Completeaza concedu medical pe 12 august",
    "form_fill",
    "fill_leave_form",
    ["leave.draft"],
    ["misspelling"]
  ),
  clarification(
    107,
    "leave",
    "Programeaza-mi concediu",
    "form_fill",
    "schedule_leave",
    ["startDate", "endDate"],
    ["incomplete"]
  ),
  clarification(
    108,
    "leave",
    "Pune concediu din 30 august pana pe 24 august",
    "form_fill",
    "schedule_leave",
    ["validDateRange"],
    ["risk"]
  ),
  blocked(
    109,
    "leave",
    "Trimite cererea de concediu",
    "form_fill",
    "submit_current_form",
    [],
    "unsupported",
    ["risk"]
  ),
  blocked(
    110,
    "leave",
    "Completeaza concediul pentru maine",
    "form_fill",
    "schedule_leave",
    ["leave.draft"],
    "permission_denied",
    ["permission_denied"],
    { permission: "denied" }
  ),
  blocked(
    111,
    "leave",
    "Mai pune o cerere de concediu pentru 24 august",
    "form_fill",
    "schedule_leave",
    ["leave.draft"],
    "duplicate",
    ["duplicate"],
    { duplicateOf: "leave:2026-08-24" }
  ),
  blocked(
    112,
    "leave",
    "Incearca din nou cererea de concediu",
    "form_fill",
    "schedule_leave",
    ["leave.draft"],
    "retry_requires_confirmation",
    ["retry"],
    { previousAttempt: "failed" }
  ),
  navigation(
    113,
    "leave",
    "Iesi din formularul de concediu si mergi la dashboard",
    "open_dashboard",
    ["navigation_from_form"],
    { pageContext: { route: "/my-leave", openForm: { id: "leave-request", mode: "create" } } }
  ),
  confirmation(
    114,
    "leave",
    "Pune-l si pana vineri",
    "form_fill",
    "fill_leave_form",
    ["leave.draft"],
    ["context", "relative_date"],
    {
      pageContext: {
        route: "/my-leave",
        openForm: { id: "leave-request", mode: "create" },
        memory: { lastCommand: "Concediu de luni" },
      },
    }
  ),

  navigation(115, "users", "Deschide lista de utilizatori", "open_page", ["standard"]),
  navigation(116, "users", "Arata profilul meu", "open_page", ["standard"]),
  navigation(117, "users", "Arata ultima activitate a lui Ionut", "open_user_activity", [
    "standard",
  ]),
  navigation(118, "users", "Deschide utilizatoru Razvan", "open_user_activity", ["misspelling"]),
  confirmation(
    119,
    "users",
    "Schimba functia lui Ionut in tehnician lifturi",
    "entity_update",
    "update_user",
    ["users.update"],
    ["standard"]
  ),
  confirmation(
    120,
    "users",
    "Pune departamentul lui Mihai la interventii",
    "entity_update",
    "update_user",
    ["users.update"],
    ["standard"]
  ),
  confirmation(
    121,
    "users",
    "Schimba rolul lui Razvan in manager",
    "entity_update",
    "update_user",
    ["users.update"],
    ["risk"]
  ),
  confirmation(
    122,
    "users",
    "Schimba telefonul meu in 0722000000",
    "entity_update",
    "update_profile_field",
    ["users.update"],
    ["context"]
  ),
  clarification(
    123,
    "users",
    "Schimba departamentul in service",
    "entity_update",
    "update_user",
    ["user"],
    ["incomplete"]
  ),
  clarification(
    124,
    "users",
    "Deschide istoricul lui Ion",
    "navigation",
    "open_user_activity",
    ["user"],
    ["incomplete"],
    { entityMatches: ["Ion Pop", "Ion Ionescu"] }
  ),
  confirmation(
    125,
    "users",
    "Schimba-i si telefonul in 0722111111",
    "entity_update",
    "update_user",
    ["users.update"],
    ["context"],
    { pageContext: { memory: { lastEntity: { type: "user", id: "u1", label: "Mihai" } } } }
  ),
  blocked(
    126,
    "users",
    "Schimba rolul lui Razvan in admin",
    "entity_update",
    "update_user",
    ["users.update"],
    "permission_denied",
    ["permission_denied", "risk"],
    { permission: "denied", pageContext: { role: "angajat" } }
  ),
  blocked(
    127,
    "users",
    "Pune din nou rolul manager pentru Razvan",
    "entity_update",
    "update_user",
    ["users.update"],
    "duplicate",
    ["duplicate", "risk"],
    { duplicateOf: "user:Razvan:role:manager" }
  ),
  blocked(
    128,
    "users",
    "Reincearca schimbarea rolului",
    "entity_update",
    "update_user",
    ["users.update"],
    "retry_requires_confirmation",
    ["retry", "risk"],
    { previousAttempt: "failed" }
  ),

  navigation(129, "expenses", "Deschide scanarea bonurilor", "open_expense_scan", ["standard"]),
  navigation(130, "expenses", "Arata facturile neplatite", "open_expense_invoices", ["standard"]),
  navigation(131, "expenses", "Du-ma la rapoarte de cheltuieli", "open_page", ["standard"]),
  navigation(132, "expenses", "Deschide cheltuelile", "open_expense_scan", ["misspelling"]),
  confirmation(
    133,
    "expenses",
    "Completeaza categoria bonului cu combustibil",
    "form_fill",
    "fill_current_page",
    ["expenses.draft"],
    ["standard"],
    { pageContext: { route: "/expenses/scan", openForm: { id: "expense", mode: "create" } } }
  ),
  confirmation(
    134,
    "expenses",
    "Pune proiectul Service 2 si nota deplasare la bon",
    "form_fill",
    "fill_current_page",
    ["expenses.draft"],
    ["multi_step"]
  ),
  clarification(
    135,
    "expenses",
    "Completeaza bonul",
    "form_fill",
    "fill_current_page",
    ["fields"],
    ["incomplete"]
  ),
  confirmation(
    136,
    "expenses",
    "Pune si proiectul Service 3",
    "form_fill",
    "fill_current_page",
    ["expenses.draft"],
    ["context"],
    {
      pageContext: {
        route: "/expenses/scan",
        openForm: { id: "expense", mode: "create" },
        memory: { lastCommand: "Completeaza categoria cu combustibil" },
      },
    }
  ),
  blocked(
    137,
    "expenses",
    "Completeaza firma bonului cu OMV",
    "form_fill",
    "fill_current_page",
    ["expenses.draft"],
    "permission_denied",
    ["permission_denied"],
    { permission: "denied" }
  ),
  blocked(
    138,
    "expenses",
    "Scaneaza din nou acelasi bon",
    "form_fill",
    "fill_current_page",
    [],
    "duplicate",
    ["duplicate"],
    { duplicateOf: "expense:receipt-hash" }
  ),
  blocked(
    139,
    "expenses",
    "Reincearca completarea bonului",
    "form_fill",
    "fill_current_page",
    ["expenses.draft"],
    "retry_requires_confirmation",
    ["retry"],
    { previousAttempt: "failed" }
  ),
  navigation(
    140,
    "expenses",
    "Iesi din formularul bonului si du-ma la mentenanta",
    "open_page",
    ["navigation_from_form"],
    { pageContext: { route: "/expenses/scan", openForm: { id: "expense", mode: "create" } } }
  ),

  navigation(141, "notifications", "Deschide notificarile", "open_page", ["standard"]),
  navigation(142, "notifications", "Arata alertele mele", "open_page", ["synonym"]),
  navigation(143, "notifications", "Cauta notificarile despre pontaj", "open_page", ["standard"]),
  blocked(
    144,
    "notifications",
    "Creeaza notificare pentru Razvan: verifica pontajul",
    "create_entity",
    "create_manual_notification",
    [],
    "unsupported",
    ["standard"]
  ),
  clarification(
    145,
    "notifications",
    "Trimite notificarea verifica pontajul",
    "create_entity",
    "create_manual_notification",
    ["targetUser"],
    ["incomplete"]
  ),
  blocked(
    146,
    "notifications",
    "Marcheaza toate notificarile citite",
    "entity_update",
    "unknown",
    [],
    "unsupported",
    ["risk"]
  ),
  blocked(
    147,
    "notifications",
    "Sterge notificarea de ieri",
    "unknown",
    "unknown",
    [],
    "unsupported",
    ["risk", "relative_date"]
  ),
  blocked(
    148,
    "notifications",
    "Trimite o notificare tuturor utilizatorilor",
    "create_entity",
    "create_manual_notification",
    [],
    "permission_denied",
    ["permission_denied", "risk"],
    { permission: "denied" }
  ),
  blocked(
    149,
    "notifications",
    "Reincearca trimiterea notificarii pentru Razvan",
    "create_entity",
    "create_manual_notification",
    [],
    "retry_requires_confirmation",
    ["retry"],
    { previousAttempt: "failed" }
  ),
  blocked(
    150,
    "notifications",
    "Trimite din nou notificarea care a plecat",
    "create_entity",
    "create_manual_notification",
    [],
    "duplicate",
    ["retry", "duplicate"],
    { previousAttempt: "succeeded" }
  ),
];
