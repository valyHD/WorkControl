import type { ReactNode } from "react";
import { Clock3 } from "lucide-react";
import StatusBadge from "./StatusBadge";

type TimesheetStatusCardProps = {
  title: string;
  subtitle?: ReactNode;
  statusLabel: string;
  tone?: "green" | "orange" | "red" | "blue" | "muted";
  children?: ReactNode;
  actions?: ReactNode;
  dataAssistantSection?: string;
};

export default function TimesheetStatusCard({
  title,
  subtitle,
  statusLabel,
  tone = "muted",
  children,
  actions,
  dataAssistantSection,
}: TimesheetStatusCardProps) {
  return (
    <div className={`wc-timesheet-status-card wc-timesheet-status-card--${tone}`} data-assistant-section={dataAssistantSection}>
      <div className="wc-timesheet-status-card__top">
        <span className="wc-timesheet-status-card__icon">
          <Clock3 size={22} strokeWidth={2.1} />
        </span>
        <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
      </div>
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
      {children ? <div className="wc-timesheet-status-card__body">{children}</div> : null}
      {actions ? <div className="wc-timesheet-status-card__actions">{actions}</div> : null}
    </div>
  );
}
