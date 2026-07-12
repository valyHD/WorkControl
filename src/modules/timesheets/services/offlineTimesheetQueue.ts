import type { TimesheetLocation } from "../../../types/timesheet";
import { getActiveTimesheetForUser, startTimesheet, stopTimesheet } from "./timesheetsService";

const STORAGE_KEY = "wc_offline_timesheet_queue_v1";
const MAX_QUEUE_ITEMS = 20;
let flushPromise: Promise<number> | null = null;

export type OfflineTimesheetStartPayload = {
  userId: string;
  userName: string;
  userThemeKey?: string | null;
  projectId: string;
  projectCode: string;
  projectName: string;
  startLocation: TimesheetLocation;
  startExplanation?: string;
  startPolicyFlag?: string;
  startExpectedTime?: string;
};

export type OfflineTimesheetStopPayload = {
  userId: string;
  timesheetId?: string;
  explanation: string;
  stopLocation: TimesheetLocation;
  stopPolicyFlag?: string;
  stopExpectedMinutes?: number;
};

export type OfflineTimesheetAction =
  | { id: string; type: "start"; occurredAt: number; payload: OfflineTimesheetStartPayload }
  | { id: string; type: "stop"; occurredAt: number; payload: OfflineTimesheetStopPayload };

function readRawQueue(): OfflineTimesheetAction[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is OfflineTimesheetAction => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<OfflineTimesheetAction>;
      return typeof candidate.id === "string" &&
        (candidate.type === "start" || candidate.type === "stop") &&
        typeof candidate.occurredAt === "number" &&
        Boolean(candidate.payload);
    }).slice(0, MAX_QUEUE_ITEMS);
  } catch {
    return [];
  }
}

function writeQueue(queue: OfflineTimesheetAction[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(0, MAX_QUEUE_ITEMS)));
  window.dispatchEvent(new CustomEvent("workcontrol:offline-timesheet-queue"));
}

export function getOfflineTimesheetQueue(userId?: string) {
  const queue = readRawQueue();
  return userId ? queue.filter((item) => item.payload.userId === userId) : queue;
}

export function queueOfflineTimesheetStart(payload: OfflineTimesheetStartPayload) {
  const existing = readRawQueue();
  const hasOpenStart = existing
    .filter((item) => item.payload.userId === payload.userId)
    .reduce((open, item) => item.type === "start" ? true : item.type === "stop" ? false : open, false);
  if (hasOpenStart) throw new Error("Exista deja o pornire offline in asteptare.");
  const action: OfflineTimesheetAction = {
    id: `timesheet-start-${crypto.randomUUID()}`,
    type: "start",
    occurredAt: Date.now(),
    payload,
  };
  writeQueue([...existing, action]);
  return action;
}

export function queueOfflineTimesheetStop(payload: OfflineTimesheetStopPayload) {
  const action: OfflineTimesheetAction = {
    id: `timesheet-stop-${crypto.randomUUID()}`,
    type: "stop",
    occurredAt: Date.now(),
    payload,
  };
  writeQueue([...readRawQueue(), action]);
  return action;
}

export function removeOfflineTimesheetAction(id: string) {
  writeQueue(readRawQueue().filter((item) => item.id !== id));
}

export function getPendingOfflineTimesheetStart(userId: string) {
  let pending: Extract<OfflineTimesheetAction, { type: "start" }> | null = null;
  for (const action of getOfflineTimesheetQueue(userId)) {
    if (action.type === "start") pending = action;
    if (action.type === "stop") pending = null;
  }
  return pending;
}

export function flushOfflineTimesheetQueue(userId: string) {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    let processed = 0;
    for (const action of getOfflineTimesheetQueue(userId)) {
      if (action.type === "start") {
        const active = await getActiveTimesheetForUser(action.payload.userId);
        if (!active) await startTimesheet({ ...action.payload, occurredAt: action.occurredAt });
      } else {
        const active = await getActiveTimesheetForUser(action.payload.userId);
        if (active) {
          await stopTimesheet({
            timesheetId: active.id,
            explanation: action.payload.explanation,
            stopLocation: action.payload.stopLocation,
            stopPolicyFlag: action.payload.stopPolicyFlag,
            stopExpectedMinutes: action.payload.stopExpectedMinutes,
            occurredAt: action.occurredAt,
          });
        }
      }
      removeOfflineTimesheetAction(action.id);
      processed += 1;
    }
    return processed;
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}
