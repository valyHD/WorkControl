import type { ReactNode } from "react";

export type TimesheetChartBar = {
  label: string;
  value: number;
  displayValue?: ReactNode;
  tone?: "green" | "orange" | "red" | "blue" | "muted";
};

type TimesheetChartCardProps = {
  title: string;
  subtitle?: string;
  bars: TimesheetChartBar[];
  emptyLabel?: string;
};

export default function TimesheetChartCard({
  title,
  subtitle,
  bars,
  emptyLabel = "Nu exista date pentru grafic.",
}: TimesheetChartCardProps) {
  const max = Math.max(...bars.map((bar) => bar.value), 0);

  return (
    <div className="wc-chart-card">
      <div className="wc-chart-card__head">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {bars.length === 0 || max <= 0 ? (
        <p className="tools-subtitle">{emptyLabel}</p>
      ) : (
        <div className="wc-chart-card__bars">
          {bars.map((bar) => {
            const width = Math.max(4, Math.round((bar.value / max) * 100));
            return (
              <div key={bar.label} className="wc-chart-card__bar-row">
                <span className="wc-chart-card__bar-label">{bar.label}</span>
                <div className="wc-chart-card__track">
                  <span
                    className={`wc-chart-card__bar wc-chart-card__bar--${bar.tone ?? "blue"}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <strong>{bar.displayValue ?? bar.value}</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
