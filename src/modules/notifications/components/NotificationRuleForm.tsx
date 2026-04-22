import { useEffect, useMemo, useState } from "react";
import type { AppUser, ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import type { ProjectItem } from "../../../types/timesheet";
import type {
  NotificationRuleEventType,
  NotificationRuleFormValues,
  NotificationRuleModule,
} from "../../../types/notification-rule";

type Props = {
  initialValues: NotificationRuleFormValues;
  users: AppUser[];
  tools: ToolItem[];
  vehicles: VehicleItem[];
  projects: ProjectItem[];
  submitting: boolean;
  onSubmit: (values: NotificationRuleFormValues) => Promise<void>;
};

const moduleOptions: Array<{ value: NotificationRuleModule; label: string; description: string }> = [
  { value: "tools", label: "Scule", description: "Inventar, stare, responsabil, poze." },
  { value: "vehicles", label: "Mașini", description: "Stare mașini, șofer, comenzi GPS." },
  { value: "timesheets", label: "Pontaje", description: "Pornire/oprire pontaj și ajustări." },
  { value: "leave", label: "Concedii", description: "Cereri de concediu/liber, aprobare, respingere, ștergere." },
  { value: "projects", label: "Proiecte", description: "Schimbări pe proiecte active/inactive." },
  { value: "users", label: "Utilizatori", description: "Creare cont, rol, activare/dezactivare." },
  { value: "notifications", label: "Notificări", description: "Fluxul notificărilor interne." },
  { value: "backup", label: "Backup", description: "Export, eșec/succes backup, curățare date." },
  { value: "web", label: "Website", description: "Schimbări detectate în aplicația web." },
  { value: "server", label: "Server", description: "Evenimente backend/infrastructură." },
  { value: "system", label: "Sistem", description: "Reguli și modificări administrative." },
  { value: "general", label: "General", description: "Prinde orice modificare importantă." },
];

const eventOptionsByModule: Record<
  NotificationRuleModule,
  Array<{ value: NotificationRuleEventType; label: string; description: string }>
> = {
  tools: [
    { value: "tool_created", label: "Sculă creată", description: "A fost adăugată o sculă nouă." },
    { value: "tool_updated", label: "Sculă actualizată", description: "Detalii sculă editate (date, imagini, locație)." },
    { value: "tool_deleted", label: "Sculă ștearsă", description: "Scula a fost eliminată din inventar." },
    { value: "tool_holder_changed", label: "Responsabil schimbat", description: "Scula a trecut la alt utilizator sau în depozit." },
    { value: "tool_status_changed", label: "Status sculă schimbat", description: "S-a modificat starea operațională a sculei." },
  ],
  vehicles: [
    { value: "vehicle_created", label: "Mașină adăugată", description: "A fost înregistrată o mașină nouă." },
    { value: "vehicle_updated", label: "Mașină actualizată", description: "Date mașină editate (ITP, RCA, date tehnice)." },
    { value: "vehicle_deleted", label: "Mașină ștearsă", description: "Mașina a fost scoasă din sistem." },
    { value: "vehicle_driver_changed", label: "Șofer schimbat", description: "S-a schimbat șoferul curent." },
    { value: "vehicle_status_changed", label: "Status mașină schimbat", description: "S-a schimbat statusul (activă/service/avariată)." },
    { value: "vehicle_started", label: "Comandă pornire", description: "A fost trimisă comandă de pornire." },
    { value: "vehicle_block_start_requested", label: "Comandă blocare pornire", description: "A fost trimisă comandă de blocare start." },
    { value: "vehicle_command_requested", label: "Comandă vehicul", description: "Alt tip de comandă trimisă către tracker." },
    { value: "vehicle_command_result", label: "Rezultat comandă", description: "Comanda mașinii a primit răspuns (success/fail)." },
    { value: "vehicle_service_due_soon", label: "Service în 500 km", description: "Se apropie revizia tehnică a mașinii." },
    { value: "vehicle_document_itp_due_soon", label: "ITP expiră în 10 zile", description: "Se apropie expirarea ITP." },
    { value: "vehicle_document_rca_due_soon", label: "RCA expiră în 10 zile", description: "Se apropie expirarea RCA." },
    { value: "vehicle_document_casco_due_soon", label: "CASCO expiră în 10 zile", description: "Se apropie expirarea CASCO." },
  ],
  timesheets: [
    { value: "timesheet_started", label: "Pontaj pornit", description: "Utilizatorul a pornit pontajul." },
    { value: "timesheet_stopped", label: "Pontaj oprit", description: "Utilizatorul a închis pontajul." },
    { value: "timesheet_updated", label: "Pontaj editat", description: "Pontaj modificat după înregistrare." },
  ],
  leave: [
    { value: "leave_request_submitted", label: "Cerere depusă", description: "Un utilizator a depus o cerere nouă de concediu/liber." },
    { value: "leave_request_approved", label: "Cerere aprobată", description: "O cerere de concediu/liber a fost aprobată." },
    { value: "leave_request_deleted", label: "Cerere ștearsă", description: "O cerere de concediu/liber a fost ștearsă." },
  ],
  projects: [
    { value: "project_created", label: "Proiect creat", description: "A fost adăugat un proiect." },
    { value: "project_updated", label: "Proiect actualizat", description: "Date/status proiect modificate." },
  ],
  users: [
    { value: "user_created", label: "Utilizator creat", description: "A fost creat un cont nou." },
    { value: "user_updated", label: "Utilizator actualizat", description: "Date profil utilizator modificate." },
    { value: "user_role_changed", label: "Rol schimbat", description: "Rolul utilizatorului s-a modificat." },
    { value: "user_activation_changed", label: "Activare/dezactivare", description: "Statusul activ/inactiv a fost schimbat." },
  ],
  notifications: [
    { value: "notification_created", label: "Notificare nouă", description: "A fost generată o notificare internă." },
    { value: "notification_read", label: "Notificare citită", description: "O notificare a fost marcată ca citită." },
  ],
  backup: [
    { value: "backup_requested", label: "Backup pornit", description: "S-a pornit un export de date." },
    { value: "backup_completed", label: "Backup finalizat", description: "Backup-ul s-a încheiat cu succes." },
    { value: "backup_failed", label: "Backup eșuat", description: "Exportul de date a eșuat." },
    { value: "data_retention_cleanup", label: "Curățare istoric", description: "Date istorice șterse pe regula de retenție." },
  ],
  web: [
    { value: "web_change_detected", label: "Schimbare web", description: "Schimbare detectată în aplicația web." },
    { value: "any_change", label: "Orice schimbare", description: "Prinde toate schimbările disponibile." },
  ],
  server: [
    { value: "server_change_detected", label: "Schimbare server", description: "Schimbare detectată pe server/infrastructură." },
    { value: "any_change", label: "Orice schimbare", description: "Prinde toate schimbările disponibile." },
  ],
  system: [
    { value: "system_change_detected", label: "Schimbare sistem", description: "Schimbare administrativă în sistem." },
    { value: "notification_rule_changed", label: "Regulă notificări schimbată", description: "O regulă a fost creată sau editată." },
    { value: "any_change", label: "Orice schimbare", description: "Prinde toate schimbările disponibile." },
  ],
  general: [{ value: "any_change", label: "Orice schimbare", description: "Regulă globală pentru toate modulele." }],
};

export default function NotificationRuleForm({
  initialValues,
  users,
  tools,
  vehicles,
  projects,
  submitting,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<NotificationRuleFormValues>(initialValues);
  const [isSubmittingNow, setIsSubmittingNow] = useState(false);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const currentEvents = eventOptionsByModule[values.module] ?? eventOptionsByModule.general;
  const activeModule = moduleOptions.find((item) => item.value === values.module);
  const activeEvent = currentEvents.find((item) => item.value === values.eventType);

  const canSelectEntity =
    values.module === "vehicles" ||
    values.module === "tools" ||
    values.module === "timesheets" ||
    values.module === "leave" ||
    values.module === "users" ||
    values.module === "projects";

  const moduleEntityOptions = useMemo(() => {
    if (values.module === "vehicles") {
      return vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: `${vehicle.plateNumber} · ${vehicle.brand} ${vehicle.model}`.trim(),
      }));
    }

    if (values.module === "tools") {
      return tools.map((tool) => ({
        id: tool.id,
        label: `${tool.internalCode} · ${tool.name}`.trim(),
      }));
    }

    if (values.module === "timesheets" || values.module === "projects") {
      return projects.map((project) => ({
        id: project.id,
        label: `${project.code} · ${project.name}`.trim(),
      }));
    }

    if (values.module === "users" || values.module === "leave") {
      return users.map((entry) => ({
        id: entry.id,
        label: entry.fullName,
      }));
    }

    return [];
  }, [projects, tools, users, values.module, vehicles]);

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
    if (submitting || isSubmittingNow) return;

    try {
      setIsSubmittingNow(true);
      await onSubmit(values);
    } finally {
      setIsSubmittingNow(false);
    }
  }

  return (
    <form className="tool-form" onSubmit={handleSubmit}>
      <div className="rule-hint-card">
        <strong>{activeModule?.label}</strong>
        <span>{activeModule?.description}</span>
        <span>
          Eveniment selectat: <strong>{activeEvent?.label}</strong> — {activeEvent?.description}
        </span>
      </div>

      <div className="tool-form-grid">
        <div className="tool-form-block">
          <label className="tool-form-label">Nume regulă</label>
          <input
            className="tool-input"
            disabled={submitting || isSubmittingNow}
            value={values.name}
            onChange={(e) => setValues((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Ex: Notifică admin când se schimbă statusul unei mașini"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Modul</label>
          <select
            className="tool-input"
            disabled={submitting || isSubmittingNow}
            value={values.module}
            onChange={(e) => {
              const nextModule = e.target.value as NotificationRuleModule;
              const nextEvents = eventOptionsByModule[nextModule] ?? eventOptionsByModule.general;
              setValues((prev) => ({
                ...prev,
                module: nextModule,
                eventType: nextEvents[0].value,
                entityId: "",
                entityLabel: "",
              }));
            }}
          >
            {moduleOptions.map((module) => (
              <option key={module.value} value={module.value}>
                {module.label}
              </option>
            ))}
          </select>
        </div>

        {canSelectEntity && (
          <div className="tool-form-block">
            <label className="tool-form-label">Entitate specifică (opțional)</label>
            <select
              className="tool-input"
              disabled={submitting || isSubmittingNow}
              value={values.entityId}
              onChange={(e) => {
                const selectedId = e.target.value;
                const selectedLabel =
                  moduleEntityOptions.find((option) => option.id === selectedId)?.label ?? "";
                setValues((prev) => ({
                  ...prev,
                  entityId: selectedId,
                  entityLabel: selectedLabel,
                }));
              }}
            >
              <option value="">Toate entitățile ({activeModule?.label || values.module})</option>
              {moduleEntityOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="tool-form-block">
          <label className="tool-form-label">Eveniment</label>
          <select
            className="tool-input"
            disabled={submitting || isSubmittingNow}
            value={values.eventType}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                eventType: e.target.value as NotificationRuleEventType,
              }))
            }
          >
            {currentEvents.map((eventType) => (
              <option key={eventType.value} value={eventType.value}>
                {eventType.label}
              </option>
            ))}
          </select>
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Status regulă</label>
          <select
            className="tool-input"
            disabled={submitting || isSubmittingNow}
            value={values.enabled ? "true" : "false"}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                enabled: e.target.value === "true",
              }))
            }
          >
            <option value="true">Activă</option>
            <option value="false">Inactivă</option>
          </select>
        </div>

        <div className="tool-form-block tool-form-block-full">
          <label className="tool-form-label">Destinatari</label>
          <div className="checkbox-grid checkbox-grid--rules">
            <label className="checkbox-line">
              <input
                type="checkbox"
                disabled={submitting || isSubmittingNow}
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
                disabled={submitting || isSubmittingNow}
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
                disabled={submitting || isSubmittingNow}
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
              <span>Toți adminii</span>
            </label>

            <label className="checkbox-line">
              <input
                type="checkbox"
                disabled={submitting || isSubmittingNow}
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
              <span>Toți managerii</span>
            </label>
          </div>
        </div>

        <div className="tool-form-block tool-form-block-full">
          <label className="tool-form-label">Useri specifici</label>
          <div className="checkbox-grid checkbox-grid--users">
            {users
              .filter((user) => user.active !== false)
              .map((user) => (
                <label className="checkbox-line" key={user.id}>
                  <input
                    type="checkbox"
                    disabled={submitting || isSubmittingNow}
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
        <button className="primary-btn" type="submit" disabled={submitting || isSubmittingNow}>
          {submitting || isSubmittingNow ? "Se salvează..." : "Salvează regula"}
        </button>
      </div>
    </form>
  );
}
