import type {
  AssistantCommandFieldValue,
  AssistantCommandIntent,
} from "../assistantCommandService";
import { normalizeAssistantInterpretation } from "../runtime/assistantIntentParser";
import { buildAssistantRuntimePlan } from "../runtime/assistantExecutor";
import type {
  AssistantRuntimeContext,
  AssistantRuntimeEntityType,
  AssistantRuntimePlan,
} from "../runtime/assistantTypes";
import {
  ASSISTANT_TOOL_OUTPUT_SCHEMA,
  auditAssistantTool,
  type AssistantToolDefinition,
  type AssistantToolExecutionContext,
  type AssistantToolModule,
  type AssistantToolPermission,
} from "../tools/assistantToolRegistry";

export type ServiceUpdateInput = {
  entityQuery: string;
  fields: Record<string, unknown>;
};

type ResolvedServiceUpdate = ServiceUpdateInput & {
  plan: AssistantRuntimePlan | null;
};

const SERVICE_UPDATE_SCHEMA = {
  type: "object",
  properties: {
    entityQuery: { type: "string", description: "Entitatea cautata." },
    fields: { type: "object", description: "Campurile si valorile de actualizat." },
  },
  required: ["entityQuery", "fields"],
  additionalProperties: false,
} as const;

export function toLegacyRuntimeContext(
  context: AssistantToolExecutionContext
): AssistantRuntimeContext {
  return {
    user: context.actor
      ? {
          uid: context.actor.uid,
          displayName: context.actor.displayName,
          email: context.actor.email,
          themeKey: context.actor.themeKey,
          role: context.actor.role,
        }
      : null,
    currentPathname: context.pageContext.route,
    memory: {
      lastEntity: context.pageContext.memory.lastEntity
        ? {
            entityType: context.pageContext.memory.lastEntity.type as AssistantRuntimeEntityType,
            entityId: context.pageContext.memory.lastEntity.id,
            label: context.pageContext.memory.lastEntity.label,
          }
        : undefined,
      lastPage: context.pageContext.memory.lastPage,
      lastCommand: context.pageContext.memory.lastCommand,
    },
  };
}

function readServiceUpdateInput(value: unknown): ServiceUpdateInput {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fields =
    input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
      ? (input.fields as Record<string, unknown>)
      : {};
  return { entityQuery: String(input.entityQuery || "").trim(), fields };
}

export function createServiceUpdateTool(params: {
  id: string;
  description: string;
  aliases?: readonly string[];
  module: AssistantToolModule;
  intent: AssistantCommandIntent;
  entityType: "vehicle" | "tool" | "project" | "user";
  permission: (
    input: ServiceUpdateInput,
    context: AssistantToolExecutionContext
  ) => AssistantToolPermission | Promise<AssistantToolPermission>;
}): AssistantToolDefinition<unknown, ResolvedServiceUpdate> {
  const definition: AssistantToolDefinition<unknown, ResolvedServiceUpdate> = {
    id: params.id,
    description: params.description,
    aliases: params.aliases || [],
    module: params.module,
    inputSchema: SERVICE_UPDATE_SCHEMA,
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: params.entityType === "user" ? "high" : "medium",
    permission: (input, context) => params.permission(readServiceUpdateInput(input), context),
    resolve: async (input, context) => {
      const parsedInput = readServiceUpdateInput(input);
      const parsed = normalizeAssistantInterpretation(context.command, {
        commandType: "entity_update",
        intent: params.intent,
        entityType: params.entityType,
        entityQuery: parsedInput.entityQuery,
        fields: parsedInput.fields as Record<string, AssistantCommandFieldValue>,
        fieldsToUpdate: parsedInput.fields as Record<string, AssistantCommandFieldValue>,
        missingFields: [],
        risk: params.entityType === "user" ? "high" : "medium",
        needsConfirmation: true,
        confidence: context.contract.confidence,
        spokenSummary: context.contract.response,
      });
      return {
        ...parsedInput,
        plan: await buildAssistantRuntimePlan(parsed, toLegacyRuntimeContext(context)),
      };
    },
    validate: (input) => {
      if (!input.entityQuery && !input.plan?.resolvedEntity) {
        return {
          ok: false,
          reason: "Lipseste entitatea.",
          missingInformation: [params.entityType],
        };
      }
      if (Object.keys(input.fields).length === 0) {
        return {
          ok: false,
          reason: "Lipsesc campurile de actualizat.",
          missingInformation: ["fields"],
        };
      }
      if (!input.plan || input.plan.status !== "ready" || !input.plan.run) {
        return {
          ok: false,
          reason: input.plan?.message || "Actualizarea nu poate fi pregatita in siguranta.",
          choices: input.plan?.options?.map((option) => ({
            id: option.entityId,
            label: option.label,
            description: option.query,
          })),
        };
      }
      return { ok: true };
    },
    preview: (input) => input.plan?.message || "Actualizez entitatea prin serviciul modulului.",
    execute: async (input) => {
      if (!input.plan?.run) throw new Error("Planul de actualizare nu este executabil.");
      const result = await input.plan.run();
      return {
        message: result.result,
        entityId: input.plan.resolvedEntity?.entityId,
        beforeData: input.plan.beforeData,
        afterData: result.afterData,
      };
    },
    audit: (input, outcome, context) =>
      auditAssistantTool(
        definition,
        {
          entityQuery: input.entityQuery,
          fields: input.fields,
        },
        outcome,
        context
      ),
  };
  return definition;
}
