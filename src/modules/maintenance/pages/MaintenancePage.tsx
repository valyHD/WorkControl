import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import { createMaintenanceClient, subscribeMaintenanceClients } from "../services/maintenanceService";
import type { MaintenanceClient } from "../../../types/maintenance";

const initialClientForm = {
  name: "Razvan Banescu",
  email: "catalina.diaconescu@yahoo.com",
  address: "Str. Aurel Vlaicu nr. 91 Sector 2",
  liftNumber: "210869",
  expiryDate: "2025-07-04",
  maintenanceCompany: "ISL ELEVATOR SOLUTIONS SRL",
};

type AddressLiftGroup = {
  key: string;
  address: string;
  lifts: string[];
};

function buildAddressLiftGroups(client: MaintenanceClient): AddressLiftGroup[] {
  const mainAddress = client.address.trim();
  const allClientLifts = Array.from(
    new Set(((client.liftNumbers || []).length ? client.liftNumbers : client.liftNumber ? [client.liftNumber] : []).filter(Boolean))
  );
  const secondaryGroups = (client.addresses || []).map((address) => {
    const label = (address.label || address.street || "").trim();
    const lifts = Array.from(
      new Set((address.lifts || []).map((lift) => lift.serialNumber || lift.label || "").map((item) => item.trim()).filter(Boolean))
    );
    return {
      key: address.id,
      address: label,
      lifts,
    };
  });

  const secondaryLiftSet = new Set(secondaryGroups.flatMap((group) => group.lifts));
  const mainLifts = allClientLifts.filter((lift) => !secondaryLiftSet.has(lift));
  const groups: AddressLiftGroup[] = [];

  if (mainAddress || mainLifts.length) {
    groups.push({
      key: `${client.id}_main`,
      address: mainAddress || "Adresă principală",
      lifts: mainLifts,
    });
  }

  secondaryGroups.forEach((group) => {
    if (group.address || group.lifts.length) {
      groups.push({
        key: group.key,
        address: group.address || "Adresă secundară",
        lifts: group.lifts,
      });
    }
  });

  if (groups.length === 0) {
    groups.push({
      key: `${client.id}_empty`,
      address: "-",
      lifts: [],
    });
  }

  return groups;
}

export default function MaintenancePage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<MaintenanceClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [clientForm, setClientForm] = useState(initialClientForm);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeMaintenanceClients(
      (data) => {
        setClients(data);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setError("Nu am putut încărca baza de mentenanță.");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  const filteredClients = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return clients;
    }

    return clients.filter((client) => {
      const addresses = [
        client.address,
        ...(client.addresses || []).map((address) => address.label || address.street || ""),
      ].filter(Boolean);
      const lifts = [
        ...((client.liftNumbers || []).length ? client.liftNumbers : client.liftNumber ? [client.liftNumber] : []),
        ...(client.addresses || []).flatMap((address) =>
          (address.lifts || []).map((lift) => lift.serialNumber || lift.label || "")
        ),
      ].filter(Boolean);
      const fullText = `${client.name} ${addresses.join(" ")} ${lifts.join(" ")}`.toLowerCase();
      return fullText.includes(query);
    });
  }, [clients, searchText]);

  async function handleCreateClient() {
    setError("");
    setMessage("");

    if (!clientForm.name.trim()) {
      setError("Numele clientului este obligatoriu.");
      return;
    }

    if (!clientForm.address.trim()) {
      setError("Adresa este obligatorie.");
      return;
    }

    if (!clientForm.liftNumber.trim()) {
      setError("Numărul liftului este obligatoriu.");
      return;
    }

    try {
      setSubmitting(true);
      await createMaintenanceClient(clientForm);
      setClientForm(initialClientForm);
      setMessage("Clientul din mentenanță a fost salvat.");
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
          <div className="kpi-label">Rezultate filtrate</div>
          <div className="kpi-value">{filteredClients.length}</div>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Mentenanță · Formular client</h2>
        <p className="tools-subtitle">Completează capurile cerute, salvează și apoi vezi lista clienților mai jos.</p>

        {error && <div className="tool-message">{error}</div>}
        {message && <div className="tool-message success-message">{message}</div>}

        <div className="tool-form-grid" style={{ marginTop: 12 }}>
          <div className="tool-form-block">
            <label className="tool-form-label">Nume</label>
            <input
              className="tool-input"
              value={clientForm.name}
              onChange={(e) => setClientForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Ex: Razvan Banescu"
            />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">E-mail</label>
            <input
              className="tool-input"
              value={clientForm.email}
              onChange={(e) => setClientForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="contact@client.ro"
            />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Adresă</label>
            <input
              className="tool-input"
              value={clientForm.address}
              onChange={(e) => setClientForm((prev) => ({ ...prev, address: e.target.value }))}
              placeholder="Str. Aurel Vlaicu nr. 91 Sector 2"
            />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Lift</label>
            <input
              className="tool-input"
              value={clientForm.liftNumber}
              onChange={(e) => setClientForm((prev) => ({ ...prev, liftNumber: e.target.value }))}
              placeholder="210869"
            />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Exp. Date</label>
            <input
              className="tool-input"
              type="date"
              value={clientForm.expiryDate}
              onChange={(e) => setClientForm((prev) => ({ ...prev, expiryDate: e.target.value }))}
            />
          </div>
          <div className="tool-form-block">
            <label className="tool-form-label">Firma Mentenanță</label>
            <input
              className="tool-input"
              value={clientForm.maintenanceCompany}
              onChange={(e) => setClientForm((prev) => ({ ...prev, maintenanceCompany: e.target.value }))}
              placeholder="ISL ELEVATOR SOLUTIONS SRL"
            />
          </div>
        </div>

        <div className="tool-form-actions" style={{ marginTop: 14 }}>
          <button className="primary-btn" type="button" onClick={() => void handleCreateClient()} disabled={submitting}>
            {submitting ? "Se salvează..." : "Salvează client"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-subtitle">Clienți mentenanță</h3>

        <div className="tool-form-block" style={{ marginBottom: 12 }}>
          <label className="tool-form-label">Caută după nume, adresă sau lift</label>
          <input
            className="tool-input"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Ex: Razvan / Aurel Vlaicu / 210869"
          />
        </div>

        {loading ? (
          <p className="tools-subtitle">Se încarcă datele...</p>
        ) : filteredClients.length === 0 ? (
          <p className="tools-subtitle">Nu există clienți pentru căutarea curentă.</p>
        ) : (
          <div className="simple-list">
            {filteredClients.map((client) => {
              const addressLiftGroups = buildAddressLiftGroups(client);
              const displayEmails = Array.from(new Set(((client.emails || []).length ? client.emails : client.email ? [client.email] : []).filter(Boolean)));

              return (
                <button
                  key={client.id}
                  className="simple-list-item"
                  type="button"
                  onClick={() => navigate(`/maintenance/${client.id}`)}
                  style={{ width: "100%", textAlign: "left", cursor: "pointer" }}>
                  <div className="simple-list-text">
                    <div className="simple-list-label">{client.name || "Fără nume"}</div>
                    {addressLiftGroups.map((group) => (
                      <div key={group.key} style={{ marginTop: 8 }}>
                        <div className="simple-list-subtitle">Adresă: {group.address || "-"}</div>
                        {group.lifts.length ? (
                          group.lifts.map((lift) => (
                            <div key={`${group.key}_lift_${lift}`} className="simple-list-subtitle">
                              • Lift: {lift}
                            </div>
                          ))
                        ) : (
                          <div className="simple-list-subtitle">• Lift: -</div>
                        )}
                      </div>
                    ))}
                    <div className="simple-list-subtitle" style={{ marginTop: 8 }}>
                      E-mail:
                    </div>
                    {displayEmails.length ? (
                      displayEmails.map((email) => (
                        <div key={`${client.id}_email_${email}`} className="simple-list-subtitle">
                          • {email}
                        </div>
                      ))
                    ) : (
                      <div className="simple-list-subtitle">• -</div>
                    )}
                    <div className="simple-list-subtitle">Exp. Date: {client.expiryDate || "-"}</div>
                    <div className="simple-list-subtitle">Firma mentenanță: {client.maintenanceCompany || "-"}</div>
                  </div>
                  <span className="badge badge-blue">client</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
