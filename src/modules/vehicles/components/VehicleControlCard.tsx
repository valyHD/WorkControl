import { useMemo, useState } from "react";
import type { VehicleCommandItem, VehicleItem } from "../../../types/vehicle";

type Props = {
  vehicle: VehicleItem;
  commands: VehicleCommandItem[];
  onRequestCommand: (type: "pulse_dout1" | "block_start") => Promise<void>;
  loading: boolean;
};

type AuthMethod = "face" | "fingerprint" | "pin";

export default function VehicleControlCard({ vehicle, commands, onRequestCommand, loading }: Props) {
  const [busyType, setBusyType] = useState<"pulse_dout1" | "block_start" | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("face");
  const [authMessage, setAuthMessage] = useState("");

  const supportStatus = useMemo(() => {
    const protocol = (vehicle.tracker?.protocol || "").toLowerCase();
    if (!protocol) return "unavailable";
    if (protocol.includes("teltonika")) return "allowed";
    if (protocol.includes("codec_8e")) return "allowed";
    return "pending";
  }, [vehicle.tracker?.protocol]);

  async function verifyByFace(): Promise<boolean> {
    try {
      const FaceDetectorCtor = (window as any).FaceDetector;
      if (!FaceDetectorCtor || !navigator.mediaDevices?.getUserMedia) {
        setAuthMessage("Face unlock indisponibil pe acest browser. Folosește PIN sau amprentă.");
        return false;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      const track = stream.getVideoTracks()[0];
      const imageCapture = new (window as any).ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();
      const detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 1 });
      const faces = await detector.detect(bitmap);
      track.stop();

      if (faces.length > 0) {
        setAuthMessage("Fața a fost detectată. Pornim mașina.");
        return true;
      }

      setAuthMessage("Nu am detectat fața. Încearcă din nou sau folosește altă metodă.");
      return false;
    } catch (error) {
      console.error(error);
      setAuthMessage("Verificarea facială a eșuat. Poți continua cu PIN sau amprentă.");
      return false;
    }
  }

  async function verifyByFingerprint(): Promise<boolean> {
    try {
      if (!window.PublicKeyCredential || !navigator.credentials?.get) {
        setAuthMessage("Amprenta nu este disponibilă pe acest dispozitiv/browser.");
        return false;
      }

      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 60_000,
          userVerification: "required",
          allowCredentials: [],
        },
      } as CredentialRequestOptions);

      setAuthMessage("Autentificare biometrică confirmată.");
      return true;
    } catch (error) {
      console.error(error);
      setAuthMessage("Amprenta a fost anulată sau respinsă.");
      return false;
    }
  }

  function verifyByPin(): boolean {
    const storageKey = `wc_vehicle_pin_${vehicle.id}`;
    const savedPin = localStorage.getItem(storageKey) || "0000";

    if (pinValue.length < 4) {
      setAuthMessage("Introdu minim 4 cifre pentru PIN.");
      return false;
    }

    if (pinValue !== savedPin) {
      setAuthMessage("PIN invalid.");
      return false;
    }

    setAuthMessage("PIN validat.");
    return true;
  }

  async function requestWithAuth(type: "pulse_dout1" | "block_start") {
    let authorized = false;

    if (authMethod === "face") {
      authorized = await verifyByFace();
    }

    if (!authorized && authMethod === "fingerprint") {
      authorized = await verifyByFingerprint();
    }

    if (!authorized && authMethod === "pin") {
      authorized = verifyByPin();
    }

    if (!authorized) return;

    setShowAuthPrompt(false);
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
        Pentru comanda „Porneste masina” este nevoie de autentificare: față / amprentă / PIN.
      </p>

      <div className="tool-form-actions">
        <button
          type="button"
          className="primary-btn"
          disabled={loading || busyType !== null}
          onClick={() => setShowAuthPrompt(true)}
        >
          {busyType === "pulse_dout1" ? "Se trimite..." : "Porneste masina (1 min)"}
        </button>

        <button
          type="button"
          className="danger-btn"
          disabled={loading || busyType !== null}
          onClick={() => void requestWithAuth("block_start")}
        >
          {busyType === "block_start" ? "Se trimite..." : "Blocheaza pornirea"}
        </button>
      </div>

      {showAuthPrompt && (
        <div className="panel" style={{ marginTop: 12, borderStyle: "dashed" }}>
          <h5 className="panel-title" style={{ marginBottom: 8 }}>Verificare identitate</h5>
          <div className="tool-form-actions">
            <button type="button" className={`secondary-btn ${authMethod === "face" ? "active" : ""}`} onClick={() => setAuthMethod("face")}>
              Recunoaștere facială
            </button>
            <button type="button" className={`secondary-btn ${authMethod === "fingerprint" ? "active" : ""}`} onClick={() => setAuthMethod("fingerprint")}>
              Amprentă
            </button>
            <button type="button" className={`secondary-btn ${authMethod === "pin" ? "active" : ""}`} onClick={() => setAuthMethod("pin")}>
              PIN
            </button>
          </div>

          {authMethod === "pin" && (
            <div style={{ marginTop: 10 }}>
              <input
                className="tool-input"
                type="password"
                inputMode="numeric"
                placeholder="PIN (implicit 0000)"
                value={pinValue}
                onChange={(event) => setPinValue(event.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </div>
          )}

          {authMessage && (
            <p className="tools-subtitle" style={{ marginTop: 10 }}>{authMessage}</p>
          )}

          <div className="tool-form-actions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="primary-btn"
              onClick={() => void requestWithAuth("pulse_dout1")}
              disabled={loading || busyType !== null}
            >
              Confirmă și pornește
            </button>
            <button type="button" className="secondary-btn" onClick={() => setShowAuthPrompt(false)}>
              Renunță
            </button>
          </div>
        </div>
      )}

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
