import type { ComponentType, ReactNode } from "react";
import { Clock3 } from "lucide-react";
import { Link } from "react-router-dom";

export type UniversalTimelineItem = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  timestamp: number;
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  tone?: "blue" | "green" | "orange" | "red" | "muted";
  to?: string;
};

export type UniversalTimelineEntity = "user" | "vehicle" | "tool" | "project" | "client" | "lift";

export default function UniversalTimeline({
  items,
  empty = "Nu există activitate în intervalul selectat.",
  entityType,
}: {
  items: UniversalTimelineItem[];
  empty?: ReactNode;
  entityType?: UniversalTimelineEntity;
}) {
  if (!items.length) return <div className="wc-product-empty-inline">{empty}</div>;
  return (
    <ol className="wc-universal-timeline" data-assistant-section="timeline" data-timeline-entity={entityType}>
      {items.map((item) => {
        const Icon = item.icon || Clock3;
        const content = (
          <>
            <div className="wc-universal-timeline__title-row">
              <strong>{item.title}</strong>
              <time dateTime={new Date(item.timestamp).toISOString()}>
                {new Date(item.timestamp).toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>
            {item.description ? <p>{item.description}</p> : null}
          </>
        );
        return (
          <li key={item.id} className={`wc-universal-timeline__item wc-universal-timeline__item--${item.tone || "muted"}`}>
            <span className="wc-universal-timeline__marker"><Icon size={15} strokeWidth={2.1} /></span>
            {item.to ? <Link className="wc-universal-timeline__content" to={item.to}>{content}</Link> : <div className="wc-universal-timeline__content">{content}</div>}
          </li>
        );
      })}
    </ol>
  );
}
