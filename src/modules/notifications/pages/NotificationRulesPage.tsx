import { useEffect, useState } from "react";
import { useAuth } from "../../../providers/AuthProvider";
import type { AppUser, ToolItem } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import type { ProjectItem } from "../../../types/timesheet";
import type { NotificationRuleFormValues, NotificationRuleItem } from "../../../types/notification-rule";
import { getToolsList, getUsersList } from "../../tools/services/toolsService";
import NotificationRuleForm from "../components/NotificationRuleForm";
import {
  createNotificationRule,
  getNotificationRules,
  updateNotificationRule,
} from "../services/notificationRulesService";
import { getVehiclesList } from "../../vehicles/services/vehiclesService";
import { getProjectsList } from "../../timesheets/services/timesheetsService";

const emptyValues: NotificationRuleFormValues = {
  name: "",
  module: "general",
  eventType: "any_change",
  entityId: "",
  entityLabel: "",
  enabled: true,
  recipients: {
    notifyDirectUser: true,
    notifyOwner: false,
    notifyAdmins: false,
    notifyManagers: false,
    specificUserIds: [],
  },
};

export default function NotificationRulesPage() {
  const { role } = useAuth();

  const [rules, setRules] = useState<NotificationRuleItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingValues, setEditingValues] =
    useState<NotificationRuleFormValues>(emptyValues);

  async function load() {
    setLoading(true);
    setError("");

    try {
      const [rulesData, usersData, toolsData, vehiclesData, projectsData] = await Promise.all([
        getNotificationRules(),
        getUsersList(),
        getToolsList(),
        getVehiclesList(),
        getProjectsList(),
      ]);

      setRules(rulesData);
      setUsers(usersData);
      setTools(toolsData);
      setVehicles(vehiclesData);
      setProjects(projectsData);
    } catch (err) {
      console.error(err);
      setError("Nu am putut incarca regulile.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(values: NotificationRuleFormValues) {
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

      await load();
    } catch (err) {
      console.error(err);
      setError("Nu am putut crea regula.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId) return;

    setSubmitting(true);
    setError("");

    try {
      if (!editingValues.name.trim()) {
        setError("Completeaza numele regulii.");
        return;
      }

      await updateNotificationRule(editingId, {
        ...editingValues,
        name: editingValues.name.trim(),
      });

      setEditingId("");
      setEditingValues(emptyValues);
      await load();
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva regula.");
    } finally {
      setSubmitting(false);
    }
  }

  if (role !== "admin" && role !== "manager") {
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
            submitting={submitting}
            onSubmit={handleCreate}
          />
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Lista reguli</h2>

        {rules.length === 0 ? (
          <p className="tools-subtitle">Nu exista reguli configurate.</p>
        ) : (
          <div className="simple-list">
            {rules.map((rule) => (
              <div key={rule.id} className="simple-list-item">
                {editingId === rule.id ? (
                  <div style={{ width: "100%" }}>
                    <NotificationRuleForm
                      initialValues={editingValues}
                      users={users}
                      tools={tools}
                      vehicles={vehicles}
                      projects={projects}
                      submitting={submitting}
                      onSubmit={async () => {
                        await handleSaveEdit();
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
                      {rule.entityId && (
                        <div className="simple-list-subtitle">
                          entitate: {rule.entityLabel || rule.entityId}
                        </div>
                      )}
                      <div className="simple-list-subtitle">
                        direct: {rule.recipients.notifyDirectUser ? "da" : "nu"} ·
                        owner: {rule.recipients.notifyOwner ? "da" : "nu"} ·
                        admini: {rule.recipients.notifyAdmins ? "da" : "nu"} ·
                        manageri: {rule.recipients.notifyManagers ? "da" : "nu"} ·
                        useri specifici: {rule.recipients.specificUserIds.length}
                      </div>
                    </div>

                    <button
                      className="secondary-btn"
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
                          recipients: {
                            ...rule.recipients,
                            specificUserIds: [...rule.recipients.specificUserIds],
                          },
                        });
                      }}
                    >
                      Editeaza
                    </button>
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
