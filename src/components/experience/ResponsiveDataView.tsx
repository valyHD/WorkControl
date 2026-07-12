import type { ReactNode } from "react";

export function ResponsiveDataView({
  table,
  cards,
  label,
  className = "",
}: {
  table: ReactNode;
  cards: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={`wc-responsive-data-view ${className}`.trim()} aria-label={label}>
      <div className="wc-responsive-data-view__table">{table}</div>
      <div className="wc-responsive-data-view__cards">{cards}</div>
    </div>
  );
}
