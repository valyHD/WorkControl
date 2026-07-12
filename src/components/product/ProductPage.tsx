import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export type ProductAction = {
  id: string;
  label: string;
  to?: string;
  onClick?: () => void;
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  tone?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  assistantAction?: string;
};

export type ProductPageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ProductAction[];
};

function ProductActionControl({ action, compact = false }: { action: ProductAction; compact?: boolean }) {
  const Icon = action.icon;
  const className = `wc-product-action wc-product-action--${action.tone || "secondary"}${compact ? " wc-product-action--compact" : ""}`;
  const content = (
    <>
      {Icon ? <Icon size={compact ? 16 : 18} strokeWidth={2.1} /> : null}
      <span>{action.label}</span>
      {!compact && action.to ? <ArrowRight size={15} strokeWidth={2} /> : null}
    </>
  );

  if (action.to) {
    return (
      <Link className={className} to={action.to} data-assistant-action={action.assistantAction}>
        {content}
      </Link>
    );
  }

  return (
    <button
      className={className}
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      data-assistant-action={action.assistantAction}
    >
      {content}
    </button>
  );
}
export function ProductPageHeader({ eyebrow, title, description, meta, actions = [] }: ProductPageHeaderProps) {
  const primaryActions = actions.filter((action) => action.tone === "primary");
  const secondaryActions = actions.filter((action) => action.tone !== "primary");

  return (
    <header className="wc-product-page-header" data-assistant-section="page-header">
      <div className="wc-product-page-header__copy">
        {eyebrow ? <span className="wc-product-eyebrow">{eyebrow}</span> : null}
        <div className="wc-product-page-header__title-row">
          <h1>{title}</h1>
          {meta ? <div className="wc-product-page-header__meta">{meta}</div> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      {actions.length ? (
        <div className="wc-product-page-header__actions">
          {secondaryActions.map((action) => <ProductActionControl key={action.id} action={action} compact />)}
          {primaryActions.map((action) => <ProductActionControl key={action.id} action={action} compact />)}
        </div>
      ) : null}
    </header>
  );
}

export function ProductSectionHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ProductAction;
}) {
  return (
    <div className="wc-product-section-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <ProductActionControl action={action} compact /> : null}
    </div>
  );
}

export function ProductQuickActions({ title = "Acțiuni rapide", actions }: { title?: string; actions: ProductAction[] }) {
  if (!actions.length) return null;
  return (
    <aside className="wc-product-quick-actions" aria-label={title} data-assistant-section="quick-actions">
      <div className="wc-product-quick-actions__head">
        <span>{title}</span>
        <small>Maximum 2 clickuri</small>
      </div>
      <div className="wc-product-quick-actions__list">
        {actions.map((action) => <ProductActionControl key={action.id} action={action} />)}
      </div>
    </aside>
  );
}

export function ProductContentLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={`wc-product-content-layout${aside ? " wc-product-content-layout--with-aside" : ""}`}>
      <div className="wc-product-content-layout__main">{children}</div>
      {aside ? <div className="wc-product-content-layout__aside">{aside}</div> : null}
    </div>
  );
}
