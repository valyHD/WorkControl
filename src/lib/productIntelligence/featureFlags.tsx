import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type WorkControlFeatureFlag =
  | "operationalInbox"
  | "savedViews"
  | "usageAnalytics"
  | "offlineTimesheets"
  | "offlineReceipts"
  | "contextualHelp"
  | "feedback"
  | "releaseNotes"
  | "systemHealth";

export type WorkControlFeatureFlags = Record<WorkControlFeatureFlag, boolean>;

const STORAGE_KEY = "wc_feature_flags_v1";
const DEFAULT_FLAGS: WorkControlFeatureFlags = {
  operationalInbox: true,
  savedViews: true,
  usageAnalytics: true,
  offlineTimesheets: true,
  offlineReceipts: true,
  contextualHelp: true,
  feedback: true,
  releaseNotes: true,
  systemHealth: true,
};

function readOverrides(): Partial<WorkControlFeatureFlags> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(DEFAULT_FLAGS)
        .filter((key) => typeof parsed[key] === "boolean")
        .map((key) => [key, parsed[key]])
    ) as Partial<WorkControlFeatureFlags>;
  } catch {
    return {};
  }
}

type FeatureFlagContextValue = {
  flags: WorkControlFeatureFlags;
  setFlag: (flag: WorkControlFeatureFlag, enabled: boolean) => void;
  resetFlags: () => void;
};

const FeatureFlagContext = createContext<FeatureFlagContextValue | null>(null);

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Partial<WorkControlFeatureFlags>>(readOverrides);
  const flags = useMemo(() => ({ ...DEFAULT_FLAGS, ...overrides }), [overrides]);

  const value = useMemo<FeatureFlagContextValue>(() => ({
    flags,
    setFlag: (flag, enabled) => {
      setOverrides((current) => {
        const next = { ...current, [flag]: enabled };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    resetFlags: () => {
      window.localStorage.removeItem(STORAGE_KEY);
      setOverrides({});
    },
  }), [flags]);

  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>;
}

export function useFeatureFlags() {
  const value = useContext(FeatureFlagContext);
  if (!value) throw new Error("useFeatureFlags trebuie folosit in FeatureFlagProvider.");
  return value;
}

export const WORKCONTROL_FEATURE_FLAG_LABELS: Record<WorkControlFeatureFlag, string> = {
  operationalInbox: "Inbox operational",
  savedViews: "Filtre salvate",
  usageAnalytics: "Analytics de utilizare",
  offlineTimesheets: "Pontaj offline",
  offlineReceipts: "Bonuri offline",
  contextualHelp: "Ajutor contextual",
  feedback: "Feedback in aplicatie",
  releaseNotes: "Noutati versiune",
  systemHealth: "Health monitoring",
};
