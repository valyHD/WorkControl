import { useEffect } from "react";
import { useFeatureFlags } from "../../lib/productIntelligence";
import { useAuth } from "../../providers/AuthProvider";
import { flushOfflineExpenseUploads } from "../../modules/expenses/services/offlineExpenseQueue";
import { flushOfflineTimesheetQueue } from "../../modules/timesheets/services/offlineTimesheetQueue";

export default function OfflineSyncCoordinator() {
  const { user } = useAuth();
  const { flags } = useFeatureFlags();

  useEffect(() => {
    if (!user?.uid) return;
    let active = true;

    const sync = async () => {
      if (!navigator.onLine || !active) return;
      const tasks: Promise<unknown>[] = [];
      if (flags.offlineTimesheets) tasks.push(flushOfflineTimesheetQueue(user.uid));
      if (flags.offlineReceipts && typeof indexedDB !== "undefined") {
        tasks.push(flushOfflineExpenseUploads(user.uid));
      }
      if (!tasks.length) return;
      const results = await Promise.allSettled(tasks);
      if (!active) return;
      window.dispatchEvent(new CustomEvent("workcontrol:offline-sync-complete", { detail: results }));
    };

    const handleOnline = () => void sync();
    window.addEventListener("online", handleOnline);
    void sync();
    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
    };
  }, [flags.offlineReceipts, flags.offlineTimesheets, user?.uid]);

  return null;
}
