import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./actionControls.css";

export type PageQuickAction = {
  id?: string;
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
  tooltip?: string;
  variant?: "primary" | "secondary" | "danger";
  active?: boolean;
  disabled?: boolean;
  assistantAction?: string;
  assistantField?: string;
  assistantSection?: string;
};

type Props = {
  actions: PageQuickAction[];
  className?: string;
};

function getButtonClass(action: PageQuickAction) {
  const base = action.variant === "primary" ? "primary-btn" : action.variant === "danger" ? "danger-btn" : "secondary-btn";
  return `${base} page-quick-actions__item${action.active ? " is-active" : ""}`;
}

function actionDataAttributes(action: PageQuickAction) {
  return {
    "data-assistant-action": action.assistantAction,
    "data-assistant-field": action.assistantField,
    "data-assistant-section": action.assistantSection,
  };
}

function renderQuickAction(action: PageQuickAction) {
  const className = getButtonClass(action);
  const content = (
    <>
      {action.icon}
      <span>{action.label}</span>
    </>
  );

  if (action.href?.startsWith("/")) {
    return (
      <Link key={action.id || action.label} className={className} to={action.href} title={action.tooltip} {...actionDataAttributes(action)}>
        {content}
      </Link>
    );
  }

  if (action.href) {
    return (
      <a key={action.id || action.label} className={className} href={action.href} title={action.tooltip} {...actionDataAttributes(action)}>
        {content}
      </a>
    );
  }

  return (
    <button
      key={action.id || action.label}
      className={className}
      type="button"
      title={action.tooltip}
      onClick={action.onClick}
      disabled={action.disabled}
      {...actionDataAttributes(action)}
    >
      {content}
    </button>
  );
}

export default function PageQuickActions({ actions, className = "" }: Props) {
  if (!actions.length) return null;

  return <div className={`page-quick-actions ${className}`.trim()}>{actions.slice(0, 5).map(renderQuickAction)}</div>;
}
