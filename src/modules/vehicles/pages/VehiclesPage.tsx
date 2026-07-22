import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SafeImage, { preloadImageUrls } from "../../../components/SafeImage";
import type { VehicleItem } from "../../../types/vehicle";
import { subscribeVehiclesList } from "../services/vehiclesService";
import VehicleStatusBadge from "../components/VehicleStatusBadge";
import { getUserThemeClass } from "../../../lib/ui/userTheme";
import { CarFront, Grid3X3, List, MapPinned, Search, Table2 } from "lucide-react";
import UserProfileLink from "../../../components/UserProfileLink";
import { VehicleGpsVisibilityToggle } from "../components/VehicleGpsVisibilityGate";
import { ErrorState, PageHeader, PageLayout } from "../../../components/experience";
import ProductTabs from "../../../components/product/ProductTabs";
import DataTable, { type DataTableColumn } from "../../../components/DataTable";
import StatusBadge from "../../../components/StatusBadge";
import SavedViewsBar from "../../../components/product/SavedViewsBar";
import { useFeatureFlags } from "../../../lib/productIntelligence";
import { useAuth } from "../../../providers/AuthProvider";
import {
  getVehicleDocumentAttentionItems,
  getVehicleDocumentExpiryItems,
} from "../utils/vehicleDocumentExpiry";

type VehicleSavedView = {
  search: string;
  statusFilter: string;
  driverFilter: string;
  gpsFilter: string;
  attentionFilter: string;
  viewMode: "cards" | "table";
};

function VehicleCardSkeleton() {
  return (
    <div className="tool-card" style={{ pointerEvents: "none" }}>
      <div className="tool-card-top">
        <div
          className="skeleton"
          style={{ width: 56, height: 56, borderRadius: "var(--radius-md)" }}
        />
        <div
          className="skeleton"
          style={{ width: 70, height: 22, borderRadius: "var(--radius-xs)" }}
        />
      </div>
      <div
        className="skeleton"
        style={{ height: 18, width: "55%", marginBottom: 8, marginTop: 4 }}
      />
      <div className="skeleton" style={{ height: 13, width: "40%", marginBottom: 6 }} />
      <div className="skeleton" style={{ height: 13, width: "65%", marginBottom: 6 }} />
      <div className="skeleton" style={{ height: 13, width: "50%" }} />
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: "toate", label: "Toate statusurile" },
  { value: "activa", label: "Activ?" },
  { value: "in_service", label: "În service" },
  { value: "indisponibila", label: "Indisponibil?" },
  { value: "avariata", label: "Avariat?" },
];

function formatDataBytes(value: unknown) {
  const bytes = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  const formatter = new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  if (bytes >= 1024 * 1024 * 1024) {
    return `${formatter.format(bytes / (1024 * 1024 * 1024))} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${formatter.format(bytes / (1024 * 1024))} MB`;
  }

  if (bytes >= 1024) {
    return `${formatter.format(bytes / 1024)} KB`;
  }

  return `${formatter.format(bytes)} B`;
}

function getCurrentGpsDataUsageMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  return `${year}_${month}`;
}

function getGpsFreshness(vehicle: VehicleItem, now = Date.now()) {
  const lastSeen = Number(
    vehicle.gpsSnapshot?.serverTimestamp ||
      vehicle.gpsSnapshot?.gpsTimestamp ||
      vehicle.tracker?.lastSeenAt ||
      0
  );
  if (!lastSeen) return { id: "missing", label: "Fara GPS", tone: "muted" as const };
  const ageMinutes = Math.max(0, (now - lastSeen) / 60_000);
  if (ageMinutes <= 10) return { id: "fresh", label: "GPS live", tone: "green" as const };
  if (ageMinutes <= 120) return { id: "stale", label: "GPS intarziat", tone: "orange" as const };
  return { id: "offline", label: "GPS offline", tone: "red" as const };
}

function hasVehicleDocumentAlert(vehicle: VehicleItem, now = Date.now()) {
  return getVehicleDocumentExpiryItems(vehicle, new Date(now)).some((item) => item.daysLeft <= 30);
}

function hasVehicleServiceAlert(vehicle: VehicleItem) {
  return Boolean(
    vehicle.status === "in_service" ||
    vehicle.status === "avariata" ||
    (vehicle.nextServiceKm > 0 && vehicle.nextServiceKm - vehicle.currentKm <= 1_000)
  );
}

export default function VehiclesPage() {
  const { user } = useAuth();
  const { flags } = useFeatureFlags();
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("toate");
  const [driverFilter, setDriverFilter] = useState("toate");
  const [gpsFilter, setGpsFilter] = useState("toate");
  const [attentionFilter, setAttentionFilter] = useState("toate");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [error, setError] = useState("");
  const savedViewValue = useMemo<VehicleSavedView>(() => ({
    search,
    statusFilter,
    driverFilter,
    gpsFilter,
    attentionFilter,
    viewMode,
  }), [attentionFilter, driverFilter, gpsFilter, search, statusFilter, viewMode]);

  const applySavedView = (view: VehicleSavedView) => {
    setSearch(view.search || "");
    setStatusFilter(view.statusFilter || "toate");
    setDriverFilter(view.driverFilter || "toate");
    setGpsFilter(view.gpsFilter || "toate");
    setAttentionFilter(view.attentionFilter || "toate");
    setViewMode(view.viewMode === "table" ? "table" : "cards");
  };

  useEffect(() => {
    setLoading(true);
    setError("");

    const unsubscribe = subscribeVehiclesList((data) => {
      setVehicles(data ?? []);
      setLoading(false);
    });

    return () => {
      try {
        unsubscribe?.();
      } catch (err) {
        console.error("[VehiclesPage][unsubscribe]", err);
      }
    };
  }, []);

  useEffect(() => {
    preloadImageUrls(
      vehicles.map((vehicle) => vehicle.coverThumbUrl || vehicle.coverImageUrl),
      48
    );
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();

    return vehicles.filter((v) => {
      // Safe string access ? Firestore may occasionally return missing fields
      const plate = (v.plateNumber || "").toLowerCase();
      const brand = (v.brand || "").toLowerCase();
      const model = (v.model || "").toLowerCase();
      const owner = (v.ownerUserName || "").toLowerCase();
      const driver = (v.currentDriverUserName || "").toLowerCase();

      const matchesSearch =
        !q ||
        plate.includes(q) ||
        brand.includes(q) ||
        model.includes(q) ||
        owner.includes(q) ||
        driver.includes(q);

      const matchesStatus = statusFilter === "toate" || v.status === statusFilter;
      const matchesDriver =
        driverFilter === "toate" ||
        (driverFilter === "assigned" ? Boolean(v.currentDriverUserId) : !v.currentDriverUserId);
      const gpsFreshness = getGpsFreshness(v);
      const matchesGps = gpsFilter === "toate" || gpsFreshness.id === gpsFilter;
      const documentAlert = hasVehicleDocumentAlert(v);
      const serviceAlert = hasVehicleServiceAlert(v);
      const matchesAttention =
        attentionFilter === "toate" ||
        (attentionFilter === "documents" && documentAlert) ||
        (attentionFilter === "service" && serviceAlert) ||
        (attentionFilter === "alerts" && (documentAlert || serviceAlert));

      return matchesSearch && matchesStatus && matchesDriver && matchesGps && matchesAttention;
    });
  }, [attentionFilter, driverFilter, gpsFilter, vehicles, search, statusFilter]);

  const total = vehicles.length;
  const activeCount = vehicles.filter((v) => v.status === "activa").length;
  const documentAttentionItems = useMemo(
    () => getVehicleDocumentAttentionItems(vehicles),
    [vehicles]
  );
  const tableColumns = useMemo<DataTableColumn<VehicleItem>[]>(
    () => [
      {
        key: "vehicle",
        header: "Masina",
        render: (vehicle) => (
          <Link className="wc-vehicle-table-identity" to={`/vehicles/${vehicle.id}`}>
            <strong>{vehicle.plateNumber}</strong>
            <span>{[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "-"}</span>
          </Link>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (vehicle) => <VehicleStatusBadge status={vehicle.status} />,
      },
      {
        key: "driver",
        header: "Sofer",
        render: (vehicle) => vehicle.currentDriverUserName || "Nealocat",
      },
      {
        key: "gps",
        header: "GPS",
        render: (vehicle) => {
          const freshness = getGpsFreshness(vehicle);
          return <StatusBadge tone={freshness.tone}>{freshness.label}</StatusBadge>;
        },
      },
      {
        key: "documents",
        header: "Documente",
        render: (vehicle) => (
          <StatusBadge tone={hasVehicleDocumentAlert(vehicle) ? "orange" : "green"}>
            {hasVehicleDocumentAlert(vehicle) ? "Verifica" : `${vehicle.documents.length} OK`}
          </StatusBadge>
        ),
      },
      {
        key: "service",
        header: "Service",
        render: (vehicle) => (
          <StatusBadge tone={hasVehicleServiceAlert(vehicle) ? "orange" : "green"}>
            {hasVehicleServiceAlert(vehicle) ? "Atentie" : "OK"}
          </StatusBadge>
        ),
      },
      {
        key: "km",
        header: "Kilometri",
        render: (vehicle) => `${(vehicle.currentKm || 0).toLocaleString("ro-RO")} km`,
      },
      {
        key: "actions",
        header: "Actiuni",
        render: (vehicle) => (
          <Link className="secondary-btn secondary-btn--compact" to={`/vehicles/${vehicle.id}`}>
            Detalii
          </Link>
        ),
      },
    ],
    []
  );

  return (
    <PageLayout>
      <PageHeader
        eyebrow="Flotă"
        title="Mașini"
        description={loading ? "Se încarcă flota..." : `${total} vehicule · ${activeCount} active`}
        actions={[
          {
            id: "gps",
            label: "Toate GPS-urile",
            to: "/vehicles/gps-map",
            icon: MapPinned,
            assistantAction: "open-fleet-gps",
          },
          {
            id: "new",
            label: "Adaugă mașină",
            to: "/vehicles/new",
            icon: CarFront,
            tone: "primary",
            assistantAction: "create-vehicle",
          },
        ]}
      />

      <ProductTabs
        activeId="list"
        tabs={[
          { id: "list", label: "Listă flotă", to: "/vehicles", icon: List },
          {
            id: "map",
            label: "Hartă GPS",
            to: "/vehicles/gps-map",
            icon: MapPinned,
            assistantAction: "open-fleet-gps",
          },
        ]}
      />

      {!loading && documentAttentionItems.length > 0 ? (
        <section className="panel" aria-labelledby="vehicle-document-attention-title">
          <div className="tools-header tools-header--compact">
            <div>
              <h2 className="panel-title" id="vehicle-document-attention-title">
                Documente care necesită atenție
              </h2>
              <p className="tools-subtitle">
                Expirate sau cu cel mult 30 de zile rămase. Lista folosește datele flotei deja încărcate.
              </p>
            </div>
            <StatusBadge tone="orange">{documentAttentionItems.length}</StatusBadge>
          </div>
          <div className="simple-list">
            {documentAttentionItems.slice(0, 8).map((item) => {
              const urgent = item.status === "expired" || item.status === "today" || item.status === "critical";
              const statusLabel = item.daysLeft < 0
                ? `Expirat de ${Math.abs(item.daysLeft)} zile`
                : item.daysLeft === 0
                  ? "Expiră astăzi"
                  : item.daysLeft === 1
                    ? "Expiră mâine"
                    : `${item.daysLeft} zile rămase`;
              return (
                <Link
                  key={item.id}
                  className="simple-list-item"
                  to={`/vehicles/${item.vehicleId}?tab=documents&focus=upload`}
                >
                  <div className="simple-list-text">
                    <span className="simple-list-label">{item.plateNumber} · {item.label}</span>
                    <span className="simple-list-subtitle">Expirare: {item.expiryDate}</span>
                  </div>
                  <StatusBadge tone={urgent ? "red" : "orange"}>{statusLabel}</StatusBadge>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="panel">
        <div className="tools-header tools-header--compact">
          <div>
            <h2 className="panel-title">Flotă</h2>
            <p className="tools-subtitle">Status, șofer, kilometri și documente.</p>
          </div>
          <div className="wc-list-view-actions">
            <div className="wc-segmented-control" aria-label="Mod afisare flota">
              <button
                type="button"
                className={viewMode === "cards" ? "is-active" : ""}
                onClick={() => setViewMode("cards")}
                title="Afisare carduri"
              >
                <Grid3X3 size={16} />
              </button>
              <button
                type="button"
                className={viewMode === "table" ? "is-active" : ""}
                onClick={() => setViewMode("table")}
                title="Afisare tabel"
              >
                <Table2 size={16} />
              </button>
            </div>
            <VehicleGpsVisibilityToggle />
          </div>
        </div>

        {/* Filters */}
        <div className="tools-filters">
          <div style={{ position: "relative", flex: 2 }}>
            <Search
              size={15}
              style={{
                position: "absolute",
                left: 11,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
                pointerEvents: "none",
              }}
            />
            <input
              className="tool-input"
              style={{ paddingLeft: 34 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Caută după număr, marcă, model, responsabil sau șofer"
            />
          </div>

          <select
            className="tool-input"
            style={{ flex: 1 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="tool-input"
            value={driverFilter}
            onChange={(event) => setDriverFilter(event.target.value)}
          >
            <option value="toate">Toti soferii</option>
            <option value="assigned">Cu sofer</option>
            <option value="unassigned">Fara sofer</option>
          </select>
          <select
            className="tool-input"
            value={gpsFilter}
            onChange={(event) => setGpsFilter(event.target.value)}
          >
            <option value="toate">Orice status GPS</option>
            <option value="fresh">GPS live</option>
            <option value="stale">GPS intarziat</option>
            <option value="offline">GPS offline</option>
            <option value="missing">Fara GPS</option>
          </select>
          <select
            className="tool-input"
            value={attentionFilter}
            onChange={(event) => setAttentionFilter(event.target.value)}
          >
            <option value="toate">Toate alertele</option>
            <option value="alerts">Necesita atentie</option>
            <option value="documents">Documente</option>
            <option value="service">Service</option>
          </select>
        </div>

        {flags.savedViews && user?.uid ? (
          <SavedViewsBar
            namespace="vehicles"
            userId={user.uid}
            value={savedViewValue}
            onApply={applySavedView}
          />
        ) : null}

        {/* States */}
        {error ? (
          <ErrorState
            title="Flota nu a putut fi incarcata"
            description={error}
            retry={() => window.location.reload()}
          />
        ) : loading ? (
          <div className="tools-grid">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <VehicleCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <CarFront size={22} strokeWidth={1.6} />
            </div>
            <div className="empty-state-title">
              {search || statusFilter !== "toate"
                ? "Nicio mașină nu corespunde filtrelor"
                : "Nicio mașină adăugată"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              {search || statusFilter !== "toate"
                ? "Modifică filtrele de căutare."
                : "Apasă Adaugă mașină pentru a începe."}
            </div>
          </div>
        ) : viewMode === "table" ? (
          <DataTable
            columns={tableColumns}
            rows={filteredVehicles}
            rowKey={(vehicle) => vehicle.id}
            empty={null}
          />
        ) : (
          <div className="tools-grid">
            {filteredVehicles.map((vehicle, index) => {
              const themeClass = getUserThemeClass(
                vehicle.currentDriverThemeKey || vehicle.ownerThemeKey || null
              );
              const prioritizeImage = index < 18;

              return (
                <Link to={`/vehicles/${vehicle.id}`} key={vehicle.id} className="tool-card-link">
                  <div className={`tool-card user-accent-card ${themeClass}`}>
                    <div className="tool-card-top">
                      <div className="tool-card-avatar">
                        <SafeImage
                          src={vehicle.coverThumbUrl || vehicle.coverImageUrl}
                          alt={vehicle.plateNumber}
                          className="tool-card-avatar-image"
                          fallbackText={vehicle.brand || vehicle.plateNumber}
                          loading={prioritizeImage ? "eager" : "lazy"}
                          fetchPriority={prioritizeImage ? "high" : "low"}
                          sizes="72px"
                        />
                      </div>
                      <VehicleStatusBadge status={vehicle.status} />
                    </div>

                    <div className="tool-card-title user-accent-title">{vehicle.plateNumber}</div>
                    <div className="tool-card-code">
                      {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "?"}
                    </div>

                    <div className="tool-card-meta">
                      <strong>Responsabil:</strong>{" "}
                      <UserProfileLink
                        userId={vehicle.ownerUserId}
                        name={vehicle.ownerUserName}
                        themeKey={vehicle.ownerThemeKey}
                        fallback="-"
                        className="user-profile-link--plain"
                      />
                    </div>
                    <div className="tool-card-meta">
                      <strong>Sofer curent:</strong>{" "}
                      <UserProfileLink
                        userId={vehicle.currentDriverUserId}
                        name={vehicle.currentDriverUserName}
                        themeKey={vehicle.currentDriverThemeKey}
                        fallback="-"
                        className="user-profile-link--plain"
                      />
                    </div>
                    <div className="tool-card-meta">
                      <strong>Km:</strong> {(vehicle.currentKm || 0).toLocaleString("ro-RO")}
                    </div>
                    <div className="tool-card-meta">
                      <strong>Date GPS luna:</strong>{" "}
                      {(() => {
                        const monthKey =
                          vehicle.gpsDataUsage?.currentMonthKey || getCurrentGpsDataUsageMonthKey();
                        const monthUsage = vehicle.gpsDataUsage?.months?.[monthKey];
                        return formatDataBytes(
                          monthUsage?.totalBytes ||
                            (monthUsage?.rxBytes || 0) + (monthUsage?.txBytes || 0)
                        );
                      })()}
                    </div>

                    <div className="tool-card-actions">
                      <UserProfileLink
                        userId={vehicle.currentDriverUserId || vehicle.ownerUserId}
                        name={vehicle.currentDriverUserName || vehicle.ownerUserName}
                        themeKey={vehicle.currentDriverThemeKey || vehicle.ownerThemeKey}
                        fallback="-"
                        showAvatar
                        avatarClassName="user-profile-small-avatar"
                        className="user-profile-link--chip"
                      />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
