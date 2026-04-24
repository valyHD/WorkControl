import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AppUser } from "../../../types/tool";
import type {
  VehicleCommandItem,
  VehicleEventItem,
  VehicleItem,
} from "../../../types/vehicle";
import { useAuth } from "../../../providers/AuthProvider";
import SafeImage from "../../../components/SafeImage";
import { SectionErrorBoundary } from "../../../lib/errors/SectionErrorBoundary";
import VehicleStatusBadge from "../components/VehicleStatusBadge";
import VehicleChangeDriverCard from "../components/VehicleChangeDriverCard";
import VehicleDocumentsPanel from "../components/VehicleDocumentsPanel";
import VehicleControlCard from "../components/VehicleControlCard";
import {
  acceptVehicleDriverChange,
  claimVehicleForCurrentUser,
  getVehicleEvents,
  getVehicleUsers,
  removeVehicleDocument,
  removeVehicleImage,
  requestVehicleCommand,
  subscribeVehicleCommands,
  setVehicleCoverImage,
  subscribeVehicleById,
} from "../services/vehiclesService";
import {
  AlertTriangle,
  Pencil,
  ArrowLeft,
  Image as ImageIcon,
  History,
  FileText,
} from "lucide-react";

const VehicleLiveRouteCard = lazy(() => import("../components/VehicleLiveRouteCard"));

function formatDate(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ro-RO");
}

function MaintenanceAlert({ label, date }: { label: string; date?: string }) {
  if (!date) return null;
  const parsed = new Date(date);
  const daysLeft = Math.ceil((parsed.getTime() - Date.now()) / 86_400_000);
  if (daysLeft > 30) return null;
  const isExpired = daysLeft < 0;

  return (
    <div
      className={`vc-feedback ${isExpired ? "vc-feedback--error" : "vc-feedback--warning"}`}
      style={{ marginBottom: 8 }}
    >
      <AlertTriangle size={14} />
      {label}: {isExpired ? `expirat de ${Math.abs(daysLeft)} zile` : `expira in ${daysLeft} zile`}
    </div>
  );
}

function VehicleDetailSkeleton() {
  return (
    <section className="page-section">
      <div className="panel">
        <div className="tool-details-header" style={{ gap: 16, padding: "4px 0" }}>
          <div
            className="skeleton"
            style={{
              width: 120,
              height: 120,
              borderRadius: "var(--radius-md)",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="skeleton" style={{ height: 24, width: "40%" }} />
            <div className="skeleton" style={{ height: 14, width: "60%" }} />
            <div className="skeleton" style={{ height: 14, width: "30%" }} />
          </div>
        </div>
      </div>

      <div className="tool-details-grid" style={{ marginTop: 16 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="panel" style={{ minHeight: 180 }}>
            <div className="skeleton" style={{ height: 14, width: "50%", marginBottom: 16 }} />
            {[1, 2, 3, 4].map((j) => (
              <div
                key={j}
                className="skeleton"
                style={{ height: 12, marginBottom: 10, width: `${70 - j * 8}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function VehicleDetailsPage() {
  const { vehicleId = "" } = useParams();
  const { user } = useAuth();
  const mountedRef = useRef(true);

  const [vehicle, setVehicle] = useState<VehicleItem | null>(null);
  const [events, setEvents] = useState<VehicleEventItem[]>([]);
  const [commands, setCommands] = useState<VehicleCommandItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [metaLoading, setMetaLoading] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMsg, setClaimMsg] = useState("");
  const [estimatedCurrentKm, setEstimatedCurrentKm] = useState<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!vehicleId) return;
    setLoading(true);

    const unsubscribe = subscribeVehicleById(vehicleId, (vehicleData) => {
      if (!mountedRef.current) return;
      setVehicle(vehicleData);
      setLoading(false);
    });

    return () => {
      try {
        unsubscribe?.();
      } catch (err) {
        console.error("[VehicleDetailsPage][unsubscribeVehicle]", err);
      }
    };
  }, [vehicleId]);

  useEffect(() => {
    if (!vehicleId) {
      setCommands([]);
      return;
    }

    const unsubscribe = subscribeVehicleCommands(vehicleId, (commandsData) => {
      if (!mountedRef.current) return;
      setCommands(commandsData);
    });

    return () => {
      try {
        unsubscribe?.();
      } catch (err) {
        console.error("[VehicleDetailsPage][unsubscribeCommands]", err);
      }
    };
  }, [vehicleId]);

  const loadMeta = useCallback(async () => {
    if (!vehicleId || metaLoading) return;

    setMetaLoading(true);
    try {
      const [eventsData, usersData] = await Promise.all([
        getVehicleEvents(vehicleId).catch(() => []),
        getVehicleUsers().catch(() => []),
      ]);

      if (!mountedRef.current) return;
      setEvents(eventsData);
      setUsers(usersData);
    } catch (err) {
      console.error("[VehicleDetailsPage][loadMeta]", err);
      if (!mountedRef.current) return;
      setEvents([]);
      setUsers([]);
    } finally {
      if (mountedRef.current) setMetaLoading(false);
    }
  }, [vehicleId, metaLoading]);

  useEffect(() => {
    if (vehicleId) {
      void loadMeta();
    }
  }, [vehicleId, loadMeta]);

  async function handleClaimVehicle() {
    if (!vehicle || !user?.uid || claimBusy) return;

    setClaimBusy(true);
    setClaimMsg("");

    try {
      await claimVehicleForCurrentUser(
        vehicle.id,
        user.uid,
        user.displayName || user.email || "Utilizator",
        user.themeKey ?? null
      );
      setClaimMsg("Vehiculul a fost preluat cu succes.");
      await loadMeta();
    } catch (err) {
      console.error("[VehicleDetailsPage][claimVehicle]", err);
      setClaimMsg("Nu am putut prelua vehiculul. Incearca din nou.");
    } finally {
      setClaimBusy(false);
    }
  }

  async function handleAcceptPendingDriver() {
    if (!vehicle || !user?.uid) return;

    await acceptVehicleDriverChange(vehicle.id, user.uid);
    await loadMeta();
  }

  async function handleSetCover(url: string) {
    if (!vehicle || !user || vehicle.ownerUserId !== user.uid) return;

    try {
      await setVehicleCoverImage(vehicle.id, url);
    } catch (err) {
      console.error("[VehicleDetailsPage][setCover]", err);
    }
  }

  async function handleDeleteImage(imageId: string) {
    if (!vehicle || !user || vehicle.ownerUserId !== user.uid || deletingImageId) return;

    setDeletingImageId(imageId);
    try {
      await removeVehicleImage(vehicle.id, vehicle.images, imageId);
    } catch (err) {
      console.error("[VehicleDetailsPage][deleteImage]", err);
    } finally {
      setDeletingImageId(null);
    }
  }


  async function handleDeleteDocument(documentId: string) {
    if (!vehicle || !user || vehicle.ownerUserId !== user.uid || deletingDocumentId) return;

    setDeletingDocumentId(documentId);
    try {
      await removeVehicleDocument(vehicle.id, vehicle.documents, documentId);
    } catch (err) {
      console.error("[VehicleDetailsPage][deleteDocument]", err);
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function handleRequestCommand(type: "pulse_dout1" | "block_start") {
    if (!vehicle) return;

    await requestVehicleCommand(vehicle.id, {
      type,
      requestedBy:
        user?.displayName ||
        user?.email ||
        vehicle.currentDriverUserName ||
        "dashboard_user",
      durationSec: type === "pulse_dout1" ? 60 : null,
    });
  }

  const isOwner = useMemo(() => {
    if (!vehicle || !user) return false;
    return vehicle.ownerUserId === user.uid;
  }, [vehicle, user]);

  const needsRepair = useMemo(() => {
    if (!vehicle) return false;
    return !vehicle.ownerUserId || !vehicle.ownerUserName;
  }, [vehicle]);

  const maintenanceAlerts = useMemo(() => {
    if (!vehicle) return [];
    return [
      { label: "ITP", date: vehicle.nextItpDate },
      { label: "RCA", date: vehicle.nextRcaDate },
      { label: "CASCO", date: vehicle.nextCascoDate },
    ].filter((a) => Boolean(a.date));
  }, [vehicle]);

  const displayedCurrentKm = useMemo(() => {
    if (!vehicle) return 0;
    const candidates = [vehicle.currentKm, vehicle.gpsSnapshot?.odometerKm, estimatedCurrentKm].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value)
    );
    if (!candidates.length) return 0;
    return Math.max(...candidates);
  }, [estimatedCurrentKm, vehicle]);

  const hasPendingDriverRequest = useMemo(() => {
    return Boolean(vehicle?.pendingDriverUserId);
  }, [vehicle?.pendingDriverUserId]);

  const isPendingForCurrentUser = useMemo(() => {
    if (!vehicle?.pendingDriverUserId || !user?.uid) return false;
    return vehicle.pendingDriverUserId === user.uid;
  }, [vehicle?.pendingDriverUserId, user?.uid]);

  if (loading) return <VehicleDetailSkeleton />;

  if (!vehicle) {
    return (
      <div className="placeholder-page">
        <h2>Masina nu a fost gasita</h2>
        <p>Verifica link-ul sau lista masinilor.</p>
        <Link
          to="/vehicles"
          className="secondary-btn"
          style={{ marginTop: 16, display: "inline-flex" }}
        >
          <ArrowLeft size={15} style={{ marginRight: 6 }} /> Inapoi la masini
        </Link>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        {maintenanceAlerts.map((a) => (
          <MaintenanceAlert key={a.label} label={a.label} date={a.date} />
        ))}

        <div className="tools-header">
          <div className="tool-details-header">
            <div className="tool-details-avatar">
              <SafeImage
                src={vehicle.coverThumbUrl || vehicle.coverImageUrl}
                alt={vehicle.plateNumber}
                className="tool-details-avatar-image"
                fallbackText={vehicle.brand || vehicle.plateNumber}
                sizes="140px"
                loading="eager"
              />
            </div>

            <div className="vehicle-details-summary">
              <h2 className="panel-title" style={{ marginBottom: 6 }}>
                {vehicle.plateNumber}
              </h2>

              <div className="tool-detail-line">
                <strong>Marca / model:</strong> {vehicle.brand} {vehicle.model}
                {vehicle.year ? (
                  <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                    · {vehicle.year}
                  </span>
                ) : null}
              </div>

              <div className="tool-detail-line">
                <strong>Status:</strong> <VehicleStatusBadge status={vehicle.status} />
              </div>

              <div className="tool-detail-line">
                <strong>Sofer curent:</strong>{" "}
                {vehicle.currentDriverUserName || (
                  <span style={{ color: "var(--text-muted)" }}>Neasignat</span>
                )}
              </div>

              <div className="tool-detail-line">
                <strong>Km curenti:</strong>{" "}
                {displayedCurrentKm.toLocaleString("ro-RO", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                km
              </div>

              <div className="vehicle-details-actions">
                {isOwner && (
                  <Link to={`/vehicles/${vehicle.id}/edit`} className="primary-btn">
                    <Pencil size={14} /> Editeaza
                  </Link>
                )}
                <Link to="/vehicles" className="secondary-btn">
                  <ArrowLeft size={14} /> Inapoi
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {needsRepair && user && (
        <div className="panel">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <AlertTriangle
              size={18}
              style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }}
            />
            <div>
              <h3 className="panel-title" style={{ marginBottom: 4 }}>
                Date incomplete
              </h3>
              <p className="tools-subtitle" style={{ marginBottom: 12 }}>
                Aceasta masina nu are responsabil setat. O poti prelua pe profilul tau.
              </p>

              {claimMsg && (
                <p
                  style={{
                    marginBottom: 10,
                    fontSize: 13,
                    color: claimMsg.includes("succes")
                      ? "var(--success)"
                      : "var(--danger)",
                  }}
                >
                  {claimMsg}
                </p>
              )}

              <button
                className="primary-btn"
                type="button"
                disabled={claimBusy}
                onClick={() => void handleClaimVehicle()}
              >
                {claimBusy ? "Se preia..." : "Preia responsabilitatea"}
              </button>
            </div>
          </div>
        </div>
      )}

      <details className="panel vehicle-sections-dropdown">
        <summary className="vehicle-sections-dropdown__summary">
          <span className="panel-title">Detalii vehicul</span>
          <span className="tools-subtitle">Apasa pentru a deschide toate sectiunile</span>
        </summary>

        <div className="tool-details-grid vehicle-sections-dropdown__body">
          <div className="panel tool-inner-panel">
            <VehicleControlCard
              vehicle={vehicle}
              commands={commands}
              onRequestCommand={handleRequestCommand}
              loading={loading}
            />
          </div>

          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Date generale</h3>

            <div className="tool-detail-line">
              <strong>Responsabil:</strong> {vehicle.ownerUserName || "—"}
            </div>
            <div className="tool-detail-line">
              <strong>Sofer curent:</strong> {vehicle.currentDriverUserName || "—"}
            </div>
            <div className="tool-detail-line">
              <strong>An fabricatie:</strong> {vehicle.year || "—"}
            </div>
            <div className="tool-detail-line">
              <strong>VIN:</strong>{" "}
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  letterSpacing: "0.5px",
                }}
              >
                {vehicle.vin || "—"}
              </span>
            </div>
            <div className="tool-detail-line">
              <strong>Combustibil:</strong> {vehicle.fuelType || "—"}
            </div>
            <div className="tool-detail-line">
              <strong>Km curenti:</strong>{" "}
              {displayedCurrentKm.toLocaleString("ro-RO", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              km
            </div>
            <div className="tool-detail-line">
              <strong>Km la inregistrare:</strong>{" "}
              {(vehicle.initialRecordedKm || 0).toLocaleString("ro-RO")} km
            </div>
          </div>

          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Mentenanta</h3>

            <div className="tool-detail-line">
              <strong>Urmator service la:</strong>{" "}
              {vehicle.nextServiceKm
                ? `${vehicle.nextServiceKm.toLocaleString("ro-RO")} km`
                : "—"}
            </div>
            <div className="tool-detail-line">
              <strong>ITP pana la:</strong>{" "}
              <span style={{ color: getDateColor(vehicle.nextItpDate) }}>
                {vehicle.nextItpDate || "—"}
              </span>
            </div>
            <div className="tool-detail-line">
              <strong>RCA pana la:</strong>{" "}
              <span style={{ color: getDateColor(vehicle.nextRcaDate) }}>
                {vehicle.nextRcaDate || "—"}
              </span>
            </div>
            <div className="tool-detail-line">
              <strong>CASCO pana la:</strong>{" "}
              <span style={{ color: getDateColor(vehicle.nextCascoDate) }}>
                {vehicle.nextCascoDate || "—"}
              </span>
            </div>

            {vehicle.maintenanceNotes && (
              <div
                className="tool-detail-line"
                style={{
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 4,
                }}
              >
                <strong>Note mentenanta:</strong>
                <span
                  style={{
                    color: "var(--text-soft)",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {vehicle.maintenanceNotes}
                </span>
              </div>
            )}
          </div>
        </div>

        {isOwner && (
          <VehicleChangeDriverCard vehicle={vehicle} users={users} onChanged={loadMeta} />
        )}

        {hasPendingDriverRequest && (
          <div className="panel">
            <h3 className="panel-title">Solicitare schimbare șofer</h3>
            <p className="tools-subtitle" style={{ marginBottom: 12 }}>
              Solicitare pentru: <strong>{vehicle.pendingDriverUserName || "utilizator"}</strong>.
              {vehicle.pendingDriverRequestedAt
                ? ` Trimisă la ${formatDate(vehicle.pendingDriverRequestedAt)}.`
                : ""}
            </p>
            {isPendingForCurrentUser ? (
              <div className="tool-form-actions">
                <button className="primary-btn" type="button" onClick={() => void handleAcceptPendingDriver()}>
                  Acceptă și devino șofer curent
                </button>
              </div>
            ) : (
              <p className="tools-subtitle">În așteptarea acceptării de către utilizatorul selectat.</p>
            )}
          </div>
        )}

        <SectionErrorBoundary sectionName="harta GPS">
          <Suspense
            fallback={
              <div className="panel">
                <h3 className="panel-title">Harta GPS</h3>
                <p className="tools-subtitle">Se incarca modulul harta si istoric...</p>
              </div>
            }
          >
            <VehicleLiveRouteCard
              vehicle={vehicle}
              showControlCard={false}
              onKmEstimateChange={setEstimatedCurrentKm}
            />
          </Suspense>
        </SectionErrorBoundary>

        <div className="panel">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h3 className="panel-title" style={{ margin: 0 }}>
            <ImageIcon size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Galerie foto
          </h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {vehicle.images.length} {vehicle.images.length === 1 ? "poza" : "poze"}
          </span>
        </div>

        {vehicle.images.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <ImageIcon size={20} strokeWidth={1.6} />
            </div>
            <div className="empty-state-title">Nicio poza incarcata</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {isOwner ? "Editeaza vehiculul pentru a adauga poze." : "Nicio poza disponibila."}
            </div>
          </div>
        ) : (
          <div className="tool-gallery">
            {vehicle.images.map((image) => (
              <div key={image.id} className="tool-gallery-item">
                <SafeImage
                  src={image.thumbUrl || image.url}
                  alt={image.fileName || "Poza vehicul"}
                  className="tool-gallery-image"
                  loading="lazy"
                  decoding="async"
                  fallbackText={vehicle.plateNumber}
                />
                {isOwner && (
                  <div className="tool-gallery-actions">
                    <button
                      className="secondary-btn"
                      type="button"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      onClick={() => void handleSetCover(image.url)}
                    >
                      Cover
                    </button>
                    <button
                      className="danger-btn"
                      type="button"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      disabled={deletingImageId === image.id}
                      onClick={() => void handleDeleteImage(image.id)}
                    >
                      {deletingImageId === image.id ? "..." : "Sterge"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </div>


        <div className="panel">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h3 className="panel-title" style={{ margin: 0 }}>
            <FileText size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Documente vehicul
          </h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {vehicle.documents.length} {vehicle.documents.length === 1 ? "document" : "documente"}
          </span>
        </div>

        <VehicleDocumentsPanel
          documents={vehicle.documents}
          isOwner={isOwner}
          deletingDocumentId={deletingDocumentId}
          onDelete={handleDeleteDocument}
        />
        </div>

        <div className="panel">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h3 className="panel-title" style={{ margin: 0 }}>
            <History size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Istoric evenimente
          </h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {events.length} {events.length === 1 ? "eveniment" : "evenimente"}
          </span>
        </div>

        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <History size={20} strokeWidth={1.6} />
            </div>
            <div className="empty-state-title">Niciun eveniment inregistrat</div>
          </div>
        ) : (
          <div className="simple-list">
            {events.map((event) => (
              <div key={event.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{event.message}</div>
                  <div className="simple-list-subtitle">
                    {event.actorUserName || "Sistem"} · {formatDate(event.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </details>
    </section>
  );
}

function getDateColor(dateStr?: string): string {
  if (!dateStr) return "inherit";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "inherit";
  const daysLeft = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) return "var(--danger)";
  if (daysLeft <= 30) return "var(--warning)";
  return "inherit";
}
