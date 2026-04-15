import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AppUser } from "../../../types/tool";
import type { VehicleEventItem, VehicleItem } from "../../../types/vehicle";
import { useAuth } from "../../../providers/AuthProvider";
import VehicleStatusBadge from "../components/VehicleStatusBadge";
import VehicleChangeDriverCard from "../components/VehicleChangeDriverCard";
import VehicleLiveRouteCard from "../components/VehicleLiveRouteCard";
import {
  claimVehicleForCurrentUser,
  getVehicleById,
  getVehicleEvents,
  getVehicleUsers,
  removeVehicleImage,
  setVehicleCoverImage,
} from "../services/vehiclesService";

function formatDate(ts: number) {
  return new Date(ts).toLocaleString("ro-RO");
}

export default function VehicleDetailsPage() {
  const { vehicleId = "" } = useParams();
  const { user } = useAuth();

  const [vehicle, setVehicle] = useState<VehicleItem | null>(null);
  const [events, setEvents] = useState<VehicleEventItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const vehicleData = await getVehicleById(vehicleId);
      setVehicle(vehicleData);

      try {
        const eventsData = await getVehicleEvents(vehicleId);
        setEvents(eventsData);
      } catch (err) {
        console.error(err);
        setEvents([]);
      }

      try {
        const usersData = await getVehicleUsers();
        setUsers(usersData);
      } catch (err) {
        console.error(err);
        setUsers([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [vehicleId]);

  async function handleClaimVehicle() {
    if (!vehicle || !user?.uid) return;
await claimVehicleForCurrentUser(
  vehicle.id,
  user.uid,
  user.displayName || user.email || "Utilizator",
  user.themeKey ?? null
);
    await load();
  }

  async function handleSetCover(url: string) {
    if (!vehicle || !user || vehicle.ownerUserId !== user.uid) return;
    await setVehicleCoverImage(vehicle.id, url);
    await load();
  }

  async function handleDeleteImage(imageId: string) {
    if (!vehicle || !user || vehicle.ownerUserId !== user.uid) return;
    await removeVehicleImage(vehicle.id, vehicle.images, imageId);
    await load();
  }

  const isOwner = useMemo(() => {
    if (!vehicle || !user) return false;
    return vehicle.ownerUserId === user.uid;
  }, [vehicle, user]);

  const needsRepair = useMemo(() => {
    if (!vehicle) return false;
    return !vehicle.ownerUserId || !vehicle.ownerUserName;
  }, [vehicle]);

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca...</h2>
        <p>Preluam profilul masinii.</p>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="placeholder-page">
        <h2>Masina nu a fost gasita</h2>
        <p>Verifica linkul sau lista masinilor.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div className="tool-details-header">
            <div className="tool-details-avatar">
              {vehicle.coverThumbUrl || vehicle.coverImageUrl ? (
                <img
                  src={vehicle.coverThumbUrl || vehicle.coverImageUrl}
                  alt={vehicle.plateNumber}
                  className="tool-details-avatar-image"
                  loading="lazy"
                />
              ) : (
                <span>{vehicle.brand.slice(0, 1).toUpperCase()}</span>
              )}
            </div>

            <div>
              <h2 className="panel-title">{vehicle.plateNumber}</h2>
              <div className="tool-detail-line">
                <strong>Marca / model:</strong> {vehicle.brand} {vehicle.model}
              </div>
              <div className="tool-detail-line">
                <strong>Status:</strong> <VehicleStatusBadge status={vehicle.status} />
              </div>
            </div>
          </div>

          <div className="tools-header-actions">
            {isOwner && (
              <Link to={`/vehicles/${vehicle.id}/edit`} className="primary-btn">
                Editeaza
              </Link>
            )}
            <Link to="/vehicles" className="secondary-btn">
              Inapoi
            </Link>
          </div>
        </div>

        <div className="tool-details-grid">
          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Date generale</h3>

            <div className="tool-detail-line">
              <strong>Responsabil principal:</strong> {vehicle.ownerUserName || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>Sofer curent:</strong> {vehicle.currentDriverUserName || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>An:</strong> {vehicle.year || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>VIN:</strong> {vehicle.vin || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>Combustibil:</strong> {vehicle.fuelType || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>Km curenti:</strong> {vehicle.currentKm || 0}
            </div>
          </div>

          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Mentenanta</h3>

            <div className="tool-detail-line">
              <strong>Urmator service la km:</strong> {vehicle.nextServiceKm || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>ITP pana la:</strong> {vehicle.nextItpDate || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>RCA pana la:</strong> {vehicle.nextRcaDate || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>Note:</strong> {vehicle.maintenanceNotes || "-"}
            </div>
          </div>
        </div>
      </div>

      {needsRepair && user && (
        <div className="panel">
          <h3 className="panel-title">Reparare rapida date masina</h3>
          <p className="tools-subtitle" style={{ marginBottom: 16 }}>
            Aceasta masina are date vechi sau incomplete. O poti trece pe profilul tau.
          </p>

          <div className="tool-form-actions">
            <button className="primary-btn" type="button" onClick={() => void handleClaimVehicle()}>
              Preia responsabilitatea si seteaza-ma sofer curent
            </button>
          </div>
        </div>
      )}

      {isOwner && (
        <VehicleChangeDriverCard vehicle={vehicle} users={users} onChanged={load} />
      )}

      {vehicle.gpsSnapshot && (
        <VehicleLiveRouteCard vehicle={vehicle} />
      )}

      <div className="panel">
        <h3 className="panel-title">Control motor / imobilizare</h3>
        <p className="tools-subtitle" style={{ marginBottom: 16 }}>
          FTC880 poate fi folosit pentru control de iesire digitala si scenarii de imobilizare doar dupa montaj electric corect.
          Pentru “pornire motor din web” nu este suficient trackerul singur si nu este suficient un cablu OBD-C.
        </p>

        <div className="vehicle-engine-warning">
          <strong>Recomandare produs:</strong> transforma actiunea in “Permite pornirea / Blocheaza pornirea” pe releu de imobilizare,
          nu “Porneste motorul”. Pentru pornire reala la distanta ai nevoie de modul dedicat de remote start + montaj auto-electrician.
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Galerie poze</h3>

        {vehicle.images.length === 0 ? (
          <p className="tools-subtitle">Nu exista poze incarcate.</p>
        ) : (
          <div className="tool-gallery">
            {vehicle.images.map((image) => (
              <div key={image.id} className="tool-gallery-item">
                <img
                  src={image.url}
                  alt={image.fileName}
                  className="tool-gallery-image"
                  loading="lazy"
                />

                {isOwner && (
                  <div className="tool-gallery-actions">
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={() => handleSetCover(image.url)}
                    >
                      Seteaza avatar
                    </button>
                    <button
                      className="danger-btn"
                      type="button"
                      onClick={() => handleDeleteImage(image.id)}
                    >
                      Sterge
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">Istoric</h3>

        {events.length === 0 ? (
          <p className="tools-subtitle">Nu exista actiuni inregistrate.</p>
        ) : (
          <div className="simple-list">
            {events.map((event) => (
              <div key={event.id} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{event.message}</div>
                  <div className="simple-list-subtitle">{formatDate(event.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}