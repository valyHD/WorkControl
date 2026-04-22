import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type {
  AppUser,
  ToolFormValues,
  ToolImageItem,
  ToolStatus,
} from "../../../types/tool";
import ToolImageUploader from "./ToolImageUploader";
import SafeImage from "../../../components/SafeImage";

type Props = {
  initialValues: ToolFormValues;
  users: AppUser[];
  onSubmit: (values: ToolFormValues, selectedFiles: File[]) => Promise<void>;
  submitting: boolean;
};

const statusOptions: ToolStatus[] = ["depozit", "atribuita", "defecta", "pierduta"];

export default function ToolForm({ initialValues, users, onSubmit, submitting }: Props) {
  const [values, setValues] = useState<ToolFormValues>(initialValues);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  function updateField<K extends keyof ToolFormValues>(field: K, value: ToolFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleOwnerChange(event: ChangeEvent<HTMLSelectElement>) {
    const selectedId = event.target.value;
    const user = users.find((item) => item.id === selectedId);

    setValues((prev) => {
      const nextOwnerName = user?.fullName ?? "";

      const noHolderYet = !prev.currentHolderUserId;
      const nextHolderId = noHolderYet ? selectedId : prev.currentHolderUserId;
      const nextHolderName = noHolderYet ? nextOwnerName : prev.currentHolderUserName;

      const nextLocationType = nextHolderId ? "utilizator" : "depozit";
      const nextLocationLabel = nextHolderId ? `La ${nextHolderName}` : "Depozit";
      const nextStatus =
        prev.status === "defecta" || prev.status === "pierduta"
          ? prev.status
          : nextHolderId
          ? "atribuita"
          : "depozit";

      return {
        ...prev,
        ownerUserId: selectedId,
        ownerUserName: nextOwnerName,
        currentHolderUserId: nextHolderId,
        currentHolderUserName: nextHolderName,
        locationType: nextLocationType,
        locationLabel: nextLocationLabel,
        status: nextStatus,
      };
    });
  }

  function handleCurrentHolderChange(event: ChangeEvent<HTMLSelectElement>) {
    const selectedId = event.target.value;
    const user = users.find((item) => item.id === selectedId);

    setValues((prev) => {
      const nextHolderName = user?.fullName ?? "";
      const nextLocationType = selectedId ? "utilizator" : "depozit";
      const nextLocationLabel = selectedId ? `La ${nextHolderName}` : "Depozit";

      const nextStatus =
        prev.status === "defecta" || prev.status === "pierduta"
          ? prev.status
          : selectedId
          ? "atribuita"
          : "depozit";

      return {
        ...prev,
        currentHolderUserId: selectedId,
        currentHolderUserName: nextHolderName,
        locationType: nextLocationType,
        locationLabel: nextLocationLabel,
        status: nextStatus,
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(values, selectedFiles);
  }

  const canSubmit = useMemo(() => {
    return values.name.trim() && values.internalCode.trim();
  }, [values]);

  return (
    <form className="tool-form" onSubmit={handleSubmit}>
      <div className="tool-form-grid">
        <div className="tool-form-block">
          <label className="tool-form-label">Nume scula *</label>
          <input
            className="tool-input"
            value={values.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="Ex: Bormasina Bosch"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Cod intern *</label>
          <input
            className="tool-input"
            value={values.internalCode}
            onChange={(e) => updateField("internalCode", e.target.value)}
            placeholder="Ex: SC-001"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Cod QR asociat</label>
          <input
            className="tool-input"
            value={values.qrCodeValue}
            onChange={(e) => updateField("qrCodeValue", e.target.value)}
            placeholder="Ex: codul citit de pe eticheta QR"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Status</label>
          <select
            className="tool-input"
            value={values.status}
            onChange={(e) => updateField("status", e.target.value as ToolStatus)}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
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
          <label className="tool-form-label">Detinator curent</label>
          <select
            className="tool-input"
            value={values.currentHolderUserId}
            onChange={handleCurrentHolderChange}
          >
            <option value="">In depozit</option>
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
          <label className="tool-form-label">Locatie curenta / cine o are</label>
          <input
            className="tool-input"
            value={values.locationLabel}
            onChange={(e) => updateField("locationLabel", e.target.value)}
            placeholder="Ex: Depozit / La Marian / In masina service 2"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Garantie manuala</label>
          <input
            className="tool-input"
            value={values.warrantyText}
            onChange={(e) => updateField("warrantyText", e.target.value)}
            placeholder="Ex: Garantie extinsa 36 luni"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Garantie pana la</label>
          <input
            className="tool-input"
            type="date"
            value={values.warrantyUntil}
            onChange={(e) => updateField("warrantyUntil", e.target.value)}
          />
        </div>

        <div className="tool-form-block tool-form-block-full">
          <label className="tool-form-label">Descriere</label>
          <textarea
            className="tool-input tool-textarea"
            value={values.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Detalii manuale despre scula"
          />
        </div>

        <div className="tool-form-block tool-form-block-full">
          <ToolImageUploader selectedFiles={selectedFiles} onFilesChange={setSelectedFiles} />
        </div>

        {values.images.length > 0 && (
          <div className="tool-form-block tool-form-block-full">
            <label className="tool-form-label">Poze existente</label>
            <div className="tool-gallery">
              {values.images.map((image: ToolImageItem) => (
                <div key={image.id} className="tool-gallery-item">
                  <SafeImage
                    src={image.thumbUrl || image.url}
                    alt={image.fileName}
                    className="tool-gallery-image"
                    loading="lazy"
                    decoding="async"
                    fallbackText={values.name || "S"}
                  />
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
          {submitting ? "Se salveaza..." : "Salveaza scula"}
        </button>
      </div>
    </form>
  );
}
