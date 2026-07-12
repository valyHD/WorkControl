import { useId } from "react";
import { ArrowRight, Check, ShieldAlert, X } from "lucide-react";
import type { AssistantConfirmationRow, AssistantRisk } from "./types";
import styles from "./assistantUi.module.css";

const RISK_LABELS: Record<AssistantRisk, string> = {
  low: "Risc scăzut",
  medium: "Risc mediu",
  high: "Risc ridicat",
};

export type ConfirmationCardProps = {
  title?: string;
  summary?: string;
  rows: readonly AssistantConfirmationRow[];
  risk: AssistantRisk;
  confidence?: number;
  reason?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmationCard({
  title = "Confirmă modificările",
  summary,
  rows,
  risk,
  confidence,
  reason,
  confirmLabel = "Confirmă",
  cancelLabel = "Anulează",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmationCardProps) {
  const titleId = useId();
  const confidencePercent =
    confidence === undefined ? null : Math.round(Math.min(1, Math.max(0, confidence)) * 100);

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.cardHeader}>
        <div>
          <h3 id={titleId}>{title}</h3>
          {summary ? <p>{summary}</p> : null}
        </div>
        <span className={styles.riskBadge} data-risk={risk}>
          <ShieldAlert size={14} aria-hidden="true" />
          {RISK_LABELS[risk]}
        </span>
      </div>

      <dl className={styles.changeList}>
        {rows.map((row) => (
          <div className={styles.changeRow} key={row.id}>
            <dt>{row.label}</dt>
            <dd>
              <span className={styles.oldValue}>{row.oldValue}</span>
              <ArrowRight size={15} aria-label="devine" />
              <span className={styles.newValue}>{row.newValue}</span>
            </dd>
          </div>
        ))}
      </dl>

      {reason || confidencePercent !== null ? (
        <div className={styles.contextRow}>
          {reason ? (
            <p>
              <strong>Motiv:</strong> {reason}
            </p>
          ) : null}
          {confidencePercent !== null ? <span>Încredere {confidencePercent}%</span> : null}
        </div>
      ) : null}

      <div className={styles.cardActions}>
        <button className={styles.primaryButton} type="button" onClick={onConfirm} disabled={busy}>
          <Check size={17} aria-hidden="true" />
          {busy ? "Se execută..." : confirmLabel}
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={busy}>
          <X size={17} aria-hidden="true" />
          {cancelLabel}
        </button>
      </div>
    </section>
  );
}
