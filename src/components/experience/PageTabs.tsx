import type { ComponentType } from "react";
import { NavLink } from "react-router-dom";

export type PageTabItem = {
  id: string;
  label: string;
  to?: string;
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: string | number;
  disabled?: boolean;
};

export function PageTabs({
  items,
  activeId,
  onChange,
  label = "Sectiuni pagina",
}: {
  items: PageTabItem[];
  activeId: string;
  onChange?: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="wc-page-tabs" role="tablist" aria-label={label}>
      {items.map((item) => {
        const Icon = item.icon;
        const content = (
          <>
            {Icon ? <Icon size={17} strokeWidth={2.1} /> : null}
            <span>{item.label}</span>
            {item.badge !== undefined ? <small>{item.badge}</small> : null}
          </>
        );
        if (item.to) {
          return (
            <NavLink
              key={item.id}
              to={item.to}
              role="tab"
              aria-selected={activeId === item.id}
              className={activeId === item.id ? "is-active" : ""}
            >
              {content}
            </NavLink>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeId === item.id}
            className={activeId === item.id ? "is-active" : ""}
            disabled={item.disabled}
            onClick={() => onChange?.(item.id)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
