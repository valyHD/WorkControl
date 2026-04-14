import type { VehicleStatus } from "../../../types/vehicle";

type Props = {
  status: VehicleStatus;
};

const statusConfig: Record<VehicleStatus, { label: string; className: string }> = {
  activa:        { label: "Activă",        className: "badge badge-green"  },
  in_service:    { label: "În service",    className: "badge badge-orange" },
  indisponibila: { label: "Indisponibilă", className: "badge badge-red"    },
  avariata:      { label: "Avariată",      className: "badge badge-red"    },
};

export default function VehicleStatusBadge({ status }: Props) {
  const config = statusConfig[status] ?? { label: status, className: "badge badge-muted" };
  return <span className={config.className}>{config.label}</span>;
}