import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../providers/AuthProvider";
import type { LiftStatus, LiftUnit, MaintenanceBranding, MaintenanceClient, MaintenanceReport, ReportType } from "../../../types/maintenance";
import {
  buildLiftLocations,
  createLift,
  createMaintenanceClient,
  createReportWithAssets,
  deleteBranding,
  deleteLift,
  deleteMaintenanceClient,
  deleteReportFully,
  getLiftUrgency,
  getMaintenanceData,
  nowFolderString,
  resolveBrandingForCompany,
  updateLift,
  updateMaintenanceClient,
  uploadBrandingAsset,
  upsertBranding,
} from "../services/maintenanceService";
import { buildMaintenancePdfBlob, defaultEmailBody, defaultEmailSubject } from "../services/maintenancePdf";
import { generateReportId, reviewStandardText } from "../utils/reportUtils";
import "./maintenance.css";

type Tab = "dashboard" | "clients" | "lifts" | "newReport" | "history" | "branding";
type ClientFormState = Omit<MaintenanceClient, "id" | "createdAt" | "updatedAt">;

const defaultClientForm: ClientFormState = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  mainAddress: "",
  notes: "",
  internalCode: "",
  status: "active",
};

const defaultLiftForm = {
  clientId: "",
  clientName: "",
  liftNumber: "",
  locationName: "",
  exactAddress: "",
  building: "",
  serialNumber: "",
  liftType: "",
  manufacturer: "",
  capacity: "",
  floors: "",
  installYear: "",
  commissioningDate: "",
  nextInspectionDate: "",
  contractExpiryDate: "",
  assignedTechnician: "",
  maintenanceCompany: "",
  expDate: "",
  status: "active" as LiftStatus,
  notes: "",
};

const defaultBranding: Omit<MaintenanceBranding, "createdAt" | "updatedAt"> = {
  id: "",
  nume: "",
  key: "",
  aliases: [],
  logoUrl: "",
  stampilaUrl: "",
  semnaturaUrl: "",
  emailDisplayName: "",
  emailImplicitCc: [],
  active: true,
};

export default function MaintenancePage() {
  const { role, user } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [clients, setClients] = useState<MaintenanceClient[]>([]);
  const [lifts, setLifts] = useState<LiftUnit[]>([]);
  const [reports, setReports] = useState<MaintenanceReport[]>([]);
  const [branding, setBranding] = useState<MaintenanceBranding[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedLiftId, setSelectedLiftId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [clientForm, setClientForm] = useState<ClientFormState>(defaultClientForm);
  const [editingClientId, setEditingClientId] = useState<string>("");
  const [liftForm, setLiftForm] = useState(defaultLiftForm);
  const [editingLiftId, setEditingLiftId] = useState<string>("");
  const [reportType, setReportType] = useState<ReportType>("revizie");
  const [reportEmail, setReportEmail] = useState("");
  const [technicianName, setTechnicianName] = useState("");
  const [constatareInterventie, setConstatareInterventie] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [brandingForm, setBrandingForm] = useState(defaultBranding);
  const [brandingLogoFile, setBrandingLogoFile] = useState<File | null>(null);
  const [brandingStampilaFile, setBrandingStampilaFile] = useState<File | null>(null);
  const [reportTypeFilter, setReportTypeFilter] = useState<"all" | ReportType>("all");

  async function loadData() {
    setLoading(true);
    try {
      const data = await getMaintenanceData();
      setClients(data.clients);
      setLifts(data.lifts);
      setReports(data.reports);
      setBranding(data.branding);
      if (!selectedClientId && data.clients[0]) {
        setSelectedClientId(data.clients[0].id);
        setReportEmail(data.clients[0].email);
      }
    } catch (loadError) {
      console.error(loadError);
      setError("Nu am putut încărca datele de mentenanță.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((report) => {
      if (selectedClientId && report.clientId !== selectedClientId) return false;
      if (reportTypeFilter !== "all" && report.reportType !== reportTypeFilter) return false;
      if (!q) return true;
      return `${report.clientName} ${report.liftNumber} ${report.technicianName} ${report.adresa}`.toLowerCase().includes(q);
    });
  }, [reports, query, selectedClientId, reportTypeFilter]);

  const locationOptions = useMemo(() => buildLiftLocations(selectedClientId, lifts), [selectedClientId, lifts]);
  const selectedLocation = locationOptions.find((item) => item.id === selectedLocationId) || locationOptions[0] || null;
  const availableLifts = selectedLocation?.lifts || [];

  useEffect(() => {
    if (locationOptions.length === 1) setSelectedLocationId(locationOptions[0].id);
  }, [locationOptions]);

  useEffect(() => {
    if (availableLifts.length === 1) setSelectedLiftId(availableLifts[0].id);
  }, [availableLifts]);

  const selectedClient = clients.find((item) => item.id === selectedClientId) || null;
  const selectedLift = lifts.find((item) => item.id === selectedLiftId) || null;
  const resolvedBranding = resolveBrandingForCompany(selectedLift?.maintenanceCompany || "", branding);

  async function detectGpsAddress() {
    if (!navigator.geolocation) return { lat: null, lng: null, text: "Locatie indisponibila" };

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 9000, maximumAge: 120000 });
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      let text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
        const j = (await r.json()) as { display_name?: string };
        if (j.display_name) text = j.display_name;
      } catch {
        // fallback to coordinates
      }
      return { lat, lng, text };
    } catch {
      return { lat: null, lng: null, text: "Locatie indisponibila" };
    }
  }

  async function generateReport() {
    if (!selectedClient || !selectedLift) return setError("Selectează client, locație și lift.");
    if (!technicianName.trim()) return setError("Completează numele tehnicianului.");
    if (reportType === "interventie" && !constatareInterventie.trim()) return setError("Completează constatarea pentru intervenție.");

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const now = new Date();
      const gps = await detectGpsAddress();
      const dataFolder = nowFolderString();
      const reportId = generateReportId(now);
      const dateText = now.toLocaleDateString("ro-RO");
      const timeText = now.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
      const standardText = reportType === "revizie" ? reviewStandardText(selectedLift.liftNumber) : "";
      const continutRaport = reportType === "interventie" ? constatareInterventie : standardText;

      const payload: Omit<MaintenanceReport, "id" | "pdfUrl"> = {
        reportId,
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        locatieId: selectedLocation?.id,
        locatieName: selectedLocation?.label || "",
        adresa: selectedLift.exactAddress || selectedClient.mainAddress,
        email: reportEmail || selectedClient.email,
        liftId: selectedLift.id,
        liftIdDocument: selectedLift.id,
        liftNumber: selectedLift.liftNumber,
        reportType,
        createdAt: Date.now(),
        dateText,
        timeText,
        dataFolder,
        gpsLat: gps.lat,
        gpsLng: gps.lng,
        gpsLocatie: gps.text,
        technicianName,
        status: "final",
        observations: "",
        standardText,
        constatareInterventie,
        continutRaport,
        images: [],
        firmaLogo: resolvedBranding.branding?.nume || "DEFAULT",
        firmaMentenantaOriginala: selectedLift.maintenanceCompany,
        brandingId: resolvedBranding.branding?.id || "",
        logoUrlFolosit: resolvedBranding.branding?.logoUrl || "",
        stampilaUrlFolosita: resolvedBranding.branding?.stampilaUrl || "",
        createdByUid: user?.uid || "",
      };

      const pdfBlob = await buildMaintenancePdfBlob({
        client: selectedClient,
        lift: selectedLift,
        branding: resolvedBranding.branding,
        report: payload,
      });

      await createReportWithAssets({
        reportPayload: payload,
        pdfBlob,
        images: reportType === "interventie" ? selectedImages : [],
        clientId: selectedClient.id,
        reportType,
        clientName: selectedClient.name,
        adresa: payload.adresa,
        liftNumber: selectedLift.liftNumber,
        dataFolder,
      });

      setMessage("Raport generat și salvat cu succes.");
      setConstatareInterventie("");
      setSelectedImages([]);
      await loadData();
    } catch (reportError) {
      console.error(reportError);
      setError("Generarea raportului a eșuat.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBranding() {
    if (!brandingForm.id.trim() || !brandingForm.nume.trim()) {
      return setError("ID-ul și numele firmei sunt obligatorii.");
    }
    setBusy(true);
    try {
      let logoUrl = brandingForm.logoUrl;
      let stampilaUrl = brandingForm.stampilaUrl;
      if (brandingLogoFile) logoUrl = await uploadBrandingAsset(brandingForm.id, "logo", brandingLogoFile);
      if (brandingStampilaFile) stampilaUrl = await uploadBrandingAsset(brandingForm.id, "stampila", brandingStampilaFile);

      await upsertBranding({
        ...brandingForm,
        logoUrl,
        stampilaUrl,
      });
      setBrandingForm(defaultBranding);
      setBrandingLogoFile(null);
      setBrandingStampilaFile(null);
      setMessage("Branding salvat.");
      await loadData();
    } catch (e) {
      console.error(e);
      setError("Nu am putut salva branding-ul.");
    } finally {
      setBusy(false);
    }
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div className="placeholder-page">
        <h2>Acces restricționat</h2>
        <p>Doar adminul sau managerul pot gestiona mentenanța lifturilor.</p>
      </div>
    );
  }

  return (
    <section className="page-section maintenance-page">
      <div className="maintenance-toolbar panel">
        <div className="maintenance-tabs">
          {[
            ["dashboard", "Dashboard"],
            ["clients", "Clienți"],
            ["lifts", "Lifturi"],
            ["newReport", "Raport nou"],
            ["history", "Istoric"],
            ["branding", "Branding firme"],
          ].map(([value, label]) => (
            <button key={value} className={tab === value ? "primary-btn" : "secondary-btn"} onClick={() => setTab(value as Tab)} type="button">
              {label}
            </button>
          ))}
        </div>
        <input className="tool-input maintenance-search" placeholder="Caută..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error && <div className="tool-message">{error}</div>}
      {message && <div className="tool-message success-message">{message}</div>}
      {resolvedBranding.warning && tab === "newReport" && <div className="tool-message">{resolvedBranding.warning}</div>}

      {loading ? (
        <div className="panel">Se încarcă modulul Mentenanță...</div>
      ) : (
        <>
          {tab === "dashboard" && <div className="panel">Clienți: {clients.length} · Lifturi: {lifts.length} · Rapoarte: {reports.length}</div>}

          {tab === "clients" && (
            <div className="maintenance-two-cols">
              <div className="panel">
                <h3 className="panel-subtitle">{editingClientId ? "Editare client" : "Adaugă client"}</h3>
                <div className="tool-form-grid">
                  {Object.entries(clientForm).map(([key, value]) => (
                    <div key={key} className="tool-form-block">
                      <label className="tool-form-label">{key}</label>
                      <input className="tool-input" value={value} onChange={(e) => setClientForm((prev) => ({ ...prev, [key]: e.target.value }))} />
                    </div>
                  ))}
                </div>
                <div className="tool-form-actions"><button className="primary-btn" disabled={busy} onClick={() => void (editingClientId ? updateMaintenanceClient(editingClientId, clientForm) : createMaintenanceClient(clientForm)).then(loadData)} type="button">Salvează client</button></div>
              </div>
              <div className="panel">
                {clients.map((client) => (
                  <div key={client.id} className="simple-list-item">
                    <div className="simple-list-text" onClick={() => { setSelectedClientId(client.id); setReportEmail(client.email); }}>
                      <div className="simple-list-label">{client.name}</div>
                      <div className="simple-list-subtitle">{client.email} · {client.mainAddress}</div>
                    </div>
                    <div className="maintenance-actions">
                      <button className="secondary-btn" onClick={() => { setClientForm(client); setEditingClientId(client.id); }} type="button">Edit</button>
                      <button className="danger-btn" onClick={() => void deleteMaintenanceClient(client.id).then(loadData)} type="button">Șterge</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "lifts" && (
            <div className="maintenance-two-cols">
              <div className="panel">
                <h3 className="panel-subtitle">{editingLiftId ? "Editare lift" : "Adaugă lift"}</h3>
                <div className="tool-form-grid">
                  <div className="tool-form-block"><label className="tool-form-label">Client</label>
                    <select className="tool-input" value={liftForm.clientId} onChange={(e) => {
                      const client = clients.find((item) => item.id === e.target.value);
                      setLiftForm((prev) => ({ ...prev, clientId: e.target.value, clientName: client?.name || "" }));
                    }}><option value="">Selectează client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
                  </div>
                  {Object.entries(liftForm).filter(([key]) => key !== "clientId").map(([key, value]) => (
                    <div key={key} className="tool-form-block"><label className="tool-form-label">{key}</label><input className="tool-input" value={value} onChange={(e) => setLiftForm((prev) => ({ ...prev, [key]: e.target.value }))} /></div>
                  ))}
                </div>
                <div className="tool-form-actions"><button className="primary-btn" disabled={busy} onClick={() => void (editingLiftId ? updateLift(editingLiftId, liftForm) : createLift(liftForm)).then(loadData)} type="button">Salvează lift</button></div>
              </div>

              <div className="panel">
                {lifts.map((lift) => (
                  <div key={lift.id} className="simple-list-item">
                    <div className="simple-list-text" onClick={() => { setSelectedClientId(lift.clientId); setSelectedLiftId(lift.id); }}>
                      <div className="simple-list-label">{lift.liftNumber} · {lift.clientName}</div>
                      <div className="simple-list-subtitle">{lift.exactAddress} · {lift.maintenanceCompany}</div>
                    </div>
                    <div className="maintenance-actions">
                      <span className={`badge badge-${getLiftUrgency(lift)}`}>{getLiftUrgency(lift)}</span>
                      <button className="secondary-btn" type="button" onClick={() => { setLiftForm(lift); setEditingLiftId(lift.id); }}>Edit</button>
                      <button className="danger-btn" type="button" onClick={() => void deleteLift(lift.id).then(loadData)}>Șterge</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "newReport" && (
            <div className="maintenance-two-cols">
              <div className="panel">
                <h3 className="panel-subtitle">Raport nou</h3>
                <div className="tool-form-grid">
                  <div className="tool-form-block"><label className="tool-form-label">Client</label><select className="tool-input" value={selectedClientId} onChange={(e) => { setSelectedClientId(e.target.value); setSelectedLocationId(""); setSelectedLiftId(""); const c = clients.find((x) => x.id === e.target.value); setReportEmail(c?.email || ""); }}><option value="">Selectează client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <div className="tool-form-block"><label className="tool-form-label">Email</label><input className="tool-input" value={reportEmail} onChange={(e) => setReportEmail(e.target.value)} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Adresă / locație</label><select className="tool-input" value={selectedLocationId} onChange={(e) => { setSelectedLocationId(e.target.value); setSelectedLiftId(""); }}><option value="">Selectează locație</option>{locationOptions.map((loc) => <option key={loc.id} value={loc.id}>{loc.label}</option>)}</select></div>
                  <div className="tool-form-block"><label className="tool-form-label">Lift</label><select className="tool-input" value={selectedLiftId} onChange={(e) => setSelectedLiftId(e.target.value)}><option value="">Selectează lift</option>{availableLifts.map((lift) => <option key={lift.id} value={lift.id}>{lift.liftNumber}</option>)}</select></div>
                  <div className="tool-form-block"><label className="tool-form-label">Tehnician</label><input className="tool-input" value={technicianName} onChange={(e) => setTechnicianName(e.target.value)} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Tip lucrare</label><select className="tool-input" value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}><option value="revizie">Revizie</option><option value="interventie">Intervenție</option></select></div>
                  {reportType === "interventie" && <div className="tool-form-block"><label className="tool-form-label">Constatare intervenție</label><textarea className="tool-input" value={constatareInterventie} onChange={(e) => setConstatareInterventie(e.target.value)} /></div>}
                  {reportType === "interventie" && <div className="tool-form-block"><label className="tool-form-label">Poze intervenție</label><input type="file" className="tool-input" multiple accept="image/*" onChange={(e) => setSelectedImages(Array.from(e.target.files || []))} /></div>}
                </div>
                <div className="tool-form-actions"><button className="primary-btn" disabled={busy} onClick={() => void generateReport()} type="button">Generează raport</button></div>
              </div>

              <div className="panel">
                <h3 className="panel-subtitle">Preview branding selectat</h3>
                <p>Firma mentenanță detectată: <b>{selectedLift?.maintenanceCompany || "-"}</b></p>
                <p>Branding folosit: <b>{resolvedBranding.branding?.nume || "Fallback"}</b></p>
                {resolvedBranding.branding?.logoUrl && <img src={resolvedBranding.branding.logoUrl} alt="logo" style={{ maxWidth: 240, maxHeight: 100 }} />}
                {resolvedBranding.branding?.stampilaUrl && <img src={resolvedBranding.branding.stampilaUrl} alt="stampila" style={{ maxWidth: 200, maxHeight: 120 }} />}
                <div className="tool-form-actions" style={{ marginTop: 16 }}>
                  <a
                    className="secondary-btn"
                    href={`mailto:${reportEmail}?subject=${encodeURIComponent(defaultEmailSubject(reportType, new Date().toLocaleDateString("ro-RO")))}&body=${encodeURIComponent(defaultEmailBody(reportType, resolvedBranding.branding?.emailDisplayName || "Mentenanta"))}${(resolvedBranding.branding?.nume || "").includes("KLEEMANN") && resolvedBranding.branding?.emailImplicitCc[0] ? `&cc=${encodeURIComponent(resolvedBranding.branding.emailImplicitCc[0])}` : ""}`}
                  >Trimite email</a>
                </div>
              </div>
            </div>
          )}

          {tab === "history" && (
            <div className="panel">
              <div className="maintenance-actions" style={{ marginBottom: 12 }}>
                <button className={reportTypeFilter === "all" ? "primary-btn" : "secondary-btn"} onClick={() => setReportTypeFilter("all")} type="button">Toate</button>
                <button className={reportTypeFilter === "revizie" ? "primary-btn" : "secondary-btn"} onClick={() => setReportTypeFilter("revizie")} type="button">Revizii</button>
                <button className={reportTypeFilter === "interventie" ? "primary-btn" : "secondary-btn"} onClick={() => setReportTypeFilter("interventie")} type="button">Intervenții</button>
              </div>
              {filteredReports.map((report) => (
                <div key={report.id} className="simple-list-item">
                  <div className="simple-list-text">
                    <div className="simple-list-label">{report.clientName} · {report.liftNumber}</div>
                    <div className="simple-list-subtitle">{report.dateText} · {report.technicianName} · {report.reportType}</div>
                    <div className="simple-list-subtitle">{report.adresa}</div>
                    {!!report.images.length && <div className="simple-list-subtitle">Imagini: {report.images.length}</div>}
                  </div>
                  <div className="maintenance-actions">
                    {report.pdfUrl && <a className="secondary-btn" href={report.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}
                    <button className="danger-btn" onClick={() => void deleteReportFully(report).then(loadData)} type="button">Șterge</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "branding" && (
            <div className="maintenance-two-cols">
              <div className="panel">
                <h3 className="panel-subtitle">Setări firme mentenanță</h3>
                <div className="tool-form-grid">
                  <div className="tool-form-block"><label className="tool-form-label">ID firmă</label><input className="tool-input" value={brandingForm.id} onChange={(e) => setBrandingForm((prev) => ({ ...prev, id: e.target.value }))} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Nume</label><input className="tool-input" value={brandingForm.nume} onChange={(e) => setBrandingForm((prev) => ({ ...prev, nume: e.target.value }))} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Key</label><input className="tool-input" value={brandingForm.key} onChange={(e) => setBrandingForm((prev) => ({ ...prev, key: e.target.value }))} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Aliases (virgulă)</label><input className="tool-input" value={brandingForm.aliases.join(", ")} onChange={(e) => setBrandingForm((prev) => ({ ...prev, aliases: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Email display</label><input className="tool-input" value={brandingForm.emailDisplayName} onChange={(e) => setBrandingForm((prev) => ({ ...prev, emailDisplayName: e.target.value }))} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Email implicit CC (virgulă)</label><input className="tool-input" value={brandingForm.emailImplicitCc.join(", ")} onChange={(e) => setBrandingForm((prev) => ({ ...prev, emailImplicitCc: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Logo</label><input type="file" className="tool-input" accept="image/*" onChange={(e) => setBrandingLogoFile(e.target.files?.[0] || null)} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Ștampilă</label><input type="file" className="tool-input" accept="image/*" onChange={(e) => setBrandingStampilaFile(e.target.files?.[0] || null)} /></div>
                </div>
                <div className="tool-form-actions"><button className="primary-btn" disabled={busy} onClick={() => void saveBranding()} type="button">Salvează branding</button></div>
              </div>
              <div className="panel">
                {branding.map((item) => (
                  <div key={item.id} className="simple-list-item">
                    <div className="simple-list-text" onClick={() => setBrandingForm({ ...item })}>
                      <div className="simple-list-label">{item.nume}</div>
                      <div className="simple-list-subtitle">{item.aliases.join(", ")}</div>
                    </div>
                    <div className="maintenance-actions"><button className="danger-btn" type="button" onClick={() => void deleteBranding(item.id).then(loadData)}>Șterge</button></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
