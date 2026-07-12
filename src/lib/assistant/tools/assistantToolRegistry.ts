import type { TimesheetLocation } from "../../../types/timesheet";
import type {
  AssistantV3Actor,
  AssistantV3Contract,
  AssistantV3PageContext,
  AssistantV3ToolCall,
} from "../core/assistantV3Types";

export type AssistantToolRisk = "low" | "medium" | "high";
export type AssistantToolModule =
  | "navigation"
  | "vehicles"
  | "tools"
  | "timesheets"
  | "maintenance"
  | "leave"
  | "users"
  | "expenses";

export type AssistantToolSchema = {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "object" | "array";
      description?: string;
      enum?: readonly string[];
    }
  >;
  required: readonly string[];
  additionalProperties: false;
};

export type AssistantToolPermission = { ok: true } | { ok: false; reason: string };
export type AssistantToolChoice = { id: string; label: string; description?: string };
export type AssistantToolValidation =
  | { ok: true }
  | { ok: false; reason: string; missingInformation?: string[]; choices?: AssistantToolChoice[] };
export type AssistantToolExecutionResult = {
  message: string;
  entityId?: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
};

export type AssistantToolAuditRecord = {
  command: string;
  toolId: string;
  module: AssistantToolModule;
  risk: AssistantToolRisk;
  actorId: string;
  status: "success" | "failed" | "blocked";
  input: unknown;
  output?: AssistantToolExecutionResult;
  error?: string;
};

export type AssistantAdapterRuntime = {
  navigate: (path: string) => void | Promise<void>;
  dispatchFormDraft: (
    eventName: string,
    fields: Record<string, unknown>
  ) => boolean | Promise<boolean>;
  getTimesheetLocation?: () => Promise<TimesheetLocation>;
  audit?: (record: AssistantToolAuditRecord) => void | Promise<void>;
};

export type AssistantToolExecutionContext = {
  command: string;
  contract: AssistantV3Contract;
  pageContext: AssistantV3PageContext;
  actor: AssistantV3Actor | null;
  runtime: AssistantAdapterRuntime;
};

export type AssistantToolDefinition<
  TInput = Record<string, unknown>,
  TResolved = TInput,
  TOutput extends AssistantToolExecutionResult = AssistantToolExecutionResult,
> = {
  id: string;
  description: string;
  aliases: readonly string[];
  module: AssistantToolModule;
  inputSchema: AssistantToolSchema;
  outputSchema: AssistantToolSchema;
  risk: AssistantToolRisk;
  permission: (
    input: TInput,
    context: AssistantToolExecutionContext
  ) => AssistantToolPermission | Promise<AssistantToolPermission>;
  resolve: (
    input: TInput,
    context: AssistantToolExecutionContext
  ) => TResolved | Promise<TResolved>;
  validate: (
    input: TResolved,
    context: AssistantToolExecutionContext
  ) => AssistantToolValidation | Promise<AssistantToolValidation>;
  preview: (input: TResolved, context: AssistantToolExecutionContext) => string | Promise<string>;
  execute: (input: TResolved, context: AssistantToolExecutionContext) => TOutput | Promise<TOutput>;
  audit: (
    input: TResolved,
    outcome: { status: "success" | "failed" | "blocked"; output?: TOutput; error?: string },
    context: AssistantToolExecutionContext
  ) => void | Promise<void>;
};

export type RegisteredAssistantTool = AssistantToolDefinition<
  unknown,
  unknown,
  AssistantToolExecutionResult
>;

export class AssistantToolRegistry {
  private readonly tools = new Map<string, RegisteredAssistantTool>();
  private readonly aliases = new Map<string, string>();

  register<TInput, TResolved, TOutput extends AssistantToolExecutionResult>(
    definition: AssistantToolDefinition<TInput, TResolved, TOutput>
  ) {
    const id = definition.id.trim();
    if (!id) throw new Error("Tool id lipsa.");
    if (this.tools.has(id) || this.aliases.has(id)) throw new Error(`Tool duplicat: ${id}.`);
    this.tools.set(id, definition as RegisteredAssistantTool);
    for (const aliasValue of definition.aliases) {
      const alias = aliasValue.trim();
      if (!alias || alias === id) continue;
      if (this.tools.has(alias) || this.aliases.has(alias))
        throw new Error(`Alias duplicat: ${alias}.`);
      this.aliases.set(alias, id);
    }
    return this;
  }

  get(idOrAlias: string) {
    const id = this.aliases.get(idOrAlias) || idOrAlias;
    return this.tools.get(id) || null;
  }

  list() {
    return Array.from(this.tools.values());
  }

  describeForPrompt() {
    return this.list().map(
      ({ id, description, aliases, module, inputSchema, outputSchema, risk }) => ({
        id,
        description,
        aliases,
        module,
        inputSchema,
        outputSchema,
        risk,
      })
    );
  }

  plan(calls: AssistantV3ToolCall[]) {
    return calls.map((call) => ({ call, definition: this.get(call.id) }));
  }
}

export function validateAssistantToolInput(
  schema: AssistantToolSchema,
  value: unknown
): AssistantToolValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "Inputul tool-ului trebuie sa fie un obiect." };
  }
  const input = value as Record<string, unknown>;
  const missing = schema.required.filter((key) => input[key] === undefined || input[key] === null);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Lipsesc campurile: ${missing.join(", ")}.`,
      missingInformation: missing,
    };
  }
  for (const [key, definition] of Object.entries(schema.properties)) {
    if (input[key] === undefined || input[key] === null) continue;
    const valueType = Array.isArray(input[key]) ? "array" : typeof input[key];
    if (valueType !== definition.type) {
      return { ok: false, reason: `Campul ${key} are un tip invalid.` };
    }
  }
  return { ok: true };
}

export const ASSISTANT_TOOL_OUTPUT_SCHEMA: AssistantToolSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    entityId: { type: "string" },
    beforeData: { type: "object" },
    afterData: { type: "object" },
  },
  required: ["message"],
  additionalProperties: false,
};

export function authenticatedPermission(
  _input: unknown,
  context: AssistantToolExecutionContext
): AssistantToolPermission {
  return context.actor?.uid ? { ok: true } : { ok: false, reason: "Trebuie sa fii autentificat." };
}

export function rolePermission(...roles: string[]) {
  return (_input: unknown, context: AssistantToolExecutionContext): AssistantToolPermission => {
    if (!context.actor?.uid) return { ok: false, reason: "Trebuie sa fii autentificat." };
    return roles.includes(context.actor.role)
      ? { ok: true }
      : { ok: false, reason: "Nu ai permisiune pentru aceasta actiune." };
  };
}

export async function auditAssistantTool(
  definition: Pick<RegisteredAssistantTool, "id" | "module" | "risk">,
  input: unknown,
  outcome: {
    status: "success" | "failed" | "blocked";
    output?: AssistantToolExecutionResult;
    error?: string;
  },
  context: AssistantToolExecutionContext
) {
  await context.runtime.audit?.({
    command: context.command,
    toolId: definition.id,
    module: definition.module,
    risk: definition.risk,
    actorId: context.actor?.uid || "",
    status: outcome.status,
    input,
    output: outcome.output,
    error: outcome.error,
  });
}
