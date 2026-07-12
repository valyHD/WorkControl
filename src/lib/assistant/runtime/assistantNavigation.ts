import {
  resolveAssistantNavigationAction,
  type AssistantNavigationAction,
} from "../assistantActionCatalog";
import type { NavigationRole } from "../../../config/navigation";

export type AssistantKnownNavigationTarget = {
  label: string;
  path: string;
  result: string;
};

function toKnownTarget(action: AssistantNavigationAction): AssistantKnownNavigationTarget {
  return {
    label: action.spokenOpenLabel,
    path: action.path,
    result: action.spokenResult,
  };
}

export function resolveAssistantKnownPageNavigation(
  text: string,
  role: NavigationRole = "angajat"
): AssistantKnownNavigationTarget | null {
  const action = resolveAssistantNavigationAction(text, role);
  return action ? toKnownTarget(action) : null;
}
