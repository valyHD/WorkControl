import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SafeImage from "../../../components/SafeImage";
import type { VehicleItem } from "../../../types/vehicle";
import { subscribeVehiclesList } from "../services/vehiclesService";
import VehicleStatusBadge from "../components/VehicleStatusBadge";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import { CarFront, Search } from "lucide-react";

function VehicleCardSkeleton() {
  return (
    <div className="tool-card" style={{ pointerEvents: "none" }}>
      <div className="tool-card-top">
        <div className="skeleton" style={{ width: 56, height: 56, borderRadius: "var(--radius-md)" }} />
        <div className="skeleton" style={{ width: 70, height: 22, borderRadius: "var(--radius-xs)" }} />
      </div>
      <div className="skeleton" style={{ height: 18, width: "55%", marginBottom: 8, marginTop: 4 }} />
      <div className="skeleton" style={{ height: 13, width: "40%", marginBottom: 6 }} />
      <div className="skeleton" style={{ height: 13, width: "65%", marginBottom: 6 }} />
      <div className="skeleton" style={{ height: 13, width: "50%" }} />
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: "toate", label: "Toate statusurile" },
  { value: "activa", label: "Activă" },
  { value: "in_service", label: "În service" },
  { value: "indisponibila", label: "Indisponibilă" },
  { value: "avariata", label: "Avariată" },
];

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("toate");
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");

    const unsubscribe = subscribeVehiclesList((data) => {
      setVehicles(data ?? []);
      setLoading(false);
    });

    return () => {
      try { unsubscribe?.(); } catch (err) {
        console.error("[VehiclesPage][unsubscribe]", err);
      }
    };
  }, []);

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();

    return vehicles.filter((v) => {
      // Safe string access — Firestore may occasionally return missing fields
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

      const matchesStatus =
        statusFilter === "toate" || v.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [vehicles, search, statusFilter]);

  const total = vehicles.length;
  const activeCount = vehicles.filter((v) => v.status === "activa").length;

  return (
    <section className="page-section">
      <div className="panel">
        {/* Header */}
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Mașini</h2>
            <p className="tools-subtitle">
              {loading ? "Se încarcă..." : `${total} vehicule · ${activeCount} active`}
            </p>
          </div>
          <div className="tools-header-actions">
            <Link to="/vehicles/new" className="primary-btn">
              <CarFront size={15} /> Adaugă mașină
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="tools-filters">
          <div style={{ position: "relative", flex: 2 }}>
            <Search
              size={15}
              style={{
                position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
                color: "var(--text-muted)", pointerEvents: "none",
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
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* States */}
        {error ? (
          <div className="placeholder-page">
            <h2>Eroare</h2>
            <p>{error}</p>
            <button className="secondary-btn" onClick={() => window.location.reload()}>Reîncarcă</button>
          </div>
        ) : loading ? (
          <div className="tools-grid">
            {[1, 2, 3, 4, 5, 6].map((i) => <VehicleCardSkeleton key={i} />)}
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><CarFront size={22} strokeWidth={1.6} /></div>
            <div className="empty-state-title">
              {search || statusFilter !== "toate" ? "Nicio mașină nu corespunde filtrelor" : "Nicio mașină adăugată"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              {search || statusFilter !== "toate"
                ? "Modifică filtrele de căutare."
                : "Apasă «Adaugă mașină» pentru a începe."}
            </div>
          </div>
        ) : (
          <div className="tools-grid">
            {filteredVehicles.map((vehicle) => {
              const themeClass = getUserThemeClass(
                vehicle.currentDriverThemeKey || vehicle.ownerThemeKey || null
              );

              return (
                <Link
                  to={`/vehicles/${vehicle.id}`}
                  key={vehicle.id}
                  className="tool-card-link"
                >
                  <div className={`tool-card user-accent-card ${themeClass}`}>
                    <div className="tool-card-top">
                      <div className="tool-card-avatar">
                        <SafeImage
                          src={vehicle.coverThumbUrl || vehicle.coverImageUrl}
                          alt={vehicle.plateNumber}
                          className="tool-card-avatar-image"
                          fallbackText={vehicle.brand || vehicle.plateNumber}
                          sizes="72px"
                        />
                      </div>
                      <VehicleStatusBadge status={vehicle.status} />
                    </div>

                    <div className="tool-card-title user-accent-title">{vehicle.plateNumber}</div>
                    <div className="tool-card-code">
                      {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "—"}
                    </div>

                    <div className="tool-card-meta">
                      <strong>Responsabil:</strong> {vehicle.ownerUserName || "—"}
                    </div>
                    <div className="tool-card-meta">
                      <strong>Șofer curent:</strong> {vehicle.currentDriverUserName || "—"}
                    </div>
                    <div className="tool-card-meta">
                      <strong>Km:</strong> {(vehicle.currentKm || 0).toLocaleString("ro-RO")}
                    </div>

                    <div className="tool-card-actions">
                      <span className="user-accent-chip">
                        <span className="user-accent-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                          {getUserInitials(vehicle.currentDriverUserName || vehicle.ownerUserName || "A")}
                        </span>
                        {vehicle.currentDriverUserName || vehicle.ownerUserName || "—"}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
