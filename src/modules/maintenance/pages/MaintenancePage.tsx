import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import {
  createMaintenanceClient,
  saveMaintenanceCompanyBranding,
  subscribeMaintenanceClients,
  subscribeMaintenanceCompanyBranding,
  uploadMaintenanceBrandingAsset,
} from "../services/maintenanceService";
import { buildMaintenancePdfBlob, resolveBrandingForCompany, type ReportType } from "../services/maintenancePdf";
import { generateReportId, reviewStandardText } from "../utils/reportUtils";
import type { MaintenanceClient, MaintenanceCompanyBranding } from "../../../types/maintenance";

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
  const [brandingItems, setBrandingItems] = useState<MaintenanceCompanyBranding[]>([]);
  const [brandingCompanyName, setBrandingCompanyName] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [stampFile, setStampFile] = useState<File | null>(null);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingMessage, setBrandingMessage] = useState("");
  const [brandingError, setBrandingError] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [reportAddress, setReportAddress] = useState("");
  const [reportLift, setReportLift] = useState("");
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportError, setReportError] = useState("");

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

  useEffect(() => {
    const unsubscribe = subscribeMaintenanceCompanyBranding(
      (items) => {
        setBrandingItems(items);
      },
      (err) => {
        console.error(err);
        setBrandingError("Nu am putut încărca branding-ul companiilor.");
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

  async function handleSaveBranding() {
    const companyName = brandingCompanyName.trim();
    if (!companyName) {
      setBrandingError("Numele firmei este obligatoriu pentru branding.");
      return;
    }

    if (!logoFile && !stampFile) {
      setBrandingError("Încarcă cel puțin un fișier: logo sau ștampilă.");
      return;
    }

    try {
      setBrandingSaving(true);
      setBrandingError("");
      setBrandingMessage("");

      const payload: {
        companyName: string;
        logoUrl?: string;
        stampUrl?: string;
        logoPath?: string;
        stampPath?: string;
      } = { companyName };

      if (logoFile) {
        const uploadedLogo = await uploadMaintenanceBrandingAsset({
          companyName,
          assetType: "logo",
          file: logoFile,
        });
        payload.logoUrl = uploadedLogo.url;
        payload.logoPath = uploadedLogo.path;
      }

      if (stampFile) {
        const uploadedStamp = await uploadMaintenanceBrandingAsset({
          companyName,
          assetType: "stamp",
          file: stampFile,
        });
        payload.stampUrl = uploadedStamp.url;
        payload.stampPath = uploadedStamp.path;
      }

      await saveMaintenanceCompanyBranding(payload);

      setBrandingMessage(
        `Branding salvat pentru ${companyName}. Raportul PDF va folosi automat logo-ul și ștampila acestei firme.`
      );
      setLogoFile(null);
      setStampFile(null);
    } catch (err) {
      console.error(err);
      setBrandingError("Nu am putut salva branding-ul companiei.");
    } finally {
      setBrandingSaving(false);
    }
  }

  function handleLoadBrandingCompany(companyName: string) {
    setBrandingCompanyName(companyName);
    setBrandingError("");
    setBrandingMessage(
      `Ai selectat ${companyName}. Poți încărca logo sau ștampilă noi pentru a le actualiza.`
    );
  }


  const reportSuggestions = useMemo(() => {
    const query = reportSearch.trim().toLowerCase();
    if (query.length < 2) {
      return [] as MaintenanceClient[];
    }

    return clients
      .filter((client) => {
        const addresses = [
          client.address,
          ...(client.addresses || []).map((address) => address.label || address.street || ""),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const lifts = [
          ...((client.liftNumbers || []).length
            ? client.liftNumbers
            : client.liftNumber
              ? [client.liftNumber]
              : []),
          ...(client.addresses || []).flatMap((address) =>
            (address.lifts || []).map((lift) => lift.serialNumber || lift.label || "")
          ),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return `${client.name} ${addresses} ${lifts}`.toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [clients, reportSearch]);

  const selectedClient = useMemo(
    () => clients.find((item) => item.id === selectedClientId) || null,
    [clients, selectedClientId]
  );

  function selectReportClient(client: MaintenanceClient) {
    const allLifts = [
      ...((client.liftNumbers || []).length ? client.liftNumbers : client.liftNumber ? [client.liftNumber] : []),
      ...(client.addresses || []).flatMap((address) =>
        (address.lifts || []).map((lift) => lift.serialNumber || lift.label || "")
      ),
    ]
      .map((item) => item.trim())
      .filter(Boolean);

    const defaultLift = allLifts[0] || "-";
    setSelectedClientId(client.id);
    setReportSearch(client.name || client.address || defaultLift);
    setReportAddress(client.address || client.addresses?.[0]?.label || "-");
    setReportLift(defaultLift);
    setReportError("");
  }

  function handleReportSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setReportSearch(event.target.value);
    setReportMessage("");
    setReportError("");
  }

  async function handleGenerateReport(type: ReportType) {
    if (!selectedClient) {
      setReportError("Selectează un client din sugestii.");
      return;
    }

    const liftValue = reportLift.trim();
    const addressValue = reportAddress.trim();
    if (!liftValue || !addressValue) {
      setReportError("Completează adresa și liftul înainte de generare.");
      return;
    }

    const branding = resolveBrandingForCompany(selectedClient.maintenanceCompany || "", brandingItems);

    try {
      setReportGenerating(true);
      setReportError("");
      setReportMessage("");

      const now = new Date();
      const pdfBlob = await buildMaintenancePdfBlob({
        client: selectedClient,
        lift: {
          id: `lift_${liftValue}`,
          label: `Lift ${liftValue}`,
          serialNumber: liftValue,
          manufacturer: "",
          installYear: "",
          maintenanceCompany: selectedClient.maintenanceCompany || "",
          maintenanceEmail: "",
          inspectionExpiryDate: selectedClient.expiryDate || "",
          notes: "",
        },
        branding,
        report: {
          reportType: type,
          createdAt: now.getTime(),
          dateText: now.toLocaleDateString("ro-RO"),
          timeText: now.toLocaleTimeString("ro-RO"),
          address: addressValue,
          locationText: addressValue,
          technicianName: "-",
          continutRaport:
            type === "interventie"
              ? "S-a efectuat interventia conform sesizarii clientului. Instalatia a fost verificata si readusa in stare de functionare in siguranta."
              : reviewStandardText(liftValue),
        },
      });

      const fileType = type === "interventie" ? "interventie" : "revizie";
      const reportId = generateReportId(now);
      const fileName = `${fileType}-${selectedClient.name || "client"}-${reportId}.pdf`
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, "-");

      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();

      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
      }, 0);

      setReportMessage(`Raportul ${fileType} a fost generat.`);
    } catch (err) {
      console.error(err);
      setReportError("Nu am putut genera PDF-ul.");
    } finally {
      setReportGenerating(false);
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
        <h2 className="panel-title">Branding PDF · Logo + Ștampilă pe firmă</h2>
        <p className="tools-subtitle">
          Încarcă fișierele o singură dată pentru fiecare firmă (ex: KLEMAN, BREX). La generarea
          raportului PDF, aplicația va alege automat logo-ul și ștampila în funcție de firma de
          mentenanță a clientului.
        </p>

        {brandingError && <div className="tool-message">{brandingError}</div>}
        {brandingMessage && <div className="tool-message success-message">{brandingMessage}</div>}

        <div className="tool-form-grid" style={{ marginTop: 12 }}>
          <div className="tool-form-block">
            <label className="tool-form-label">Firma mentenanță</label>
            <input
              className="tool-input"
              value={brandingCompanyName}
              onChange={(e) => setBrandingCompanyName(e.target.value)}
              placeholder="Ex: KLEMAN sau BREX"
            />
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Logo firmă</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
            />
            <div className="simple-list-subtitle">{logoFile ? logoFile.name : "Nu ai selectat logo."}</div>
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Ștampilă firmă</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setStampFile(e.target.files?.[0] ?? null)}
            />
            <div className="simple-list-subtitle">{stampFile ? stampFile.name : "Nu ai selectat ștampilă."}</div>
          </div>
        </div>

        <div className="tool-form-actions" style={{ marginTop: 14 }}>
          <button className="primary-btn" type="button" onClick={() => void handleSaveBranding()} disabled={brandingSaving}>
            {brandingSaving ? "Se încarcă..." : "Salvează branding firmă"}
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <h3 className="panel-subtitle">Firme configurate</h3>
          {brandingItems.length === 0 ? (
            <p className="tools-subtitle">Nu există branding salvat încă.</p>
          ) : (
            <div className="simple-list">
              {brandingItems.map((item) => (
                <div key={item.id} className="simple-list-item">
                  <div className="simple-list-text">
                    <div className="simple-list-label">{item.companyName}</div>
                    <div className="simple-list-subtitle">Logo: {item.logoUrl ? "configurat" : "-"}</div>
                    <div className="simple-list-subtitle">Ștampilă: {item.stampUrl ? "configurată" : "-"}</div>
                    <div className="simple-list-subtitle">Cheie internă: {item.companyKey}</div>
                  </div>
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => handleLoadBrandingCompany(item.companyName)}>
                    Editează
                  </button>
                </div>
              ))}
            </div>
          )}
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
        <h2 className="panel-title">Generare raport PDF</h2>
        <p className="tools-subtitle">Scrie minim 2 litere pentru client și selectează din sugestii (nume / adresă / lift). Datele clientului se completează automat, fără e-mail.</p>

        {reportError && <div className="tool-message">{reportError}</div>}
        {reportMessage && <div className="tool-message success-message">{reportMessage}</div>}

        <div className="tool-form-grid" style={{ marginTop: 12 }}>
          <div className="tool-form-block" style={{ gridColumn: "1 / -1", position: "relative" }}>
            <label className="tool-form-label">Client (minim 2 litere)</label>
            <input
              className="tool-input"
              value={reportSearch}
              onChange={handleReportSearchChange}
              placeholder="Ex: Razvan / Aurel Vlaicu / 210869"
            />
            {reportSuggestions.length > 0 && reportSearch.trim().length >= 2 && (
              <div className="simple-list" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
                {reportSuggestions.map((client) => (
                  <button
                    key={`report_suggestion_${client.id}`}
                    type="button"
                    className="simple-list-item"
                    onClick={() => selectReportClient(client)}
                    style={{ width: "100%", textAlign: "left", cursor: "pointer" }}>
                    <div className="simple-list-text">
                      <div className="simple-list-label">{client.name || "Fără nume"}</div>
                      <div className="simple-list-subtitle">Adresă: {client.address || "-"}</div>
                      <div className="simple-list-subtitle">Lift: {client.liftNumber || client.liftNumbers?.[0] || "-"}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Nume client</label>
            <input className="tool-input" value={selectedClient?.name || ""} readOnly />
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Firma mentenanță</label>
            <input className="tool-input" value={selectedClient?.maintenanceCompany || ""} readOnly />
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Adresă client</label>
            <input className="tool-input" value={reportAddress} onChange={(e) => setReportAddress(e.target.value)} placeholder="Adresă client" />
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Lift</label>
            <input className="tool-input" value={reportLift} onChange={(e) => setReportLift(e.target.value)} placeholder="Număr lift" />
          </div>
        </div>

        <div className="tool-form-actions" style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="primary-btn" type="button" onClick={() => void handleGenerateReport("revizie")} disabled={reportGenerating}>
            {reportGenerating ? "Se generează..." : "Generează raport revizie"}
          </button>
          <button className="secondary-btn" type="button" onClick={() => void handleGenerateReport("interventie")} disabled={reportGenerating}>
            {reportGenerating ? "Se generează..." : "Generează raport intervenție"}
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
