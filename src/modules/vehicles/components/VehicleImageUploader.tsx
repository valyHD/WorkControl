import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Upload, X, ImageIcon } from "lucide-react";

type Props = {
  selectedFiles: File[];
  onFilesChange: (files: File[]) => void;
  maxFiles?: number;
  maxSizeMb?: number;
};

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const DEFAULT_MAX_MB = 10;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export default function VehicleImageUploader({
  selectedFiles,
  onFilesChange,
  maxFiles = 10,
  maxSizeMb = DEFAULT_MAX_MB,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [validationMsg, setValidationMsg] = useState("");

  const validateAndAdd = useCallback(
    (incoming: File[]) => {
      setValidationMsg("");
      const maxBytes = maxSizeMb * 1_048_576;
      const rejected: string[] = [];
      const accepted: File[] = [];

      for (const file of incoming) {
        if (!ACCEPTED.includes(file.type)) {
          rejected.push(`${file.name}: tip neacceptat`);
          continue;
        }
        if (file.size > maxBytes) {
          rejected.push(`${file.name}: prea mare (max ${maxSizeMb}MB)`);
          continue;
        }
        accepted.push(file);
      }

      const combined = [...selectedFiles, ...accepted];
      const limited = combined.slice(0, maxFiles);

      if (limited.length < combined.length) {
        rejected.push(`Maxim ${maxFiles} fișiere permise.`);
      }

      onFilesChange(limited);

      if (rejected.length) {
        setValidationMsg(rejected.join(" · "));
      }
    },
    [selectedFiles, onFilesChange, maxFiles, maxSizeMb]
  );

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    validateAndAdd(files);
    // Reset input so same file can be re-added after removal
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    validateAndAdd(files);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function removeFile(idx: number) {
    const next = selectedFiles.filter((_, i) => i !== idx);
    onFilesChange(next);
    setValidationMsg("");
  }

  return (
    <div className="tool-form-block">
      <label className="tool-form-label">
        Poze mașină{maxFiles > 1 ? ` (max ${maxFiles})` : ""}
      </label>

      {/* Drop zone */}
      <div
        className={`viu-dropzone ${dragOver ? "viu-dropzone--over" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Zonă upload poze"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={maxFiles > 1}
          accept={ACCEPTED.join(",")}
          onChange={handleInputChange}
          style={{ display: "none" }}
        />
        <Upload
          size={22}
          strokeWidth={1.8}
          style={{ color: dragOver ? "var(--primary)" : "var(--text-muted)", transition: "color 0.15s" }}
        />
        <div className="viu-dropzone__label">
          {dragOver ? "Eliberează pentru upload" : "Trage pozele aici sau apasă pentru selectare"}
        </div>
        <div className="viu-dropzone__hint">
          JPEG, PNG, WebP · max {maxSizeMb}MB per fișier
        </div>
      </div>

      {/* Validation error */}
      {validationMsg && (
        <div className="vc-feedback vc-feedback--error" style={{ marginTop: 8, fontSize: 12 }}>
          {validationMsg}
        </div>
      )}

      {/* Preview list */}
      {selectedFiles.length > 0 && (
        <div className="viu-file-list">
          {selectedFiles.map((file, idx) => {
            const previewUrl = URL.createObjectURL(file);
            return (
              <div key={`${file.name}-${file.size}-${idx}`} className="viu-file-item">
                <div className="viu-file-thumb">
                  {file.type.startsWith("image/") ? (
                    <img
                      src={previewUrl}
                      alt={file.name}
                      className="viu-file-thumb-img"
                      onLoad={() => URL.revokeObjectURL(previewUrl)}
                      onError={() => URL.revokeObjectURL(previewUrl)}
                    />
                  ) : (
                    <ImageIcon size={18} style={{ color: "var(--text-muted)" }} />
                  )}
                </div>
                <div className="viu-file-meta">
                  <div className="viu-file-name">{file.name}</div>
                  <div className="viu-file-size">{formatFileSize(file.size)}</div>
                </div>
                <button
                  type="button"
                  className="viu-file-remove"
                  onClick={() => removeFile(idx)}
                  aria-label={`Elimină ${file.name}`}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
