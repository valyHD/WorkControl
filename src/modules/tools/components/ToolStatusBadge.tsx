import type { ToolStatus } from "../../../types/tool";

type Props = {
  status: ToolStatus;
};

const statusConfig: Record<ToolStatus, { label: string; className: string }> = {
  depozit:  { label: "Depozit",  className: "badge badge-green"  },
  atribuita:{ label: "Atribuită",className: "badge badge-orange" },
  defecta:  { label: "Defectă",  className: "badge badge-red"    },
  pierduta: { label: "Pierdută", className: "badge badge-red"    },
};

export default function ToolStatusBadge({ status }: Props) {
  const config = statusConfig[status] ?? { label: status, className: "badge badge-muted" };
  return <span className={config.className}>{config.label}</span>;
}