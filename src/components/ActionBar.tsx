import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./actionControls.css";

export type ActionBarAction = {
  id?: string;
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  tooltip?: string;
  disabled?: boolean;
  assistantAction?: string;
  assistantField?: string;
  assistantSection?: string;
};

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ActionBarAction[];
};

function getButtonClass(variant: ActionBarAction["variant"]) {
  if (variant === "danger") return "danger-btn";
  if (variant === "primary") return "primary-btn";
  return "secondary-btn";
}

function actionDataAttributes(action: ActionBarAction) {
  return {
    "data-assistant-action": action.assistantAction,
    "data-assistant-field": action.assistantField,
    "data-assistant-section": action.assistantSection,
  };
}

function renderAction(action: ActionBarAction) {
  const className = getButtonClass(action.variant);
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

export default function ActionBar({ title, subtitle, actions = [] }: Props) {
  return (
    <div className="panel action-bar">
      <div className="action-bar__copy">
        <h1 className="action-bar__title">{title}</h1>
        {subtitle ? <p className="action-bar__subtitle">{subtitle}</p> : null}
      </div>
      {actions.length ? <div className="action-bar__actions">{actions.map(renderAction)}</div> : null}
    </div>
  );
}
