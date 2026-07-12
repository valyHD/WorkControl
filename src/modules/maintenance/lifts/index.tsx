import type { ReactNode } from "react";

export function MaintenanceLiftsModule({ children }: { children: ReactNode }) {
  return <section data-maintenance-module="lifts">{children}</section>;
}
