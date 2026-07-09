import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";

type KpiTone = "blue" | "green" | "orange" | "red" | "purple" | "muted";

type KpiCardProps = {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: KpiTone;
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  to?: string;
  dataAssistantAction?: string;
};

export default function KpiCard({
  label,
  value,
  helper,
  tone = "blue",
  icon: Icon,
  to,
  dataAssistantAction,
}: KpiCardProps) {
  const content = (
    <>
      <div className="wc-kpi-card__head">
        <span>{label}</span>
        {Icon ? (
          <span className={`wc-kpi-card__icon wc-kpi-card__icon--${tone}`}>
            <Icon size={18} strokeWidth={2.1} />
          </span>
        ) : null}
      </div>
      <div className="wc-kpi-card__value">{value}</div>
      {helper ? <div className={`wc-kpi-card__helper wc-kpi-card__helper--${tone}`}>{helper}</div> : null}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className={`wc-kpi-card wc-kpi-card--${tone} wc-kpi-card--link`}
        data-assistant-action={dataAssistantAction}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={`wc-kpi-card wc-kpi-card--${tone}`} data-assistant-action={dataAssistantAction}>
      {content}
    </div>
  );
}
