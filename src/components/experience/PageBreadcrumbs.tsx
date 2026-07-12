import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { PageBreadcrumbDefinition } from "../../config/pageExperience";

export function PageBreadcrumbs({ items }: { items: PageBreadcrumbDefinition[] }) {
  if (!items.length) return null;
  return (
    <nav className="wc-page-breadcrumbs" aria-label="Fir de navigare">
      <Link to="/dashboard">WorkControl</Link>
      {items.map((item, index) => {
        const current = index === items.length - 1;
        return (
          <span className="wc-page-breadcrumbs__item" key={`${item.label}-${index}`}>
            <ChevronRight size={12} aria-hidden="true" />
            {item.path && !item.path.includes(":") && !current ? (
              <Link to={item.path}>{item.label}</Link>
            ) : (
              <span aria-current={current ? "page" : undefined}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
