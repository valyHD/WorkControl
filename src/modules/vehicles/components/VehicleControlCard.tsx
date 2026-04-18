import { useMemo, useState } from "react";
import type { VehicleCommandItem, VehicleItem } from "../../../types/vehicle";

type Props = {
  vehicle: VehicleItem;
  commands: VehicleCommandItem[];
  onRequestCommand: (type: "pulse_dout1" | "block_start") => Promise<void>;
  loading: boolean;
};

type AuthMethod = "face" | "fingerprint" | "pin";

type WebAuthnCredential = {
  id: string;
  createdAt: number;
};

function storagePinKey(vehicleId: string) {
  return `wc_vehicle_pin_${vehicleId}`;
}

function storageCredentialKey(vehicleId: string) {
  return `wc_vehicle_webauthn_${vehicleId}`;
}

function toBase64Url(bytes: ArrayBuffer): string {
  const uint8 = new Uint8Array(bytes);
  let str = "";
  uint8.forEach((item) => {
    str += String.fromCharCode(item);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);

  for (let i = 0; i < str.length; i += 1) {
    bytes[i] = str.charCodeAt(i);
  }

  return bytes;
}

export default function VehicleControlCard({ vehicle, commands, onRequestCommand, loading }: Props) {
  const [busyType, setBusyType] = useState<"pulse_dout1" | "block_start" | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("fingerprint");
  const [authMessage, setAuthMessage] = useState("");
  const [settingUp, setSettingUp] = useState(false);

  const supportStatus = useMemo(() => {
    const protocol = (vehicle.tracker?.protocol || "").toLowerCase();
    if (!protocol) return "unavailable";
    if (protocol.includes("teltonika")) return "allowed";
    if (protocol.includes("codec_8e")) return "allowed";
    return "pending";
  }, [vehicle.tracker?.protocol]);

  const hasPin = Boolean(localStorage.getItem(storagePinKey(vehicle.id)));

  function readStoredCredential(): WebAuthnCredential | null {
    const raw = localStorage.getItem(storageCredentialKey(vehicle.id));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as WebAuthnCredential;
      if (!parsed?.id) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async function verifyWithDeviceBiometric(): Promise<boolean> {
    try {
      if (!window.PublicKeyCredential || !navigator.credentials?.get) {
        setAuthMessage("Biometria din blocarea ecranului nu e disponibila pe acest dispozitiv/browser.");
        return false;
      }

      const stored = readStoredCredential();
      if (!stored?.id) {
        setAuthMessage("Nu exista biometrie configurata pentru aceasta masina. Apasa " +
          "«Seteaza biometrie din telefon». ");
        return false;
      }

      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 60_000,
          userVerification: "required",
          allowCredentials: [
            {
              id: fromBase64Url(stored.id),
              type: "public-key",
              transports: ["internal"],
            },
          ],
        },
      } as CredentialRequestOptions);

      setAuthMessage("Autentificare biometrica reusita.");
      return true;
    } catch (error) {
      console.error(error);
      setAuthMessage("Biometria a fost anulata sau respinsa.");
      return false;
    }
  }

  async function setupBiometric(): Promise<void> {
    try {
      setSettingUp(true);

      if (!window.PublicKeyCredential || !navigator.credentials?.create) {
        setAuthMessage("Acest browser nu permite configurarea biometriei WebAuthn.");
        return;
      }

      const userIdSeed = `${vehicle.id}_${Date.now()}`;
      const userId = new TextEncoder().encode(userIdSeed.slice(0, 32));

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: "WorkControl Vehicle Unlock" },
          user: {
            id: userId,
            name: `vehicle-${vehicle.id}`,
            displayName: `Vehicle ${vehicle.plateNumber}`,
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          timeout: 60_000,
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "preferred",
            userVerification: "required",
          },
          attestation: "none",
        },
      } as CredentialCreationOptions)) as PublicKeyCredential | null;

      if (!credential?.rawId) {
        setAuthMessage("Configurarea biometriei nu a returnat credential valid.");
        return;
      }

      const payload: WebAuthnCredential = {
        id: toBase64Url(credential.rawId),
        createdAt: Date.now(),
      };

      localStorage.setItem(storageCredentialKey(vehicle.id), JSON.stringify(payload));
      setAuthMessage("Biometria telefonului e configurata. Acum poti porni masina cu Face/Amprenta.");
    } catch (error) {
      console.error(error);
      setAuthMessage("Nu am putut configura biometria. Verifica blocarea ecranului pe telefon.");
    } finally {
      setSettingUp(false);
    }
  }

  function savePin(): void {
    if (newPin.length < 4) {
      setAuthMessage("PIN-ul trebuie sa aiba minim 4 cifre.");
      return;
    }

    if (newPin !== confirmPin) {
      setAuthMessage("PIN-ul confirmat nu coincide.");
      return;
    }

    localStorage.setItem(storagePinKey(vehicle.id), newPin);
    setNewPin("");
    setConfirmPin("");
    setAuthMessage("PIN salvat cu succes pentru aceasta masina.");
  }

  function verifyByPin(): boolean {
    const savedPin = localStorage.getItem(storagePinKey(vehicle.id));

    if (!savedPin) {
      setAuthMessage("Nu exista PIN setat. Configureaza PIN-ul inainte sa pornesti masina.");
      return false;
    }

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

  async function requestWithAuth(
    type: "pulse_dout1" | "block_start",
    methodOverride?: AuthMethod
  ): Promise<boolean> {
    const selectedMethod = methodOverride ?? authMethod;
    let authorized = false;

    if (selectedMethod === "face" || selectedMethod === "fingerprint") {
      authorized = await verifyWithDeviceBiometric();
    }

    if (!authorized && selectedMethod === "pin") {
      authorized = verifyByPin();
    }

    if (!authorized) return false;

    setShowAuthPrompt(false);
    setBusyType(type);
    try {
      await onRequestCommand(type);
      return true;
    } finally {
      setBusyType(null);
    }
  }

  async function handleQuickStart(): Promise<void> {
    setAuthMethod("fingerprint");
    const started = await requestWithAuth("pulse_dout1", "fingerprint");
    if (!started) {
      setShowAuthPrompt(true);
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
        Pentru „Porneste masina”, aplicatia cere direct amprenta telefonului (fara pas de confirmare).
      </p>

      <div className="tool-form-actions">
        <button
          type="button"
          className="primary-btn"
          disabled={loading || busyType !== null}
          onClick={() => void handleQuickStart()}
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
              Face ID telefon
            </button>
            <button type="button" className={`secondary-btn ${authMethod === "fingerprint" ? "active" : ""}`} onClick={() => setAuthMethod("fingerprint")}>
              Amprenta telefon
            </button>
            <button type="button" className={`secondary-btn ${authMethod === "pin" ? "active" : ""}`} onClick={() => setAuthMethod("pin")}>
              PIN masina
            </button>
          </div>

          {(authMethod === "face" || authMethod === "fingerprint") && (
            <div className="tool-form-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="secondary-btn"
                disabled={settingUp}
                onClick={() => void setupBiometric()}
              >
                {settingUp ? "Configuram..." : "Seteaza biometrie din telefon"}
              </button>
            </div>
          )}

          {authMethod === "pin" && (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <input
                className="tool-input"
                type="password"
                inputMode="numeric"
                placeholder={hasPin ? "PIN existent" : "Seteaza PIN nou"}
                value={pinValue}
                onChange={(event) => setPinValue(event.target.value.replace(/\D/g, "").slice(0, 8))}
              />

              <div className="tool-form-actions" style={{ gap: 8 }}>
                <input
                  className="tool-input"
                  type="password"
                  inputMode="numeric"
                  placeholder="PIN nou"
                  value={newPin}
                  onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                />
                <input
                  className="tool-input"
                  type="password"
                  inputMode="numeric"
                  placeholder="Confirma PIN"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                />
                <button type="button" className="secondary-btn" onClick={savePin}>
                  Salveaza PIN
                </button>
              </div>
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
              Confirma si porneste
            </button>
            <button type="button" className="secondary-btn" onClick={() => setShowAuthPrompt(false)}>
              Renunta
            </button>
          </div>
        </div>
      )}

      <div className="tool-detail-line">
        <strong>Tracker:</strong> {vehicle.tracker?.imei || "-"}
      </div>

      <details className="vehicle-control-history" open={false}>
        <summary>Istoric comenzi DOUT1 ({commands.length})</summary>
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
            commands.slice(0, 15).map((cmd) => (
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
      </details>
    </div>
  );
}
