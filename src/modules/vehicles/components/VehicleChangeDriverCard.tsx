import { useMemo, useState } from "react";
import type { AppUser } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import { changeVehicleDriver } from "../services/vehiclesService";
import { UserCheck, CheckCircle2, AlertCircle } from "lucide-react";

type Props = {
  vehicle: VehicleItem;
  users: AppUser[];
  onChanged: () => Promise<void>;
};

export default function VehicleChangeDriverCard({ vehicle, users, onChanged }: Props) {
  const [selectedUserId, setSelectedUserId] = useState(vehicle.currentDriverUserId || "");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  const isSameDriver = selectedUserId === (vehicle.currentDriverUserId || "");

  async function handleSubmit() {
    if (submitting || isSameDriver) return;

    setSubmitting(true);
    setMessage("");

    try {
      await changeVehicleDriver(
        vehicle.id,
        selectedUserId,
        selectedUser?.fullName ?? "",
        selectedUser?.themeKey ?? null
      );
      setMessage(
        selectedUserId
          ? "Solicitarea a fost trimisă. Șoferul se schimbă după acceptare."
          : "Șoferul curent a fost eliminat."
      );
      setMessageType("success");
      await onChanged();
    } catch (err) {
      console.error("[VehicleChangeDriverCard]", err);
      setMessage("Nu am putut actualiza șoferul. Încearcă din nou.");
      setMessageType("error");
    } finally {
      setSubmitting(false);
    }
  }

  const activeUsers = useMemo(
    () => users.filter((u) => u.active !== false),
    [users]
  );

  return (
    <div className="panel tool-inner-panel" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 32, height: 32, borderRadius: "var(--radius-sm)",
          background: "var(--primary-soft)", color: "var(--primary)", flexShrink: 0,
        }}>
          <UserCheck size={16} strokeWidth={2.2} />
        </div>
        <div>
          <h3 className="panel-title" style={{ margin: 0 }}>Schimbă șoferul curent</h3>
          <p className="tools-subtitle" style={{ margin: 0, fontSize: 12 }}>
            Actual: {vehicle.currentDriverUserName || <em>Neasignat</em>}
          </p>
        </div>
      </div>

      <div className="tool-form-block">
        <label className="tool-form-label">Șofer nou</label>
        <select
          className="tool-input"
          value={selectedUserId}
          onChange={(e) => { setSelectedUserId(e.target.value); setMessage(""); }}
          disabled={submitting}
        >
          <option value="">— Fără șofer curent —</option>
          {activeUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName || u.id}
            </option>
          ))}
        </select>
      </div>

      <div className="tool-form-actions" style={{ marginTop: 12 }}>
        <button
          className="primary-btn"
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || isSameDriver}
          style={{ flex: 1, justifyContent: "center" }}
        >
          {submitting ? "Se actualizează..." : "Salvează șoferul"}
        </button>
      </div>

      {isSameDriver && !message && (
        <p className="tools-subtitle" style={{ marginTop: 8, fontSize: 12, textAlign: "center" }}>
          Acesta este deja șoferul curent.
        </p>
      )}

      {message && (
        <div
          className={`vc-feedback vc-feedback--${messageType}`}
          style={{ marginTop: 10 }}
        >
          {messageType === "success"
            ? <CheckCircle2 size={14} />
            : <AlertCircle size={14} />
          }
          {message}
        </div>
      )}
    </div>
  );
}
