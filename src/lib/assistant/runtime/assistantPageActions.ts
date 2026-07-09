import { highlightAssistantElement } from "./assistantButtonHighlighter";
import { getAssistantStepMessageById } from "./assistantPageFlow";
import { resolveAssistantPageActionFromText, type AssistantPageActionMatch } from "./assistantPageActionRegistry";

export type AssistantControlledPageAction = {
  id: string;
  label: string;
  result: string;
  note?: string;
  selector: string;
  actionType: AssistantPageActionMatch["actionType"];
  score: number;
  run: () => Promise<string>;
};

export function resolveAssistantControlledPageAction(
  command: string,
  pathname: string
): AssistantControlledPageAction | null {
  const match = resolveAssistantPageActionFromText(pathname, command);
  if (!match) return null;
  const flowMessage = getAssistantStepMessageById(pathname, match.id);
  const defaultResult =
    match.actionType === "file"
      ? "Am evidentiat zona de incarcare. Alege manual fisierul din browser."
      : `Am evidentiat ${match.label}.`;

  return {
    id: match.id,
    label: `Scot in fata: ${match.label}.`,
    result: flowMessage || defaultResult,
    note: "Folosesc actiunea declarata a paginii.",
    selector: match.selector,
    actionType: match.actionType,
    score: match.score,
    run: async () => {
      const highlighted = highlightAssistantElement(match.selector);
      if (!highlighted) throw new Error(`Nu am gasit elementul pentru ${match.label}.`);
      return flowMessage || defaultResult;
    },
  };
}
