import type { ReactNode } from "react";

export function MaintenanceReportsModule({ children }: { children: ReactNode }) {
  return <section data-maintenance-module="reports">{children}</section>;
}
