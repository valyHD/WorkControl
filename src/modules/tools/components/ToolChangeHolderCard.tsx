import { useMemo, useState } from "react";
import type { AppUser, ToolItem } from "../../../types/tool";
import { changeToolHolder } from "../services/toolsService";

type Props = {
  tool: ToolItem;
  users: AppUser[];
  initiator: {
    userId: string;
    userName: string;
    userThemeKey: string | null;
  };
  onChanged: () => Promise<void>;
};

export default function ToolChangeHolderCard({ tool, users, initiator, onChanged }: Props) {
  const [selectedUserId, setSelectedUserId] = useState(tool.currentHolderUserId || "");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const selectedUser = useMemo(() => {
    return users.find((user) => user.id === selectedUserId) ?? null;
  }, [users, selectedUserId]);

  async function handleSubmit() {
    setSubmitting(true);
    setMessage("");

    try {
      await changeToolHolder(
        tool.id,
        selectedUserId,
        selectedUser?.fullName ?? "",
        selectedUser?.themeKey ?? null,
        initiator
      );

      setMessage(
        selectedUserId
          ? "Solicitarea a fost trimisa. Detinatorul se schimba dupa acceptare."
          : "Scula a fost mutata in depozit."
      );
      await onChanged();
    } catch (error) {
      console.error(error);
      setMessage("Nu am putut actualiza detinatorul curent.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel tool-inner-panel">
      <h3 className="panel-title">Da scula altui utilizator</h3>

      <div className="tool-form-block">
        <label className="tool-form-label">Detinator curent nou</label>
        <select
          className="tool-input"
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
        >
          <option value="">Mut-o in depozit</option>
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
          {submitting ? "Se actualizeaza..." : "Salveaza detinatorul"}
        </button>
      </div>

      {message && <div className="tool-message">{message}</div>}
    </div>
  );
}
