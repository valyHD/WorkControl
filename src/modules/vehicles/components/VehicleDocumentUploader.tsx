import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { VehicleDocumentCategory } from "../../../types/vehicle";
import { VEHICLE_DOCUMENT_CATEGORIES } from "../../../types/vehicle";
import { FileText, Trash2 } from "lucide-react";

export type VehiclePendingDocument = {
  id: string;
  file: File;
  category: VehicleDocumentCategory;
};

type Props = {
  selectedDocuments: VehiclePendingDocument[];
  onDocumentsChange: (documents: VehiclePendingDocument[]) => void;
};

const categoryLabels: Record<VehicleDocumentCategory, string> = {
  service: "Service + facturi",
  leasing_rate: "Rate leasing",
  rca_itp: "RCA / ITP",
  rovinieta: "Roviniete",
  amenda: "Amenzi",
  other: "Alte documente",
};

export default function VehicleDocumentUploader({
  selectedDocuments,
  onDocumentsChange,
}: Props) {
  const [category, setCategory] = useState<VehicleDocumentCategory>("service");

  function handleFilesSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    const pending = files.map((file) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file,
      category,
    }));

    onDocumentsChange([...selectedDocuments, ...pending]);
    event.target.value = "";
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
        leasing_rate: 0,
        rca_itp: 0,
        rovinieta: 0,
        amenda: 0,
        other: 0,
      }
    );
  }, [selectedDocuments]);

  return (
    <div className="vehicle-doc-uploader">
      <div className="vehicle-doc-uploader__controls">
        <label className="tool-form-label">Categorie document</label>
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

        <label className="secondary-btn" style={{ alignSelf: "flex-end" }}>
          Alege documente
          <input
            type="file"
            multiple
            onChange={handleFilesSelect}
            style={{ display: "none" }}
          />
        </label>
      </div>

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
          Acceptă orice tip de fișier (PDF, Word, Excel, imagini etc.).
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
