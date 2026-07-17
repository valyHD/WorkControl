import type { ControlPanelSettings } from "./controlPanelService";

export function applyControlPanelUiPreferences(settings: Pick<
  ControlPanelSettings,
  | "uiFontScale"
  | "uiFontFamily"
  | "uiDensity"
  | "uiPalette"
  | "uiCardStyle"
  | "uiContrast"
  | "uiAnimations"
>) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--ui-font-scale", String(settings.uiFontScale));
  document.documentElement.dataset.uiFontFamily = settings.uiFontFamily;
  document.documentElement.dataset.uiDensity = settings.uiDensity;
  document.documentElement.dataset.uiPalette = settings.uiPalette;
  document.documentElement.dataset.uiCardStyle = settings.uiCardStyle;
  document.documentElement.dataset.uiContrast = settings.uiContrast;
  document.documentElement.dataset.uiAnimations = settings.uiAnimations;
}
