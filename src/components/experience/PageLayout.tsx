import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ProductPageHeader, type ProductPageHeaderProps } from "../product/ProductPage";

export function PageLayout({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section className={`wc-page-layout page-section ${className}`.trim()} {...props}>
      {children}
    </section>
  );
}

export function PageHeader(props: ProductPageHeaderProps) {
  return <ProductPageHeader {...props} />;
}

export function PageToolbar({
  children,
  label = "Actiuni pagina",
  className = "",
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`wc-page-toolbar ${className}`.trim()} role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

export function KpiGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`wc-kpi-grid ${className}`.trim()}>{children}</div>;
}

export function ContentGrid({
  children,
  columns = "balanced",
  className = "",
}: {
  children: ReactNode;
  columns?: "balanced" | "main-aside" | "three";
  className?: string;
}) {
  return <div className={`wc-content-grid wc-content-grid--${columns} ${className}`.trim()}>{children}</div>;
}

export function SidePanel({
  title,
  description,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside className={`wc-side-panel ${className}`.trim()}>
      {title || description ? (
        <header className="wc-side-panel__header">
          {title ? <h2>{title}</h2> : null}
          {description ? <p>{description}</p> : null}
        </header>
      ) : null}
      {children}
    </aside>
  );
}
