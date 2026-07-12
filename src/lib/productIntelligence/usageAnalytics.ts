import { getAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled } from "firebase/analytics";
import app from "../firebase/firebase";

const CONSENT_KEY = "wc_usage_analytics_consent_v1";
let analyticsPromise: ReturnType<typeof createAnalytics> | null = null;

async function createAnalytics() {
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") return null;
  if (!(await isSupported())) return null;
  return getAnalytics(app);
}

export function hasUsageAnalyticsConsent() {
  return typeof window !== "undefined" && window.localStorage.getItem(CONSENT_KEY) === "granted";
}

export async function setUsageAnalyticsConsent(enabled: boolean) {
  window.localStorage.setItem(CONSENT_KEY, enabled ? "granted" : "denied");
  analyticsPromise ??= createAnalytics();
  const analytics = await analyticsPromise;
  if (analytics) setAnalyticsCollectionEnabled(analytics, enabled);
}

export function sanitizeAnalyticsPath(path: string) {
  const cleanPath = path.split("?")[0].split("#")[0];
  const segments = cleanPath.split("/").filter(Boolean);
  const entityModules = new Set(["users", "vehicles", "tools", "timesheets", "maintenance"]);
  const reservedSegments = new Set(["new", "edit", "gps-map", "live", "manage", "parts", "orders"]);
  if (segments.length >= 2 && entityModules.has(segments[0]) && !reservedSegments.has(segments[1])) {
    segments[1] = ":id";
  }
  return `/${segments.join("/")}`.slice(0, 160);
}

export async function trackWorkControlPage(path: string, role: string) {
  if (!hasUsageAnalyticsConsent()) return;
  analyticsPromise ??= createAnalytics();
  const analytics = await analyticsPromise;
  if (!analytics) return;
  logEvent(analytics, "page_view", {
    page_path: sanitizeAnalyticsPath(path),
    user_role: role.slice(0, 30),
  });
}

export async function trackWorkControlAction(action: string, module: string) {
  if (!hasUsageAnalyticsConsent()) return;
  analyticsPromise ??= createAnalytics();
  const analytics = await analyticsPromise;
  if (!analytics) return;
  logEvent(analytics, "workcontrol_action", {
    action: action.slice(0, 80),
    module: module.slice(0, 60),
  });
}
