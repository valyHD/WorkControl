import {
  getControlPanelSettings,
  saveControlPanelSettings,
  type ControlPanelSettings,
} from "../../../modules/reports/services/controlPanelService";
import { applyControlPanelUiPreferences } from "../../../modules/reports/services/controlPanelUiPreferences";
import {
  ASSISTANT_TOOL_OUTPUT_SCHEMA,
  auditAssistantTool,
  rolePermission,
  type AssistantToolDefinition,
} from "../tools/assistantToolRegistry";

const ALLOWED_SETTING_FIELDS = new Set([
  "uiFontScale",
  "uiFontFamily",
  "uiDensity",
  "uiPalette",
  "uiCardStyle",
  "uiContrast",
  "uiAnimations",
]);

const UI_FONT_FAMILIES = ["dm-sans", "inter", "poppins", "roboto-slab"] as const;
const UI_DENSITIES = ["compact", "comfortable", "spacious"] as const;
const UI_PALETTES = ["blue", "slate", "emerald", "sunset", "violet"] as const;
const UI_CARD_STYLES = ["flat", "elevated", "glass"] as const;
const UI_CONTRASTS = ["normal", "high"] as const;
const UI_ANIMATIONS = ["full", "reduced", "none"] as const;

type UiSettingFields = Partial<
  Pick<
    ControlPanelSettings,
    | "uiFontScale"
    | "uiFontFamily"
    | "uiDensity"
    | "uiPalette"
    | "uiCardStyle"
    | "uiContrast"
    | "uiAnimations"
  >
>;

type SettingsInput = {
  fields: Record<string, unknown>;
};

type ResolvedSettingsInput = SettingsInput & {
  current: ControlPanelSettings;
  fields: UiSettingFields;
  invalidFields: string[];
};

function readInput(value: unknown): SettingsInput {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fields =
    input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
      ? (input.fields as Record<string, unknown>)
      : {};
  return { fields };
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function normalizeFontScale(value: unknown, current: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1.25, Math.max(0.9, value));
  }
  const text = String(value || "").toLowerCase();
  if (/\b(?:mai\s+mare|mareste|marit|mare)\b/.test(text)) return Math.min(1.25, current + 0.08);
  if (/\b(?:mai\s+mic|micsoreaza|mic)\b/.test(text)) return Math.max(0.9, current - 0.08);
  const parsed = Number(text.replace(",", "."));
  if (Number.isFinite(parsed)) return Math.min(1.25, Math.max(0.9, parsed));
  return null;
}

function normalizeFields(fields: Record<string, unknown>, current: ControlPanelSettings) {
  const normalized: UiSettingFields = {};
  const invalidFields: string[] = [];

  for (const [field, value] of Object.entries(fields)) {
    if (!ALLOWED_SETTING_FIELDS.has(field)) {
      invalidFields.push(field);
      continue;
    }

    if (field === "uiFontScale") {
      const scale = normalizeFontScale(value, current.uiFontScale);
      if (scale === null) invalidFields.push(field);
      else normalized.uiFontScale = Number(scale.toFixed(2));
      continue;
    }
    if (field === "uiFontFamily") {
      if (isOneOf(UI_FONT_FAMILIES, value)) normalized.uiFontFamily = value;
      else invalidFields.push(field);
      continue;
    }
    if (field === "uiDensity") {
      if (isOneOf(UI_DENSITIES, value)) normalized.uiDensity = value;
      else invalidFields.push(field);
      continue;
    }
    if (field === "uiPalette") {
      if (isOneOf(UI_PALETTES, value)) normalized.uiPalette = value;
      else invalidFields.push(field);
      continue;
    }
    if (field === "uiCardStyle") {
      if (isOneOf(UI_CARD_STYLES, value)) normalized.uiCardStyle = value;
      else invalidFields.push(field);
      continue;
    }
    if (field === "uiContrast") {
      if (isOneOf(UI_CONTRASTS, value)) normalized.uiContrast = value;
      else invalidFields.push(field);
      continue;
    }
    if (field === "uiAnimations") {
      if (isOneOf(UI_ANIMATIONS, value)) normalized.uiAnimations = value;
      else invalidFields.push(field);
    }
  }

  return { fields: normalized, invalidFields };
}

function compactSettings(settings: ControlPanelSettings, fields: UiSettingFields) {
  return Object.fromEntries(
    Object.keys(fields).map((field) => [field, settings[field as keyof ControlPanelSettings]])
  );
}

function formatChangeList(fields: UiSettingFields) {
  return Object.entries(fields)
    .map(([field, value]) => `${field}: ${String(value)}`)
    .join(", ");
}

export function createSettingsUpdateTool(): AssistantToolDefinition<
  unknown,
  ResolvedSettingsInput
> {
  const definition: AssistantToolDefinition<unknown, ResolvedSettingsInput> = {
    id: "settings.update",
    aliases: ["update_site_settings", "update_ui_settings"],
    description:
      "Actualizeaza controlat setarile globale de interfata: densitate, tema, font, contrast, carduri si animatii.",
    module: "settings",
    inputSchema: {
      type: "object",
      properties: {
        fields: { type: "object" },
      },
      required: ["fields"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "medium",
    permission: rolePermission("admin"),
    resolve: async (input) => {
      const parsed = readInput(input);
      const current = await getControlPanelSettings();
      const normalized = normalizeFields(parsed.fields, current);
      return {
        ...parsed,
        current,
        fields: normalized.fields,
        invalidFields: normalized.invalidFields,
      };
    },
    validate: (input) => {
      if (input.invalidFields.length > 0) {
        return {
          ok: false,
          reason: `Setari UI nepermise sau invalide: ${input.invalidFields.join(", ")}.`,
        };
      }
      if (Object.keys(input.fields).length === 0) {
        return { ok: false, reason: "Nu am gasit setarea site-ului care trebuie modificata." };
      }
      return { ok: true };
    },
    preview: (input) => `Schimb setarile site-ului: ${formatChangeList(input.fields)}.`,
    execute: async (input) => {
      const beforeData = compactSettings(input.current, input.fields);
      const nextSettings = { ...input.current, ...input.fields, updatedAt: Date.now() };
      await saveControlPanelSettings(nextSettings);
      applyControlPanelUiPreferences(nextSettings);
      return {
        message: "Am actualizat setarile site-ului.",
        beforeData,
        afterData: compactSettings(nextSettings, input.fields),
      };
    },
    audit: (input, outcome, context) =>
      auditAssistantTool(definition, { fields: input.fields }, outcome, context),
  };
  return definition;
}
