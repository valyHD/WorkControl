import { ExternalLink, Download, FileText, Trash2 } from "lucide-react";
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

function getPreviewKind(contentType: string): "image" | "embed" | "none" {
  if (!contentType) return "none";
  if (contentType.startsWith("image/")) return "image";
  if (
    contentType === "application/pdf" ||
    contentType === "application/json" ||
    contentType.endsWith("+json") ||
    contentType.startsWith("text/")
  ) {
    return "embed";
  }
  return "none";
}

export default function VehicleDocumentsPanel({
  documents,
  isOwner,
  deletingDocumentId,
  onDelete,
}: Props) {
  async function handleDownloadDocument(item: VehicleDocumentItem) {
    try {
      const response = await fetch(item.url, { credentials: "omit" });
      if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = item.name;
      link.rel = "noopener noreferrer";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      const link = document.createElement("a");
      link.href = item.url;
      link.download = item.name;
      link.rel = "noopener noreferrer";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }

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

  const groupedDocuments = documents.reduce<Record<VehicleDocumentCategory, VehicleDocumentItem[]>>(
    (acc, item) => {
      acc[item.category].push(item);
      return acc;
    },
    {
      service: [],
      leasing_rate: [],
      rca_itp: [],
      rovinieta: [],
      amenda: [],
      other: [],
    }
  );

  return (
    <div className="vehicle-doc-sections">
      {(Object.entries(groupedDocuments) as [VehicleDocumentCategory, VehicleDocumentItem[]][])
        .filter(([, items]) => items.length > 0)
        .map(([category, items]) => (
          <section key={category} className="vehicle-doc-section">
            <header className="vehicle-doc-section__header">
              <h4>{categoryLabels[category]}</h4>
              <span>{items.length}</span>
            </header>

            <div className="vehicle-doc-grid">
              {items.map((item) => {
                const previewKind = getPreviewKind(item.contentType);
                return (
                  <article key={item.id} className="vehicle-doc-card">
                    <div className="vehicle-doc-card__header">
                      <FileText size={16} />
                      <div>
                        <div className="vehicle-doc-card__name">{item.name}</div>
                        <div className="vehicle-doc-card__meta">
                          {(item.sizeBytes / 1024).toFixed(1)} KB · {item.extension.toUpperCase() || "document"}
                        </div>
                      </div>
                    </div>

                    {previewKind === "image" ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="vehicle-doc-preview"
                        title="Preview document"
                      >
                        <img src={item.url} alt={item.name} loading="lazy" />
                      </a>
                    ) : previewKind === "embed" ? (
                      <div className="vehicle-doc-preview vehicle-doc-preview--embed">
                        <iframe title={`Preview ${item.name}`} src={item.url} loading="lazy" />
                      </div>
                    ) : (
                      <div className="vehicle-doc-preview__placeholder">
                        <FileText size={16} />
                        Preview indisponibil pentru acest tip de fișier
                      </div>
                    )}

                    <div className="vehicle-doc-card__actions">
                      <a className="secondary-btn" href={item.url} target="_blank" rel="noreferrer">
                        <ExternalLink size={14} /> Deschide
                      </a>
                      <a
                        className="secondary-btn"
                        href={item.url}
                        download={item.name}
                        onClick={(event) => {
                          event.preventDefault();
                          void handleDownloadDocument(item);
                        }}
                      >
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
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
