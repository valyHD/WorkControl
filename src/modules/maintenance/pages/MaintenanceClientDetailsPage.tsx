import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import type { ClientAddress, MaintenanceClient, MaintenanceReportHistoryItem } from "../../../types/maintenance";
import {
  getMaintenanceClientById,
  subscribeMaintenanceReportHistory,
  updateMaintenanceClient,
} from "../services/maintenanceService";
import { downloadFileFromUrl } from "../../../lib/files/downloadFile";
import EntityTimeline from "../../../components/product/EntityTimeline";
import "./maintenance.css";

type AddressLiftGroup = {
  key: string;
  address: string;
  lifts: string[];
};

type LiftExpiryRow = {
  key: string;
  lift: string;
  address: string;
  expiryDate: string;
  kind: "main" | "address";
  addressId?: string;
  liftId?: string;
};

function toDateInputValue(value?: string): string {
  const text = (value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const dotMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return "";
}

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
  const [newAddressLiftInput, setNewAddressLiftInput] = useState("");
  const [newAddressLiftNumbers, setNewAddressLiftNumbers] = useState<string[]>([]);
  const [reports, setReports] = useState<MaintenanceReportHistoryItem[]>([]);
  const [reportSearch, setReportSearch] = useState("");
  const [reportTypeFilter, setReportTypeFilter] = useState("");
  const [liftExpiryDrafts, setLiftExpiryDrafts] = useState<Record<string, string>>({});
  const [editClientForm, setEditClientForm] = useState({
    name: "",
    email: "",
    address: "",
    liftNumber: "",
    maintenanceCompany: "",
    expiryDate: "",
  });
  const [imageViewer, setImageViewer] = useState<{ images: MaintenanceReportHistoryItem["images"]; index: number } | null>(null);

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
        setEditClientForm({
          name: result.name || "",
          email: result.email || result.emails?.[0] || "",
          address: result.address || "",
          liftNumber: result.liftNumber || result.liftNumbers?.[0] || "",
          maintenanceCompany: result.maintenanceCompany || "",
          expiryDate: toDateInputValue(result.expiryDate),
        });
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

  useEffect(() => {
    if (!clientId) {
      return undefined;
    }

    return subscribeMaintenanceReportHistory(
      clientId,
      setReports,
      (err) => {
        console.error(err);
        setError("Nu am putut incarca istoricul rapoartelor.");
      }
    );
  }, [clientId]);

  const displayEmails = useMemo(() => {
    if (!client) {
      return [];
    }
    const list = client.emails?.length ? client.emails : client.email ? [client.email] : [];
    return Array.from(new Set(list));
  }, [client]);

  const addressLiftGroups = useMemo(() => (client ? buildAddressLiftGroups(client) : []), [client]);

  const liftExpiryRows = useMemo(() => {
    if (!client) {
      return [] as LiftExpiryRow[];
    }

    const rows: LiftExpiryRow[] = [];
    const secondaryLiftSet = new Set(
      (client.addresses || []).flatMap((address) =>
        (address.lifts || []).map((lift) => (lift.serialNumber || lift.label || "").trim()).filter(Boolean)
      )
    );

    const mainLifts = ((client.liftNumbers || []).length ? client.liftNumbers : client.liftNumber ? [client.liftNumber] : [])
      .map((lift) => lift.trim())
      .filter((lift) => lift && !secondaryLiftSet.has(lift));

    mainLifts.forEach((lift) => {
      rows.push({
        key: `main_${lift}`,
        lift,
        address: client.address || "Adresa principala",
        expiryDate: client.liftExpiryDates?.[lift] || client.expiryDate || "",
        kind: "main",
      });
    });

    (client.addresses || []).forEach((address) => {
      (address.lifts || []).forEach((lift) => {
        const liftLabel = (lift.serialNumber || lift.label || "").trim();
        if (!liftLabel) return;
        rows.push({
          key: `${address.id}_${lift.id || liftLabel}`,
          lift: liftLabel,
          address: address.label || address.street || "Adresa",
          expiryDate: lift.inspectionExpiryDate || client.liftExpiryDates?.[liftLabel] || client.expiryDate || "",
          kind: "address",
          addressId: address.id,
          liftId: lift.id,
        });
      });
    });

    return rows;
  }, [client]);

  const filteredReports = useMemo(() => {
    const query = reportSearch.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesType = !reportTypeFilter || report.reportType === reportTypeFilter;
      const fullText = `${report.dateText} ${report.timeText} ${report.reportType} ${report.address} ${report.lift} ${report.technicianName}`.toLowerCase();
      return matchesType && (!query || fullText.includes(query));
    });
  }, [reports, reportSearch, reportTypeFilter]);

  function getLiftExpiryDate(lift: string): string {
    return liftExpiryRows.find((row) => row.lift === lift)?.expiryDate || client?.expiryDate || "-";
  }

  useEffect(() => {
    setLiftExpiryDrafts((prev) => {
      const next = { ...prev };
      liftExpiryRows.forEach((row) => {
        if (next[row.key] === undefined) {
          next[row.key] = toDateInputValue(row.expiryDate);
        }
      });

      Object.keys(next).forEach((key) => {
        if (!liftExpiryRows.some((row) => row.key === key)) {
          delete next[key];
        }
      });

      return next;
    });
  }, [liftExpiryRows]);

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
    await savePatch(
      {
        liftNumber: nextLifts[0] || "",
        liftNumbers: nextLifts,
        liftExpiryDates: {
          ...(client.liftExpiryDates || {}),
          [value]: client.liftExpiryDates?.[value] || client.expiryDate || "",
        },
      },
      "Liftul a fost adăugat."
    );
    setNewLiftNumber("");
  }

  async function handleAddAddress() {
    if (!client || !newAddress.trim()) {
      setError("Adresa nouă este obligatorie.");
      return;
    }

    const liftItems = Array.from(new Set(newAddressLiftNumbers.map((item) => item.trim()).filter(Boolean)));

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
        inspectionExpiryDate: client.liftExpiryDates?.[item] || client.expiryDate || "",
        notes: "",
      })),
    };

    const extraLifts = liftItems.length ? Array.from(new Set([...(client.liftNumbers || []), ...liftItems])) : client.liftNumbers;
    const nextLiftExpiryDates = liftItems.reduce(
      (acc, lift) => ({
        ...acc,
        [lift]: acc[lift] || client.expiryDate || "",
      }),
      { ...(client.liftExpiryDates || {}) } as Record<string, string>
    );
    await savePatch(
      {
        addresses: [...(client.addresses || []), addressEntry],
        ...(extraLifts?.length ? { liftNumbers: extraLifts, liftNumber: extraLifts[0] || "" } : {}),
        liftExpiryDates: nextLiftExpiryDates,
      },
      "Adresa a fost adăugată."
    );

    setNewAddress("");
    setNewAddressLiftInput("");
    setNewAddressLiftNumbers([]);
  }

  function handleQueueAddressLift() {
    const value = newAddressLiftInput.trim();
    if (!value) {
      return;
    }
    setNewAddressLiftNumbers((prev) => Array.from(new Set([...prev, value])));
    setNewAddressLiftInput("");
  }

  function handleRemoveQueuedAddressLift(value: string) {
    setNewAddressLiftNumbers((prev) => prev.filter((item) => item !== value));
  }

  async function handleSaveClientBasics() {
    if (!client) return;
    const nextLift = editClientForm.liftNumber.trim();
    const nextEmail = editClientForm.email.trim();
    const extraEmails = (client.emails || []).slice(1).filter((item) => item !== nextEmail);
    const extraLifts = (client.liftNumbers || []).slice(1).filter((item) => item !== nextLift);
    await savePatch(
      {
        name: editClientForm.name,
        email: nextEmail,
        emails: nextEmail ? [nextEmail, ...extraEmails] : [],
        address: editClientForm.address,
        liftNumber: nextLift,
        liftNumbers: nextLift ? [nextLift, ...extraLifts] : [],
        maintenanceCompany: editClientForm.maintenanceCompany,
        expiryDate: editClientForm.expiryDate,
      },
      "Datele clientului au fost actualizate."
    );
  }

  async function handleUpdateLiftExpiry(row: LiftExpiryRow, expiryDate: string) {
    if (!client) {
      return;
    }

    const nextLiftExpiryDates = {
      ...(client.liftExpiryDates || {}),
      [row.lift]: expiryDate,
    };
    const totalLifts = liftExpiryRows.length;

    if (row.kind === "address") {
      const nextAddresses = (client.addresses || []).map((address) => {
        if (address.id !== row.addressId) {
          return address;
        }

        return {
          ...address,
          lifts: (address.lifts || []).map((lift) => {
            const liftLabel = (lift.serialNumber || lift.label || "").trim();
            const matchesLift = row.liftId ? lift.id === row.liftId : liftLabel === row.lift;
            return matchesLift ? { ...lift, inspectionExpiryDate: expiryDate } : lift;
          }),
        };
      });

      await savePatch(
        {
          addresses: nextAddresses,
          liftExpiryDates: nextLiftExpiryDates,
          ...(totalLifts === 1 ? { expiryDate } : {}),
        },
        "Data de expirare a liftului a fost salvata."
      );
      return;
    }

    await savePatch(
      {
        liftExpiryDates: nextLiftExpiryDates,
        ...(totalLifts === 1 ? { expiryDate } : {}),
      },
      "Data de expirare a liftului a fost salvata."
    );
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
    <section className="page-section maintenance-page">
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
                  {addressLiftGroups.map((group) => (
                    <div key={group.key} style={{ marginTop: 8 }}>
                      <div className="simple-list-subtitle">Adresă: {group.address || "-"}</div>
                      {group.lifts.length ? (
                        group.lifts.map((lift) => (
                          <div key={`${group.key}_header_lift_${lift}`} className="simple-list-subtitle">
                            • Lift: {lift} · Exp. Date: {getLiftExpiryDate(lift)}
                          </div>
                        ))
                      ) : (
                        <div className="simple-list-subtitle">• Lift: -</div>
                      )}
                    </div>
                  ))}
                  <div className="simple-list-subtitle">Firma mentenanță: {client.maintenanceCompany || "-"}</div>
                  <div className="simple-list-subtitle">Exp. Date general: {client.expiryDate || "-"}</div>
                </div>
              </div>
            </div>

            <div className="panel" style={{ marginBottom: 16 }}>
              <h3 className="panel-subtitle">Editeaza date client</h3>
              <div className="tool-form-grid" style={{ marginTop: 12 }}>
                <div className="tool-form-block">
                  <label className="tool-form-label">Nume</label>
                  <input className="tool-input" value={editClientForm.name} onChange={(e) => setEditClientForm((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div className="tool-form-block">
                  <label className="tool-form-label">Email principal</label>
                  <input className="tool-input" value={editClientForm.email} onChange={(e) => setEditClientForm((prev) => ({ ...prev, email: e.target.value }))} />
                </div>
                <div className="tool-form-block">
                  <label className="tool-form-label">Adresa principala</label>
                  <input className="tool-input" value={editClientForm.address} onChange={(e) => setEditClientForm((prev) => ({ ...prev, address: e.target.value }))} />
                </div>
                <div className="tool-form-block">
                  <label className="tool-form-label">Lift principal</label>
                  <input className="tool-input" value={editClientForm.liftNumber} onChange={(e) => setEditClientForm((prev) => ({ ...prev, liftNumber: e.target.value }))} />
                </div>
                <div className="tool-form-block">
                  <label className="tool-form-label">Firma mentenanta</label>
                  <input className="tool-input" value={editClientForm.maintenanceCompany} onChange={(e) => setEditClientForm((prev) => ({ ...prev, maintenanceCompany: e.target.value }))} />
                </div>
                <div className="tool-form-block">
                  <label className="tool-form-label">Exp. Date general</label>
                  <input className="tool-input" type="date" value={editClientForm.expiryDate} onChange={(e) => setEditClientForm((prev) => ({ ...prev, expiryDate: e.target.value }))} />
                </div>
              </div>
              <div className="maintenance-actions" style={{ marginTop: 12 }}>
                <button className="primary-btn" type="button" onClick={() => void handleSaveClientBasics()} disabled={saving}>
                  Salveaza date client
                </button>
              </div>
            </div>

            <div className="panel" style={{ marginBottom: 16 }}>
              <h3 className="panel-subtitle">Istoric rapoarte</h3>
              <div className="tool-form-grid" style={{ marginTop: 12 }}>
                <div className="tool-form-block">
                  <label className="tool-form-label">Cauta dupa data, ora, adresa, lift sau tehnician</label>
                  <input
                    className="tool-input"
                    value={reportSearch}
                    onChange={(e) => setReportSearch(e.target.value)}
                    placeholder="Ex: 25.04 / revizie / 210869"
                  />
                </div>
                <div className="tool-form-block">
                  <label className="tool-form-label">Tip raport</label>
                  <select
                    className="tool-input"
                    value={reportTypeFilter}
                    onChange={(e) => setReportTypeFilter(e.target.value)}>
                    <option value="">Toate</option>
                    <option value="revizie">Revizie</option>
                    <option value="interventie">Interventie</option>
                  </select>
                </div>
              </div>

              {filteredReports.length ? (
                <div className="simple-list" style={{ marginTop: 12 }}>
                  {filteredReports.map((report) => (
                    <div className="simple-list-item" key={report.id}>
                      <div className="simple-list-text">
                        <div className="simple-list-label">
                          {report.reportType === "interventie" ? "Interventie" : "Revizie"} - {report.dateText} {report.timeText}
                        </div>
                        <div className="simple-list-subtitle">Adresa: {report.address || "-"}</div>
                        <div className="simple-list-subtitle">Lift: {report.lift || "-"}</div>
                        <div className="simple-list-subtitle">Tehnician: {report.technicianName || "-"}</div>
                        {report.comments && <div className="simple-list-subtitle">Comentarii: {report.comments}</div>}
                        {report.images?.length > 0 && (
                          <div className="maintenance-thumbs">
                            {report.images.map((image, imageIndex) => (
                              <button
                                className="maintenance-thumb-btn"
                                type="button"
                                key={`${report.id}_image_${image.path || image.url}`}
                                onClick={() => setImageViewer({ images: report.images, index: imageIndex })}>
                                <img src={image.url} alt={image.name || `Poza ${imageIndex + 1}`} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {report.pdfUrl && (
                        <div className="leave-admin-actions">
                          <a className="secondary-btn" href={report.pdfUrl} target="_blank" rel="noreferrer">
                            Deschide PDF
                          </a>
                          <button
                            className="secondary-btn"
                            type="button"
                            onClick={() =>
                              void downloadFileFromUrl({
                                url: report.pdfUrl,
                                fileName: report.fileName || `raport-mentenanta-${report.id}.pdf`,
                              })
                            }
                          >
                            Download
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tools-subtitle">Nu exista rapoarte pentru filtrul curent.</p>
              )}
            </div>

            {imageViewer && imageViewer.images[imageViewer.index] && (
              <div className="maintenance-lightbox" role="dialog" aria-modal="true">
                <button className="maintenance-lightbox-close" type="button" onClick={() => setImageViewer(null)}>
                  Inchide
                </button>
                <button
                  className="maintenance-lightbox-nav maintenance-lightbox-prev"
                  type="button"
                  onClick={() =>
                    setImageViewer((prev) =>
                      prev ? { ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length } : prev
                    )
                  }>
                  ‹
                </button>
                <img
                  src={imageViewer.images[imageViewer.index].url}
                  alt={imageViewer.images[imageViewer.index].name || "Poza raport"}
                />
                <button
                  className="maintenance-lightbox-nav maintenance-lightbox-next"
                  type="button"
                  onClick={() =>
                    setImageViewer((prev) =>
                      prev ? { ...prev, index: (prev.index + 1) % prev.images.length } : prev
                    )
                  }>
                  ›
                </button>
                <button
                  className="primary-btn maintenance-lightbox-download"
                  type="button"
                  onClick={() => {
                    const image = imageViewer.images[imageViewer.index];
                    void downloadFileFromUrl({
                      url: image.url,
                      fileName: image.name || "poza-raport",
                    });
                  }}
                >
                  Download
                </button>
              </div>
            )}

            <div className="panel" style={{ marginBottom: 16 }}>
              <h3 className="panel-subtitle">Expirare pe lift</h3>
              {liftExpiryRows.length ? (
                <div className="simple-list" style={{ marginTop: 12 }}>
                  {liftExpiryRows.map((row) => (
                    <div className="simple-list-item" key={row.key}>
                      <div className="simple-list-text">
                        <div className="simple-list-label">Lift: {row.lift}</div>
                        <div className="simple-list-subtitle">Adresa: {row.address || "-"}</div>
                      </div>
                      <input
                        className="tool-input"
                        type="date"
                        value={liftExpiryDrafts[row.key] ?? toDateInputValue(row.expiryDate)}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setLiftExpiryDrafts((prev) => ({ ...prev, [row.key]: nextValue }));
                          void handleUpdateLiftExpiry(row, nextValue);
                        }}
                        disabled={saving}
                        style={{ maxWidth: 180 }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tools-subtitle">Nu exista lifturi configurate.</p>
              )}
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
                  Adaugă lift la această adresă (unul câte unul)
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="tool-input"
                    value={newAddressLiftInput}
                    onChange={(e) => setNewAddressLiftInput(e.target.value)}
                    placeholder="210871"
                  />
                  <button className="secondary-btn" type="button" onClick={handleQueueAddressLift} disabled={saving}>
                    Adaugă în listă
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  {newAddressLiftNumbers.length ? (
                    newAddressLiftNumbers.map((lift) => (
                      <div key={`queued_lift_${lift}`} className="simple-list-subtitle" style={{ display: "flex", gap: 8 }}>
                        <span>• {lift}</span>
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={() => handleRemoveQueuedAddressLift(lift)}
                          disabled={saving}>
                          Șterge
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="simple-list-subtitle">Nu ai adăugat încă lifturi pentru această adresă.</div>
                  )}
                </div>
                <button className="secondary-btn" type="button" onClick={() => void handleAddAddress()} disabled={saving}>
                  Adaugă adresă cu lifturi
                </button>
              </div>
            </div>

            <div className="panel" style={{ marginTop: 16 }}>
              <h3 className="panel-subtitle">E-mailuri</h3>
              {displayEmails.length ? (
                displayEmails.map((email) => (
                  <p className="tools-subtitle" key={`client_email_${email}`}>
                    {email}
                  </p>
                ))
              ) : (
                <p className="tools-subtitle">-</p>
              )}
            </div>

            <div className="panel" style={{ marginTop: 16 }}>
              <h3 className="panel-subtitle">Adrese și lifturi</h3>
              {addressLiftGroups.length ? (
                <div className="simple-list">
                  {addressLiftGroups.map((group) => (
                    <div className="simple-list-item" key={group.key}>
                      <div className="simple-list-text">
                        <div className="simple-list-label">{group.address || "Adresă"}</div>
                        {group.lifts.length ? (
                          group.lifts.map((lift) => (
                            <div className="simple-list-subtitle" key={`${group.key}_lift_${lift}`}>
                              • {lift}
                            </div>
                          ))
                        ) : (
                          <div className="simple-list-subtitle">• -</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tools-subtitle">Nu există adrese.</p>
              )}
            </div>

            <div className="panel" style={{ marginTop: 16 }}>
              <h3 className="panel-subtitle">Activitate client</h3>
              <p className="tools-subtitle">Evenimente reale din istoricul WorkControl pentru acest client.</p>
              <EntityTimeline entityType="client" entityId={client.id} />
            </div>
          </>
        ) : (
          <p className="tools-subtitle">Clientul nu există.</p>
        )}
      </div>
    </section>
  );
}
