import { ExternalLink, Download, FileText, Eye, Trash2 } from "lucide-react";
import type { VehicleDocumentCategory, VehicleDocumentItem } from "../../../types/vehicle";

const categoryLabels: Record<VehicleDocumentCategory, string> = {
  service: "Service + facturi",
  leasing_rate: "Rate leasing",
  rca_itp: "RCA / ITP",
  rovinieta: "Roviniete",
  amenda: "Amenzi",
  other: "Altele",
};

type Props = {
  documents: VehicleDocumentItem[];
  isOwner: boolean;
  deletingDocumentId?: string | null;
  onDelete?: (documentId: string) => Promise<void>;
};

function canInlinePreview(contentType: string): boolean {
  if (!contentType) return false;
  return (
    contentType.startsWith("image/") ||
    contentType === "application/pdf" ||
    contentType.startsWith("text/")
  );
}

export default function VehicleDocumentsPanel({
  documents,
  isOwner,
  deletingDocumentId,
  onDelete,
}: Props) {
  if (!documents.length) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <FileText size={20} strokeWidth={1.6} />
        </div>
        <div className="empty-state-title">Nu există documente încărcate</div>
      </div>
    );
  }

  return (
    <div className="vehicle-doc-grid">
      {documents.map((item) => (
        <article key={item.id} className="vehicle-doc-card">
          <div className="vehicle-doc-card__header">
            <FileText size={16} />
            <div>
              <div className="vehicle-doc-card__name">{item.name}</div>
              <div className="vehicle-doc-card__meta">
                {categoryLabels[item.category]} · {(item.sizeBytes / 1024).toFixed(1)} KB
              </div>
            </div>
          </div>

          {canInlinePreview(item.contentType) ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="vehicle-doc-preview"
              title="Preview document"
            >
              {item.contentType.startsWith("image/") ? (
                <img src={item.url} alt={item.name} loading="lazy" />
              ) : (
                <div className="vehicle-doc-preview__placeholder">
                  <Eye size={16} /> Preview disponibil
                </div>
              )}
            </a>
          ) : (
            <div className="vehicle-doc-preview__placeholder">
              <FileText size={16} />
              Fișier {item.extension.toUpperCase() || "document"}
            </div>
          )}

          <div className="vehicle-doc-card__actions">
            <a className="secondary-btn" href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Deschide
            </a>
            <a className="secondary-btn" href={item.url} download={item.name}>
              <Download size={14} /> Download
            </a>
            {isOwner && onDelete ? (
              <button
                className="danger-btn"
                type="button"
                disabled={deletingDocumentId === item.id}
                onClick={() => void onDelete(item.id)}
              >
                <Trash2 size={14} /> {deletingDocumentId === item.id ? "..." : "Sterge"}
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
