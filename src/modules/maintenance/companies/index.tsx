import type { ReactNode } from "react";

export function MaintenanceCompaniesModule({ children }: { children: ReactNode }) {
  return <section data-maintenance-module="companies">{children}</section>;
}
