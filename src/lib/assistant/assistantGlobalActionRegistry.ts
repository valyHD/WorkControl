import type { NavigationRole } from "../../config/navigation";
import {
  getAssistantNavigationActions,
  type AssistantNavigationAction,
} from "./assistantActionCatalog";
import {
  getAssistantPageActions,
  type AssistantPageAction,
} from "./runtime/assistantPageActionRegistry";

export type AssistantGlobalNavigationAction = AssistantNavigationAction & {
  kind: "navigation";
};

export type AssistantGlobalPageAction = AssistantPageAction & {
  kind: "page";
};

export type AssistantGlobalAction =
  | AssistantGlobalNavigationAction
  | AssistantGlobalPageAction;

export function getAssistantGlobalNavigationActions(role: NavigationRole) {
  return getAssistantNavigationActions(role).map<AssistantGlobalNavigationAction>((action) => ({
    ...action,
    kind: "navigation",
  }));
}

export function getAssistantGlobalPageActions(pathname: string) {
  return getAssistantPageActions(pathname).map<AssistantGlobalPageAction>((action) => ({
    ...action,
    kind: "page",
  }));
}

export function getAssistantGlobalActions(params: {
  pathname: string;
  role: NavigationRole;
}) {
  return [
    ...getAssistantGlobalNavigationActions(params.role),
    ...getAssistantGlobalPageActions(params.pathname),
  ] satisfies AssistantGlobalAction[];
}
