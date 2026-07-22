import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type {
  VehicleDocumentCategory,
  VehicleDocumentIngestionJob,
  VehicleDocumentItem,
  VehicleDocumentIntelligenceStatus,
} from "../../../types/vehicle";
import { downloadFileFromUrl } from "../../../lib/files/downloadFile";
import {
  applyVehicleDocumentIngestionJob,
  getVehicleDocumentIngestionJob,
  queueVehicleDocumentsForAnalysis,
  rejectVehicleDocumentIngestionJob,
  retryVehicleDocumentIngestionJob,
  rollbackVehicleDocumentIngestionJob,
  saveVehicleDocuments,
  uploadVehicleDocuments,
} from "../services/vehiclesService";
import VehicleDocumentUploader from "./VehicleDocumentUploader";
import type { VehiclePendingDocument } from "./VehicleDocumentUploader";
import "../styles/vehicle-documents.css";

const categoryLabels: Record<VehicleDocumentCategory, string> = {
  service: "Service + facturi",
  itp: "ITP",
  rca: "RCA / Asigurare",
  casco: "CASCO",
  leasing_rate: "Rate leasing",
  rovinieta: "Roviniete",
  amenda: "Amenzi",
  other: "Altele",
};

const intelligenceLabels: Record<VehicleDocumentIntelligenceStatus, string> = {
  queued: "În așteptare",
  processing: "Se citește",
  needs_review: "Necesită verificare",
  applied: "Confirmat",
  rejected: "Respins",
  failed: "Analiză eșuată",
};

const DOCUMENT_JOB_POLL_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 30_000];

type Props = {
  vehicleId: string;
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

function confidenceLabel(value?: number) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value || 0))) * 100)}%`;
}

function getEffectiveStatus(item: VehicleDocumentItem, job?: VehicleDocumentIngestionJob) {
  if (item.intelligenceStatus === "applied" || item.intelligenceStatus === "rejected") {
    return item.intelligenceStatus;
  }
  if (job?.decision === "applied") return "applied";
  if (job?.decision === "rejected") return "rejected";
  if (job?.decision === "rolled_back") return "needs_review";
  return job?.status || item.intelligenceStatus;
}

export default function VehicleDocumentsPanel({
  vehicleId,
  documents,
  isOwner,
  deletingDocumentId,
  onDelete,
}: Props) {
  const [jobsByDocument, setJobsByDocument] = useState<Record<string, VehicleDocumentIngestionJob>>(
    {}
  );
  const [busyDocumentId, setBusyDocumentId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [pendingDocuments, setPendingDocuments] = useState<VehiclePendingDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const pollCountRef = useRef(0);

  const reviewableDocuments = useMemo(
    () =>
      documents.filter(
        (item) =>
          item.intelligenceJobId && !["applied", "rejected"].includes(item.intelligenceStatus || "")
      ),
    [documents]
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    pollCountRef.current = 0;

    async function refreshJobs() {
      if (!reviewableDocuments.length || document.visibilityState === "hidden") return;
      const entries = await Promise.all(
        reviewableDocuments.map(async (item) => {
          try {
            const job = await getVehicleDocumentIngestionJob({
              vehicleId,
              documentId: item.id,
              jobId: item.intelligenceJobId || "",
            });
            return [item.id, job] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      const nextJobs = Object.fromEntries(
        entries.filter((entry): entry is readonly [string, VehicleDocumentIngestionJob] =>
          Boolean(entry)
        )
      );
      setJobsByDocument((current) => ({ ...current, ...nextJobs }));
      const stillProcessing = Object.values(nextJobs).some((job) =>
        ["queued", "processing"].includes(job.status)
      );
      if (
        stillProcessing &&
        document.visibilityState === "visible" &&
        pollCountRef.current < DOCUMENT_JOB_POLL_DELAYS_MS.length
      ) {
        const delay = DOCUMENT_JOB_POLL_DELAYS_MS[pollCountRef.current];
        pollCountRef.current += 1;
        timer = setTimeout(() => void refreshJobs(), delay);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        if (timer) clearTimeout(timer);
        timer = undefined;
        return;
      }
      pollCountRef.current = 0;
      void refreshJobs();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void refreshJobs();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [reviewableDocuments, vehicleId]);

  async function handleDownloadDocument(item: VehicleDocumentItem) {
    await downloadFileFromUrl({ url: item.url, fileName: item.name });
  }

  async function handleUploadDocuments() {
    if (!pendingDocuments.length || uploading) return;
    setUploading(true);
    setActionMessage("");
    try {
      const uploaded = await uploadVehicleDocuments(vehicleId, pendingDocuments);
      await saveVehicleDocuments(vehicleId, documents, uploaded);
      await queueVehicleDocumentsForAnalysis(vehicleId, uploaded);
      setPendingDocuments([]);
      setActionMessage(
        "Documentele au fost încărcate. WorkControl citește automat rovinieta, data expirării și configurează notificarea cu 7 zile înainte."
      );
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Documentele nu au putut fi încărcate."
      );
    } finally {
      setUploading(false);
    }
  }

  function jobReference(item: VehicleDocumentItem) {
    return {
      vehicleId,
      documentId: item.id,
      jobId: item.intelligenceJobId || "",
    };
  }

  async function runDocumentAction(
    item: VehicleDocumentItem,
    action: "apply" | "reject" | "retry" | "rollback"
  ) {
    if (!item.intelligenceJobId || busyDocumentId) return;
    setBusyDocumentId(item.id);
    setActionMessage("");
    try {
      if (action === "apply") {
        const result = jobsByDocument[item.id]?.result;
        const acceptedFields: Array<"documentType" | "expiryDate"> = [];
        if (result?.documentType.value && result.documentType.value !== "unknown")
          acceptedFields.push("documentType");
        if (result?.expiryDate.value) acceptedFields.push("expiryDate");
        if (!acceptedFields.length)
          throw new Error("Analiza nu conține câmpuri sigure de aplicat.");
        await applyVehicleDocumentIngestionJob(jobReference(item), acceptedFields);
        setJobsByDocument((current) => ({
          ...current,
          [item.id]: { ...current[item.id], decision: "applied" },
        }));
        setActionMessage("Datele documentului au fost confirmate și salvate.");
      } else if (action === "reject") {
        await rejectVehicleDocumentIngestionJob(jobReference(item));
        setJobsByDocument((current) => ({
          ...current,
          [item.id]: { ...current[item.id], decision: "rejected" },
        }));
        setActionMessage("Sugestiile AI au fost respinse. Datele mașinii nu au fost schimbate.");
      } else if (action === "retry") {
        await retryVehicleDocumentIngestionJob(jobReference(item));
        setJobsByDocument((current) => ({
          ...current,
          [item.id]: { ...current[item.id], status: "queued", errorCode: undefined },
        }));
        setActionMessage("Analiza documentului a fost repornită.");
      } else {
        await rollbackVehicleDocumentIngestionJob(jobReference(item));
        setJobsByDocument((current) => ({
          ...current,
          [item.id]: { ...current[item.id], decision: "rolled_back" },
        }));
        setActionMessage("Aplicarea a fost anulată. Valorile anterioare au fost restaurate.");
      }
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Acțiunea nu a putut fi finalizată."
      );
    } finally {
      setBusyDocumentId("");
    }
  }

  const groupedDocuments = documents.reduce<Record<VehicleDocumentCategory, VehicleDocumentItem[]>>(
    (acc, item) => {
      acc[item.category].push(item);
      return acc;
    },
    {
      service: [],
      itp: [],
      rca: [],
      casco: [],
      leasing_rate: [],
      rovinieta: [],
      amenda: [],
      other: [],
    }
  );

  return (
    <div className="vehicle-doc-sections">
      {isOwner ? (
        <section className="vehicle-doc-upload-card" aria-label="Încarcă document vehicul">
          <div>
            <h4>Încarcă document sau bon</h4>
            <p>
              O fotografie cu bonul de rovinietă este citită automat, fără să deschizi editarea
              kilometrilor.
            </p>
          </div>
          <VehicleDocumentUploader
            selectedDocuments={pendingDocuments}
            onDocumentsChange={setPendingDocuments}
          />
          <button
            className="primary-btn"
            type="button"
            disabled={!pendingDocuments.length || uploading}
            onClick={() => void handleUploadDocuments()}
          >
            {uploading ? "Se încarcă și se citește..." : "Încarcă și citește automat"}
          </button>
        </section>
      ) : null}
      {actionMessage ? (
        <div className="vehicle-doc-action-message" aria-live="polite">
          {actionMessage}
        </div>
      ) : null}
      {!documents.length ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <FileText size={20} strokeWidth={1.6} />
          </div>
          <div className="empty-state-title">Nu există documente încărcate</div>
        </div>
      ) : null}
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
                const job = jobsByDocument[item.id];
                const intelligenceStatus = getEffectiveStatus(item, job);
                const extraction = job?.result;
                const isBusy = busyDocumentId === item.id;
                return (
                  <article key={item.id} className="vehicle-doc-card">
                    <div className="vehicle-doc-card__header">
                      <FileText size={16} />
                      <div>
                        <div className="vehicle-doc-card__name">{item.name}</div>
                        <div className="vehicle-doc-card__meta">
                          {(item.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                          {item.extension.toUpperCase() || "document"}
                          {item.expiryDate ? ` · expiră ${item.expiryDate}` : ""}
                          {item.aiAnalysis?.confidence
                            ? ` · AI ${confidenceLabel(item.aiAnalysis.confidence)}`
                            : ""}
                        </div>
                      </div>
                      {intelligenceStatus ? (
                        <span
                          className={`vehicle-doc-intelligence-status is-${intelligenceStatus}`}
                        >
                          {intelligenceLabels[intelligenceStatus]}
                        </span>
                      ) : null}
                    </div>

                    {previewKind === "image" ? (
                      <a
                        href={item.url}
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
                        <FileText size={16} /> Preview indisponibil pentru acest tip de fișier
                      </div>
                    )}

                    {item.category === "rovinieta" && item.expirySource === "ai_auto" ? (
                      <div className="vehicle-doc-auto-success">
                        Rovinietă detectată automat. Expiră la {item.expiryDate}; șoferul curent
                        va fi notificat cu 7 zile înainte.
                      </div>
                    ) : null}

                    {intelligenceStatus === "needs_review" && extraction && isOwner ? (
                      <div className="vehicle-doc-review" aria-label="Verificare date extrase">
                        <div className="vehicle-doc-review__title">
                          <FileSearch size={16} /> Verifică înainte de aplicare
                        </div>
                        <div className="vehicle-doc-review__grid">
                          <div>
                            <span>Tip document</span>
                            <strong>{extraction.documentType.value || "Necunoscut"}</strong>
                            <small>{confidenceLabel(extraction.documentType.confidence)}</small>
                          </div>
                          <div>
                            <span>Expirare</span>
                            <strong>{extraction.expiryDate.value || "Nedetectată"}</strong>
                            <small>{confidenceLabel(extraction.expiryDate.confidence)}</small>
                          </div>
                          <div>
                            <span>Emitent</span>
                            <strong>{extraction.providerName.value || "Nedetectat"}</strong>
                            <small>{confidenceLabel(extraction.providerName.confidence)}</small>
                          </div>
                          <div>
                            <span>Număr document</span>
                            <strong>{extraction.policyNumber.value || "Nedetectat"}</strong>
                            <small>{confidenceLabel(extraction.policyNumber.confidence)}</small>
                          </div>
                        </div>
                        {extraction.notes ? <p>{extraction.notes}</p> : null}
                        <div className="vehicle-doc-review__actions">
                          <button
                            className="primary-btn"
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runDocumentAction(item, "apply")}
                          >
                            <Check size={15} /> Aplică datele
                          </button>
                          <button
                            className="secondary-btn"
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runDocumentAction(item, "reject")}
                          >
                            <X size={15} /> Respinge
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {intelligenceStatus === "failed" && isOwner ? (
                      <div className="vehicle-doc-review vehicle-doc-review--error">
                        <span>Documentul nu a putut fi citit automat.</span>
                        <button
                          className="secondary-btn"
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runDocumentAction(item, "retry")}
                        >
                          <RefreshCw size={15} /> Reîncearcă
                        </button>
                      </div>
                    ) : null}

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
                      {intelligenceStatus === "applied" && isOwner ? (
                        <button
                          className="secondary-btn"
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runDocumentAction(item, "rollback")}
                        >
                          <RotateCcw size={14} /> Anulează aplicarea
                        </button>
                      ) : null}
                      {isOwner && onDelete ? (
                        <button
                          className="danger-btn"
                          type="button"
                          disabled={deletingDocumentId === item.id || isBusy}
                          onClick={() => void onDelete(item.id)}
                        >
                          <Trash2 size={14} /> {deletingDocumentId === item.id ? "..." : "Șterge"}
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
