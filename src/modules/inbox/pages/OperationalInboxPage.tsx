import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, RefreshCw, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader, PageLayout } from "../../../components/experience";
import StatusBadge from "../../../components/StatusBadge";
import { resolveNotificationPath } from "../../../lib/notifications/notificationNavigation";
import { useFeatureFlags } from "../../../lib/productIntelligence";
import { useAuth } from "../../../providers/AuthProvider";
import {
  getOperationalInbox,
  markOperationalInboxItemRead,
  type OperationalInboxItem,
} from "../services/operationalInboxService";

export default function OperationalInboxPage() {
  const { user } = useAuth();
  const { flags } = useFeatureFlags();
  const navigate = useNavigate();
  const [items, setItems] = useState<OperationalInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setError("");
    try {
      setItems(await getOperationalInbox(user.uid, 25));
    } catch {
      setError("Inbox-ul operational nu a putut fi incarcat.");
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => ({
    critical: items.filter((item) => item.priority === "critical"),
    action: items.filter((item) => item.priority === "action"),
    info: items.filter((item) => item.priority === "info"),
  }), [items]);

  if (!flags.operationalInbox) {
    return <PageLayout><div className="panel">Inbox-ul operational este dezactivat prin feature flag.</div></PageLayout>;
  }

  const openItem = async (item: OperationalInboxItem) => {
    if (!item.read) await markOperationalInboxItemRead(item.id);
    navigate(resolveNotificationPath(item));
  };

  return (
    <PageLayout className="wc-operational-inbox-page">
      <PageHeader
        eyebrow="Command Center"
        title="Inbox operational"
        description="Alertele sunt ordonate dupa urgenta, stare si nevoia de actiune."
        actions={[{ id: "refresh-inbox", label: loading ? "Se actualizeaza" : "Actualizeaza", icon: RefreshCw, onClick: () => void load(), disabled: loading }]}
      />
      {error ? <div className="tool-message error-message" role="alert">{error}</div> : null}
      <div className="wc-inbox-summary">
        <article><AlertTriangle size={18} /><span>Critice</span><strong>{groups.critical.length}</strong></article>
        <article><CheckCircle2 size={18} /><span>Cer actiune</span><strong>{groups.action.length}</strong></article>
        <article><Bell size={18} /><span>Informari</span><strong>{groups.info.length}</strong></article>
      </div>
      {loading ? <div className="panel" role="status">Se incarca inbox-ul...</div> : null}
      {!loading && items.length === 0 ? <div className="panel wc-product-empty-inline">Nu exista elemente in inbox.</div> : null}
      {(["critical", "action", "info"] as const).map((priority) => groups[priority].length ? (
        <section className="panel wc-inbox-group" key={priority}>
          <h2>{priority === "critical" ? "Necesita atentie imediata" : priority === "action" ? "De rezolvat" : "Informari"}</h2>
          <div className="simple-list">
            {groups[priority].map((item) => (
              <button className="simple-list-item wc-inbox-item" type="button" key={item.id} onClick={() => void openItem(item)}>
                <span className="wc-inbox-item__icon">{priority === "critical" ? <AlertTriangle size={17} /> : priority === "action" ? <Sparkles size={17} /> : <Bell size={17} />}</span>
                <span className="simple-list-text"><strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.createdAt).toLocaleString("ro-RO")}</small></span>
                <StatusBadge tone={item.read ? "muted" : priority === "critical" ? "red" : priority === "action" ? "orange" : "blue"}>{item.read ? "Citit" : "Nou"}</StatusBadge>
              </button>
            ))}
          </div>
        </section>
      ) : null)}
    </PageLayout>
  );
}
