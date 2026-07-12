import type { ReactNode } from "react";

export function MaintenanceClientsModule({ children }: { children: ReactNode }) {
  return <section data-maintenance-module="clients">{children}</section>;
}
