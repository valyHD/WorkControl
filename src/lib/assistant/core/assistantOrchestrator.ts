import { normalizeAndValidateAssistantV3Contract } from "./assistantV3Contract";
import {
  ASSISTANT_V3_SAFE_CONFIDENCE,
  type AssistantV3Actor,
  type AssistantV3Contract,
  type AssistantV3PageContext,
} from "./assistantV3Types";
import type {
  AssistantAdapterRuntime,
  AssistantToolExecutionContext,
  AssistantToolExecutionResult,
  AssistantToolChoice,
  AssistantToolValidation,
} from "../tools/assistantToolRegistry";
import { AssistantToolRegistry, validateAssistantToolInput } from "../tools/assistantToolRegistry";

export type AssistantV3Interpreter = (
  command: string,
  context: AssistantV3PageContext
) => Promise<unknown>;

export type AssistantOrchestratorStatus =
  | "invalid_contract"
  | "unsupported"
  | "permission_denied"
  | "needs_clarification"
  | "confirmation_required"
  | "executed"
  | "failed";

export type AssistantOrchestratorResult = {
  status: AssistantOrchestratorStatus;
  contract?: AssistantV3Contract;
  message: string;
  previews: string[];
  results: AssistantToolExecutionResult[];
  changes?: Array<{ id: string; label: string; oldValue: unknown; newValue: unknown }>;
  choices?: AssistantToolChoice[];
  errors?: string[];
};

type AssistantConfirmationChange = {
  id: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
};

function confirmationChanges(
  items: Array<{ callId: string; input: unknown }>
): AssistantConfirmationChange[] {
  const output: AssistantConfirmationChange[] = [];
  items.forEach((item) => {
    if (!item.input || typeof item.input !== "object" || Array.isArray(item.input)) return;
    const input = item.input as Record<string, unknown>;
    const plan =
      input.plan && typeof input.plan === "object" && !Array.isArray(input.plan)
        ? (input.plan as {
            changes?: Array<{
              fieldKey?: string;
              label?: string;
              oldValue?: unknown;
              newValue?: unknown;
            }>;
          })
        : null;
    if (Array.isArray(plan?.changes) && plan.changes.length > 0) {
      output.push(
        ...plan.changes.map((change, index) => ({
          id: `${item.callId}-${change.fieldKey || index}`,
          label: change.label || change.fieldKey || "Camp",
          oldValue: change.oldValue ?? "-",
          newValue: change.newValue ?? "-",
        }))
      );
      return;
    }
    const fields =
      input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
        ? (input.fields as Record<string, unknown>)
        : {};
    output.push(
      ...Object.entries(fields).map(([key, value]) => ({
        id: `${item.callId}-${key}`,
        label: key,
        oldValue: "Necompletat",
        newValue: value,
      }))
    );
  });
  return output;
}

type OrchestratorInput = {
  command: string;
  pageContext: AssistantV3PageContext;
  actor: AssistantV3Actor | null;
  runtime: AssistantAdapterRuntime;
  contract?: AssistantV3Contract;
  confirmedToolCallIds?: string[];
};

export class AssistantV3Orchestrator {
  private readonly interpreter: AssistantV3Interpreter;
  private readonly registry: AssistantToolRegistry;

  constructor(interpreter: AssistantV3Interpreter, registry: AssistantToolRegistry) {
    this.interpreter = interpreter;
    this.registry = registry;
  }

  async run(input: OrchestratorInput): Promise<AssistantOrchestratorResult> {
    const raw = input.contract ?? (await this.interpreter(input.command, input.pageContext));
    const validated = normalizeAndValidateAssistantV3Contract(input.command, raw);
    if (!validated.ok) {
      return {
        status: "invalid_contract",
        message: "Interpretarea comenzii nu respecta contractul Assistant V3.",
        previews: [],
        results: [],
        errors: validated.errors,
      };
    }

    const contract = validated.value;
    const planned = this.registry.plan(contract.toolCalls);
    const unsupported = planned.filter((item) => !item.definition).map((item) => item.call.id);
    if (unsupported.length > 0) {
      return {
        status: "unsupported",
        contract,
        message: `Actiuni nesuportate: ${unsupported.join(", ")}.`,
        previews: [],
        results: [],
      };
    }

    for (const item of planned) {
      const inputValidation = validateAssistantToolInput(
        item.definition!.inputSchema,
        item.call.input
      );
      if (!inputValidation.ok) {
        return {
          status: "needs_clarification",
          contract,
          message: inputValidation.reason,
          previews: [],
          results: [],
          errors: inputValidation.missingInformation,
        };
      }
    }

    const context: AssistantToolExecutionContext = {
      command: input.command,
      contract,
      pageContext: input.pageContext,
      actor: input.actor,
      runtime: input.runtime,
    };

    for (const item of planned) {
      const permission = await item.definition!.permission(item.call.input, context);
      if (!permission.ok) {
        await item.definition!.audit(
          item.call.input,
          { status: "blocked", error: permission.reason },
          context
        );
        return {
          status: "permission_denied",
          contract,
          message: permission.reason,
          previews: [],
          results: [],
        };
      }
    }

    const resolved: Array<{
      callId: string;
      definition: NonNullable<(typeof planned)[number]["definition"]>;
      input: unknown;
      validation: AssistantToolValidation;
    }> = [];
    for (const item of planned) {
      const resolvedInput = await item.definition!.resolve(item.call.input, context);
      const validation = await item.definition!.validate(resolvedInput, context);
      resolved.push({
        callId: item.call.id,
        definition: item.definition!,
        input: resolvedInput,
        validation,
      });
    }

    const missing = [
      ...contract.missingInformation,
      ...resolved.flatMap((item) =>
        item.validation.ok ? [] : item.validation.missingInformation || [item.validation.reason]
      ),
    ];
    if (contract.confidence < ASSISTANT_V3_SAFE_CONFIDENCE || missing.length > 0) {
      const choices = resolved.flatMap((item) =>
        item.validation.ok ? [] : item.validation.choices || []
      );
      const message =
        missing.length > 0
          ? `Am nevoie de: ${Array.from(new Set(missing)).join(", ")}.`
          : contract.response || "Comanda este prea ambigua pentru executie.";
      for (const item of resolved) {
        await item.definition.audit(item.input, { status: "blocked", error: message }, context);
      }
      return {
        status: "needs_clarification",
        contract,
        message,
        previews: [],
        results: [],
        choices,
      };
    }

    const previews = await Promise.all(
      resolved.map((item) => item.definition.preview(item.input, context))
    );
    const changes = confirmationChanges(resolved);
    const confirmed = new Set(input.confirmedToolCallIds || []);
    const unconfirmed = resolved.filter((item) => {
      const requiresConfirmation = contract.confirmationRequired || item.definition.risk !== "low";
      return (
        requiresConfirmation && !confirmed.has(item.callId) && !confirmed.has(item.definition.id)
      );
    });
    if (unconfirmed.length > 0) {
      return {
        status: "confirmation_required",
        contract,
        message: contract.response || "Confirma actiunile inainte de executie.",
        previews,
        results: [],
        changes,
      };
    }

    const results: AssistantToolExecutionResult[] = [];
    for (const item of resolved) {
      try {
        const output = await item.definition.execute(item.input, context);
        results.push(output);
        await item.definition.audit(item.input, { status: "success", output }, context);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Executia actiunii a esuat.";
        await item.definition.audit(item.input, { status: "failed", error: message }, context);
        return { status: "failed", contract, message, previews, results };
      }
    }

    return {
      status: "executed",
      contract,
      message: results.at(-1)?.message || contract.response,
      previews,
      results,
      changes,
    };
  }
}
