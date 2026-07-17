import {
  getNotificationRules,
  updateNotificationRule,
} from "../../../modules/notifications/services/notificationRulesService";
import type {
  NotificationRuleFormValues,
  NotificationRuleItem,
} from "../../../types/notification-rule";
import { normalizeAssistantText, scoreAssistantText } from "../runtime/assistantFuzzy";
import {
  ASSISTANT_TOOL_OUTPUT_SCHEMA,
  auditAssistantTool,
  rolePermission,
  type AssistantToolDefinition,
} from "../tools/assistantToolRegistry";

const ALLOWED_FIELDS = new Set([
  "enabled",
  "soundEnabled",
  "scheduleTime",
  "stopTime",
  "reminderRepeatMinutes",
  "reminderActiveMinutes",
]);

type NotificationSettingsInput = {
  ruleQuery: string;
  fields: Record<string, unknown>;
};

type RankedRule = { rule: NotificationRuleItem; score: number };

type ResolvedNotificationSettingsInput = NotificationSettingsInput & {
  rule: NotificationRuleItem | null;
  options: RankedRule[];
  invalidFields: string[];
};

function readInput(value: unknown): NotificationSettingsInput {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fields =
    input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
      ? (input.fields as Record<string, unknown>)
      : {};
  return {
    ruleQuery: String(input.ruleQuery || "").replace(/\s+/g, " ").trim(),
    fields,
  };
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeAssistantText(String(value || ""));
  if (["da", "activ", "activa", "activeaza", "pornit", "porneste"].includes(normalized)) {
    return true;
  }
  if (
    ["nu", "inactiv", "inactiva", "dezactiveaza", "oprit", "opreste"].includes(normalized)
  ) {
    return false;
  }
  return null;
}

function normalizeClockTime(value: unknown) {
  const normalized = String(value || "")
    .trim()
    .replace(/\b(?:ora|la)\b/gi, " ")
    .replace(/\s+/g, " ");
  const match = normalized.match(/^(\d{1,2})(?:(?::|\s)(\d{1,2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeFields(fields: Record<string, unknown>) {
  const normalized: Record<string, boolean | number | string> = {};
  const invalidFields: string[] = [];

  for (const [field, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(field)) {
      invalidFields.push(field);
      continue;
    }
    if (field === "enabled" || field === "soundEnabled") {
      const booleanValue = normalizeBoolean(value);
      if (booleanValue === null) invalidFields.push(field);
      else normalized[field] = booleanValue;
      continue;
    }
    if (field === "scheduleTime" || field === "stopTime") {
      const time = normalizeClockTime(value);
      if (!time) invalidFields.push(field);
      else normalized[field] = time;
      continue;
    }
    const minutes = Number(value);
    const min = field === "reminderRepeatMinutes" ? 5 : 0;
    const max = field === "reminderRepeatMinutes" ? 720 : 1440;
    if (!Number.isFinite(minutes) || minutes < min || minutes > max) invalidFields.push(field);
    else normalized[field] = Math.round(minutes);
  }

  return { fields: normalized, invalidFields };
}

function rankRules(rules: NotificationRuleItem[], query: string) {
  const normalizedQuery = normalizeAssistantText(query);
  return rules
    .map((rule) => ({
      rule,
      score:
        normalizeAssistantText(rule.name) === normalizedQuery
          ? 1
          : scoreAssistantText(
              [rule.name, rule.module, rule.eventType, rule.entityLabel].filter(Boolean).join(" "),
              query
            ),
    }))
    .filter((entry) => entry.score >= 0.3)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function compactRuleFields(rule: NotificationRuleItem, fields: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(fields).map((field) => [field, rule[field as keyof NotificationRuleItem]]));
}

function toFormValues(rule: NotificationRuleItem): NotificationRuleFormValues {
  return {
    name: rule.name,
    module: rule.module,
    eventType: rule.eventType,
    entityId: rule.entityId,
    entityLabel: rule.entityLabel,
    enabled: rule.enabled,
    scheduleTime: rule.scheduleTime,
    stopTime: rule.stopTime,
    weekdays: [...rule.weekdays],
    reminderDelayHours: rule.reminderDelayHours,
    reminderRepeatMinutes: rule.reminderRepeatMinutes,
    reminderActiveMinutes: rule.reminderActiveMinutes,
    soundEnabled: rule.soundEnabled,
    recipients: {
      ...rule.recipients,
      specificUserIds: [...rule.recipients.specificUserIds],
    },
  };
}

export function createNotificationRuleSettingsTool(): AssistantToolDefinition<
  unknown,
  ResolvedNotificationSettingsInput
> {
  const definition: AssistantToolDefinition<unknown, ResolvedNotificationSettingsInput> = {
    id: "notifications.rules.update",
    aliases: ["update_notification_rule", "update_notification_settings"],
    description:
      "Actualizeaza controlat o regula de notificare: stare, sunet, ore sau intervale.",
    module: "notifications",
    inputSchema: {
      type: "object",
      properties: {
        ruleQuery: { type: "string" },
        fields: { type: "object" },
      },
      required: ["ruleQuery", "fields"],
      additionalProperties: false,
    },
    outputSchema: ASSISTANT_TOOL_OUTPUT_SCHEMA,
    risk: "medium",
    permission: rolePermission("admin", "manager"),
    resolve: async (input) => {
      const parsed = readInput(input);
      const normalized = normalizeFields(parsed.fields);
      const options = rankRules(await getNotificationRules(), parsed.ruleQuery);
      const [first, second] = options;
      const rule =
        first && first.score >= 0.85 && (!second || first.score - second.score >= 0.08)
          ? first.rule
          : null;
      return {
        ...parsed,
        fields: normalized.fields,
        invalidFields: normalized.invalidFields,
        rule,
        options,
      };
    },
    validate: (input) => {
      if (!input.ruleQuery) {
        return { ok: false, reason: "Spune numele regulii.", missingInformation: ["regula"] };
      }
      if (input.invalidFields.length > 0) {
        return {
          ok: false,
          reason: `Setari nepermise sau invalide: ${input.invalidFields.join(", ")}.`,
        };
      }
      if (Object.keys(input.fields).length === 0) {
        return { ok: false, reason: "Nu am gasit setarea care trebuie modificata." };
      }
      if (!input.rule) {
        return {
          ok: false,
          reason:
            input.options.length > 1
              ? "Am gasit mai multe reguli. Alege varianta corecta."
              : "Nu am gasit regula ceruta.",
          choices: input.options.map(({ rule }) => ({
            id: rule.id,
            label: rule.name,
            description: `${rule.module} · ${rule.enabled ? "activa" : "inactiva"}`,
          })),
        };
      }
      return { ok: true };
    },
    preview: (input) => {
      const changes = Object.entries(input.fields)
        .map(([field, value]) => `${field}: ${String(value)}`)
        .join(", ");
      return `Modific regula ${input.rule?.name || input.ruleQuery}: ${changes}.`;
    },
    execute: async (input) => {
      if (!input.rule) throw new Error("Regula de notificare nu a fost rezolvata.");
      const beforeData = compactRuleFields(input.rule, input.fields);
      const nextValues = { ...toFormValues(input.rule), ...input.fields } as NotificationRuleFormValues;
      await updateNotificationRule(input.rule.id, nextValues);
      return {
        message: `Am actualizat regula ${input.rule.name}.`,
        entityId: input.rule.id,
        beforeData,
        afterData: compactRuleFields({ ...input.rule, ...nextValues }, input.fields),
      };
    },
    audit: (input, outcome, context) =>
      auditAssistantTool(
        definition,
        { ruleId: input.rule?.id || "", ruleQuery: input.ruleQuery, fields: input.fields },
        outcome,
        context
      ),
  };
  return definition;
}
