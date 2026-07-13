import { describe, expect, it } from "vitest";
import { getAssistantV3ToolRegistry } from "../adapters";
import { validateAssistantV3Contract } from "./assistantV3Contract";
import {
  ASSISTANT_ROMANIAN_COMMAND_CATEGORIES,
  ASSISTANT_ROMANIAN_COMMAND_MATRIX,
  ASSISTANT_ROMANIAN_COMMAND_SCENARIOS,
} from "./assistantRomanianCommandMatrix";
import { ASSISTANT_V3_SAFE_CONFIDENCE } from "./assistantV3Types";

const LOCAL_CONTRACT_FIXTURES = {
  commandTypes: new Set([
    "navigation",
    "form_fill",
    "entity_update",
    "create_entity",
    "timesheet_action",
    "question",
    "unknown",
  ]),
  mutationTypes: new Set(["form_fill", "entity_update", "create_entity", "timesheet_action"]),
  navigationToolId: "navigation.open",
  minimumCases: 150,
} as const;

describe("Romanian WorkControl assistant command matrix", () => {
  it("contains at least 150 unique, sequential commands", () => {
    expect(ASSISTANT_ROMANIAN_COMMAND_MATRIX).toHaveLength(LOCAL_CONTRACT_FIXTURES.minimumCases);
    expect(ASSISTANT_ROMANIAN_COMMAND_MATRIX.map(({ id }) => id)).toEqual(
      Array.from({ length: LOCAL_CONTRACT_FIXTURES.minimumCases }, (_, index) => index + 1)
    );

    const normalizedCommands = ASSISTANT_ROMANIAN_COMMAND_MATRIX.map(({ command }) =>
      command.trim().toLocaleLowerCase("ro-RO")
    );
    expect(new Set(normalizedCommands).size).toBe(normalizedCommands.length);
  });

  it("covers every required module category and command scenario", () => {
    const categories = new Set(ASSISTANT_ROMANIAN_COMMAND_MATRIX.map(({ category }) => category));
    const scenarios = new Set(
      ASSISTANT_ROMANIAN_COMMAND_MATRIX.flatMap(({ scenarios: values }) => values)
    );

    expect(categories).toEqual(new Set(ASSISTANT_ROMANIAN_COMMAND_CATEGORIES));
    expect(scenarios).toEqual(new Set(ASSISTANT_ROMANIAN_COMMAND_SCENARIOS));
    for (const category of ASSISTANT_ROMANIAN_COMMAND_CATEGORIES) {
      expect(
        ASSISTANT_ROMANIAN_COMMAND_MATRIX.filter((item) => item.category === category).length
      ).toBeGreaterThanOrEqual(8);
    }
  });

  it("maps every expectation to the local V3 contract fixture", () => {
    for (const item of ASSISTANT_ROMANIAN_COMMAND_MATRIX) {
      expect(LOCAL_CONTRACT_FIXTURES.commandTypes.has(item.expected.commandType)).toBe(true);
      const result = validateAssistantV3Contract({
        version: "3",
        commandType: item.expected.commandType,
        intent: item.expected.intent,
        toolCalls: item.expected.toolIds.map((id) => ({ id, input: {} })),
        targetPage: item.expected.commandType === "navigation" ? "/fixture" : "",
        entityReferences: [],
        missingInformation: item.expected.missingInformation,
        confidence: item.expected.confidence,
        confirmationRequired: item.expected.confirmationRequired,
        response: item.command,
      });

      expect(result, `Contract invalid pentru cazul ${item.id}: ${item.command}`).toMatchObject({
        ok: true,
      });
    }
  });

  it("references only tools registered by the local V3 adapters", () => {
    const registry = getAssistantV3ToolRegistry();
    const referencedToolIds = new Set(
      ASSISTANT_ROMANIAN_COMMAND_MATRIX.flatMap(({ expected }) => expected.toolIds)
    );

    for (const toolId of referencedToolIds) {
      expect(registry.get(toolId), `Tool neinregistrat: ${toolId}`).not.toBeNull();
    }
  });

  it("enforces confidence and confirmation safety invariants", () => {
    for (const item of ASSISTANT_ROMANIAN_COMMAND_MATRIX) {
      const { expected } = item;
      if (expected.execution === "clarification") {
        expect(
          expected.confidence,
          `Clarificare cu confidence sigur la cazul ${item.id}`
        ).toBeLessThan(ASSISTANT_V3_SAFE_CONFIDENCE);
        expect(expected.toolIds).toHaveLength(0);
        expect(expected.missingInformation.length).toBeGreaterThan(0);
      } else {
        expect(expected.confidence, `Plan nesigur la cazul ${item.id}`).toBeGreaterThanOrEqual(
          ASSISTANT_V3_SAFE_CONFIDENCE
        );
      }

      if (
        LOCAL_CONTRACT_FIXTURES.mutationTypes.has(expected.commandType) &&
        expected.toolIds.length > 0
      ) {
        expect(expected.confirmationRequired, `Mutatie fara confirmare la cazul ${item.id}`).toBe(
          true
        );
        expect(expected.execution).not.toBe("navigate");
      }
      if (expected.execution === "blocked") expect(expected.blockReason).toBeDefined();
    }
  });

  it("keeps navigation separate from mutation tools and form execution", () => {
    for (const item of ASSISTANT_ROMANIAN_COMMAND_MATRIX) {
      const { expected } = item;
      if (expected.commandType === "navigation") {
        expect(expected.toolIds).toEqual(
          expected.execution === "clarification" ? [] : [LOCAL_CONTRACT_FIXTURES.navigationToolId]
        );
        expect(expected.confirmationRequired).toBe(false);
        expect(expected.execution === "navigate" || expected.execution === "clarification").toBe(
          true
        );
      } else {
        expect(expected.toolIds).not.toContain(LOCAL_CONTRACT_FIXTURES.navigationToolId);
      }
    }
  });
});
