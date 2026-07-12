import { useEffect, useMemo, useState } from "react";
import { Activity, Bell, Clock3, FileText, Pencil, Wrench } from "lucide-react";
import { getAuditLogsForEntity } from "../../modules/audit/services/auditLogService";
import UniversalTimeline, { type UniversalTimelineEntity, type UniversalTimelineItem } from "./UniversalTimeline";

function iconFor(category: string) {
  if (category === "timesheets") return Clock3;
  if (category === "maintenance") return Wrench;
  if (category === "notifications") return Bell;
  if (category === "expenses") return FileText;
  if (category === "users" || category === "vehicles" || category === "tools") return Pencil;
  return Activity;
}

export default function EntityTimeline({ entityType, entityId }: { entityType: UniversalTimelineEntity; entityId: string }) {
  const [items, setItems] = useState<UniversalTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAuditLogsForEntity(entityId, 40)
      .then((logs) => {
        if (!active) return;
        setItems(logs.map((item) => ({
          id: item.id,
          title: item.title || item.action || "Activitate",
          description: item.message || item.entityLabel,
          timestamp: item.createdAt,
          icon: iconFor(item.category),
          tone: item.action.includes("delete") ? "red" : item.action.includes("create") ? "green" : "blue",
          to: item.path || undefined,
        })));
      })
      .catch(() => { if (active) setError("Istoricul nu a putut fi incarcat."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [entityId]);

  const content = useMemo(() => items, [items]);
  if (loading) return <div className="wc-product-empty-inline" role="status">Se incarca istoricul...</div>;
  if (error) return <div className="wc-product-empty-inline" role="alert">{error}</div>;
  return <UniversalTimeline entityType={entityType} items={content} />;
}
