export type MaintenanceReportTaskState = "idle" | "running" | "success" | "error";

export type MaintenanceReportTaskSnapshot = {
  id: string;
  state: MaintenanceReportTaskState;
  message: string;
  error: string;
  startedAt: number;
  finishedAt: number;
};

type TaskListener = (snapshot: MaintenanceReportTaskSnapshot) => void;

const IDLE_SNAPSHOT: MaintenanceReportTaskSnapshot = {
  id: "",
  state: "idle",
  message: "",
  error: "",
  startedAt: 0,
  finishedAt: 0,
};

let snapshot = IDLE_SNAPSHOT;
let activePromise: Promise<void> | null = null;
const listeners = new Set<TaskListener>();

function publish(next: MaintenanceReportTaskSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener(next);
}

export function subscribeMaintenanceReportTask(listener: TaskListener) {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function getMaintenanceReportTaskSnapshot() {
  return snapshot;
}

export function startMaintenanceReportTask(
  execute: (updateMessage: (message: string) => void) => Promise<void>
) {
  if (activePromise && snapshot.state === "running") {
    return { started: false, taskId: snapshot.id, promise: activePromise };
  }

  const taskId = `maintenance-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  publish({
    id: taskId,
    state: "running",
    message: "Raportul se pregateste in fundal...",
    error: "",
    startedAt,
    finishedAt: 0,
  });

  const updateMessage = (message: string) => {
    if (snapshot.id !== taskId || snapshot.state !== "running") return;
    publish({ ...snapshot, message });
  };

  activePromise = Promise.resolve()
    .then(() => execute(updateMessage))
    .then(() => {
      publish({
        ...snapshot,
        id: taskId,
        state: "success",
        message: "Raportul a fost generat si trimis.",
        error: "",
        finishedAt: Date.now(),
      });
    })
    .catch((error) => {
      publish({
        ...snapshot,
        id: taskId,
        state: "error",
        message: "",
        error: error instanceof Error ? error.message : "Raportul nu a putut fi trimis.",
        finishedAt: Date.now(),
      });
    })
    .finally(() => {
      activePromise = null;
    });

  return { started: true, taskId, promise: activePromise };
}
