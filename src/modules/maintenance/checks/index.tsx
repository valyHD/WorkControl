import type { ReactNode } from "react";

export function MaintenanceChecksModule({ children }: { children: ReactNode }) {
  return <section data-maintenance-module="checks">{children}</section>;
}
