import type { ComponentType, ReactNode } from "react";
import { Inbox } from "lucide-react";

type EmptyStateProps = {
  title: string;
  subtitle?: ReactNode;
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  action?: ReactNode;
};

export default function EmptyState({ title, subtitle, icon: Icon = Inbox, action }: EmptyStateProps) {
  return (
    <div className="wc-empty-state">
      <div className="wc-empty-state__icon">
        <Icon size={22} strokeWidth={1.9} />
      </div>
      <strong>{title}</strong>
      {subtitle ? <p>{subtitle}</p> : null}
      {action ? <div className="wc-empty-state__action">{action}</div> : null}
    </div>
  );
}
