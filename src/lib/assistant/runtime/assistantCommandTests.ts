import type { AssistantCommandEntityType, AssistantCommandIntent } from "../assistantCommandService";
import type { AssistantCommandType } from "./assistantClassifier";

export type AssistantCommandTestCase = {
  command: string;
  expectedIntent: AssistantCommandIntent;
  expectedEntityType: AssistantCommandEntityType;
  expectedCommandType?: AssistantCommandType;
  expectedFields?: string[];
  shouldClarify?: boolean;
  shouldConfirm?: boolean;
  negativeAssertion?: string;
};

export const assistantCommandTests: AssistantCommandTestCase[] = [
  { command: "deschide masina B 33 LGR", expectedIntent: "open_vehicle", expectedEntityType: "vehicle" },
  { command: "du-te pe pagina concedii", expectedIntent: "open_page", expectedEntityType: "page", expectedCommandType: "navigation", negativeAssertion: "Nu modifica niciun camp din formularul curent." },
  { command: "deschide mentenanta", expectedIntent: "open_page", expectedEntityType: "page", expectedCommandType: "navigation", negativeAssertion: "Nu completeaza formularul curent." },
  { command: "arata dashboard", expectedIntent: "open_page", expectedEntityType: "page", expectedCommandType: "navigation" },
  { command: "schimba kilometrii la B33LGR la 6180", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedCommandType: "entity_update", expectedFields: ["kilometri"], shouldConfirm: true },
  { command: "Schimba kilometrii masinii B33LGR la 6180", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["kilometri"], shouldConfirm: true },
  { command: "La Logan pune km 7000", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["kilometri"], shouldConfirm: true },
  { command: "seteaza ITP la Logan pe 20 septembrie 2026", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["ITP"], shouldConfirm: true },
  { command: "pune masina lui Razvan in service", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["status"], shouldConfirm: true },
  { command: "schimba soferul la B123ABC pe Mihai", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["sofer"], shouldConfirm: true },
  { command: "la Logan schimba kilometrii la 6200 si ITP-ul pe 20 septembrie 2026", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["kilometri", "ITP"], shouldConfirm: true },
  { command: "schimba RCA la Toyota pe 15 august 2026", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["RCA"], shouldConfirm: true },
  { command: "seteaza rovinieta la duba cu 04 in numar pe 30 decembrie 2026", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["rovinieta"], shouldConfirm: true },
  { command: "pune numarul masinii Logan in B99ABC", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["numar"], shouldConfirm: true },
  { command: "modifica VIN la B123ABC in WDB123", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["VIN"], shouldConfirm: true },
  { command: "deschide flexul Bosch", expectedIntent: "open_tool", expectedEntityType: "tool" },
  { command: "marcheaza flexul Bosch defect", expectedIntent: "update_tool", expectedEntityType: "tool", expectedFields: ["status"], shouldConfirm: true },
  { command: "muta bormasina la Ionut", expectedIntent: "update_tool", expectedEntityType: "tool", expectedFields: ["detinator"], shouldConfirm: true },
  { command: "pune scula in depozit", expectedIntent: "update_tool", expectedEntityType: "tool", expectedFields: ["status"], shouldClarify: true },
  { command: "schimba codul sculei in SC-123", expectedIntent: "update_tool", expectedEntityType: "tool", expectedFields: ["cod"], shouldClarify: true },
  { command: "seteaza QR la flex Bosch in QR-55", expectedIntent: "update_tool", expectedEntityType: "tool", expectedFields: ["QR"], shouldConfirm: true },
  { command: "schimba garantia bormasinii pe 10 octombrie 2026", expectedIntent: "update_tool", expectedEntityType: "tool", expectedFields: ["garantie"], shouldConfirm: true },
  { command: "pune observatii la flex Bosch verificat azi", expectedIntent: "update_tool", expectedEntityType: "tool", expectedFields: ["observatii"], shouldConfirm: true },
  { command: "schimba responsabilul sculei Makita pe Razvan", expectedIntent: "update_tool", expectedEntityType: "tool", expectedFields: ["responsabil"], shouldConfirm: true },
  { command: "deschide scula cu cod SC-123", expectedIntent: "open_tool", expectedEntityType: "tool" },
  { command: "creeaza proiect Revizie Lifturi Sector 3", expectedIntent: "create_project", expectedEntityType: "project", shouldConfirm: true },
  { command: "schimba proiectul Revizie Lifturi in finalizat", expectedIntent: "update_project", expectedEntityType: "project", expectedFields: ["status"], shouldConfirm: true },
  { command: "porneste pontaj pe proiectul Service", expectedIntent: "start_timesheet", expectedEntityType: "project", shouldConfirm: true },
  { command: "opreste pontajul", expectedIntent: "stop_timesheet", expectedEntityType: "none", shouldConfirm: true },
  { command: "schimba numele proiectului Service in Service Lifturi", expectedIntent: "update_project", expectedEntityType: "project", expectedFields: ["nume"], shouldConfirm: true },
  { command: "fa proiectul Montaj inactiv", expectedIntent: "update_project", expectedEntityType: "project", expectedFields: ["status"], shouldConfirm: true },
  { command: "du-ma la pontajul meu", expectedIntent: "open_page", expectedEntityType: "page" },
  { command: "deschide harta cu toate gpsurile", expectedIntent: "open_page", expectedEntityType: "page" },
  { command: "du-ma la scanare bonuri", expectedIntent: "open_page", expectedEntityType: "page" },
  { command: "deschide facturi", expectedIntent: "open_page", expectedEntityType: "page" },
  { command: "du-ma la concedii", expectedIntent: "open_page", expectedEntityType: "page" },
  { command: "Adauga client nou in mentenanta Isomat cu lift 210869", expectedIntent: "create_maintenance_client", expectedEntityType: "maintenanceClient", expectedCommandType: "create_entity", expectedFields: ["name", "liftNumber"], shouldConfirm: true },
  { command: "Adauga client mentenanta Isomat cu lift 210869", expectedIntent: "create_maintenance_client", expectedEntityType: "maintenanceClient", expectedCommandType: "create_entity", expectedFields: ["name", "liftNumber"], shouldConfirm: true },
  { command: "Completeaza client nou Isomat email office@isomat.ro adresa Aurel Vlaicu 91 lift 210869", expectedIntent: "create_maintenance_client", expectedEntityType: "maintenanceClient", expectedCommandType: "create_entity", expectedFields: ["name", "email", "address", "liftNumber"], shouldConfirm: true },
  { command: "Programeaza concediu ultima saptamana din august", expectedIntent: "schedule_leave", expectedEntityType: "currentPage", expectedCommandType: "form_fill", expectedFields: ["startDate", "endDate"], shouldConfirm: true },
  { command: "completeaza concediu de luni pana vineri", expectedIntent: "schedule_leave", expectedEntityType: "currentPage", expectedCommandType: "form_fill", expectedFields: ["startDate", "endDate"], shouldConfirm: true },
  { command: "Programeaza concediu intre 24 si 30 august", expectedIntent: "schedule_leave", expectedEntityType: "currentPage", expectedCommandType: "form_fill", expectedFields: ["startDate", "endDate"], shouldConfirm: true },
  { command: "apasa salveaza", expectedIntent: "click_button", expectedEntityType: "currentPage", shouldConfirm: true },
  { command: "apasa trimite cererea", expectedIntent: "click_button", expectedEntityType: "currentPage", shouldConfirm: true },
  { command: "completeaza telefon cu 0722000000", expectedIntent: "fill_current_page", expectedEntityType: "currentPage", expectedFields: ["telefon"], shouldConfirm: true },
  { command: "selecteaza firma WorkControl", expectedIntent: "fill_current_page", expectedEntityType: "currentPage", expectedFields: ["firma"], shouldConfirm: true },
  { command: "schimba statusul", expectedIntent: "unknown", expectedEntityType: "none", shouldClarify: true },
  { command: "schimba data", expectedIntent: "unknown", expectedEntityType: "none", expectedCommandType: "unknown", shouldClarify: true },
  { command: "modifica data", expectedIntent: "unknown", expectedEntityType: "none", expectedCommandType: "unknown", shouldClarify: true },
  { command: "fiind in concedii, deschide mentenanta", expectedIntent: "open_page", expectedEntityType: "page", expectedCommandType: "navigation", negativeAssertion: "Nu modifica datele concediului." },
  { command: "fiind in formular masina, du-te pe pagina concedii", expectedIntent: "open_page", expectedEntityType: "page", expectedCommandType: "navigation", negativeAssertion: "Nu modifica numarul de inmatriculare." },
  { command: "muta la Mihai", expectedIntent: "unknown", expectedEntityType: "none", shouldClarify: true },
  { command: "deschide Logan", expectedIntent: "open_vehicle", expectedEntityType: "vehicle", shouldClarify: true },
  { command: "schimba km la 5000", expectedIntent: "update_vehicle", expectedEntityType: "vehicle", expectedFields: ["km"], shouldClarify: true },
  { command: "arata ultimul pontaj al lui Razvan", expectedIntent: "open_page", expectedEntityType: "page" },
  { command: "creeaza scula noua flex Bosch cod FB-01", expectedIntent: "create_tool", expectedEntityType: "tool", shouldConfirm: true },
  { command: "creeaza masina B44XYZ Dacia Logan", expectedIntent: "create_vehicle", expectedEntityType: "vehicle", shouldConfirm: true },
];
