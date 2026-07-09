import type { ReactNode } from "react";

type FilterBarProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  dataAssistantSection?: string;
};

export default function FilterBar({ children, title, subtitle, dataAssistantSection }: FilterBarProps) {
  return (
    <div className="wc-filter-bar" data-assistant-section={dataAssistantSection}>
      {title || subtitle ? (
        <div className="wc-filter-bar__intro">
          {title ? <strong>{title}</strong> : null}
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      ) : null}
      <div className="wc-filter-bar__controls">{children}</div>
    </div>
  );
}
