import { useMemo, useState } from "react";
import type { VehicleCommandItem, VehicleItem } from "../../../types/vehicle";

type Props = {
  vehicle: VehicleItem;
  commands: VehicleCommandItem[];
  onRequestCommand: (type: "pulse_dout1" | "block_start") => Promise<void>;
  loading: boolean;
};

export default function VehicleControlCard({ vehicle, commands, onRequestCommand, loading }: Props) {
  const [busyType, setBusyType] = useState<"pulse_dout1" | "block_start" | null>(null);

  const supportStatus = useMemo(() => {
    const protocol = (vehicle.tracker?.protocol || "").toLowerCase();
    if (!protocol) return "unavailable";
    if (protocol.includes("teltonika")) return "allowed";
    if (protocol.includes("codec_8e")) return "allowed";
    return "pending";
  }, [vehicle.tracker?.protocol]);

  async function run(type: "pulse_dout1" | "block_start") {
    const confirmed = window.confirm(
      type === "pulse_dout1"
        ? "Confirmi comanda? Releul de pe DOUT1 va ramane activ 1 minut."
        : "Confirmi comanda? Se va trimite cerere de blocare pornire."
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
        <h4 className="panel-title">Control releu DOUT1</h4>
        <span className={`vehicle-gps-chip control-${supportStatus}`}>
          {supportStatus === "allowed"
            ? "Pregatit"
            : supportStatus === "pending"
            ? "Partial"
            : "Indisponibil"}
        </span>
      </div>

      <p className="tools-subtitle" style={{ marginBottom: 12 }}>
        Butonul de mai jos trebuie executat in backend/gateway catre trackerul FMC130.
      </p>

      <div className="tool-form-actions">
        <button
          type="button"
          className="primary-btn"
          disabled={loading || busyType !== null}
          onClick={() => void run("pulse_dout1")}
        >
          {busyType === "pulse_dout1" ? "Se trimite..." : "Porneste masina (1 min)"}
        </button>

        <button
          type="button"
          className="danger-btn"
          disabled={loading || busyType !== null}
          onClick={() => void run("block_start")}
        >
          {busyType === "block_start" ? "Se trimite..." : "Blocheaza pornirea"}
        </button>
      </div>

      <div className="tool-detail-line">
        <strong>Tracker:</strong> {vehicle.tracker?.imei || "-"}
      </div>

      <div className="simple-list" style={{ marginTop: 12 }}>
        {commands.length === 0 ? (
          <div className="simple-list-item">
            <div className="simple-list-text">
              <div className="simple-list-label">Nu exista cereri trimise inca.</div>
              <div className="simple-list-subtitle">
                La apasare se creeaza un document in subcolectia commands.
              </div>
            </div>
          </div>
        ) : (
          commands.slice(0, 5).map((cmd) => (
            <div className="simple-list-item" key={cmd.id}>
              <div className="simple-list-text">
                <div className="simple-list-label">
                  {cmd.type === "pulse_dout1"
                    ? "Porneste masina"
                    : cmd.type === "block_start"
                    ? "Blocheaza pornirea"
                    : "Comanda"}{" "}
                  · {cmd.status}
                </div>
                <div className="simple-list-subtitle">
                  {new Date(cmd.requestedAt).toLocaleString("ro-RO")}
                  {" · "}
                  {cmd.requestedBy}
                  {cmd.durationSec ? ` · ${cmd.durationSec}s` : ""}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}