import { useMemo, useState } from "react";
import type { VehicleCommandItem, VehicleItem } from "../../../types/vehicle";

type Props = {
  vehicle: VehicleItem;
  commands: VehicleCommandItem[];
  onRequestCommand: (type: "allow_start" | "block_start") => Promise<void>;
  loading: boolean;
};

export default function VehicleControlCard({ vehicle, commands, onRequestCommand, loading }: Props) {
  const [busyType, setBusyType] = useState<"allow_start" | "block_start" | null>(null);

  const supportStatus = useMemo(() => {
    const protocol = (vehicle.tracker?.protocol || "").toLowerCase();
    if (!protocol) return "unavailable";
    if (protocol.includes("fmc130")) return "allowed";
    if (protocol.includes("ftc880")) return "pending";
    return "unavailable";
  }, [vehicle.tracker?.protocol]);

  async function run(type: "allow_start" | "block_start") {
    if (supportStatus === "unavailable") return;
    const confirmed = window.confirm(
      type === "allow_start"
        ? "Confirmi comanda: Permite pornirea motorului?"
        : "Confirmi comanda: Blocheaza pornirea motorului?"
    );
    if (!confirmed) return;

    setBusyType(type);
    try {
      await onRequestCommand(type);
    } finally {
      setBusyType(null);
    }
  }

  return (
    <div className="panel vehicle-control-card">
      <div className="vehicle-control-card__header">
        <h4 className="panel-title">Vehicle Control</h4>
        <span className={`vehicle-gps-chip control-${supportStatus}`}>{supportStatus}</span>
      </div>

      <p className="tools-subtitle" style={{ marginBottom: 12 }}>
        Structura este pregatita pentru pipeline comenzi Firestore (`vehicles/{"{"}vehicleId{"}"}/commands`) si integrare FMC130.
      </p>

      <div className="tool-form-actions">
        <button
          type="button"
          className="primary-btn"
          disabled={loading || supportStatus === "unavailable" || busyType === "block_start"}
          onClick={() => void run("allow_start")}
        >
          {busyType === "allow_start" ? "Se trimite..." : "Permite pornirea"}
        </button>
        <button
          type="button"
          className="danger-btn"
          disabled={loading || supportStatus === "unavailable" || busyType === "allow_start"}
          onClick={() => void run("block_start")}
        >
          {busyType === "block_start" ? "Se trimite..." : "Blocheaza pornirea"}
        </button>
      </div>

      <div className="tool-detail-line">
        <strong>Audit:</strong> comenzile sunt create cu status `requested`; executia hardware ramane fallback pentru FTC880.
      </div>

      <div className="simple-list" style={{ marginTop: 12 }}>
        {commands.length === 0 ? (
          <div className="simple-list-item">
            <div className="simple-list-text">
              <div className="simple-list-label">Nicio comanda trimisa inca.</div>
            </div>
          </div>
        ) : (
          commands.slice(0, 5).map((cmd) => (
            <div className="simple-list-item" key={cmd.id}>
              <div className="simple-list-text">
                <div className="simple-list-label">{cmd.type} · {cmd.status}</div>
                <div className="simple-list-subtitle">
                  {new Date(cmd.requestedAt).toLocaleString("ro-RO")} · {cmd.requestedBy}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
