import { describe, expect, it, vi } from "vitest";
import {
  getMaintenanceReportTaskSnapshot,
  startMaintenanceReportTask,
} from "./maintenanceReportBackgroundTask";

describe("maintenance report background task", () => {
  it("continues independently and prevents duplicate report submissions", async () => {
    let finish: (() => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );

    const first = startMaintenanceReportTask(execute);
    const duplicate = startMaintenanceReportTask(vi.fn());

    expect(first.started).toBe(true);
    expect(duplicate.started).toBe(false);
    expect(duplicate.taskId).toBe(first.taskId);
    await Promise.resolve();
    finish?.();
    await first.promise;
    expect(getMaintenanceReportTaskSnapshot()).toMatchObject({ state: "success" });
  });
});
