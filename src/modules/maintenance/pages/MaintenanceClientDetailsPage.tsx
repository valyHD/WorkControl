import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import type { ClientAddress, MaintenanceClient } from "../../../types/maintenance";
import { getMaintenanceClientById, updateMaintenanceClient } from "../services/maintenanceService";

export default function MaintenanceClientDetailsPage() {
  const { role } = useAuth();
  const { clientId = "" } = useParams();
  const [client, setClient] = useState<MaintenanceClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newLiftNumber, setNewLiftNumber] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newAddressLifts, setNewAddressLifts] = useState("");

  useEffect(() => {
    async function loadClient() {
      setLoading(true);
      setError("");
      try {
        const result = await getMaintenanceClientById(clientId);
        if (!result) {
          setError("Clientul nu a fost găsit.");
          setClient(null);
          return;
        }

        setClient(result);
      } catch (err) {
        console.error(err);
        setError("Nu am putut încărca detaliile clientului.");
      } finally {
        setLoading(false);
      }
    }

    if (clientId) {
      void loadClient();
    }
  }, [clientId]);

  const displayEmails = useMemo(() => {
    if (!client) {
      return [];
    }
    const list = client.emails?.length ? client.emails : client.email ? [client.email] : [];
    return Array.from(new Set(list));
  }, [client]);

  const displayLifts = useMemo(() => {
    if (!client) {
      return [];
    }
    const list = client.liftNumbers?.length ? client.liftNumbers : client.liftNumber ? [client.liftNumber] : [];
    return Array.from(new Set(list));
  }, [client]);

  async function savePatch(next: Partial<MaintenanceClient>, successText: string) {
    if (!client) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await updateMaintenanceClient(client.id, next);
      const refreshed = await getMaintenanceClientById(client.id);
      if (refreshed) {
        setClient(refreshed);
      }
      setMessage(successText);
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva modificarea.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddEmail() {
    const value = newEmail.trim();
    if (!value || !client) {
      return;
    }

    const nextEmails = Array.from(new Set([...(client.emails || []), value]));
    await savePatch({ email: nextEmails[0] || "", emails: nextEmails }, "E-mailul a fost adăugat.");
    setNewEmail("");
  }

  async function handleAddLift() {
    const value = newLiftNumber.trim();
    if (!value || !client) {
      return;
    }

    const nextLifts = Array.from(new Set([...(client.liftNumbers || []), value]));
    await savePatch({ liftNumber: nextLifts[0] || "", liftNumbers: nextLifts }, "Liftul a fost adăugat.");
    setNewLiftNumber("");
  }

  async function handleAddAddress() {
    if (!client || !newAddress.trim()) {
      setError("Adresa nouă este obligatorie.");
      return;
    }

    const liftItems = newAddressLifts
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const addressEntry: ClientAddress = {
      id: `address_${Date.now()}`,
      label: newAddress.trim(),
      city: "",
      street: newAddress.trim(),
      postalCode: "",
      contactPerson: "",
      contactPhone: "",
      lifts: liftItems.map((item, index) => ({
        id: `lift_${Date.now()}_${index}`,
        label: `Lift ${item}`,
        serialNumber: item,
        manufacturer: "",
        installYear: "",
        maintenanceCompany: client.maintenanceCompany || "",
        maintenanceEmail: client.email || "",
        inspectionExpiryDate: client.expiryDate || "",
        notes: "",
      })),
    };

    const extraLifts = liftItems.length ? Array.from(new Set([...(client.liftNumbers || []), ...liftItems])) : client.liftNumbers;
    await savePatch(
      {
        addresses: [...(client.addresses || []), addressEntry],
        ...(extraLifts?.length ? { liftNumbers: extraLifts, liftNumber: extraLifts[0] || "" } : {}),
      },
      "Adresa a fost adăugată."
    );

    setNewAddress("");
    setNewAddressLifts("");
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div className="placeholder-page">
        <h2>Acces restricționat</h2>
        <p>Doar adminul sau managerul pot gestiona baza de mentenanță.</p>
      </div>
    );
  }

  if (loading) {
    return <p className="tools-subtitle">Se încarcă detaliile clientului...</p>;
  }

  return (
    <section className="page-section">
      <div className="panel">
        <h2 className="panel-title">Detalii client mentenanță</h2>
        <p className="tools-subtitle">
          <Link to="/maintenance">← Înapoi la lista clienților</Link>
        </p>

        {error && <div className="tool-message">{error}</div>}
        {message && <div className="tool-message success-message">{message}</div>}

        {client ? (
          <>
            <div className="simple-list" style={{ marginBottom: 16 }}>
              <div className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{client.name || "Fără nume"}</div>
                  <div className="simple-list-subtitle">Adresă principală: {client.address || "-"}</div>
                  <div className="simple-list-subtitle">Firma mentenanță: {client.maintenanceCompany || "-"}</div>
                  <div className="simple-list-subtitle">Exp. Date: {client.expiryDate || "-"}</div>
                </div>
              </div>
            </div>

            <div className="tool-form-grid">
              <div className="tool-form-block">
                <label className="tool-form-label">Adaugă e-mail nou</label>
                <input
                  className="tool-input"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="nou@client.ro"
                />
                <button className="secondary-btn" type="button" onClick={() => void handleAddEmail()} disabled={saving}>
                  Adaugă e-mail
                </button>
              </div>

              <div className="tool-form-block">
                <label className="tool-form-label">Adaugă număr lift</label>
                <input
                  className="tool-input"
                  value={newLiftNumber}
                  onChange={(e) => setNewLiftNumber(e.target.value)}
                  placeholder="210870"
                />
                <button className="secondary-btn" type="button" onClick={() => void handleAddLift()} disabled={saving}>
                  Adaugă lift
                </button>
              </div>

              <div className="tool-form-block" style={{ gridColumn: "1 / -1" }}>
                <label className="tool-form-label">Adaugă adresă nouă</label>
                <input
                  className="tool-input"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="Str. Exemplu nr. 10, București"
                />
                <label className="tool-form-label" style={{ marginTop: 8 }}>
                  Lifturi la această adresă (separate prin virgulă)
                </label>
                <input
                  className="tool-input"
                  value={newAddressLifts}
                  onChange={(e) => setNewAddressLifts(e.target.value)}
                  placeholder="210871, 210872"
                />
                <button className="secondary-btn" type="button" onClick={() => void handleAddAddress()} disabled={saving}>
                  Adaugă adresă cu lifturi
                </button>
              </div>
            </div>

            <div className="panel" style={{ marginTop: 16 }}>
              <h3 className="panel-subtitle">E-mailuri</h3>
              <p className="tools-subtitle">{displayEmails.length ? displayEmails.join(" · ") : "-"}</p>
              <h3 className="panel-subtitle" style={{ marginTop: 12 }}>
                Lifturi
              </h3>
              <p className="tools-subtitle">{displayLifts.length ? displayLifts.join(" · ") : "-"}</p>
            </div>

            <div className="panel" style={{ marginTop: 16 }}>
              <h3 className="panel-subtitle">Adrese secundare și lifturi</h3>
              {client.addresses?.length ? (
                <div className="simple-list">
                  {client.addresses.map((address) => (
                    <div className="simple-list-item" key={address.id}>
                      <div className="simple-list-text">
                        <div className="simple-list-label">{address.label || address.street || "Adresă"}</div>
                        <div className="simple-list-subtitle">
                          Lifturi: {address.lifts?.map((lift) => lift.serialNumber || lift.label).filter(Boolean).join(", ") || "-"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tools-subtitle">Nu există adrese secundare.</p>
              )}
            </div>
          </>
        ) : (
          <p className="tools-subtitle">Clientul nu există.</p>
        )}
      </div>
    </section>
  );
}
