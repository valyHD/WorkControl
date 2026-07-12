import type { ReactNode } from "react";

export function MaintenancePartsModule({ children }: { children: ReactNode }) {
  return <section data-maintenance-module="parts">{children}</section>;
}
