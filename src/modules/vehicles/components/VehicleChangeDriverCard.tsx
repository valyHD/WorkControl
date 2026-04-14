import { useMemo, useState } from "react";
import type { AppUser } from "../../../types/tool";
import type { VehicleItem } from "../../../types/vehicle";
import { changeVehicleDriver } from "../services/vehiclesService";

type Props = {
  vehicle: VehicleItem;
  users: AppUser[];
  onChanged: () => Promise<void>;
};

export default function VehicleChangeDriverCard({
  vehicle,
  users,
  onChanged,
}: Props) {
  const [selectedUserId, setSelectedUserId] = useState(vehicle.currentDriverUserId || "");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const selectedUser = useMemo(() => {
    return users.find((user) => user.id === selectedUserId) ?? null;
  }, [users, selectedUserId]);

  async function handleSubmit() {
    setSubmitting(true);
    setMessage("");

    try {
      await changeVehicleDriver(
        vehicle.id,
        selectedUserId,
        selectedUser?.fullName ?? "",
        selectedUser?.themeKey ?? null
      );
      setMessage(selectedUserId ? "Soferul curent a fost actualizat." : "Soferul curent a fost eliminat.");
      await onChanged();
    } catch (error) {
      console.error(error);
      setMessage("Nu am putut actualiza soferul.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel tool-inner-panel">
      <h3 className="panel-title">Schimba soferul curent</h3>

      <div className="tool-form-block">
        <label className="tool-form-label">Sofer curent nou</label>
        <select
          className="tool-input"
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
        >
          <option value="">Fara sofer curent</option>
          {users
            .filter((user) => user.active !== false)
            .map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
        </select>
      </div>

      <div className="tool-form-actions">
        <button
          className="primary-btn"
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? "Se actualizeaza..." : "Salveaza soferul"}
        </button>
      </div>

      {message && <div className="tool-message">{message}</div>}
    </div>
  );
}