import type { ReactNode } from "react";

type StatusTone = "green" | "orange" | "red" | "blue" | "muted";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
};

export default function StatusBadge({ children, tone = "muted", className = "" }: StatusBadgeProps) {
  return <span className={`wc-status-badge wc-status-badge--${tone} ${className}`.trim()}>{children}</span>;
}
