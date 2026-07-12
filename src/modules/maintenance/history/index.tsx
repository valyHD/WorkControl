import type { ReactNode } from "react";

export function MaintenanceHistoryModule({ children }: { children: ReactNode }) {
  return <section data-maintenance-module="history">{children}</section>;
}
