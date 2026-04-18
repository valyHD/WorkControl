import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { AppUser } from "../../../types/tool";
import type {
  VehicleFormValues,
  VehicleImageItem,
  VehicleStatus,
} from "../../../types/vehicle";
import VehicleImageUploader from "./VehicleImageUploader";

type Props = {
  initialValues: VehicleFormValues;
  users: AppUser[];
  onSubmit: (values: VehicleFormValues, selectedFiles: File[]) => Promise<void>;
  submitting: boolean;
};

const statusOptions: VehicleStatus[] = [
  "activa",
  "in_service",
  "indisponibila",
  "avariata",
];

export default function VehicleForm({
  initialValues,
  users,
  onSubmit,
  submitting,
}: Props) {
  const [values, setValues] = useState<VehicleFormValues>(initialValues);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  function updateField<K extends keyof VehicleFormValues>(
    field: K,
    value: VehicleFormValues[K]
  ) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleOwnerChange(event: ChangeEvent<HTMLSelectElement>) {
    const selectedId = event.target.value;
    const user = users.find((item) => item.id === selectedId);

    setValues((prev) => {
      const nextOwnerName = user?.fullName ?? "";
      const noDriverYet = !prev.currentDriverUserId;
      const nextDriverId = noDriverYet ? selectedId : prev.currentDriverUserId;
      const nextDriverName = noDriverYet ? nextOwnerName : prev.currentDriverUserName;

      return {
        ...prev,
        ownerUserId: selectedId,
        ownerUserName: nextOwnerName,
        currentDriverUserId: nextDriverId,
        currentDriverUserName: nextDriverName,
      };
    });
  }

  function handleDriverChange(event: ChangeEvent<HTMLSelectElement>) {
    const selectedId = event.target.value;
    const user = users.find((item) => item.id === selectedId);

    setValues((prev) => ({
      ...prev,
      currentDriverUserId: selectedId,
      currentDriverUserName: user?.fullName ?? "",
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(values, selectedFiles);
  }

  const canSubmit = useMemo(() => {
    return (
      values.plateNumber.trim() &&
      values.brand.trim() &&
      values.model.trim()
    );
  }, [values]);

  return (
    <form className="tool-form" onSubmit={handleSubmit}>
      <div className="tool-form-grid">
        <div className="tool-form-block">
          <label className="tool-form-label">Numar inmatriculare *</label>
          <input
            className="tool-input"
            value={values.plateNumber}
            onChange={(e) => updateField("plateNumber", e.target.value.toUpperCase())}
            placeholder="Ex: B123ABC"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Marca *</label>
          <input
            className="tool-input"
            value={values.brand}
            onChange={(e) => updateField("brand", e.target.value)}
            placeholder="Ex: Ford"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Model *</label>
          <input
            className="tool-input"
            value={values.model}
            onChange={(e) => updateField("model", e.target.value)}
            placeholder="Ex: Transit"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">An</label>
          <input
            className="tool-input"
            value={values.year}
            onChange={(e) => updateField("year", e.target.value)}
            placeholder="Ex: 2020"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Serie sasiu (VIN)</label>
          <input
            className="tool-input"
            value={values.vin}
            onChange={(e) => updateField("vin", e.target.value)}
            placeholder="Ex: WF0..."
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Combustibil</label>
          <input
            className="tool-input"
            value={values.fuelType}
            onChange={(e) => updateField("fuelType", e.target.value)}
            placeholder="Ex: diesel"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Status</label>
          <select
            className="tool-input"
            value={values.status}
            onChange={(e) => updateField("status", e.target.value as VehicleStatus)}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Km reali la înregistrare</label>
          <input
            className="tool-input"
            type="number"
            value={values.initialRecordedKm}
            onChange={(e) => updateField("initialRecordedKm", Number(e.target.value || 0))}
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Km curenți</label>
          <input
            className="tool-input"
            type="number"
            value={values.currentKm}
            onChange={(e) => updateField("currentKm", Number(e.target.value || 0))}
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Responsabil principal</label>
          <select
            className="tool-input"
            value={values.ownerUserId}
            onChange={handleOwnerChange}
          >
            <option value="">Fara responsabil</option>
            {users
              .filter((user) => user.active !== false)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
          </select>
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Sofer curent</label>
          <select
            className="tool-input"
            value={values.currentDriverUserId}
            onChange={handleDriverChange}
          >
            <option value="">Fara sofer curent</option>
            {users
              .filter((user) => user.active !== false)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
          </select>
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Tip prag service</label>
          <select
            className="tool-input"
            value={values.serviceStrategy}
            onChange={(e) => updateField("serviceStrategy", e.target.value as VehicleFormValues["serviceStrategy"])}
          >
            <option value="interval">Interval km (ex: la 15.000 km)</option>
            <option value="absolute">Kilometraj fix pentru revizie</option>
          </select>
        </div>

        {values.serviceStrategy === "interval" ? (
          <div className="tool-form-block">
            <label className="tool-form-label">Revizie la fiecare (km)</label>
            <input
              className="tool-input"
              type="number"
              value={values.serviceIntervalKm}
              onChange={(e) => updateField("serviceIntervalKm", Number(e.target.value || 0))}
            />
          </div>
        ) : (
          <div className="tool-form-block">
            <label className="tool-form-label">Prag service (km total)</label>
            <input
              className="tool-input"
              type="number"
              value={values.nextServiceKm}
              onChange={(e) => updateField("nextServiceKm", Number(e.target.value || 0))}
            />
          </div>
        )}

        <div className="tool-form-block">
          <label className="tool-form-label">Următor service calculat</label>
          <input
            className="tool-input"
            type="number"
            disabled
            value={
              values.serviceStrategy === "interval"
                ? Number(values.currentKm || 0) + Number(values.serviceIntervalKm || 0)
                : Number(values.nextServiceKm || 0)
            }
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">ITP pana la</label>
          <input
            className="tool-input"
            type="date"
            value={values.nextItpDate}
            onChange={(e) => updateField("nextItpDate", e.target.value)}
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">RCA pana la</label>
          <input
            className="tool-input"
            type="date"
            value={values.nextRcaDate}
            onChange={(e) => updateField("nextRcaDate", e.target.value)}
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">CASCO până la</label>
          <input
            className="tool-input"
            type="date"
            value={values.nextCascoDate}
            onChange={(e) => updateField("nextCascoDate", e.target.value)}
          />
        </div>

        <div className="tool-form-block tool-form-block-full">
          <label className="tool-form-label">Note mentenanta</label>
          <textarea
            className="tool-input tool-textarea"
            value={values.maintenanceNotes}
            onChange={(e) => updateField("maintenanceNotes", e.target.value)}
            placeholder="Detalii revizie, distributie, observatii"
          />
        </div>

        <div className="tool-form-block tool-form-block-full">
          <VehicleImageUploader
            selectedFiles={selectedFiles}
            onFilesChange={setSelectedFiles}
          />
        </div>

        {values.images.length > 0 && (
          <div className="tool-form-block tool-form-block-full">
            <label className="tool-form-label">Poze existente</label>
            <div className="tool-gallery">
              {values.images.map((image: VehicleImageItem) => (
                <div key={image.id} className="tool-gallery-item">
                  <img src={image.url} alt={image.fileName} className="tool-gallery-image" />
                  {values.coverImageUrl === image.url && (
                    <span className="tool-cover-chip">Poza principala</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="tool-form-actions">
        <button className="primary-btn" type="submit" disabled={!canSubmit || submitting}>
          {submitting ? "Se salveaza..." : "Salveaza masina"}
        </button>
      </div>
    </form>
  );
}
