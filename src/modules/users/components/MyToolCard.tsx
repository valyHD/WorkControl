import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppUser, ToolItem } from "../../../types/tool";
import ToolStatusBadge from "../../tools/components/ToolStatusBadge";
import SafeImage from "../../../components/SafeImage";
import { changeToolHolder } from "../../tools/services/toolsService";

type Props = {
  tool: ToolItem;
  users: AppUser[];
  onChanged: () => Promise<void>;
  showOwner?: boolean;
  canManage?: boolean;
  initiator: {
    userId: string;
    userName: string;
    userThemeKey: string | null;
  };
};

export default function MyToolCard({
  tool,
  users,
  onChanged,
  showOwner = true,
  canManage = true,
  initiator,
}: Props) {
  const [selectedUserId, setSelectedUserId] = useState(tool.currentHolderUserId || "");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const selectedUser = useMemo(() => {
    return users.find((user) => user.id === selectedUserId) ?? null;
  }, [users, selectedUserId]);

  async function handleSaveHolder() {
    if (!canManage) return;

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
          ? "Scula a fost mutata la noul user."
          : "Scula a fost mutata in depozit."
      );

      await onChanged();
    } catch (error) {
      console.error(error);
      setMessage("Nu am putut actualiza detinatorul.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tool-card">
      <div className="tool-card-top">
        <div className="tool-card-avatar">
          <SafeImage
            src={tool.coverThumbUrl || tool.coverImageUrl}
            alt={tool.name}
            className="tool-card-avatar-image"
            fallbackText={tool.name}
            sizes="72px"
          />
        </div>

        <ToolStatusBadge status={tool.status} />
      </div>

      <div className="tool-card-title">{tool.name}</div>

      <div className="tool-card-code">Cod intern: {tool.internalCode || "-"}</div>
      <div className="tool-card-code">QR: {tool.qrCodeValue || "-"}</div>

      {showOwner && (
        <div className="tool-card-meta">
          <strong>Responsabil:</strong> {tool.ownerUserName || "-"}
        </div>
      )}

      <div className="tool-card-meta">
        <strong>La cine se afla:</strong> {tool.currentHolderUserName || "Depozit"}
      </div>

      {canManage ? (
        <>
          <div className="tool-card-transfer">
            <label className="tool-form-label">Da scula altui user</label>
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

          <div className="tool-card-actions">
            <button
              className="primary-btn"
              type="button"
              onClick={() => void handleSaveHolder()}
              disabled={submitting}
            >
              {submitting ? "Se salveaza..." : "Salveaza"}
            </button>

            <Link to={`/tools/${tool.id}`} className="secondary-btn">
              Vezi
            </Link>

            <Link to={`/tools/${tool.id}/edit`} className="secondary-btn">
              Editeaza
            </Link>
          </div>
        </>
      ) : (
        <div className="tool-card-actions">
          <Link to={`/tools/${tool.id}`} className="secondary-btn">
            Vezi
          </Link>
        </div>
      )}

      {message && <div className="tool-message">{message}</div>}
    </div>
  );
}