import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../providers/AuthProvider";
import type { LiftStatus, LiftUnit, MaintenanceClient, MaintenanceReport, ReportType } from "../../../types/maintenance";
import {
  createLift,
  createMaintenanceClient,
  createReport,
  deleteLift,
  deleteMaintenanceClient,
  getLiftUrgency,
  getMaintenanceData,
  updateLift,
  updateMaintenanceClient,
} from "../services/maintenanceService";
import { buildMaintenancePdfBlob } from "../services/maintenancePdf";
import "./maintenance.css";

type Tab = "dashboard" | "clients" | "lifts" | "reports";
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
  status: "active" as LiftStatus,
  notes: "",
};

const defaultReportForm = {
  clientId: "",
  liftId: "",
  reportType: "revizie" as ReportType,
  technicianName: "",
  observations: "",
  reviewChecklist: [] as string[],
  standardText: "Revizie periodică executată conform planului de mentenanță, fără abateri critice.",
  complaint: "",
  finding: "",
  workPerformed: "",
  replacedParts: "",
  recommendations: "",
};

const checklistOptions = ["Usi", "Panou comanda", "Frana", "Cabina", "Sistem siguranta", "Curatare camera tehnica"];

export default function MaintenancePage() {
  const { role } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [clients, setClients] = useState<MaintenanceClient[]>([]);
  const [lifts, setLifts] = useState<LiftUnit[]>([]);
  const [reports, setReports] = useState<MaintenanceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedLiftId, setSelectedLiftId] = useState<string>("");
  const [clientForm, setClientForm] = useState<ClientFormState>(defaultClientForm);
  const [editingClientId, setEditingClientId] = useState<string>("");
  const [liftForm, setLiftForm] = useState(defaultLiftForm);
  const [editingLiftId, setEditingLiftId] = useState<string>("");
  const [reportForm, setReportForm] = useState(defaultReportForm);
  const [reportTypeFilter, setReportTypeFilter] = useState<"all" | ReportType>("all");

  async function loadData() {
    setLoading(true);
    try {
      const data = await getMaintenanceData();
      setClients(data.clients);
      setLifts(data.lifts);
      setReports(data.reports);
      if (!selectedClientId && data.clients[0]) setSelectedClientId(data.clients[0].id);
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

  const filteredClients = useMemo(() => {
    if (!query.trim()) return clients;
    const q = query.toLowerCase();
    return clients.filter((item) => `${item.name} ${item.phone} ${item.mainAddress}`.toLowerCase().includes(q));
  }, [clients, query]);

  const filteredLifts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lifts.filter((lift) => {
      if (selectedClientId && lift.clientId !== selectedClientId) return false;
      if (!q) return true;
      return `${lift.liftNumber} ${lift.clientName} ${lift.exactAddress} ${lift.assignedTechnician}`.toLowerCase().includes(q);
    });
  }, [lifts, query, selectedClientId]);

  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((report) => {
      if (selectedClientId && report.clientId !== selectedClientId) return false;
      if (selectedLiftId && report.liftId !== selectedLiftId) return false;
      if (reportTypeFilter !== "all" && report.reportType !== reportTypeFilter) return false;
      if (!q) return true;
      return `${report.clientName} ${report.liftNumber} ${report.technicianName} ${report.observations}`.toLowerCase().includes(q);
    });
  }, [reports, query, selectedClientId, selectedLiftId, reportTypeFilter]);

  const dashboard = useMemo(() => {
    const activeLifts = lifts.filter((lift) => lift.status === "active").length;
    const expired = lifts.filter((lift) => lift.nextInspectionDate && new Date(lift.nextInspectionDate).getTime() < Date.now()).length;
    const dueSoon = lifts.filter((lift) => {
      const urgency = getLiftUrgency(lift);
      return urgency === "yellow" || urgency === "orange" || urgency === "red";
    }).length;
    return {
      totalClients: clients.length,
      totalLifts: lifts.length,
      activeLifts,
      expired,
      dueSoon,
      latestReports: reports.slice(0, 6),
      latestInterventions: reports.filter((item) => item.reportType === "interventie").slice(0, 4),
      latestReviews: reports.filter((item) => item.reportType === "revizie").slice(0, 4),
    };
  }, [clients, lifts, reports]);

  async function saveClient() {
    if (!clientForm.name.trim()) return setError("Numele clientului este obligatoriu.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (editingClientId) {
        await updateMaintenanceClient(editingClientId, clientForm);
        setMessage("Client actualizat cu succes.");
      } else {
        await createMaintenanceClient(clientForm);
        setMessage("Client adăugat cu succes.");
      }
      setClientForm(defaultClientForm);
      setEditingClientId("");
      await loadData();
    } catch (saveError) {
      console.error(saveError);
      setError("Eroare la salvarea clientului.");
    } finally {
      setBusy(false);
    }
  }

  async function removeClient(clientId: string) {
    if (!window.confirm("Ștergi clientul? Lifturile și rapoartele trebuie șterse separat.")) return;
    setBusy(true);
    try {
      await deleteMaintenanceClient(clientId);
      await loadData();
      setMessage("Client șters.");
    } catch (removeError) {
      console.error(removeError);
      setError("Nu am putut șterge clientul.");
    } finally {
      setBusy(false);
    }
  }

  async function saveLift() {
    if (!liftForm.clientId || !liftForm.liftNumber.trim()) {
      return setError("Selectează clientul și completează numărul liftului.");
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (editingLiftId) {
        await updateLift(editingLiftId, liftForm);
        setMessage("Lift actualizat.");
      } else {
        await createLift(liftForm);
        setMessage("Lift adăugat.");
      }
      setLiftForm(defaultLiftForm);
      setEditingLiftId("");
      await loadData();
    } catch (saveError) {
      console.error(saveError);
      setError("Nu am putut salva liftul.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLift(liftId: string) {
    if (!window.confirm("Ștergi liftul selectat?")) return;
    setBusy(true);
    try {
      await deleteLift(liftId);
      await loadData();
      setMessage("Lift șters.");
    } catch (removeError) {
      console.error(removeError);
      setError("Nu am putut șterge liftul.");
    } finally {
      setBusy(false);
    }
  }

  async function generateReport() {
    const client = clients.find((item) => item.id === reportForm.clientId);
    const lift = lifts.find((item) => item.id === reportForm.liftId);
    if (!client || !lift) return setError("Selectează client și lift.");

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const now = new Date();
      let gpsLat: number | null = null;
      let gpsLng: number | null = null;

      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60000 });
          });
          gpsLat = pos.coords.latitude;
          gpsLng = pos.coords.longitude;
        } catch {
          // opțional; continuăm fără coordonate
        }
      }

      const payload: Omit<MaintenanceReport, "id" | "pdfUrl"> = {
        clientId: client.id,
        clientName: client.name,
        liftId: lift.id,
        liftNumber: lift.liftNumber,
        reportType: reportForm.reportType,
        createdAt: Date.now(),
        dateText: now.toLocaleDateString("ro-RO"),
        timeText: now.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }),
        gpsLat,
        gpsLng,
        gpsAddress: gpsLat && gpsLng ? "Locație GPS browser" : "Locație indisponibilă",
        technicianName: reportForm.technicianName,
        status: "final",
        observations: reportForm.observations,
        reviewChecklist: reportForm.reviewChecklist,
        standardText: reportForm.standardText,
        complaint: reportForm.complaint,
        finding: reportForm.finding,
        workPerformed: reportForm.workPerformed,
        replacedParts: reportForm.replacedParts,
        recommendations: reportForm.recommendations,
      };

      const pdfBlob = buildMaintenancePdfBlob({ client, lift, report: payload, companyName: "WorkControl" });
      await createReport(payload, pdfBlob);
      setReportForm((prev) => ({ ...defaultReportForm, clientId: prev.clientId, liftId: prev.liftId }));
      setMessage("Raport generat și salvat.");
      await loadData();
    } catch (reportError) {
      console.error(reportError);
      setError("Generarea raportului a eșuat.");
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
            ["reports", "Rapoarte"],
          ].map(([value, label]) => (
            <button key={value} className={tab === value ? "primary-btn" : "secondary-btn"} onClick={() => setTab(value as Tab)} type="button">
              {label}
            </button>
          ))}
        </div>
        <input className="tool-input maintenance-search" placeholder="Caută client, lift, adresă, tehnician..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error && <div className="tool-message">{error}</div>}
      {message && <div className="tool-message success-message">{message}</div>}

      {loading ? (
        <div className="panel">Se încarcă modulul Mentenanță...</div>
      ) : (
        <>
          {tab === "dashboard" && (
            <>
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">Total clienți</div><div className="kpi-value">{dashboard.totalClients}</div></div>
                <div className="kpi-card"><div className="kpi-label">Total lifturi</div><div className="kpi-value">{dashboard.totalLifts}</div></div>
                <div className="kpi-card"><div className="kpi-label">Lifturi active</div><div className="kpi-value">{dashboard.activeLifts}</div></div>
                <div className="kpi-card"><div className="kpi-label">Scadente/expirate</div><div className="kpi-value">{dashboard.dueSoon + dashboard.expired}</div></div>
              </div>

              <div className="maintenance-two-cols">
                <div className="panel">
                  <h3 className="panel-subtitle">Avertizări</h3>
                  {lifts
                    .filter((lift) => getLiftUrgency(lift) !== "normal")
                    .slice(0, 8)
                    .map((lift) => (
                      <div key={lift.id} className="simple-list-item">
                        <div className="simple-list-text">
                          <div className="simple-list-label">{lift.liftNumber} · {lift.clientName}</div>
                          <div className="simple-list-subtitle">{lift.exactAddress} · scadență {lift.nextInspectionDate || "-"}</div>
                        </div>
                        <span className={`badge badge-${getLiftUrgency(lift)}`}>{getLiftUrgency(lift)}</span>
                      </div>
                    ))}
                </div>
                <div className="panel">
                  <h3 className="panel-subtitle">Ultime rapoarte</h3>
                  {dashboard.latestReports.map((report) => (
                    <div key={report.id} className="simple-list-item">
                      <div className="simple-list-text">
                        <div className="simple-list-label">{report.clientName} · {report.liftNumber}</div>
                        <div className="simple-list-subtitle">{report.dateText} {report.timeText} · {report.technicianName}</div>
                      </div>
                      <span className="badge badge-blue">{report.reportType}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "clients" && (
            <div className="maintenance-two-cols">
              <div className="panel">
                <h3 className="panel-subtitle">{editingClientId ? "Editare client" : "Adaugă client"}</h3>
                <div className="tool-form-grid">
                  {Object.entries(clientForm).map(([key, value]) =>
                    key === "status" ? (
                      <div key={key} className="tool-form-block"><label className="tool-form-label">Status</label>
                        <select className="tool-input" value={value} onChange={(e) => setClientForm((prev) => ({ ...prev, status: e.target.value as "active" | "inactive" }))}>
                          <option value="active">Activ</option>
                          <option value="inactive">Inactiv</option>
                        </select>
                      </div>
                    ) : (
                      <div key={key} className="tool-form-block"><label className="tool-form-label">{key}</label>
                        <input className="tool-input" value={value} onChange={(e) => setClientForm((prev) => ({ ...prev, [key]: e.target.value }))} />
                      </div>
                    )
                  )}
                </div>
                <div className="tool-form-actions"><button className="primary-btn" disabled={busy} onClick={() => void saveClient()} type="button">Salvează client</button></div>
              </div>

              <div className="panel">
                <h3 className="panel-subtitle">Listă clienți</h3>
                {filteredClients.map((client) => (
                  <div key={client.id} className="simple-list-item">
                    <div className="simple-list-text" onClick={() => setSelectedClientId(client.id)}>
                      <div className="simple-list-label">{client.name}</div>
                      <div className="simple-list-subtitle">{client.phone || "fără telefon"} · {client.mainAddress || "fără adresă"}</div>
                    </div>
                    <div className="maintenance-actions">
                      <button className="secondary-btn" type="button" onClick={() => { setClientForm(client); setEditingClientId(client.id); }}>Edit</button>
                      <button className="danger-btn" type="button" onClick={() => void removeClient(client.id)}>Șterge</button>
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
                    }}>
                      <option value="">Selectează client</option>
                      {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                    </select>
                  </div>
                  {Object.entries(liftForm).filter(([key]) => key !== "clientId" && key !== "clientName").map(([key, value]) => (
                    <div key={key} className="tool-form-block"><label className="tool-form-label">{key}</label>
                      {key === "status" ? (
                        <select className="tool-input" value={value} onChange={(e) => setLiftForm((prev) => ({ ...prev, status: e.target.value as LiftStatus }))}>
                          <option value="active">Activ</option><option value="stopped">Oprit</option><option value="repair">În reparație</option><option value="overdue">Scadent</option>
                        </select>
                      ) : (
                        <input className="tool-input" value={value} onChange={(e) => setLiftForm((prev) => ({ ...prev, [key]: e.target.value }))} />
                      )}
                    </div>
                  ))}
                </div>
                <div className="tool-form-actions"><button className="primary-btn" disabled={busy} onClick={() => void saveLift()} type="button">Salvează lift</button></div>
              </div>

              <div className="panel">
                <h3 className="panel-subtitle">Listă lifturi</h3>
                {filteredLifts.map((lift) => (
                  <div key={lift.id} className="simple-list-item">
                    <div className="simple-list-text" onClick={() => { setSelectedLiftId(lift.id); setReportForm((prev) => ({ ...prev, clientId: lift.clientId, liftId: lift.id })); }}>
                      <div className="simple-list-label">{lift.liftNumber} · {lift.clientName}</div>
                      <div className="simple-list-subtitle">{lift.exactAddress} · tehnician: {lift.assignedTechnician || "-"}</div>
                    </div>
                    <div className="maintenance-actions">
                      <span className={`badge badge-${getLiftUrgency(lift)}`}>{getLiftUrgency(lift)}</span>
                      <button className="secondary-btn" type="button" onClick={() => { setLiftForm(lift); setEditingLiftId(lift.id); }}>Edit</button>
                      <button className="danger-btn" type="button" onClick={() => void removeLift(lift.id)}>Șterge</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "reports" && (
            <div className="maintenance-two-cols">
              <div className="panel">
                <h3 className="panel-subtitle">Generează raport</h3>
                <div className="tool-form-grid">
                  <div className="tool-form-block"><label className="tool-form-label">Client</label>
                    <select className="tool-input" value={reportForm.clientId} onChange={(e) => setReportForm((prev) => ({ ...prev, clientId: e.target.value, liftId: "" }))}>
                      <option value="">Selectează client</option>
                      {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                    </select>
                  </div>
                  <div className="tool-form-block"><label className="tool-form-label">Lift</label>
                    <select className="tool-input" value={reportForm.liftId} onChange={(e) => setReportForm((prev) => ({ ...prev, liftId: e.target.value }))}>
                      <option value="">Selectează lift</option>
                      {lifts.filter((lift) => !reportForm.clientId || lift.clientId === reportForm.clientId).map((lift) => <option key={lift.id} value={lift.id}>{lift.liftNumber}</option>)}
                    </select>
                  </div>
                  <div className="tool-form-block"><label className="tool-form-label">Tip raport</label>
                    <select className="tool-input" value={reportForm.reportType} onChange={(e) => setReportForm((prev) => ({ ...prev, reportType: e.target.value as ReportType }))}>
                      <option value="revizie">Revizie</option><option value="interventie">Intervenție</option>
                    </select>
                  </div>
                  <div className="tool-form-block"><label className="tool-form-label">Tehnician</label><input className="tool-input" value={reportForm.technicianName} onChange={(e) => setReportForm((prev) => ({ ...prev, technicianName: e.target.value }))} /></div>
                  <div className="tool-form-block"><label className="tool-form-label">Observații</label><textarea className="tool-input" value={reportForm.observations} onChange={(e) => setReportForm((prev) => ({ ...prev, observations: e.target.value }))} /></div>

                  {reportForm.reportType === "revizie" ? (
                    <>
                      <div className="tool-form-block"><label className="tool-form-label">Text standard revizie</label><textarea className="tool-input" value={reportForm.standardText} onChange={(e) => setReportForm((prev) => ({ ...prev, standardText: e.target.value }))} /></div>
                      <div className="tool-form-block"><label className="tool-form-label">Checklist</label>
                        <div className="maintenance-checklist">
                          {checklistOptions.map((item) => (
                            <label key={item}>
                              <input
                                type="checkbox"
                                checked={reportForm.reviewChecklist.includes(item)}
                                onChange={(e) => setReportForm((prev) => ({
                                  ...prev,
                                  reviewChecklist: e.target.checked
                                    ? [...prev.reviewChecklist, item]
                                    : prev.reviewChecklist.filter((value) => value !== item),
                                }))}
                              />
                              {item}
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="tool-form-block"><label className="tool-form-label">Reclamație</label><textarea className="tool-input" value={reportForm.complaint} onChange={(e) => setReportForm((prev) => ({ ...prev, complaint: e.target.value }))} /></div>
                      <div className="tool-form-block"><label className="tool-form-label">Constatare</label><textarea className="tool-input" value={reportForm.finding} onChange={(e) => setReportForm((prev) => ({ ...prev, finding: e.target.value }))} /></div>
                      <div className="tool-form-block"><label className="tool-form-label">Lucrare efectuată</label><textarea className="tool-input" value={reportForm.workPerformed} onChange={(e) => setReportForm((prev) => ({ ...prev, workPerformed: e.target.value }))} /></div>
                      <div className="tool-form-block"><label className="tool-form-label">Piese schimbate</label><textarea className="tool-input" value={reportForm.replacedParts} onChange={(e) => setReportForm((prev) => ({ ...prev, replacedParts: e.target.value }))} /></div>
                      <div className="tool-form-block"><label className="tool-form-label">Recomandări</label><textarea className="tool-input" value={reportForm.recommendations} onChange={(e) => setReportForm((prev) => ({ ...prev, recommendations: e.target.value }))} /></div>
                    </>
                  )}
                </div>
                <div className="tool-form-actions"><button className="primary-btn" disabled={busy} onClick={() => void generateReport()} type="button">Generează PDF</button></div>
              </div>

              <div className="panel">
                <h3 className="panel-subtitle">Istoric rapoarte</h3>
                <div className="maintenance-actions" style={{ marginBottom: 10 }}>
                  <button className={reportTypeFilter === "all" ? "primary-btn" : "secondary-btn"} onClick={() => setReportTypeFilter("all")} type="button">Toate</button>
                  <button className={reportTypeFilter === "revizie" ? "primary-btn" : "secondary-btn"} onClick={() => setReportTypeFilter("revizie")} type="button">Revizii</button>
                  <button className={reportTypeFilter === "interventie" ? "primary-btn" : "secondary-btn"} onClick={() => setReportTypeFilter("interventie")} type="button">Intervenții</button>
                </div>
                {filteredReports.map((report) => (
                  <div key={report.id} className="simple-list-item">
                    <div className="simple-list-text">
                      <div className="simple-list-label">{report.clientName} · {report.liftNumber}</div>
                      <div className="simple-list-subtitle">{report.dateText} {report.timeText} · {report.technicianName}</div>
                      <div className="simple-list-subtitle">{report.observations || report.standardText || report.finding || "Fără observații"}</div>
                    </div>
                    <div className="maintenance-actions">
                      <span className="badge badge-blue">{report.reportType}</span>
                      {report.pdfUrl && <a className="secondary-btn" href={report.pdfUrl} target="_blank" rel="noreferrer">Vezi PDF</a>}
                    </div>
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
