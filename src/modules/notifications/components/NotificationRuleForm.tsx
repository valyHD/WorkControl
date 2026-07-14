import { useEffect, useMemo, useState } from "react";
import type { AppUser, ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import type { ProjectItem } from "../../../types/timesheet";
import type { MaintenanceClient } from "../../../types/maintenance";
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
  maintenanceClients?: MaintenanceClient[];
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
  { value: "maintenance", label: "Mentenanta lifturi", description: "Clienti, lifturi, rapoarte si branding." },
  { value: "expenses", label: "Bonuri si facturi", description: "Documente scanate, facturi si decontari." },
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
    { value: "tool_images_updated", label: "Poze scula adaugate", description: "Galeria sculei a fost actualizata." },
    { value: "tool_cover_changed", label: "Poza principala scula", description: "Poza principala a sculei a fost schimbata." },
    { value: "tool_image_deleted", label: "Poza scula stearsa", description: "O poza a sculei a fost stearsa." },
    { value: "tool_claimed", label: "Scula preluata", description: "Un utilizator a preluat scula in responsabilitate." },
  ],
  vehicles: [
    { value: "vehicle_created", label: "Mașină adăugată", description: "A fost înregistrată o mașină nouă." },
    { value: "vehicle_updated", label: "Mașină actualizată", description: "Date mașină editate (ITP, RCA, date tehnice)." },
    { value: "vehicle_deleted", label: "Mașină ștearsă", description: "Mașina a fost scoasă din sistem." },
    { value: "vehicle_driver_changed", label: "Șofer schimbat", description: "S-a schimbat șoferul curent." },
    { value: "vehicle_status_changed", label: "Status mașină schimbat", description: "S-a schimbat statusul (activă/service/avariată)." },
    { value: "vehicle_images_updated", label: "Poze masina adaugate", description: "Galeria masinii a fost actualizata." },
    { value: "vehicle_cover_changed", label: "Poza principala masina", description: "Poza principala a masinii a fost schimbata." },
    { value: "vehicle_image_deleted", label: "Poza masina stearsa", description: "O poza a masinii a fost stearsa." },
    { value: "vehicle_documents_updated", label: "Documente masina", description: "Documentele masinii au fost adaugate sau actualizate." },
    { value: "vehicle_document_deleted", label: "Document masina sters", description: "Un document al masinii a fost sters." },
    { value: "vehicle_claimed", label: "Masina preluata", description: "Un utilizator a preluat masina in responsabilitate." },
    { value: "vehicle_started", label: "Comandă pornire", description: "A fost trimisă comandă de pornire." },
    { value: "vehicle_block_start_requested", label: "Comandă blocare pornire", description: "A fost trimisă comandă de blocare start." },
    { value: "vehicle_command_requested", label: "Comandă vehicul", description: "Alt tip de comandă trimisă către tracker." },
    { value: "vehicle_command_result", label: "Rezultat comandă", description: "Comanda mașinii a primit răspuns (success/fail)." },
    { value: "vehicle_service_due_soon", label: "Service în 500 km", description: "Se apropie revizia tehnică a mașinii." },
    { value: "vehicle_oil_service_due_soon", label: "Revizie ulei în 500 km", description: "Se apropie revizia de ulei după km." },
    { value: "vehicle_document_itp_due_soon", label: "ITP expiră în 10 zile", description: "Se apropie expirarea ITP." },
    { value: "vehicle_document_rca_due_soon", label: "RCA expiră în 10 zile", description: "Se apropie expirarea RCA." },
    { value: "vehicle_document_casco_due_soon", label: "CASCO expiră în 10 zile", description: "Se apropie expirarea CASCO." },
    { value: "vehicle_document_rovinieta_due_soon", label: "Rovinieta expiră în 10 zile", description: "Se apropie expirarea rovinietei." },
  ],
  timesheets: [
    { value: "timesheet_started", label: "Pontaj pornit", description: "Utilizatorul a pornit pontajul." },
    { value: "timesheet_stopped", label: "Pontaj oprit", description: "Utilizatorul a închis pontajul." },
    { value: "timesheet_updated", label: "Pontaj editat", description: "Pontaj modificat după înregistrare." },
    { value: "timesheet_corrected", label: "Pontaj corectat", description: "Pontajul a fost marcat/corectat dupa durata sau explicatie." },
    { value: "timesheet_deleted", label: "Pontaj sters", description: "Un pontaj a fost sters." },
    { value: "timesheet_location_recorded", label: "Locatie pontaj", description: "Locatia de start/stop a fost inregistrata." },
    { value: "timesheet_work_interval_reminder", label: "Program lucru pontaj", description: "Setezi intervalul de lucru, iar sistemul notifica pornirea si oprirea pontajului." },
    { value: "timesheet_start_daily_reminder", label: "Reminder porneste pontajul", description: "Trimite zilnic notificare daca pontajul nu este pornit." },
    { value: "timesheet_stop_after_8h_reminder", label: "Reminder opreste pontajul", description: "Trimite la ora setata daca pontajul este inca activ." },
  ],
  leave: [
    { value: "leave_request_submitted", label: "Cerere depusă", description: "Un utilizator a depus o cerere nouă de concediu/liber." },
    { value: "leave_request_approved", label: "Cerere aprobată", description: "O cerere de concediu/liber a fost aprobată." },
    { value: "leave_request_rejected", label: "Cerere respinsa", description: "O cerere de concediu/liber a fost respinsa." },
    { value: "leave_request_deleted", label: "Cerere ștearsă", description: "O cerere de concediu/liber a fost ștearsă." },
  ],
  projects: [
    { value: "project_created", label: "Proiect creat", description: "A fost adăugat un proiect." },
    { value: "project_updated", label: "Proiect actualizat", description: "Date/status proiect modificate." },
    { value: "project_status_changed", label: "Status proiect", description: "Statusul proiectului a fost schimbat." },
    { value: "project_deleted", label: "Proiect sters", description: "Un proiect a fost sters." },
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
    { value: "notification_rule_created", label: "Regula creata", description: "A fost creata o regula de notificare." },
    { value: "notification_rule_updated", label: "Regula actualizata", description: "O regula de notificare a fost editata." },
    { value: "notification_rule_deleted", label: "Regula stearsa", description: "O regula de notificare a fost stearsa." },
  ],
  maintenance: [
    { value: "maintenance_client_created", label: "Client mentenanta creat", description: "A fost adaugat un client de mentenanta." },
    { value: "maintenance_client_updated", label: "Client mentenanta editat", description: "Datele clientului de mentenanta au fost modificate." },
    { value: "maintenance_client_deleted", label: "Client mentenanta sters", description: "Un client de mentenanta a fost sters." },
    { value: "maintenance_lift_updated", label: "Lift editat", description: "Lift, adresa, expirare ISCIR sau tip R1/R2 schimbat." },
    { value: "maintenance_report_created", label: "Raport generat", description: "A fost generat un raport de revizie/interventie." },
    { value: "maintenance_branding_updated", label: "Branding firma", description: "Logo/stampila sau firma de mentenanta a fost modificata." },
    { value: "maintenance_part_order_created", label: "Comanda piese creata", description: "A fost creata o comanda noua de piese pentru lift." },
    { value: "maintenance_part_order_updated", label: "Comanda piese editata", description: "Datele unei comenzi de piese au fost modificate." },
    { value: "maintenance_part_order_status_changed", label: "Status comanda piese", description: "Statusul comenzii de piese s-a schimbat." },
    { value: "maintenance_part_order_deleted", label: "Comanda piese stearsa", description: "O comanda de piese a fost stearsa." },
  ],
  expenses: [
    { value: "expense_document_created", label: "Document cheltuiala", description: "A fost scanat sau introdus un bon/factura." },
    { value: "expense_invoice_created", label: "Factura introdusa", description: "A fost introdusa sau scanata o factura." },
    { value: "expense_reimbursable_created", label: "Decontare introdusa", description: "A fost introdus un document marcat pentru decontare." },
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
    { value: "control_panel_settings_updated", label: "Setari control panel", description: "Setarile aplicatiei au fost modificate." },
    { value: "system_change_detected", label: "Schimbare sistem", description: "Schimbare administrativă în sistem." },
    { value: "notification_rule_changed", label: "Regulă notificări schimbată", description: "O regulă a fost creată sau editată." },
    { value: "any_change", label: "Orice schimbare", description: "Prinde toate schimbările disponibile." },
  ],
  general: [{ value: "any_change", label: "Orice schimbare", description: "Regulă globală pentru toate modulele." }],
};

const START_TIMESHEET_REMINDER_EVENT: NotificationRuleEventType = "timesheet_start_daily_reminder";
const STOP_TIMESHEET_REMINDER_EVENT: NotificationRuleEventType = "timesheet_stop_after_8h_reminder";
const WORK_INTERVAL_REMINDER_EVENT: NotificationRuleEventType = "timesheet_work_interval_reminder";
const DEFAULT_TIMESHEET_REMINDER_WEEKDAYS = [1, 2, 3, 4, 5];
const weekdayOptions = [
  { value: 1, label: "Luni" },
  { value: 2, label: "Marti" },
  { value: 3, label: "Miercuri" },
  { value: 4, label: "Joi" },
  { value: 5, label: "Vineri" },
  { value: 6, label: "Sambata" },
  { value: 7, label: "Duminica" },
];

function isStartReminder(eventType: NotificationRuleEventType) {
  return eventType === START_TIMESHEET_REMINDER_EVENT;
}

function isStopReminder(eventType: NotificationRuleEventType) {
  return eventType === STOP_TIMESHEET_REMINDER_EVENT;
}

function isWorkIntervalReminder(eventType: NotificationRuleEventType) {
  return eventType === WORK_INTERVAL_REMINDER_EVENT;
}

function getReminderWeekdays(weekdays: number[] | undefined) {
  return weekdays?.length ? weekdays : DEFAULT_TIMESHEET_REMINDER_WEEKDAYS;
}

function normalizeReminderRepeatMinutes(value: number | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 60;
  return Math.max(5, Math.min(720, Math.round(parsed)));
}

function normalizeReminderActiveMinutes(value: number | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 120;
  return Math.max(0, Math.min(1440, Math.round(parsed)));
}

export default function NotificationRuleForm({
  initialValues,
  users,
  tools,
  vehicles,
  projects,
  maintenanceClients = [],
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
  const startReminderSelected = isStartReminder(values.eventType);
  const stopReminderSelected = isStopReminder(values.eventType);
  const workIntervalSelected = isWorkIntervalReminder(values.eventType);
  const timesheetReminderSelected = startReminderSelected || stopReminderSelected || workIntervalSelected;

  const canSelectEntity =
    values.module === "vehicles" ||
    values.module === "tools" ||
    values.module === "timesheets" ||
    values.module === "leave" ||
    values.module === "users" ||
    values.module === "projects" ||
    values.module === "maintenance";

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
        label: project.name || "Fara nume",
      }));
    }

    if (values.module === "maintenance") {
      return maintenanceClients.map((client) => ({
        id: client.id,
        label: client.name || client.email || client.id,
      }));
    }

    if (values.module === "users" || values.module === "leave") {
      return users.map((entry) => ({
        id: entry.id,
        label: entry.fullName,
      }));
    }

    return [];
  }, [maintenanceClients, projects, tools, users, values.module, vehicles]);

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

  function toggleWeekday(weekday: number) {
    setValues((prev) => {
      const currentWeekdays = getReminderWeekdays(prev.weekdays);
      const exists = currentWeekdays.includes(weekday);
      const nextWeekdays = exists
        ? currentWeekdays.filter((day) => day !== weekday)
        : [...currentWeekdays, weekday].sort((a, b) => a - b);

      return {
        ...prev,
        weekdays: nextWeekdays.length > 0 ? nextWeekdays : [weekday],
      };
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || isSubmittingNow) return;

    try {
      setIsSubmittingNow(true);
      await onSubmit({
        ...values,
        reminderRepeatMinutes: timesheetReminderSelected
          ? normalizeReminderRepeatMinutes(values.reminderRepeatMinutes)
          : values.reminderRepeatMinutes,
        reminderActiveMinutes: timesheetReminderSelected
          ? normalizeReminderActiveMinutes(values.reminderActiveMinutes)
          : values.reminderActiveMinutes,
      });
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
            onChange={(e) => {
              const nextEventType = e.target.value as NotificationRuleEventType;
              setValues((prev) => ({
                ...prev,
                eventType: nextEventType,
                scheduleTime: isStartReminder(nextEventType) || isWorkIntervalReminder(nextEventType) ? prev.scheduleTime || "08:30" : prev.scheduleTime,
                stopTime: isStopReminder(nextEventType) || isWorkIntervalReminder(nextEventType) ? prev.stopTime || "17:00" : prev.stopTime,
                weekdays:
                  isStartReminder(nextEventType) || isStopReminder(nextEventType) || isWorkIntervalReminder(nextEventType)
                    ? getReminderWeekdays(prev.weekdays)
                    : prev.weekdays,
                reminderRepeatMinutes:
                  isStartReminder(nextEventType) || isStopReminder(nextEventType) || isWorkIntervalReminder(nextEventType)
                    ? normalizeReminderRepeatMinutes(prev.reminderRepeatMinutes)
                    : prev.reminderRepeatMinutes,
                reminderActiveMinutes:
                  isStartReminder(nextEventType) || isStopReminder(nextEventType) || isWorkIntervalReminder(nextEventType)
                    ? normalizeReminderActiveMinutes(prev.reminderActiveMinutes)
                    : prev.reminderActiveMinutes,
                soundEnabled: isStartReminder(nextEventType) || isStopReminder(nextEventType) || isWorkIntervalReminder(nextEventType) ? prev.soundEnabled !== false : prev.soundEnabled,
              }));
            }}
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

        {workIntervalSelected && (
          <>
            <div className="tool-form-block">
              <label className="tool-form-label">Interval lucru - inceput</label>
              <input
                className="tool-input"
                type="time"
                disabled={submitting || isSubmittingNow}
                value={values.scheduleTime || "08:30"}
                onChange={(e) => setValues((prev) => ({ ...prev, scheduleTime: e.target.value || "08:30" }))}
              />
              <small className="tool-form-hint">La ora aceasta primeste notificare daca nu a pornit pontajul.</small>
            </div>

            <div className="tool-form-block">
              <label className="tool-form-label">Interval lucru - sfarsit</label>
              <input
                className="tool-input"
                type="time"
                disabled={submitting || isSubmittingNow}
                value={values.stopTime || "17:00"}
                onChange={(e) => setValues((prev) => ({ ...prev, stopTime: e.target.value || "17:00" }))}
              />
              <small className="tool-form-hint">La ora aceasta primeste notificare daca pontajul este inca activ.</small>
            </div>
          </>
        )}

        {startReminderSelected && (
          <div className="tool-form-block">
            <label className="tool-form-label">Ora pornire pontaj</label>
            <input
              className="tool-input"
              type="time"
              disabled={submitting || isSubmittingNow}
              value={values.scheduleTime || "08:30"}
              onChange={(e) => setValues((prev) => ({ ...prev, scheduleTime: e.target.value || "08:30" }))}
            />
          </div>
        )}

        {stopReminderSelected && (
          <div className="tool-form-block">
            <label className="tool-form-label">Ora oprire pontaj</label>
            <input
              className="tool-input"
              type="time"
              disabled={submitting || isSubmittingNow}
              value={values.stopTime || "17:00"}
              onChange={(e) => setValues((prev) => ({ ...prev, stopTime: e.target.value || "17:00" }))}
            />
          </div>
        )}

        {timesheetReminderSelected && (
          <div className="tool-form-block tool-form-block-full">
            <label className="tool-form-label">Zile active</label>
            <div className="checkbox-grid checkbox-grid--rules">
              {weekdayOptions.map((day) => {
                const selectedWeekdays = getReminderWeekdays(values.weekdays);
                return (
                  <label className="checkbox-line" key={day.value}>
                    <input
                      type="checkbox"
                      disabled={submitting || isSubmittingNow}
                      checked={selectedWeekdays.includes(day.value)}
                      onChange={() => toggleWeekday(day.value)}
                    />
                    <span>{day.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {timesheetReminderSelected && (
          <div className="tool-form-block">
            <label className="tool-form-label">Repeta notificarea la fiecare (minute)</label>
            <input
              className="tool-input"
              type="number"
              min={5}
              max={720}
              step={5}
              inputMode="numeric"
              disabled={submitting || isSubmittingNow}
              value={values.reminderRepeatMinutes ? String(values.reminderRepeatMinutes) : ""}
              onChange={(e) => {
                const rawValue = e.target.value;
                setValues((prev) => ({
                  ...prev,
                  reminderRepeatMinutes: rawValue === "" ? 0 : Number(rawValue),
                }));
              }}
              onBlur={() =>
                setValues((prev) => ({
                  ...prev,
                  reminderRepeatMinutes: normalizeReminderRepeatMinutes(prev.reminderRepeatMinutes),
                }))
              }
              placeholder="60"
            />
          </div>
        )}

        {timesheetReminderSelected && (
          <div className="tool-form-block">
            <label className="tool-form-label">Insista maximum dupa ora setata (minute)</label>
            <input
              className="tool-input"
              type="number"
              min={0}
              max={1440}
              step={5}
              inputMode="numeric"
              disabled={submitting || isSubmittingNow}
              value={values.reminderActiveMinutes === 0 || values.reminderActiveMinutes ? String(values.reminderActiveMinutes) : ""}
              onChange={(e) => {
                const rawValue = e.target.value;
                setValues((prev) => ({
                  ...prev,
                  reminderActiveMinutes: rawValue === "" ? 0 : Number(rawValue),
                }));
              }}
              onBlur={() =>
                setValues((prev) => ({
                  ...prev,
                  reminderActiveMinutes: normalizeReminderActiveMinutes(prev.reminderActiveMinutes),
                }))
              }
              placeholder="120"
            />
            <small className="tool-form-hint">
              120 = timp de 2 ore. 0 inseamna doar notificarea de la ora setata, fara insistente.
            </small>
          </div>
        )}

        {timesheetReminderSelected && (
          <div className="tool-form-block">
            <label className="tool-form-label">Sunet</label>
            <label className="tool-checkbox-inline">
              <input
                type="checkbox"
                disabled={submitting || isSubmittingNow}
                checked={values.soundEnabled !== false}
                onChange={(e) => setValues((prev) => ({ ...prev, soundEnabled: e.target.checked }))}
              />
              Notificare cu sunet
            </label>
          </div>
        )}

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
