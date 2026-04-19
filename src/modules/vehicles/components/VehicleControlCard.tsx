import { useCallback, useMemo, useRef, useState } from "react";
import { ShieldAlert, ShieldCheck, Zap, Lock, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import type { VehicleCommandItem, VehicleItem } from "../../../types/vehicle";

type Props = {
  vehicle: VehicleItem;
  commands: VehicleCommandItem[];
  onRequestCommand: (type: "pulse_dout1" | "block_start") => Promise<void>;
  loading: boolean;
};

type AuthMethod = "face" | "fingerprint" | "pin";
type CommandState = "idle" | "auth" | "sending" | "success" | "error";

type WebAuthnCredential = { id: string; createdAt: number };

function storagePinKey(vid: string) { return `wc_vehicle_pin_${vid}`; }
function storageCredentialKey(vid: string) { return `wc_vehicle_webauthn_${vid}`; }

function toBase64Url(bytes: ArrayBuffer): string {
  let str = "";
  new Uint8Array(bytes).forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  const norm = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const str = atob(pad);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

function readStoredCredential(vehicleId: string): WebAuthnCredential | null {
  try {
    const raw = localStorage.getItem(storageCredentialKey(vehicleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WebAuthnCredential;
    return parsed?.id ? parsed : null;
  } catch { return null; }
}

export default function VehicleControlCard({ vehicle, commands, onRequestCommand, loading }: Props) {
  const [commandState, setCommandState] = useState<CommandState>("idle");
  const [pendingType, setPendingType] = useState<"pulse_dout1" | "block_start" | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("fingerprint");
  const [authMessage, setAuthMessage] = useState("");
  const [settingUp, setSettingUp] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [feedbackType, setFeedbackType] = useState<"success" | "error" | "info">("info");
  const inFlightRef = useRef(false);

  const supportStatus = useMemo(() => {
    const proto = (vehicle.tracker?.protocol || "").toLowerCase();
    if (!proto) return "unavailable";
    if (proto.includes("teltonika") || proto.includes("codec_8e")) return "allowed";
    return "pending";
  }, [vehicle.tracker?.protocol]);

  const hasPin = Boolean(localStorage.getItem(storagePinKey(vehicle.id)));
  const hasCredential = Boolean(readStoredCredential(vehicle.id));
  const isBusy = commandState === "sending" || commandState === "auth" || loading;

  function showFeedback(msg: string, type: "success" | "error" | "info" = "info") {
    setFeedbackMsg(msg); setFeedbackType(type);
  }

  async function verifyBiometric(): Promise<boolean> {
    try {
      if (!window.PublicKeyCredential || !navigator.credentials?.get) {
        setAuthMessage("Biometria nu e disponibila pe acest dispozitiv."); return false;
      }
      const stored = readStoredCredential(vehicle.id);
      if (!stored?.id) {
        setAuthMessage("Nu exista biometrie configurata. Seteaza mai jos."); return false;
      }
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 60_000,
          userVerification: "required",
          allowCredentials: [{ id: fromBase64Url(stored.id), type: "public-key", transports: ["internal"] }],
        },
      } as CredentialRequestOptions);
      return true;
    } catch (err) {
      console.error("[VehicleControlCard][biometric]", err);
      setAuthMessage("Biometria a fost anulata sau respinsa."); return false;
    }
  }

  async function setupBiometric(): Promise<void> {
    if (settingUp) return;
    try {
      setSettingUp(true); setAuthMessage("");
      if (!window.PublicKeyCredential || !navigator.credentials?.create) {
        setAuthMessage("Browser-ul nu suporta WebAuthn."); return;
      }
      const userId = new TextEncoder().encode(`${vehicle.id}_${Date.now()}`.slice(0, 32));
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: "WorkControl" },
          user: { id: userId, name: `vehicle-${vehicle.id}`, displayName: vehicle.plateNumber },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          timeout: 60_000,
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
          attestation: "none",
        },
      } as CredentialCreationOptions)) as PublicKeyCredential | null;
      if (!cred?.rawId) { setAuthMessage("Configurarea nu a returnat credential valid."); return; }
      localStorage.setItem(storageCredentialKey(vehicle.id), JSON.stringify({ id: toBase64Url(cred.rawId), createdAt: Date.now() }));
      setAuthMessage("Biometria e configurata!");
    } catch (err) {
      console.error("[VehicleControlCard][setupBiometric]", err);
      setAuthMessage("Nu am putut configura biometria.");
    } finally { setSettingUp(false); }
  }

  function savePin(): void {
    if (newPin.length < 4) { setAuthMessage("PIN-ul trebuie sa aiba minim 4 cifre."); return; }
    if (newPin !== confirmPin) { setAuthMessage("PIN-urile nu coincid."); return; }
    localStorage.setItem(storagePinKey(vehicle.id), newPin);
    setNewPin(""); setConfirmPin("");
    setAuthMessage("PIN salvat cu succes.");
  }

  function verifyPin(): boolean {
    const saved = localStorage.getItem(storagePinKey(vehicle.id));
    if (!saved) { setAuthMessage("Nu exista PIN setat."); return false; }
    if (pinValue.length < 4) { setAuthMessage("Introdu minim 4 cifre."); return false; }
    if (pinValue !== saved) { setAuthMessage("PIN invalid."); return false; }
    return true;
  }

  const executeCommand = useCallback(async (type: "pulse_dout1" | "block_start"): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setCommandState("sending");
    setFeedbackMsg("");
    try {
      await onRequestCommand(type);
      setCommandState("success");
      showFeedback(
        type === "pulse_dout1" ? "Comanda de pornire trimisa cu succes." : "Blocare pornire activata.",
        "success"
      );
      window.setTimeout(() => setCommandState("idle"), 3000);
    } catch (err) {
      console.error("[VehicleControlCard][executeCommand]", err);
      setCommandState("error");
      showFeedback(err instanceof Error ? err.message : "Nu am putut trimite comanda. Incearca din nou.", "error");
      window.setTimeout(() => { setCommandState("idle"); setFeedbackMsg(""); }, 4000);
    } finally {
      inFlightRef.current = false;
    }
  }, [onRequestCommand]);

  async function handleStart(): Promise<void> {
    if (isBusy) return;
    setPendingType("pulse_dout1");
    setCommandState("auth"); setAuthMessage("");
    const ok = await verifyBiometric();
    if (!ok) { setCommandState("idle"); setPendingType("pulse_dout1"); setShowAuth(true); return; }
    setShowAuth(false);
    await executeCommand("pulse_dout1");
  }

  async function handleBlock(): Promise<void> {
    if (isBusy) return;
    setPendingType("block_start");
    setCommandState("auth");
    const ok = await verifyBiometric();
    if (!ok) { setCommandState("idle"); setPendingType("block_start"); setShowAuth(true); return; }
    setShowAuth(false);
    await executeCommand("block_start");
  }

  async function handleConfirm(): Promise<void> {
    if (!pendingType || isBusy) return;
    setAuthMessage("");
    let ok = false;
    if (authMethod === "face" || authMethod === "fingerprint") ok = await verifyBiometric();
    else if (authMethod === "pin") ok = verifyPin();
    if (!ok) return;
    setShowAuth(false); setPinValue(""); setPendingType(null);
    await executeCommand(pendingType);
  }

  const supportChipClass =
    supportStatus === "allowed" ? "vehicle-gps-chip is-online"
    : supportStatus === "pending" ? "vehicle-gps-chip is-recent"
    : "vehicle-gps-chip is-offline";

  return (
    <div className="panel vehicle-control-card">
      <div className="vehicle-control-card__header">
        <div>
          <h4 className="panel-title" style={{ marginBottom: 2 }}>Control vehicul</h4>
          <p className="tools-subtitle" style={{ margin: 0, fontSize: 12 }}>Releu DOUT1 · biometrie sau PIN</p>
        </div>
        <span className={supportChipClass}>
          {supportStatus === "allowed" ? "Pregatit" : supportStatus === "pending" ? "Partial" : "Indisponibil"}
        </span>
      </div>

      {feedbackMsg && (
        <div className={`vc-feedback vc-feedback--${feedbackType}`} style={{ marginBottom: 12 }}>
          {feedbackType === "success" ? <CheckCircle2 size={14} /> : feedbackType === "error" ? <AlertCircle size={14} /> : null}
          {feedbackMsg}
        </div>
      )}

      <div className="tool-form-actions">
        <button
          type="button" className="primary-btn"
          disabled={isBusy || supportStatus === "unavailable"}
          onClick={() => void handleStart()}
          style={{ flex: 1, justifyContent: "center", gap: 8 }}
        >
          {commandState === "sending" && pendingType !== "block_start" ? (
            <><Clock size={14} className="spin-icon" /> Se trimite...</>
          ) : commandState === "auth" ? (
            <><ShieldCheck size={14} /> Autentificare...</>
          ) : (
            <><Zap size={14} /> Porneste (1 min)</>
          )}
        </button>
        <button
          type="button" className="danger-btn"
          disabled={isBusy || supportStatus === "unavailable"}
          onClick={() => void handleBlock()}
          style={{ flex: 1, justifyContent: "center", gap: 8 }}
        >
          {commandState === "sending" && pendingType === "block_start" ? (
            <><Clock size={14} className="spin-icon" /> Se trimite...</>
          ) : (
            <><Lock size={14} /> Blocheaza pornirea</>
          )}
        </button>
      </div>

      {supportStatus === "unavailable" && (
        <div className="vc-feedback vc-feedback--error" style={{ marginTop: 8 }}>
          <AlertCircle size={14} />
          Tracker-ul nu suporta comenzi remote. Verifica protocolul.
        </div>
      )}

      {showAuth && (
        <div className="panel vc-auth-panel">
          <h5 className="panel-title" style={{ marginBottom: 10 }}>
            <ShieldAlert size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Verificare identitate
          </h5>
          <div className="tool-form-actions" style={{ marginBottom: 10 }}>
            {(["fingerprint", "face", "pin"] as AuthMethod[]).map((m) => (
              <button key={m} type="button" className={`secondary-btn ${authMethod === m ? "active" : ""}`}
                onClick={() => { setAuthMethod(m); setAuthMessage(""); }} style={{ flex: 1 }}>
                {m === "fingerprint" ? "Amprenta" : m === "face" ? "Face ID" : "PIN"}
              </button>
            ))}
          </div>

          {(authMethod === "face" || authMethod === "fingerprint") && (
            <button type="button" className="secondary-btn" disabled={settingUp}
              onClick={() => void setupBiometric()} style={{ width: "100%", marginBottom: 8 }}>
              {settingUp ? "Se configureaza..." : hasCredential ? "Reconfigureaza biometria" : "Seteaza biometria telefonului"}
            </button>
          )}

          {authMethod === "pin" && (
            <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
              <input className="tool-input" type="password" inputMode="numeric"
                placeholder={hasPin ? "Introdu PIN-ul existent" : "Seteaza PIN nou (min 4 cifre)"}
                value={pinValue} autoComplete="off"
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 8))} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
                <input className="tool-input" type="password" inputMode="numeric" placeholder="PIN nou"
                  value={newPin} autoComplete="new-password"
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))} />
                <input className="tool-input" type="password" inputMode="numeric" placeholder="Confirma PIN"
                  value={confirmPin} autoComplete="new-password"
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))} />
                <button type="button" className="secondary-btn" onClick={savePin}>Salveaza</button>
              </div>
            </div>
          )}

          {authMessage && (
            <p className="tools-subtitle" style={{
              marginBottom: 10, fontSize: 12,
              color: authMessage.includes("succes") || authMessage.includes("configurat") ? "var(--success)" : "var(--danger)",
            }}>{authMessage}</p>
          )}

          <div className="tool-form-actions">
            <button type="button" className="primary-btn" onClick={() => void handleConfirm()} disabled={isBusy} style={{ flex: 1 }}>
              {isBusy ? "Se proceseaza..." : "Confirma si executa"}
            </button>
            <button type="button" className="secondary-btn"
              onClick={() => { setShowAuth(false); setAuthMessage(""); setPinValue(""); setPendingType(null); setCommandState("idle"); }}>
              Renunta
            </button>
          </div>
        </div>
      )}

      <div className="tool-detail-line" style={{ marginTop: 12, fontSize: 13 }}>
        <strong>IMEI:</strong> {vehicle.tracker?.imei || "-"}
        {vehicle.tracker?.protocol && (
          <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>· {vehicle.tracker.protocol}</span>
        )}
      </div>

      <details className="vehicle-control-history" style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-soft)", userSelect: "none" }}>
          Istoric comenzi ({commands.length})
        </summary>
        <div className="simple-list" style={{ marginTop: 10 }}>
          {commands.length === 0 ? (
            <div className="simple-list-item">
              <div className="simple-list-label" style={{ color: "var(--text-muted)" }}>Nu exista comenzi trimise inca.</div>
            </div>
          ) : commands.slice(0, 15).map((cmd) => {
            const statusColor = cmd.status === "completed" ? "var(--success)" : cmd.status === "failed" ? "var(--danger)" : "var(--warning)";
            return (
              <div className="simple-list-item" key={cmd.id}>
                <div className="simple-list-text">
                  <div className="simple-list-label">
                    {cmd.type === "pulse_dout1" ? "Porneste masina" : cmd.type === "block_start" ? "Blocheaza pornirea" : "Comanda"}{" "}
                    <span style={{ color: statusColor, fontWeight: 700 }}>· {cmd.status}</span>
                  </div>
                  <div className="simple-list-subtitle">
                    {new Date(cmd.requestedAt).toLocaleString("ro-RO")} · {cmd.requestedBy}
                    {cmd.durationSec ? ` · ${cmd.durationSec}s` : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
