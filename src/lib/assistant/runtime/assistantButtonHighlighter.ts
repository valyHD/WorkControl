import { getAssistantNextStepForPage, type AssistantNextStep } from "./assistantPageContext";

const HIGHLIGHT_CLASS = "assistant-highlight";
const HIGHLIGHT_DURATION_MS = 4_500;

function getHighlightTarget(selector: string) {
  return document.querySelector(selector) as HTMLElement | null;
}

export function clearAssistantHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((element) => {
    element.classList.remove(HIGHLIGHT_CLASS);
    element.removeAttribute("data-assistant-highlight-label");
  });
}

export function highlightAssistantElement(selector: string, durationMs = HIGHLIGHT_DURATION_MS) {
  const element = getHighlightTarget(selector);
  if (!element) return false;

  clearAssistantHighlights();
  element.classList.add(HIGHLIGHT_CLASS);
  element.setAttribute("data-assistant-highlight-label", "Pas recomandat de asistent");
  element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  element.focus?.({ preventScroll: true });

  window.setTimeout(() => {
    element.classList.remove(HIGHLIGHT_CLASS);
    element.removeAttribute("data-assistant-highlight-label");
  }, durationMs);

  return true;
}

export function highlightAssistantStep(step: AssistantNextStep | null | undefined, durationMs = HIGHLIGHT_DURATION_MS) {
  if (!step) return false;
  return highlightAssistantElement(step.selector, durationMs);
}

export function highlightAssistantNextStepForPage(
  pathname: string,
  queryParams?: URLSearchParams | string | Record<string, string | undefined>,
  durationMs = HIGHLIGHT_DURATION_MS
) {
  const [firstStep] = getAssistantNextStepForPage(pathname, queryParams);
  return highlightAssistantStep(firstStep, durationMs);
}

export function scheduleAssistantNextStepHighlight(
  pathname: string,
  queryParams?: URLSearchParams | string | Record<string, string | undefined>,
  delayMs = 350
) {
  window.setTimeout(() => {
    highlightAssistantNextStepForPage(pathname, queryParams);
  }, delayMs);
}
