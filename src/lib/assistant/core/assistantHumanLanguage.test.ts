import { describe, expect, it } from "vitest";
import {
  analyzeAssistantHumanLanguage,
  buildAssistantLanguageHints,
  buildLocalContextualFormContract,
  buildLocalContextualNavigationContract,
  buildSafeAssistantClarificationContract,
} from "./assistantHumanLanguage";

describe("assistant human language", () => {
  it("extracts action, domain and context from colloquial Romanian", () => {
    expect(
      analyzeAssistantHumanLanguage("pune si la masina asta kilometrii pe 7200")
    ).toMatchObject({
      action: "update",
      modules: expect.arrayContaining(["vehicles"]),
      usesCurrentContext: true,
      isMutation: true,
      fieldWords: expect.arrayContaining(["kilometri"]),
    });
  });

  it("describes a natural multi-step request without executing it prematurely", () => {
    expect(
      analyzeAssistantHumanLanguage("du-ma la masina Toyota si apoi schimba km la 7200")
    ).toMatchObject({
      modules: expect.arrayContaining(["vehicles"]),
      hasMultipleSteps: true,
      actionSequence: expect.arrayContaining(["navigate", "update"]),
      possibleEntityTypes: expect.arrayContaining(["vehicle"]),
    });
  });

  it("marks a follow-up as contextual and exposes only safe previous-command hints", () => {
    expect(
      buildAssistantLanguageHints("si pune-i ITP-ul pe 20 august", {
        memory: { lastCommand: "deschide masina Toyota" },
      })
    ).toMatchObject({
      isContinuation: true,
      hasPreviousCommand: true,
      previousAction: "navigate",
      previousModules: expect.arrayContaining(["vehicles"]),
    });
  });

  it.each([
    ["si aproba cererea de concediu respectiva", "leaveRequest"],
    ["la bonul ala schimba proiectul", "expense"],
    ["opreste regula respectiva", "notificationRule"],
    ["fa tema aia verde", "siteSettings"],
  ])("recognizes contextual entities across modules: %s", (command, entityType) => {
    expect(analyzeAssistantHumanLanguage(command)).toMatchObject({
      usesCurrentContext: true,
      possibleEntityTypes: expect.arrayContaining([entityType]),
    });
  });

  it("returns to the previous WorkControl page without replaying a previous write", () => {
    expect(
      buildLocalContextualNavigationContract("revino unde eram", {
        route: "/notifications",
        memory: {
          lastPage: "/notifications",
          previousPage: "/vehicles/vehicle-1?tab=gps",
          lastCommand: "schimba kilometrii la 7200",
        },
      })
    ).toMatchObject({
      commandType: "navigation",
      confirmationRequired: false,
      toolCalls: [
        {
          id: "navigation.open",
          input: { path: "/vehicles/vehicle-1?tab=gps", query: "" },
        },
      ],
    });
  });

  it("rejects an unsafe remembered route", () => {
    expect(
      buildLocalContextualNavigationContract("tot acolo", {
        route: "/dashboard",
        memory: { previousPage: "//outside.example" },
      })
    ).toBeNull();
  });

  it.each([
    [
      "completeaza nume client Isomat email office@isomat.ro telefon 0722000000",
      "/maintenance?tab=clients",
      "maintenance.draft",
      { name: "isomat", email: "office@isomat.ro", contactPhone: "0722000000" },
    ],
    [
      "baga marca Dacia model Logan kilometri 6200",
      "/vehicles/new",
      "vehicles.draft",
      { brand: "dacia", model: "logan", currentKm: 6200 },
    ],
    [
      "pune nume Flex Bosch status defecta locatie depozit",
      "/tools/new",
      "tools.draft",
      { name: "flex bosch", status: "defecta", locationLabel: "depozit" },
    ],
    [
      "trece nume complet Mihai Popescu functie electrician departament service",
      "/users/new/edit",
      "users.draft",
      { fullName: "mihai popescu", roleTitle: "electrician", department: "service" },
    ],
    [
      "completeaza data inceput 20 august 2026 data sfarsit 25 august 2026 motiv odihna",
      "/my-leave",
      "leave.draft",
      { startDate: "20 august 2026", endDate: "25 august 2026", reason: "odihna" },
    ],
    [
      "pune proiect Service Lifturi firma Brex Lifts",
      "/expenses/scan",
      "expenses.draft",
      { projectId: "service lifturi", companyName: "brex lifts" },
    ],
    [
      "baga nume proiect Service 4 status activ",
      "/projects",
      "timesheets.projects.draft",
      { name: "service 4", status: "activ" },
    ],
  ])("fills the controlled form for rough wording: %s", (command, route, toolId, fields) => {
    const result = buildLocalContextualFormContract(command, { route });

    expect(result).toMatchObject({
      commandType: "form_fill",
      confirmationRequired: false,
      toolCalls: [{ id: toolId, input: { fields } }],
    });
  });

  it("does not guess a write when the cloud interpreter is unavailable", () => {
    const result = buildSafeAssistantClarificationContract("schimba si aici", {
      route: "/vehicles/vehicle-1",
      page: "vehicle-details",
      selectedEntity: { type: "vehicle", id: "vehicle-1", label: "B092194 Dacia Logan" },
      openForm: null,
      availableActions: [],
      allowedFields: [],
      role: "admin",
      memory: {},
    });

    expect(result).toMatchObject({
      commandType: "unknown",
      toolCalls: [],
      confidence: 0.35,
      missingInformation: ["campul si valoarea noua"],
    });
    expect(result.response).toContain("B092194 Dacia Logan");
  });
});
