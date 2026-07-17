import { getAssistantFieldDefinitions } from "../runtime/assistantFieldResolver";
import { resolveAssistantEntity } from "../runtime/assistantEntityResolver";
import type { AssistantRuntimeEntityType } from "../runtime/assistantTypes";
import {
  ASSISTANT_TOOL_OUTPUT_SCHEMA,
  authenticatedPermission,
  auditAssistantTool,
  type AssistantToolDefinition,
} from "../tools/assistantToolRegistry";
import { toLegacyRuntimeContext } from "./adapterHelpers";

type EntityReadInput = {
  entityQuery: string;
  fields: Record<string, unknown>;
};

type ResolvedEntityReadInput = EntityReadInput & {
  entityType: AssistantRuntimeEntityType;
  requestedFields: string[];
  resolution: Awaited<ReturnType<typeof resolveAssistantEntity>>;
};

const ENTITY_READ_SCHEMA = {
  type: "object",
  properties: {
    entityQuery: { type: "string", description: "Entitatea despre care se cer informatii." },
    fields: { type: "object", description: "Campurile aprobate care trebuie citite." },
  },
  required: ["entityQuery", "fields"],
  additionalProperties: false,
} as const;

const FIELD_SOURCE: Partial<Record<AssistantRuntimeEntityType, Record<string, string>>> = {
  vehicle: {
    currentKm: "currentKm",
    nextItpDate: "nextItpDate",
    nextRcaDate: "nextRcaDate",
    nextCascoDate: "nextCascoDate",
    nextRovinietaDate: "nextRovinietaDate",
    nextOilServiceKm: "nextOilServiceKm",
    nextServiceKm: "nextServiceKm",
    plateNumber: "plateNumber",
    brand: "brand",
    model: "model",
    vin: "vin",
    status: "status",
    driver: "currentDriverUserName",
    owner: "ownerUserName",
  },
  tool: {
    name: "name",
    internalCode: "internalCode",
    qrCodeValue: "qrCodeValue",
    status: "status",
    owner: "ownerUserName",
    holder: "currentHolderUserName",
    locationLabel: "locationLabel",
    description: "description",
    warrantyUntil: "warrantyUntil",
  },
  project: { name: "name", status: "status" },
  user: { roleTitle: "roleTitle", department: "department", role: "role", fullName: "fullName" },
};

function parseInput(value: unknown): EntityReadInput {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    entityQuery: String(input.entityQuery || "").trim(),
    fields:
      input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
        ? (input.fields as Record<string, unknown>)
        : {},
  };
}

function formatValue(field: string, value: unknown) {
  if (value === undefined || value === null || value === "") return "necompletat";
  if (typeof value === "number") {
    const formatted = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(value);
    return field.toLowerCase().includes("km") ? `${formatted} km` : formatted;
  }
  if (typeof value === "boolean") return value ? "da" : "nu";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}.${month}.${year}`;
  }
  return String(value);
}

export function createEntityReadTool(): AssistantToolDefinition<unknown, ResolvedEntityReadInput> {
  const definition: AssistantToolDefinition<unknown, ResolvedEntityReadInput> = {
    id: "entities.read",
    description: "Citeste in siguranta campuri aprobate ale unei masini, scule, proiect sau utilizator.",
    aliases: ["assistant.entities.read"],
    module: "assistant",
    inputSchema: ENTITY_READ_SCHEMA,
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "low",
    permission: authenticatedPermission,
    resolve: async (input, context) => {
      const parsed = parseInput(input);
      const entityType = (context.contract.entityReferences[0]?.type || "none") as AssistantRuntimeEntityType;
      const allowed = new Set(getAssistantFieldDefinitions(entityType).map((field) => field.key));
      const requestedFields = Object.entries(parsed.fields)
        .filter(([field, enabled]) => Boolean(enabled) && allowed.has(field))
        .map(([field]) => field);
      return {
        ...parsed,
        entityType,
        requestedFields,
        resolution: await resolveAssistantEntity(
          entityType,
          parsed.entityQuery,
          toLegacyRuntimeContext(context)
        ),
      };
    },
    validate: (input) => {
      if (input.entityType === "none" || input.requestedFields.length === 0) {
        return { ok: false, reason: "Nu am inteles ce informatie trebuie citita." };
      }
      if (input.resolution.status === "ambiguous") {
        return {
          ok: false,
          reason: input.resolution.message || "Am gasit mai multe rezultate.",
          choices: input.resolution.options.map((option) => ({
            id: option.entityId,
            label: option.label,
          })),
        };
      }
      if (input.resolution.status !== "resolved" || !input.resolution.entity) {
        return { ok: false, reason: input.resolution.message || "Nu am gasit entitatea ceruta." };
      }
      return { ok: true };
    },
    preview: (input) =>
      `Citesc ${input.requestedFields.length} informatii despre ${input.resolution.entity?.label || "entitate"}.`,
    execute: async (input) => {
      const entity = input.resolution.entity;
      if (!entity) throw new Error("Entitatea nu a fost rezolvata.");
      const data = entity.data as Record<string, unknown>;
      const definitions = new Map(
        getAssistantFieldDefinitions(input.entityType).map((field) => [field.key, field])
      );
      const sourceMap = FIELD_SOURCE[input.entityType] || {};
      const values = input.requestedFields.map((field) => {
        const label = definitions.get(field)?.label || field;
        return `${label}: ${formatValue(field, data[sourceMap[field] || field])}`;
      });
      return {
        message: `${entity.label}. ${values.join("; ")}.`,
        entityId: entity.entityId,
      };
    },
    audit: (input, outcome, context) =>
      auditAssistantTool(
        definition,
        { entityType: input.entityType, entityQuery: input.entityQuery, fields: input.requestedFields },
        outcome,
        context
      ),
  };
  return definition;
}
