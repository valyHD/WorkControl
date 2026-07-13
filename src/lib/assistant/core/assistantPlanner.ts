import type { AssistantV3Contract } from "./assistantV3Types";
import type { AssistantToolRegistry } from "../tools/assistantToolRegistry";

export function buildAssistantExecutionSteps(
  contract: AssistantV3Contract,
  active = false,
  registry?: AssistantToolRegistry
) {
  return contract.toolCalls.map((call, index) => ({
    id: call.id + index,
    label: registry?.get(call.id)?.description || call.id,
    description: index === 0 ? contract.response : undefined,
    status: active && index === 0 ? ("active" as const) : ("pending" as const),
    requiresConfirmation:
      contract.confirmationRequired || (registry?.get(call.id)?.risk || "low") !== "low",
  }));
}
