import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { VehicleItem } from "../../../types/vehicle";
import { subscribeVehiclesList } from "../services/vehiclesService";
import VehicleStatusBadge from "../components/VehicleStatusBadge";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";

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
      setVehicles(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();

    return vehicles.filter((vehicle) => {
      const matchesSearch =
        !q ||
        vehicle.plateNumber.toLowerCase().includes(q) ||
        vehicle.brand.toLowerCase().includes(q) ||
        vehicle.model.toLowerCase().includes(q) ||
        vehicle.ownerUserName.toLowerCase().includes(q) ||
        vehicle.currentDriverUserName.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === "toate" || vehicle.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [vehicles, search, statusFilter]);

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Masini</h2>
            <p className="tools-subtitle">
              Evidenta flota, responsabil, sofer curent, km si mentenanta.
            </p>
          </div>

          <div className="tools-header-actions">
            <Link to="/vehicles/new" className="primary-btn">
              Adauga masina
            </Link>
          </div>
        </div>

        <div className="tools-filters">
          <input
            className="tool-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cauta dupa numar, marca, model, responsabil sau sofer"
          />

          <select
            className="tool-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="toate">Toate statusurile</option>
            <option value="activa">activa</option>
            <option value="in_service">in_service</option>
            <option value="indisponibila">indisponibila</option>
            <option value="avariata">avariata</option>
          </select>
        </div>

        {error ? (
          <div className="placeholder-page">
            <h2>Eroare</h2>
            <p>{error}</p>
          </div>
        ) : loading ? (
          <div className="placeholder-page">
            <h2>Se incarca...</h2>
            <p>Preluam masinile din Firestore.</p>
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="placeholder-page">
            <h2>Nu exista masini</h2>
            <p>Apasa pe „Adauga masina”.</p>
          </div>
        ) : (
          <div className="tools-grid">
            {filteredVehicles.map((vehicle) => {
const userThemeClass = getUserThemeClass(
  vehicle.currentDriverThemeKey || vehicle.ownerThemeKey || null
);

              return (
                <Link
                  to={`/vehicles/${vehicle.id}`}
                  key={vehicle.id}
                  className="tool-card-link"
                >
                  <div className={`tool-card user-accent-card ${userThemeClass}`}>
                    <div className="tool-card-top">
                      <div className="tool-card-avatar">
                        {vehicle.coverThumbUrl || vehicle.coverImageUrl ? (
                          <img
                            src={vehicle.coverThumbUrl || vehicle.coverImageUrl}
                            alt={vehicle.plateNumber}
                            className="tool-card-avatar-image"
                            loading="lazy"
                          />
                        ) : (
                          <span>{vehicle.brand.slice(0, 1).toUpperCase()}</span>
                        )}
                      </div>

                      <VehicleStatusBadge status={vehicle.status} />
                    </div>

                    <div className="tool-card-title user-accent-title">{vehicle.plateNumber}</div>
                    <div className="tool-card-code">
                      {vehicle.brand} {vehicle.model}
                    </div>

                    <div className="tool-card-meta">
                      <strong>Responsabil:</strong> {vehicle.ownerUserName || "-"}
                    </div>

                    <div className="tool-card-meta">
                      <strong>Sofer curent:</strong> {vehicle.currentDriverUserName || "-"}
                    </div>

                    <div className="tool-card-meta">
                      <strong>Km:</strong> {vehicle.currentKm || 0}
                    </div>

                    <div className="tool-card-actions">
                      <span className="user-accent-chip">
                        <span
                          className="user-accent-avatar"
                          style={{ width: 24, height: 24, fontSize: 10 }}
                        >
                          {getUserInitials(vehicle.currentDriverUserName || vehicle.ownerUserName || "A")}
                        </span>
                        {vehicle.currentDriverUserName || vehicle.ownerUserName || "-"}
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
