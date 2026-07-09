import type { AssistantCommandType } from "./assistantClassifier";
import { hasAssistantNavigationSafetyIntent, isAssistantFieldAllowedForPage } from "./assistantClassifier";

export const ENABLE_ASSISTANT_DOM_FALLBACK = false;

export function isAssistantDomElementVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

export function findAssistantActionElement(selector: string) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) return null;
  return isAssistantDomElementVisible(element) ? element : null;
}

export function canUseAssistantDomFallback(params: {
  command: string;
  commandType: AssistantCommandType;
  pathname: string;
  fields?: string[];
}) {
  if (!ENABLE_ASSISTANT_DOM_FALLBACK) return false;
  if (params.commandType !== "form_fill") return false;
  if (hasAssistantNavigationSafetyIntent(params.command)) return false;

  const fields = params.fields || [];
  if (fields.length === 0) return false;
  return fields.every((field) => isAssistantFieldAllowedForPage(params.pathname, field));
}
