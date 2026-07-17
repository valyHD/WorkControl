import type { AssistantV3SelectedEntity } from "./assistantV3Types";

let selectedEntity: AssistantV3SelectedEntity | null = null;

export function setAssistantPageSelectedEntity(entity: AssistantV3SelectedEntity | null) {
  selectedEntity = entity;
}

export function getAssistantPageSelectedEntity() {
  return selectedEntity;
}
