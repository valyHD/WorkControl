import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase/firebase";
import type { AuditLogItem } from "../../types/audit";
import { NAVIGATION_ITEMS, getNavigationItemForPath } from "../../config/navigation";

export type PageChangeSummary = {
  latestAt: number;
  items: AuditLogItem[];
};

export type PageChangeMap = Record<string, PageChangeSummary>;
export type PageReadState = Record<string, number>;

const ignoredChangeCategories = new Set(["auth", "navigation"]);
const ignoredChangeActions = new Set([
  "page_view",
  "site_entered",
  "user_site_entered",
  "notification_delivered",
  "notification_read",
  "push_token_synced",
]);

function cleanAuditPath(path: string) {
  return String(path || "").split("?")[0].split("#")[0].trim();
}

function inferAuditPath(item: AuditLogItem) {
  const path = cleanAuditPath(item.path);
  if (path.startsWith("/")) return path;
  if (item.category === "users") return "/users";
  if (item.category === "tools") return "/tools";
  if (item.category === "vehicles") return "/vehicles";
  if (item.category === "timesheets") return "/timesheets";
  if (item.category === "leave") return "/my-leave";
  if (item.category === "projects") return "/projects";
  if (item.category === "notifications") return "/notifications";
  if (item.category === "maintenance") return "/maintenance";
  if (item.category === "expenses") return "/expenses/scan";
  if (["backup", "system", "web", "server"].includes(item.category)) return "/control-panel";
  return "";
}

function isVisiblePageChange(item: AuditLogItem) {
  if (ignoredChangeCategories.has(item.category) || ignoredChangeActions.has(item.action)) {
    return false;
  }
  if (item.metadata?.eventType && ignoredChangeActions.has(String(item.metadata.eventType))) {
    return false;
  }
  const text = `${item.title || ""} ${item.message || ""}`.toLowerCase();
  if (text.includes("a intrat pe site") || text.includes("intrare pe site")) return false;
  if (!item.title && !item.message) return false;
  return Boolean(getNavigationItemForPath(inferAuditPath(item)));
}

function pageReadKey(userId: string, path: string) {
  return `wc_page_changes_read:${userId}:${path}`;
}

function pageChangesInitializedKey(userId: string) {
  return `wc_page_changes_initialized:${userId}:v1`;
}

function pageReadDocId(path: string) {
  return encodeURIComponent(path).replace(/\./g, "%2E");
}

export function buildInitialPageReadState(readAt = Date.now()): PageReadState {
  return NAVIGATION_ITEMS.reduce<PageReadState>((acc, item) => {
    acc[item.path] = readAt;
    return acc;
  }, {});
}

export function getLocalPageReadAt(userId: string, path: string) {
  if (!userId || typeof window === "undefined") return 0;
  try {
    const value = Number(window.localStorage.getItem(pageReadKey(userId, path)) || "0");
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function buildLocalPageReadState(userId: string): PageReadState {
  return NAVIGATION_ITEMS.reduce<PageReadState>((state, item) => {
    state[item.path] = getLocalPageReadAt(userId, item.path);
    return state;
  }, {});
}

export function initializeLocalPageChangeReads(userId: string, readAt = Date.now()) {
  if (!userId || typeof window === "undefined") return false;
  try {
    const key = pageChangesInitializedKey(userId);
    if (window.localStorage.getItem(key)) return false;
    NAVIGATION_ITEMS.forEach((item) => {
      window.localStorage.setItem(pageReadKey(userId, item.path), String(readAt));
    });
    window.localStorage.setItem(key, String(readAt));
    return true;
  } catch {
    return false;
  }
}

function writeLocalPageRead(userId: string, path: string, readAt: number) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pageReadKey(userId, path), String(readAt));
  } catch {
    // The current session remains usable when localStorage is unavailable.
  }
}

export async function seedRemotePageChangeReads(userId: string, readAt: number) {
  await Promise.all(
    NAVIGATION_ITEMS.map((item) =>
      setDoc(
        doc(db, "users", userId, "pageChangeReads", pageReadDocId(item.path)),
        {
          path: item.path,
          readAt,
          updatedAt: Date.now(),
          updatedAtServer: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );
}

export async function markPageChangesRead(userId: string, path: string, readAt: number) {
  if (!userId) return;
  writeLocalPageRead(userId, path, readAt);
  await setDoc(
    doc(db, "users", userId, "pageChangeReads", pageReadDocId(path)),
    {
      path,
      readAt,
      updatedAt: Date.now(),
      updatedAtServer: serverTimestamp(),
    },
    { merge: true }
  );
}

export function buildPageChangeMap(
  items: AuditLogItem[],
  pageReadState: PageReadState,
  readsLoaded: boolean,
  currentUserId: string
): PageChangeMap {
  if (!readsLoaded) return {};

  return items.reduce<PageChangeMap>((acc, item) => {
    if (!isVisiblePageChange(item) || (currentUserId && item.actorUserId === currentUserId)) {
      return acc;
    }
    const menuItem = getNavigationItemForPath(inferAuditPath(item));
    if (!menuItem || item.createdAt <= (pageReadState[menuItem.path] || 0)) return acc;
    const existing = acc[menuItem.path] || { latestAt: 0, items: [] };
    existing.items.push(item);
    existing.latestAt = Math.max(existing.latestAt, item.createdAt);
    acc[menuItem.path] = existing;
    return acc;
  }, {});
}

function getAuditDetailLines(item: AuditLogItem) {
  const metadata = item.metadata || {};
  const candidates = [metadata.changesText, metadata.fieldsText, metadata.detailsText];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(String).filter(Boolean).slice(0, 5);
    }
    if (typeof candidate === "string" && candidate.trim()) return [candidate.trim()];
  }
  return [];
}

function formatAuditMoment(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  return new Date(ts).toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PageChangesPanel({
  pageTitle,
  changes,
  onMarkRead,
}: {
  pageTitle: string;
  changes: AuditLogItem[];
  onMarkRead: () => void;
}) {
  const visibleChanges = changes.slice(0, 6);
  return (
    <section className="page-changes-panel" aria-live="polite">
      <div className="page-changes-header">
        <div>
          <div className="page-changes-eyebrow">Modificari noi</div>
          <div className="page-changes-title">
            {changes.length === 1
              ? `1 schimbare pe ${pageTitle}`
              : `${changes.length} schimbari pe ${pageTitle}`}
          </div>
        </div>
        <button type="button" className="secondary-btn page-changes-read-btn" onClick={onMarkRead}>
          Am vazut modificarile
        </button>
      </div>
      <div className="page-changes-list">
        {visibleChanges.map((item) => {
          const detailLines = getAuditDetailLines(item);
          return (
            <article key={item.id} className="page-change-card">
              <div className="page-change-card-top">
                <strong>{item.title || "Modificare"}</strong>
                <span>{formatAuditMoment(item.createdAt)}</span>
              </div>
              {item.message ? <p>{item.message}</p> : null}
              {detailLines.length ? (
                <ul>{detailLines.map((line) => <li key={line}>{line}</li>)}</ul>
              ) : null}
              <div className="page-change-meta">
                {item.actorUserName || "WorkControl"}
                {item.entityLabel ? ` - ${item.entityLabel}` : ""}
              </div>
            </article>
          );
        })}
        {changes.length > visibleChanges.length ? (
          <div className="page-change-more">
            +{changes.length - visibleChanges.length} modificari mai vechi pe pagina aceasta
          </div>
        ) : null}
      </div>
    </section>
  );
}
