import type { ReactNode } from "react";

export function FormSection({
  title,
  description,
  children,
  step,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  step?: string | number;
  className?: string;
}) {
  return (
    <fieldset className={`wc-form-section ${className}`.trim()}>
      <legend>
        {step !== undefined ? <span className="wc-form-section__step">{step}</span> : null}
        <span>
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
        </span>
      </legend>
      <div className="wc-form-section__content">{children}</div>
    </fieldset>
  );
}

export function FormWizard({ children, label = "Pasi formular" }: { children: ReactNode; label?: string }) {
  return <div className="wc-form-wizard" aria-label={label}>{children}</div>;
}

export function StickyActionBar({
  children,
  label = "Actiuni formular",
}: {
  children: ReactNode;
  label?: string;
}) {
  return <div className="wc-sticky-action-bar" role="toolbar" aria-label={label}>{children}</div>;
}
