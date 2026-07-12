import type { ReactNode } from "react";

export function MaintenanceDashboardModule({ children }: { children: ReactNode }) {
  return <section data-maintenance-module="dashboard">{children}</section>;
}
