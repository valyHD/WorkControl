import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { VehicleDocumentCategory } from "../../../types/vehicle";
import { VEHICLE_DOCUMENT_CATEGORIES } from "../../../types/vehicle";
import { FileText, Trash2 } from "lucide-react";
import {
  isSupportedVehicleDocumentFile,
  VEHICLE_DOCUMENT_ACCEPT,
} from "../utils/vehicleDocumentSummary";

export type VehiclePendingDocument = {
  id: string;
  file: File;
  category: VehicleDocumentCategory;
  expiryDate: string;
};

type Props = {
  selectedDocuments: VehiclePendingDocument[];
  onDocumentsChange: (documents: VehiclePendingDocument[]) => void;
  onUploadImmediately?: (documents: VehiclePendingDocument[]) => Promise<void>;
};

const categoryLabels: Record<VehicleDocumentCategory, string> = {
  service: "Service + facturi",
  itp: "ITP",
  rca: "RCA / Asigurare",
  casco: "CASCO",
  leasing_rate: "Rate leasing",
  rovinieta: "Roviniete",
  amenda: "Amenzi",
  other: "Alte documente",
};

export default function VehicleDocumentUploader({
  selectedDocuments,
  onDocumentsChange,
  onUploadImmediately,
}: Props) {
  const [category, setCategory] = useState<VehicleDocumentCategory>("other");
  const [expiryDate, setExpiryDate] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleFilesSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const invalidFile = files.find((file) => !isSupportedVehicleDocumentFile(file));
    if (invalidFile) {
      setError(`${invalidFile.name} nu este acceptat. Foloseste PDF, JPG, PNG sau WEBP de maximum 18 MB.`);
      event.target.value = "";
      return;
    }

    const pending = files.map((file) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file,
      category,
      expiryDate,
    }));

    setError("");
    event.target.value = "";

    if (onUploadImmediately) {
      setUploading(true);
      try {
        await onUploadImmediately(pending);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Documentul nu a putut fi incarcat si analizat automat."
        );
      } finally {
        setUploading(false);
      }
      return;
    }

    onDocumentsChange([...selectedDocuments, ...pending]);
  }

  function removeSelected(id: string) {
    onDocumentsChange(selectedDocuments.filter((item) => item.id !== id));
  }

  const countByCategory = useMemo(() => {
    return selectedDocuments.reduce<Record<VehicleDocumentCategory, number>>(
      (acc, item) => {
        acc[item.category] += 1;
        return acc;
      },
      {
        service: 0,
        itp: 0,
        rca: 0,
        casco: 0,
        leasing_rate: 0,
        rovinieta: 0,
        amenda: 0,
        other: 0,
      }
    );
  }, [selectedDocuments]);

  return (
    <div className="vehicle-doc-uploader">
      <div className="vehicle-doc-uploader__controls">
        <label className="tool-form-label">Categorie inițială</label>
        <select
          className="tool-input"
          value={category}
          onChange={(event) => setCategory(event.target.value as VehicleDocumentCategory)}
        >
          {VEHICLE_DOCUMENT_CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {categoryLabels[item]}
            </option>
          ))}
        </select>

        <label className="tool-form-label">Data expirare</label>
        <input
          className="tool-input"
          type="date"
          value={expiryDate}
          onChange={(event) => setExpiryDate(event.target.value)}
        />

        <label
          className="secondary-btn"
          style={{ alignSelf: "flex-end", opacity: uploading ? 0.65 : 1 }}
          aria-disabled={uploading}
        >
          {uploading ? "Se incarca si se citeste..." : "Alege documente"}
          <input
            type="file"
            multiple
            accept={VEHICLE_DOCUMENT_ACCEPT}
            onChange={handleFilesSelect}
            disabled={uploading}
            style={{ display: "none" }}
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <p className="tools-subtitle" style={{ marginTop: 8 }}>
        Pentru bonuri de rovinietă poți lăsa „Alte documente”. WorkControl detectează automat
        tipul și data expirării.
      </p>

      {selectedDocuments.length > 0 ? (
        <div className="vehicle-doc-list">
          {selectedDocuments.map((item) => (
            <div key={item.id} className="vehicle-doc-item">
              <div className="vehicle-doc-item__main">
                <FileText size={16} />
                <div>
                  <div className="vehicle-doc-item__name">{item.file.name}</div>
                  <div className="vehicle-doc-item__meta">
                    {categoryLabels[item.category]} · {(item.file.size / 1024).toFixed(1)} KB
                    {item.expiryDate ? ` · expira ${item.expiryDate}` : ""}
                  </div>
                </div>
              </div>
              <button
                className="danger-btn"
                type="button"
                onClick={() => removeSelected(item.id)}
                style={{ padding: "4px 8px" }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="tools-subtitle" style={{ marginTop: 8 }}>
          Accepta PDF, JPG, PNG sau WEBP, maximum 18 MB per document.
        </p>
      )}

      <div className="vehicle-doc-counters">
        {VEHICLE_DOCUMENT_CATEGORIES.map((item) => (
          <span key={item} className="tool-cover-chip">
            {categoryLabels[item]}: {countByCategory[item]}
          </span>
        ))}
      </div>
    </div>
  );
}
