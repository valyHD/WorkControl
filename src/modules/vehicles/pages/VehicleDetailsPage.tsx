import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AppUser } from "../../../types/tool";
import type {
  VehicleDocumentItem,
  VehicleEventItem,
  VehicleImageItem,
  VehicleItem,
  VehiclePositionItem,
} from "../../../types/vehicle";
import { useAuth } from "../../../providers/AuthProvider";
import SafeImage from "../../../components/SafeImage";
import { SectionErrorBoundary } from "../../../lib/errors/SectionErrorBoundary";
import UserProfileLink from "../../../components/UserProfileLink";
import VehicleStatusBadge from "../components/VehicleStatusBadge";
import VehicleChangeDriverCard from "../components/VehicleChangeDriverCard";
import VehicleDocumentsPanel from "../components/VehicleDocumentsPanel";
import GpsSimulatorPanel from "../components/GpsSimulatorPanel";
import ProductTabs from "../../../components/product/ProductTabs";
import UniversalTimeline from "../../../components/product/UniversalTimeline";
import { canUseGpsSimulator } from "../hooks/useGpsSimulator";
import {
  acceptVehicleDriverChange,
  addVehicleComment,
  claimVehicleForCurrentUser,
  deleteVehicle,
  getVehicleEvents,
  getVehicleUsers,
  removeVehicleDocument,
  removeVehicleImage,
  restoreVehicleCoverImage,
  restoreVehicleDocuments,
  restoreVehicleImages,
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
  Navigation,
  RotateCcw,
  Activity,
} from "lucide-react";

const VehicleLiveRouteCard = lazy(() => import("../components/VehicleLiveRouteCard"));
const KM_ESTIMATE_REFRESH_MS = 3_000;

interface VehicleUndoAction {
  id: string;
  label: string;
  run: () => Promise<void>;
}

function formatDate(ts?: number) {
  if (!ts) return "?";
  return new Date(ts).toLocaleString("ro-RO");
}

function getTrustedTotalOdometerKm(value: unknown, initialRecordedKm: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  if (initialRecordedKm > 0 && value < initialRecordedKm) return 0;
  return value;
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
    <section className="page-section vehicle-details-page">
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

function VehicleSectionDropdown({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
    }
  }, [defaultOpen]);

  return (
    <details className="panel vehicle-section-dropdown" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="vehicle-section-dropdown__summary">
        <span className="panel-title">{title}</span>
        {subtitle ? <span className="tools-subtitle">{subtitle}</span> : null}
      </summary>
      {isOpen ? <div className="vehicle-section-dropdown__body">{children}</div> : null}
    </details>
  );
}

export default function VehicleDetailsPage() {
  const { vehicleId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { role, user } = useAuth();
  const mountedRef = useRef(true);

  const [vehicle, setVehicle] = useState<VehicleItem | null>(null);
  const [events, setEvents] = useState<VehicleEventItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [metaLoading, setMetaLoading] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [deletingVehicle, setDeletingVehicle] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMsg, setClaimMsg] = useState("");
  const [estimatedCurrentKm, setEstimatedCurrentKm] = useState<number | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [simulationPositions, setSimulationPositions] = useState<VehiclePositionItem[]>([]);
  const [simulationPlannedPositions, setSimulationPlannedPositions] = useState<VehiclePositionItem[]>([]);
  const [simulationActive, setSimulationActive] = useState(false);
  const [undoStack, setUndoStack] = useState<VehicleUndoAction[]>([]);
  const [undoBusy, setUndoBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const estimatedKmUpdateRef = useRef({ km: 0, updatedAt: 0 });
  const requestedTabRaw = searchParams.get("tab") || (location.hash === "#vehicle-tracker-live-section" ? "gps" : "general");
  const requestedTab = requestedTabRaw === "history" ? "timeline" : requestedTabRaw;
  const activeTab = ["general", "gps", "timeline", "maintenance", "documents", "expenses", "drivers", "settings"].includes(requestedTab)
    ? requestedTab
    : "general";

  function selectVehicleTab(tab: string) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }

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
    if (!vehicle || !user || !canManageVehicle) return;

    const previousCoverImageUrl = vehicle.coverImageUrl || "";
    const previousCoverThumbUrl = vehicle.coverThumbUrl || "";
    if (previousCoverImageUrl === url) return;

    try {
      await setVehicleCoverImage(vehicle.id, url);
      pushUndoAction({
        label: "Poza principala a fost schimbata.",
        run: () => restoreVehicleCoverImage(vehicle.id, previousCoverImageUrl, previousCoverThumbUrl),
      });
    } catch (err) {
      console.error("[VehicleDetailsPage][setCover]", err);
    }
  }

  async function handleDeleteImage(imageId: string) {
    if (!vehicle || !user || !canManageVehicle || deletingImageId) return;

    setDeletingImageId(imageId);
    const previousImages = [...vehicle.images] as VehicleImageItem[];
    const previousCoverImageUrl = vehicle.coverImageUrl || "";
    const previousCoverThumbUrl = vehicle.coverThumbUrl || "";
    try {
      await removeVehicleImage(vehicle.id, vehicle.images, imageId);
      pushUndoAction({
        label: "Poza a fost stearsa.",
        run: () => restoreVehicleImages(vehicle.id, previousImages, previousCoverImageUrl, previousCoverThumbUrl),
      });
    } catch (err) {
      console.error("[VehicleDetailsPage][deleteImage]", err);
    } finally {
      setDeletingImageId(null);
    }
  }


  async function handleDeleteDocument(documentId: string) {
    if (!vehicle || !user || !canManageVehicle || deletingDocumentId) return;

    setDeletingDocumentId(documentId);
    const previousDocuments = [...vehicle.documents] as VehicleDocumentItem[];
    try {
      await removeVehicleDocument(vehicle.id, vehicle.documents, documentId);
      pushUndoAction({
        label: "Documentul a fost sters.",
        run: () => restoreVehicleDocuments(vehicle.id, previousDocuments),
      });
    } catch (err) {
      console.error("[VehicleDetailsPage][deleteDocument]", err);
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function handleDeleteVehicle() {
    if (!vehicle || !canManageVehicle || deletingVehicle) return;
    const ok = window.confirm(`Stergi masina "${vehicle.plateNumber || vehicle.brand || vehicle.id}"?`);
    if (!ok) return;

    setDeletingVehicle(true);
    try {
      await deleteVehicle(vehicle.id);
      navigate("/vehicles");
    } catch (err) {
      console.error("[VehicleDetailsPage][deleteVehicle]", err);
      setDeletingVehicle(false);
    }
  }

  function pushUndoAction(action: Omit<VehicleUndoAction, "id">) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setUndoStack((current) => [...current.slice(-9), { id, ...action }]);
  }

  async function handleUndoLastAction() {
    const action = undoStack[undoStack.length - 1];
    if (!action || undoBusy) return;

    setUndoBusy(true);
    try {
      await action.run();
      setUndoStack((current) => current.filter((item) => item.id !== action.id));
    } catch (err) {
      console.error("[VehicleDetailsPage][undo]", err);
    } finally {
      setUndoBusy(false);
    }
  }

  const isOwner = useMemo(() => {
    if (!vehicle || !user) return false;
    return vehicle.ownerUserId === user.uid;
  }, [vehicle, user]);
  const canManageVehicle = isOwner || role === "admin";

  const canShowSimulator = useMemo(() => canUseGpsSimulator(user?.email), [user?.email]);
  const shouldOpenTrackerSection = location.hash === "#vehicle-tracker-live-section";

  useEffect(() => {
    if (!shouldOpenTrackerSection) return;
    window.setTimeout(() => {
      document.getElementById("vehicle-tracker-live-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 180);
  }, [shouldOpenTrackerSection, vehicle?.id]);

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
      { label: "Rovinieta", date: vehicle.nextRovinietaDate },
    ].filter((a) => Boolean(a.date));
  }, [vehicle]);

  const displayedCurrentKm = useMemo(() => {
    if (!vehicle) return 0;
    const initialRecordedKm = vehicle.initialRecordedKm || 0;
    if (typeof estimatedCurrentKm === "number" && Number.isFinite(estimatedCurrentKm)) {
      return estimatedCurrentKm;
    }
    const trustedGpsOdometerKm = getTrustedTotalOdometerKm(
      vehicle.gpsSnapshot?.odometerKm,
      initialRecordedKm
    );
    if (trustedGpsOdometerKm > 0) {
      return Math.max(
        trustedGpsOdometerKm,
        typeof vehicle.currentKm === "number" && Number.isFinite(vehicle.currentKm)
          ? vehicle.currentKm
          : 0
      );
    }
    if (
      typeof vehicle.currentKm === "number" &&
      Number.isFinite(vehicle.currentKm) &&
      vehicle.currentKm >= initialRecordedKm
    ) {
      return vehicle.currentKm;
    }
    return initialRecordedKm;
  }, [estimatedCurrentKm, vehicle]);

  useEffect(() => {
    if (!vehicle) return;
    const hasActiveRoute =
      Boolean(vehicle.gpsSim) &&
      vehicle.gpsSim?.active !== false &&
      (vehicle.gpsSim?.points?.length ?? 0) > 0;

    if (hasActiveRoute) return;

    const initialRecordedKm = vehicle.initialRecordedKm || 0;
    const trustedGpsOdometerKm = getTrustedTotalOdometerKm(
      vehicle.gpsSnapshot?.odometerKm,
      initialRecordedKm
    );
    const storedKm =
      typeof vehicle.currentKm === "number" &&
      Number.isFinite(vehicle.currentKm) &&
      vehicle.currentKm >= initialRecordedKm
        ? vehicle.currentKm
        : initialRecordedKm;
    const liveKm = Math.max(trustedGpsOdometerKm, storedKm);
    estimatedKmUpdateRef.current = { km: liveKm, updatedAt: Date.now() };
    setEstimatedCurrentKm(null);
  }, [
    vehicle?.currentKm,
    vehicle?.gpsSim,
    vehicle?.gpsSnapshot?.gpsTimestamp,
    vehicle?.gpsSnapshot?.odometerKm,
    vehicle?.initialRecordedKm,
  ]);

  const handleKmEstimateChange = useCallback((km: number) => {
    if (!Number.isFinite(km)) return;

    const now = Date.now();
    const previous = estimatedKmUpdateRef.current;
    const changedEnough = Math.abs(km - previous.km) >= 0.05;
    const waitedEnough = now - previous.updatedAt >= KM_ESTIMATE_REFRESH_MS;

    if (!changedEnough && !waitedEnough) return;

    const trustedGpsOdometerKm = getTrustedTotalOdometerKm(
      vehicle?.gpsSnapshot?.odometerKm,
      vehicle?.initialRecordedKm || 0
    );
    const nextKm = Math.max(km, trustedGpsOdometerKm);

    estimatedKmUpdateRef.current = { km: nextKm, updatedAt: now };
    setEstimatedCurrentKm((current) => {
      if (typeof current === "number" && Math.abs(current - nextKm) < 0.01) return current;
      return nextKm;
    });
  }, [vehicle?.gpsSnapshot?.odometerKm, vehicle?.initialRecordedKm]);

  async function handleAddComment() {
    if (!vehicle || !user?.uid || commentBusy) return;
    const cleanComment = commentText.trim();
    if (!cleanComment) return;

    setCommentBusy(true);
    try {
      await addVehicleComment(vehicle.id, cleanComment, {
        actorUserId: user.uid,
        actorUserName: user.displayName || user.email || "Utilizator",
        actorUserThemeKey: user.themeKey ?? null,
      });
      setCommentText("");
      await loadMeta();
    } finally {
      setCommentBusy(false);
    }
  }

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
    <section className="page-section vehicle-details-page">
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
                fetchPriority="high"
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
                    ? {vehicle.year}
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
                <Link to={`/vehicles/${vehicle.id}/live`} className="primary-btn">
                  <Activity size={14} /> Detalii live
                </Link>
                {canManageVehicle && (
                  <>
                    <Link to={`/vehicles/${vehicle.id}/edit`} className="primary-btn">
                      <Pencil size={14} /> Editeaza
                    </Link>
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={() => void handleDeleteVehicle()}
                      disabled={deletingVehicle}
                    >
                      {deletingVehicle ? "Se sterge..." : "Sterge masina"}
                    </button>
                  </>
                )}
                {canShowSimulator && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setShowSimulator((value) => !value)}
                  >
                    <Navigation size={14} />
                    {showSimulator ? "Inchide panou" : "Trimite notificare"}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={!undoStack.length || undoBusy}
                  title={undoStack.length ? "Anuleaza ultima actiune" : "Nu ai nicio actiune de anulat"}
                  onClick={() => void handleUndoLastAction()}
                >
                  <RotateCcw size={14} />
                  Undo
                </button>
                <Link to="/vehicles" className="secondary-btn">
                  <ArrowLeft size={14} /> Inapoi
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ProductTabs
        activeId={activeTab}
        onChange={selectVehicleTab}
        label="Detalii mașină"
        tabs={[
          { id: "general", label: "Overview", assistantAction: "vehicle-tab-general" },
          { id: "gps", label: "GPS", assistantAction: "vehicle-tab-gps" },
          { id: "timeline", label: "Timeline", badge: events.length, assistantAction: "vehicle-tab-timeline" },
          { id: "maintenance", label: "Mentenanță", badge: maintenanceAlerts.length || undefined, assistantAction: "vehicle-tab-maintenance" },
          { id: "documents", label: "Documente", badge: vehicle.documents.length, assistantAction: "vehicle-tab-documents" },
          { id: "expenses", label: "Cheltuieli", assistantAction: "vehicle-tab-expenses" },
          { id: "drivers", label: "Soferi", assistantAction: "vehicle-tab-drivers" },
          { id: "settings", label: "Setari", assistantAction: "vehicle-tab-settings" },
        ]}
      />

      {undoStack.length > 0 && (
        <div className="vehicle-undo-bar">
          <span>{undoStack[undoStack.length - 1]?.label}</span>
          <button
            type="button"
            className="secondary-btn"
            disabled={undoBusy}
            onClick={() => void handleUndoLastAction()}
          >
            <RotateCcw size={14} />
            Undo
          </button>
        </div>
      )}

      <div className="wc-vehicle-tab-panel" hidden={activeTab !== "general"}>
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

      <VehicleSectionDropdown title="Date generale" defaultOpen>
        <div className="tool-detail-line">
          <strong>Responsabil:</strong>{" "}
          <UserProfileLink userId={vehicle.ownerUserId} name={vehicle.ownerUserName} themeKey={vehicle.ownerThemeKey} />
        </div>
        <div className="tool-detail-line">
          <strong>Sofer curent:</strong>{" "}
          <UserProfileLink
            userId={vehicle.currentDriverUserId}
            name={vehicle.currentDriverUserName}
            themeKey={vehicle.currentDriverThemeKey}
          />
        </div>
        <div className="tool-detail-line">
          <strong>An fabricatie:</strong> {vehicle.year || "?"}
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
            {vehicle.vin || "?"}
          </span>
        </div>
        <div className="tool-detail-line">
          <strong>Combustibil:</strong> {vehicle.fuelType || "?"}
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
      </VehicleSectionDropdown>
      </div>

      <div className="wc-vehicle-tab-panel" hidden={activeTab !== "maintenance"}>
      <VehicleSectionDropdown title="Mentenanta">
        <div className="tool-detail-line">
          <strong>Urmator service la:</strong>{" "}
          {vehicle.nextServiceKm ? `${vehicle.nextServiceKm.toLocaleString("ro-RO")} km` : "?"}
        </div>
        <div className="tool-detail-line">
          <strong>ITP pana la:</strong>{" "}
          <span style={{ color: getDateColor(vehicle.nextItpDate) }}>{vehicle.nextItpDate || "?"}</span>
        </div>
        <div className="tool-detail-line">
          <strong>RCA pana la:</strong>{" "}
          <span style={{ color: getDateColor(vehicle.nextRcaDate) }}>{vehicle.nextRcaDate || "?"}</span>
        </div>
        <div className="tool-detail-line">
          <strong>CASCO pana la:</strong>{" "}
          <span style={{ color: getDateColor(vehicle.nextCascoDate) }}>
            {vehicle.nextCascoDate || "?"}
          </span>
        </div>
        <div className="tool-detail-line">
          <strong>Rovinieta pana la:</strong>{" "}
          <span style={{ color: getDateColor(vehicle.nextRovinietaDate) }}>
            {vehicle.nextRovinietaDate || "?"}
          </span>
        </div>
        <div className="tool-detail-line">
          <strong>Revizie ulei la:</strong>{" "}
          {vehicle.nextOilServiceKm ? `${vehicle.nextOilServiceKm.toLocaleString("ro-RO")} km` : "?"}
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
      </VehicleSectionDropdown>
      </div>

      <div className="wc-vehicle-tab-panel" hidden={activeTab !== "drivers"}>
      <VehicleSectionDropdown title="Schimba soferul curent">
        {canManageVehicle && <VehicleChangeDriverCard vehicle={vehicle} users={users} onChanged={loadMeta} />}

        {hasPendingDriverRequest && (
          <div className="panel" style={{ marginTop: canManageVehicle ? 10 : 0 }}>
            <h3 className="panel-title">Solicitare schimbare ?ofer</h3>
            <p className="tools-subtitle" style={{ marginBottom: 12 }}>
              Solicitare pentru:{" "}
              <UserProfileLink
                userId={vehicle.pendingDriverUserId}
                name={vehicle.pendingDriverUserName}
                themeKey={vehicle.pendingDriverThemeKey}
                fallback="utilizator"
                className="user-profile-link--plain"
              />.
              ? {vehicle.pendingDriverRequestedAt
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
      </VehicleSectionDropdown>
      </div>

      <div className="wc-vehicle-tab-panel" hidden={activeTab !== "gps"}>
      <div id="vehicle-tracker-live-section">
      <VehicleSectionDropdown title="Tracker live" defaultOpen={shouldOpenTrackerSection}>
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
              onKmEstimateChange={handleKmEstimateChange}
              simulationPositions={simulationPositions}
              simulationPlannedPositions={simulationPlannedPositions}
              simulationActive={simulationActive}
            />
          </Suspense>
        </SectionErrorBoundary>
      </VehicleSectionDropdown>
      </div>

      {canShowSimulator && showSimulator ? (
        <GpsSimulatorPanel
          vehicle={vehicle}
          defaultExpanded
          onSimulationPositionsChange={setSimulationPositions}
          onSimulationPlannedPositionsChange={setSimulationPlannedPositions}
          onSimulationActiveChange={setSimulationActive}
        />
      ) : null}
      </div>

      <div className="wc-vehicle-tab-panel" hidden={activeTab !== "documents"}>
      <VehicleSectionDropdown title="Galerie foto">
        <div>
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
              {canManageVehicle ? "Editeaza vehiculul pentru a adauga poze." : "Nicio poza disponibila."}
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
                {canManageVehicle && (
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
      </VehicleSectionDropdown>

      <VehicleSectionDropdown title="Documente vehicul">
        <div>
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
          vehicleId={vehicle.id}
          documents={vehicle.documents}
          isOwner={canManageVehicle}
          deletingDocumentId={deletingDocumentId}
          onDelete={handleDeleteDocument}
        />
        </div>
      </VehicleSectionDropdown>
      </div>

      <div className="wc-vehicle-tab-panel" hidden={activeTab !== "timeline"}>
      <VehicleSectionDropdown title="Istoric evenimente si comentarii">
        <div>
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
            Istoric evenimente si comentarii
          </h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {events.length} {events.length === 1 ? "eveniment" : "evenimente"}
          </span>
        </div>

        <div className="asset-comment-box">
          <label className="tool-form-label">Adauga comentariu / observatie</label>
          <p className="tools-subtitle" style={{ margin: 0 }}>
            Comentariile despre masina se scriu aici: defecte, predari, reparatii, documente sau observatii zilnice.
          </p>
          <textarea
            className="tool-input tool-textarea"
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            placeholder="Ex: schimbat ulei, lovitura bara fata, predat curat, verificat documente..."
          />
          <div className="tool-form-actions">
            <button
              className="primary-btn"
              type="button"
              disabled={commentBusy || !commentText.trim()}
              onClick={() => void handleAddComment()}
            >
              {commentBusy ? "Se adauga..." : "Adauga comentariu"}
            </button>
          </div>
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
                    <UserProfileLink
                      userId={event.actorUserId}
                      name={event.actorUserName || "Sistem"}
                      themeKey={event.actorUserThemeKey}
                    />
                    {" "}· {formatDate(event.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </VehicleSectionDropdown>
      </div>

      <div className="wc-vehicle-tab-panel" hidden={activeTab !== "expenses"}>
        <div className="panel">
          <div className="panel-head">
            <div><h2 className="panel-title">Cheltuieli mașină</h2><p className="panel-subtitle">Bonuri, facturi și rapoarte asociate flotei.</p></div>
          </div>
          <div className="tool-form-actions">
            <Link className="primary-btn" to={`/expenses/scan?vehicleId=${encodeURIComponent(vehicle.id)}`} data-assistant-action="vehicle-add-expense">Scanează bon</Link>
            <Link className="secondary-btn" to={`/expenses/reports?vehicleId=${encodeURIComponent(vehicle.id)}`} data-assistant-action="vehicle-view-expenses">Vezi rapoarte</Link>
          </div>
        </div>
      </div>

      <div className="wc-vehicle-tab-panel" hidden={activeTab !== "timeline"}>
        <div className="panel">
          <div className="panel-head"><div><h2 className="panel-title">Timeline mașină</h2><p className="panel-subtitle">Evenimentele importante, în ordine cronologică.</p></div></div>
          <UniversalTimeline
            entityType="vehicle"
            items={events.map((event) => ({
              id: event.id,
              title: event.message,
              description: event.actorUserName || "Sistem",
              timestamp: event.createdAt,
              tone: event.type === "comment" ? "blue" : "muted",
            }))}
          />
        </div>
      </div>

      <div className="wc-vehicle-tab-panel" hidden={activeTab !== "settings"}>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Setari masina</h2>
              <p className="panel-subtitle">Date administrative, responsabilitate si configurarea vehiculului.</p>
            </div>
          </div>
          <div className="tool-form-actions">
            {canManageVehicle ? <Link className="primary-btn" to={`/vehicles/${vehicle.id}/edit`}>Editeaza masina</Link> : null}
            <Link className="secondary-btn" to={`/vehicles/${vehicle.id}/live`}>Date live FMC130</Link>
          </div>
        </div>
      </div>
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
