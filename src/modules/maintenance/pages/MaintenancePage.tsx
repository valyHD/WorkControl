import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../providers/AuthProvider";
import { createMaintenanceClient, getMaintenanceClients } from "../services/maintenanceService";
import type { MaintenanceClient } from "../../../types/maintenance";

const initialClientForm = {
  name: "",
  email: "",
  phone: "",
  cif: "",
};

export default function MaintenancePage() {
  const { role } = useAuth();
  const [clients, setClients] = useState<MaintenanceClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clientForm, setClientForm] = useState(initialClientForm);

  async function load() {
    setLoading(true);
    try {
      const data = await getMaintenanceClients();
      setClients(data);
    } catch (err) {
      console.error(err);
      setError("Nu am putut încărca baza de mentenanță.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const totals = useMemo(() => {
    const addresses = clients.reduce((sum, client) => sum + client.addresses.length, 0);
    const lifts = clients.reduce(
      (sum, client) => sum + client.addresses.reduce((addressSum, address) => addressSum + address.lifts.length, 0),
      0
    );

    return { addresses, lifts };
  }, [clients]);

  async function handleCreateClient() {
    setError("");
    setMessage("");

    if (!clientForm.name.trim()) {
      setError("Numele clientului este obligatoriu.");
      return;
    }

    try {
      setSubmitting(true);
      await createMaintenanceClient(clientForm);
      setClientForm(initialClientForm);
      setMessage("Clientul a fost adăugat. Următorul pas: adăugare adrese și lifturi.");
      await load();
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva clientul.");
    } finally {
      setSubmitting(false);
    }
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div className="placeholder-page">
        <h2>Acces restricționat</h2>
        <p>Doar adminul sau managerul pot gestiona baza de mentenanță.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Clienți mentenanță</div>
          <div className="kpi-value">{clients.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Adrese în sistem</div>
          <div className="kpi-value">{totals.addresses}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Lifturi în sistem</div>
          <div className="kpi-value">{totals.lifts}</div>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Mentenanță · Bază clienți</h2>
        <p className="tools-subtitle">
          Pregătire pentru baza de date client → adrese → lifturi. De aici vom genera PDF-uri pe client.
        </p>

        {error && <div className="tool-message">{error}</div>}
        {message && <div className="tool-message success-message">{message}</div>}

        <div className="tool-form-grid" style={{ marginTop: 12 }}>
          <div className="tool-form-block">
            <label className="tool-form-label">Nume client</label>
            <input
              className="tool-input"
              value={clientForm.name}
              onChange={(e) => setClientForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Ex: Asociația Magnolia"
            />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Email</label>
            <input
              className="tool-input"
              value={clientForm.email}
              onChange={(e) => setClientForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="contact@client.ro"
            />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Telefon</label>
            <input
              className="tool-input"
              value={clientForm.phone}
              onChange={(e) => setClientForm((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="07xx xxx xxx"
            />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">CIF / CUI</label>
            <input
              className="tool-input"
              value={clientForm.cif}
              onChange={(e) => setClientForm((prev) => ({ ...prev, cif: e.target.value }))}
              placeholder="RO1234567"
            />
          </div>
        </div>

        <div className="tool-form-actions" style={{ marginTop: 14 }}>
          <button className="primary-btn" type="button" onClick={() => void handleCreateClient()} disabled={submitting}>
            {submitting ? "Se salvează..." : "Adaugă client"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-subtitle">Clienți existenți</h3>

        {loading ? (
          <p className="tools-subtitle">Se încarcă datele...</p>
        ) : clients.length === 0 ? (
          <p className="tools-subtitle">Nu există clienți. Adaugă primul client pentru a porni baza de date.</p>
        ) : (
          <div className="simple-list">
            {clients.map((client) => (
              <div key={client.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{client.name}</div>
                  <div className="simple-list-subtitle">
                    {client.email || "fără email"} · {client.phone || "fără telefon"} · {client.cif || "fără CIF"}
                  </div>
                  <div className="simple-list-subtitle">
                    Adrese: {client.addresses.length} · Lifturi: {client.addresses.reduce((sum, address) => sum + address.lifts.length, 0)}
                  </div>
                </div>
                <span className="badge badge-blue">pregătit</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
