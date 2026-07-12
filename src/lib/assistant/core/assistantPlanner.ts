import type { AssistantV3Contract } from "./assistantV3Types";

export function buildAssistantExecutionSteps(contract: AssistantV3Contract, active = false) {
  return contract.toolCalls.map((call, index) => ({
    id: call.id + index,
    label: call.id,
    description: index === 0 ? contract.response : undefined,
    status: active && index === 0 ? ("active" as const) : ("pending" as const),
    requiresConfirmation: contract.confirmationRequired,
  }));
}
