import { useEffect, useState } from "react";
import type { AppUser } from "../../../types/tool";
import type {
  NotificationRuleEventType,
  NotificationRuleFormValues,
  NotificationRuleModule,
} from "../../../types/notification-rule";

type Props = {
  initialValues: NotificationRuleFormValues;
  users: AppUser[];
  submitting: boolean;
  onSubmit: (values: NotificationRuleFormValues) => Promise<void>;
};

const moduleOptions: NotificationRuleModule[] = [
  "tools",
  "vehicles",
  "timesheets",
  "users",
  "web",
  "server",
  "system",
  "general",
];

const eventOptionsByModule: Record<NotificationRuleModule, NotificationRuleEventType[]> = {
  tools: ["tool_holder_changed", "tool_status_changed"],
  vehicles: ["vehicle_driver_changed", "vehicle_status_changed", "vehicle_command_requested", "vehicle_command_result"],
  timesheets: ["timesheet_started", "timesheet_stopped", "timesheet_updated"],
  users: ["user_created", "user_role_changed"],
  web: ["web_change_detected", "any_change"],
  server: ["server_change_detected", "any_change"],
  system: ["system_change_detected", "notification_rule_changed", "any_change"],
  general: ["any_change"],
};

export default function NotificationRuleForm({
  initialValues,
  users,
  submitting,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<NotificationRuleFormValues>(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  function toggleSpecificUser(userId: string) {
    setValues((prev) => {
      const exists = prev.recipients.specificUserIds.includes(userId);
      return {
        ...prev,
        recipients: {
          ...prev.recipients,
          specificUserIds: exists
            ? prev.recipients.specificUserIds.filter((id) => id !== userId)
            : [...prev.recipients.specificUserIds, userId],
        },
      };
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(values);
  }

  const currentEvents = eventOptionsByModule[values.module];

  return (
    <form className="tool-form" onSubmit={handleSubmit}>
      <div className="tool-form-grid">
        <div className="tool-form-block">
          <label className="tool-form-label">Nume regula</label>
          <input
            className="tool-input"
            value={values.name}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="Ex: Notifica admin la schimbare scula"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Modul</label>
          <select
            className="tool-input"
            value={values.module}
            onChange={(e) => {
              const nextModule = e.target.value as NotificationRuleModule;
              const nextEvents = eventOptionsByModule[nextModule];
              setValues((prev) => ({
                ...prev,
                module: nextModule,
                eventType: nextEvents[0],
              }));
            }}
          >
            {moduleOptions.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </select>
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Eveniment</label>
          <select
            className="tool-input"
            value={values.eventType}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                eventType: e.target.value as NotificationRuleEventType,
              }))
            }
          >
            {currentEvents.map((eventType) => (
              <option key={eventType} value={eventType}>
                {eventType}
              </option>
            ))}
          </select>
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Status regula</label>
          <select
            className="tool-input"
            value={values.enabled ? "true" : "false"}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                enabled: e.target.value === "true",
              }))
            }
          >
            <option value="true">activa</option>
            <option value="false">inactiva</option>
          </select>
        </div>

        <div className="tool-form-block tool-form-block-full">
          <label className="tool-form-label">Destinatari</label>

          <div className="checkbox-grid">
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={values.recipients.notifyDirectUser}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    recipients: {
                      ...prev.recipients,
                      notifyDirectUser: e.target.checked,
                    },
                  }))
                }
              />
              <span>User implicat direct</span>
            </label>

            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={values.recipients.notifyOwner}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    recipients: {
                      ...prev.recipients,
                      notifyOwner: e.target.checked,
                    },
                  }))
                }
              />
              <span>Owner / responsabil</span>
            </label>

            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={values.recipients.notifyAdmins}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    recipients: {
                      ...prev.recipients,
                      notifyAdmins: e.target.checked,
                    },
                  }))
                }
              />
              <span>Toti adminii</span>
            </label>

            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={values.recipients.notifyManagers}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    recipients: {
                      ...prev.recipients,
                      notifyManagers: e.target.checked,
                    },
                  }))
                }
              />
              <span>Toti managerii</span>
            </label>
          </div>
        </div>

        <div className="tool-form-block tool-form-block-full">
          <label className="tool-form-label">Useri specifici</label>
          <div className="checkbox-grid">
            {users
              .filter((user) => user.active !== false)
              .map((user) => (
                <label className="checkbox-line" key={user.id}>
                  <input
                    type="checkbox"
                    checked={values.recipients.specificUserIds.includes(user.id)}
                    onChange={() => toggleSpecificUser(user.id)}
                  />
                  <span>{user.fullName}</span>
                </label>
              ))}
          </div>
        </div>
      </div>

      <div className="tool-form-actions">
        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? "Se salveaza..." : "Salveaza regula"}
        </button>
      </div>
    </form>
  );
}
