import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../providers/AuthProvider";
import type { AppUser, ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import type { ProjectItem } from "../../../types/timesheet";
import type { MaintenanceClient } from "../../../types/maintenance";
import type { NotificationRuleFormValues, NotificationRuleItem } from "../../../types/notification-rule";
import { getToolsList, getUsersList } from "../../tools/services/toolsService";
import NotificationRuleForm from "../components/NotificationRuleForm";
import {
  createNotificationRule,
  deleteNotificationRule,
  subscribeNotificationRules,
  updateNotificationRule,
} from "../services/notificationRulesService";
import { getVehiclesList } from "../../vehicles/services/vehiclesService";
import { getProjectsList } from "../../timesheets/services/timesheetsService";
import { getMaintenanceClients } from "../../maintenance/services/maintenanceService";
import { filterActiveMaintenanceClients } from "../../maintenance/utils/maintenanceClientStatus";

const emptyValues: NotificationRuleFormValues = {
  name: "",
  module: "general",
  eventType: "any_change",
  entityId: "",
  entityLabel: "",
  enabled: true,
  scheduleTime: "08:30",
  stopTime: "17:00",
  weekdays: [1, 2, 3, 4, 5],
  reminderDelayHours: 8,
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
};

const weekdayShortLabels: Record<number, string> = {
  1: "L",
  2: "Ma",
  3: "Mi",
  4: "J",
  5: "V",
  6: "S",
  7: "D",
};

function formatWeekdays(weekdays: number[] | undefined) {
  const selected = weekdays?.length ? weekdays : [1, 2, 3, 4, 5];
  return selected.map((day) => weekdayShortLabels[day] || String(day)).join(", ");
}

export default function NotificationRulesPage() {
  const { role } = useAuth();

  const [rules, setRules] = useState<NotificationRuleItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [maintenanceClients, setMaintenanceClients] = useState<MaintenanceClient[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [editingValues, setEditingValues] = useState<NotificationRuleFormValues>(emptyValues);
  const isMountedRef = useRef(true);

  const canManageRules = role === "admin" || role === "manager";

  const loadDependencies = useCallback(async () => {
    setError("");
    setLoading(true);

    try {
      const [usersData, toolsData, vehiclesData, projectsData, maintenanceClientsData] = await Promise.all([
        getUsersList(),
        getToolsList(),
        getVehiclesList(),
        getProjectsList(),
        getMaintenanceClients(),
      ]);

      if (!isMountedRef.current) return;
      setUsers(usersData);
      setTools(toolsData);
      setVehicles(vehiclesData);
      setProjects(projectsData);
      setMaintenanceClients(filterActiveMaintenanceClients(maintenanceClientsData));
    } catch (err) {
      console.error("[NotificationRulesPage][loadDependencies]", err);
      if (!isMountedRef.current) return;
      setError("Nu am putut incarca toate datele auxiliare. Poti reincerca.");
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!canManageRules) {
      setLoading(false);
      return;
    }

    void loadDependencies();
  }, [canManageRules, loadDependencies]);

  useEffect(() => {
    if (!canManageRules) return;

    const unsubscribe = subscribeNotificationRules(
      (rulesData) => {
        if (!isMountedRef.current) return;
        setRules(Array.isArray(rulesData) ? rulesData : []);
      },
      (err) => {
        console.error("[NotificationRulesPage][subscribeNotificationRules]", err);
        if (!isMountedRef.current) return;
        setError("Nu am putut sincroniza regulile live.");
      }
    );

    return () => unsubscribe();
  }, [canManageRules]);

  async function handleCreate(values: NotificationRuleFormValues) {
    if (submitting) return;

    setSubmitting(true);
    setError("");

    try {
      if (!values.name.trim()) {
        setError("Completeaza numele regulii.");
        return;
      }

      await createNotificationRule({
        ...values,
        name: values.name.trim(),
      });
    } catch (err) {
      console.error("[NotificationRulesPage][handleCreate]", err);
      setError("Nu am putut crea regula.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(values: NotificationRuleFormValues) {
    if (!editingId || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      if (!values.name.trim()) {
        setError("Completeaza numele regulii.");
        return;
      }

      await updateNotificationRule(editingId, {
        ...values,
        name: values.name.trim(),
      });

      setEditingId("");
      setEditingValues(emptyValues);
    } catch (err) {
      console.error("[NotificationRulesPage][handleSaveEdit]", err);
      setError("Nu am putut salva regula.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteRule(rule: NotificationRuleItem) {
    if (deletingId || submitting) return;
    const confirmed = window.confirm(`Stergi regula "${rule.name}"?`);
    if (!confirmed) return;

    setDeletingId(rule.id);
    setError("");

    try {
      await deleteNotificationRule(rule);
      if (editingId === rule.id) {
        setEditingId("");
        setEditingValues(emptyValues);
      }
    } catch (err) {
      console.error("[NotificationRulesPage][handleDeleteRule]", err);
      setError("Nu am putut sterge regula.");
    } finally {
      setDeletingId("");
    }
  }

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => b.updatedAt - a.updatedAt),
    [rules]
  );

  if (!canManageRules) {
    return (
      <div className="placeholder-page">
        <h2>Acces restrictionat</h2>
        <p>Doar adminul sau managerul pot gestiona regulile de notificare.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca regulile...</h2>
        <p>Preluam configurarea notificarilor.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        <h2 className="panel-title">Reguli notificari</h2>
        <p className="tools-subtitle">
          Configureaza cine este notificat, pentru ce eveniment si din ce modul.
        </p>

        {error && <div className="tool-message" style={{ marginTop: 16 }}>{error}</div>}

        <div style={{ marginTop: 20 }}>
          <NotificationRuleForm
            initialValues={emptyValues}
            users={users}
            tools={tools}
            vehicles={vehicles}
            projects={projects}
            maintenanceClients={maintenanceClients}
            submitting={submitting}
            onSubmit={handleCreate}
          />
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Lista reguli</h2>

        {sortedRules.length === 0 ? (
          <p className="tools-subtitle">Nu exista reguli configurate.</p>
        ) : (
          <div className="simple-list compact-rows">
            {sortedRules.map((rule) => (
              <div key={rule.id} className="simple-list-item notification-rule-item">
                {editingId === rule.id ? (
                  <div style={{ width: "100%" }}>
                    <NotificationRuleForm
                      initialValues={editingValues}
                      users={users}
                      tools={tools}
                      vehicles={vehicles}
                      projects={projects}
                      maintenanceClients={maintenanceClients}
                      submitting={submitting}
                      onSubmit={async (values) => {
                        await handleSaveEdit(values);
                      }}
                    />

                    <div className="tool-form-actions" style={{ marginTop: 12 }}>
                      <button
                        className="secondary-btn"
                        type="button"
                        onClick={() => {
                          setEditingId("");
                          setEditingValues(emptyValues);
                        }}
                      >
                        Renunta
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="simple-list-text">
                      <div className="simple-list-label">{rule.name}</div>
                      <div className="simple-list-subtitle">
                        modul: {rule.module} · eveniment: {rule.eventType} · status:{" "}
                        {rule.enabled ? "activa" : "inactiva"}
                      </div>
                      {(rule.eventType === "timesheet_work_interval_reminder" ||
                        rule.eventType === "timesheet_start_daily_reminder" ||
                        rule.eventType === "timesheet_stop_after_8h_reminder") && (
                        <div className="simple-list-subtitle chip-list">
                          {rule.eventType === "timesheet_work_interval_reminder" && (
                            <span className="inline-setting-chip">
                              interval: {rule.scheduleTime || "08:30"} - {rule.stopTime || "17:00"}
                            </span>
                          )}
                          {rule.eventType === "timesheet_start_daily_reminder" && (
                            <span className="inline-setting-chip">pornire: {rule.scheduleTime || "08:30"}</span>
                          )}
                          {rule.eventType === "timesheet_stop_after_8h_reminder" && (
                            <span className="inline-setting-chip">oprire: {rule.stopTime || "17:00"}</span>
                          )}
                          <span className="inline-setting-chip">zile: {formatWeekdays(rule.weekdays)}</span>
                          <span className="inline-setting-chip">repeta: {rule.reminderRepeatMinutes || 60} min</span>
                          <span className="inline-setting-chip">maxim: {rule.reminderActiveMinutes ?? 120} min</span>
                          <span className="inline-setting-chip">sunet: {rule.soundEnabled === false ? "nu" : "da"}</span>
                        </div>
                      )}
                      {rule.entityId && (
                        <div className="simple-list-subtitle">
                          entitate: {rule.entityLabel || rule.entityId}
                        </div>
                      )}
                      <div className="simple-list-subtitle chip-list">
                        <span className="inline-setting-chip">direct: {rule.recipients.notifyDirectUser ? "da" : "nu"}</span>
                        <span className="inline-setting-chip">owner: {rule.recipients.notifyOwner ? "da" : "nu"}</span>
                        <span className="inline-setting-chip">admini: {rule.recipients.notifyAdmins ? "da" : "nu"}</span>
                        <span className="inline-setting-chip">manageri: {rule.recipients.notifyManagers ? "da" : "nu"}</span>
                        <span className="inline-setting-chip">useri specifici: {rule.recipients.specificUserIds.length}</span>
                      </div>
                    </div>

                    <div
                      className="notification-rule-actions"
                      style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
                    >
                      <button
                        className="secondary-btn notification-rule-edit-btn"
                        type="button"
                        onClick={() => {
                          setEditingId(rule.id);
                          setEditingValues({
                            name: rule.name,
                            module: rule.module,
                            eventType: rule.eventType,
                            entityId: rule.entityId,
                            entityLabel: rule.entityLabel,
                            enabled: rule.enabled,
                            scheduleTime: rule.scheduleTime || "08:30",
                            stopTime: rule.stopTime || "17:00",
                            weekdays: rule.weekdays?.length ? [...rule.weekdays] : [1, 2, 3, 4, 5],
                            reminderDelayHours: rule.reminderDelayHours || 8,
                            reminderRepeatMinutes: rule.reminderRepeatMinutes || 60,
                            reminderActiveMinutes: rule.reminderActiveMinutes ?? 120,
                            soundEnabled: rule.soundEnabled !== false,
                            recipients: {
                              ...rule.recipients,
                              specificUserIds: [...rule.recipients.specificUserIds],
                            },
                          });
                        }}
                      >
                        Editeaza
                      </button>
                      <button
                        className="secondary-btn notification-rule-delete-btn"
                        type="button"
                        disabled={deletingId === rule.id || submitting}
                        onClick={() => void handleDeleteRule(rule)}
                      >
                        {deletingId === rule.id ? "Se sterge..." : "Sterge"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
