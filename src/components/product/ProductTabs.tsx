import type { ComponentType } from "react";
import { Link } from "react-router-dom";

export type ProductTab = {
  id: string;
  label: string;
  to?: string;
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: string | number;
  assistantAction?: string;
};

export default function ProductTabs({
  tabs,
  activeId,
  onChange,
  label = "Secțiuni pagină",
}: {
  tabs: ProductTab[];
  activeId: string;
  onChange?: (id: string) => void;
  label?: string;
}) {
  return (
    <nav className="wc-product-tabs" aria-label={label} data-assistant-section="page-tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const content = (
          <>
            {Icon ? <Icon size={16} strokeWidth={2} /> : null}
            <span>{tab.label}</span>
            {tab.badge !== undefined ? <small>{tab.badge}</small> : null}
          </>
        );
        const className = `wc-product-tab${tab.id === activeId ? " is-active" : ""}`;
        if (tab.to) {
          return <Link key={tab.id} className={className} to={tab.to} data-assistant-action={tab.assistantAction}>{content}</Link>;
        }
        return (
          <button
            key={tab.id}
            className={className}
            type="button"
            aria-current={tab.id === activeId ? "page" : undefined}
            onClick={() => onChange?.(tab.id)}
            data-assistant-action={tab.assistantAction}
          >
            {content}
          </button>
        );
      })}
    </nav>
  );
}
