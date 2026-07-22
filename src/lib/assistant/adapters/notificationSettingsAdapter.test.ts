import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRuleItem } from "../../../types/notification-rule";
import type { AssistantToolExecutionContext } from "../tools/assistantToolRegistry";
import { createNotificationRuleSettingsTool } from "./notificationSettingsAdapter";

const mocks = vi.hoisted(() => ({
  getRules: vi.fn(),
  updateRule: vi.fn(),
}));

vi.mock("../../../modules/notifications/services/notificationRulesService", () => ({
  getNotificationRules: mocks.getRules,
  updateNotificationRule: mocks.updateRule,
}));

function rule(id: string, name: string): NotificationRuleItem {
  return {
    id,
    name,
    module: "timesheets",
    eventType: "timesheet_start_daily_reminder",
    entityId: "",
    entityLabel: "",
    enabled: true,
    scheduleTime: "08:00",
    stopTime: "17:00",
    weekdays: [1, 2, 3, 4, 5],
    reminderDelayHours: 8,
    reminderDaysBefore: 7,
    reminderRepeatMinutes: 60,
    reminderActiveMinutes: 120,
    soundEnabled: true,
    recipients: {
      notifyDirectUser: true,
      notifyOwner: false,
      notifyAdmins: false,
      notifyManagers: false,
      specificUserIds: [],
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function context(role = "admin"): AssistantToolExecutionContext {
  return {
    command: "pune ora regulii Pontaj dimineata la 7",
    contract: {
      version: "3",
      commandType: "entity_update",
      intent: "update_notification_rule",
      toolCalls: [],
      targetPage: "",
      entityReferences: [],
      missingInformation: [],
      confidence: 0.98,
      confirmationRequired: true,
      response: "Actualizez regula?",
    },
    pageContext: {
      route: "/notification-rules",
      page: "notification-rules",
      selectedEntity: null,
      openForm: null,
      availableActions: [],
      allowedFields: [],
      role,
      memory: {},
    },
    actor: { uid: "user-1", role },
    runtime: {
      navigate: vi.fn(),
      dispatchFormDraft: vi.fn(),
    },
  };
}

describe("notification rule settings tool", () => {
  beforeEach(() => {
    mocks.getRules.mockReset();
    mocks.updateRule.mockReset();
  });

  it("normalizes time and updates only the requested allowlisted field", async () => {
    const item = rule("rule-1", "Pontaj dimineata");
    mocks.getRules.mockResolvedValue([item]);
    mocks.updateRule.mockResolvedValue(undefined);
    const tool = createNotificationRuleSettingsTool();
    const executionContext = context();

    expect(await tool.permission({}, executionContext)).toEqual({ ok: true });
    const resolved = await tool.resolve(
      { ruleQuery: "Pontaj dimineata", fields: { scheduleTime: "7" } },
      executionContext
    );
    expect(resolved.rule?.id).toBe("rule-1");
    expect(resolved.fields).toEqual({ scheduleTime: "07:00" });
    expect(await tool.validate(resolved, executionContext)).toEqual({ ok: true });

    const output = await tool.execute(resolved, executionContext);

    expect(mocks.updateRule).toHaveBeenCalledWith(
      "rule-1",
      expect.objectContaining({ scheduleTime: "07:00", stopTime: "17:00" })
    );
    expect(output).toMatchObject({
      entityId: "rule-1",
      beforeData: { scheduleTime: "08:00" },
      afterData: { scheduleTime: "07:00" },
    });
  });

  it("asks the user to choose when two rules match", async () => {
    mocks.getRules.mockResolvedValue([
      rule("rule-1", "Pontaj start dimineata"),
      rule("rule-2", "Pontaj start echipa"),
    ]);
    const tool = createNotificationRuleSettingsTool();
    const executionContext = context();
    const resolved = await tool.resolve(
      { ruleQuery: "Pontaj start", fields: { enabled: false } },
      executionContext
    );

    expect(resolved.rule).toBeNull();
    expect(await tool.validate(resolved, executionContext)).toMatchObject({
      ok: false,
      choices: [
        { id: "rule-1", label: "Pontaj start dimineata" },
        { id: "rule-2", label: "Pontaj start echipa" },
      ],
    });
    expect(mocks.updateRule).not.toHaveBeenCalled();
  });

  it("blocks employees from changing notification rules", async () => {
    const tool = createNotificationRuleSettingsTool();
    expect(await tool.permission({}, context("angajat"))).toEqual({
      ok: false,
      reason: "Nu ai permisiune pentru aceasta actiune.",
    });
  });

  it("rejects fields outside the settings allowlist", async () => {
    mocks.getRules.mockResolvedValue([rule("rule-1", "Pontaj dimineata")]);
    const tool = createNotificationRuleSettingsTool();
    const executionContext = context();
    const resolved = await tool.resolve(
      { ruleQuery: "Pontaj dimineata", fields: { recipients: [] } },
      executionContext
    );

    expect(await tool.validate(resolved, executionContext)).toMatchObject({
      ok: false,
      reason: "Setari nepermise sau invalide: recipients.",
    });
    expect(mocks.updateRule).not.toHaveBeenCalled();
  });
});
