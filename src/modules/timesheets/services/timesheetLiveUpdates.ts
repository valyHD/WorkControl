export const TIMESHEETS_CHANGED_EVENT = "workcontrol:timesheets-changed";

export type TimesheetsChangedDetail = {
  userId?: string;
  reason?: "start" | "stop" | "location" | "offline-sync" | "manual";
  changedAt: number;
};

let updatesChannel: BroadcastChannel | null = null;

function getUpdatesChannel() {
  if (typeof BroadcastChannel === "undefined") return null;
  updatesChannel ??= new BroadcastChannel(TIMESHEETS_CHANGED_EVENT);
  return updatesChannel;
}

export function notifyTimesheetsChanged(
  detail: Omit<TimesheetsChangedDetail, "changedAt"> = {}
) {
  if (typeof window === "undefined") return;
  const payload: TimesheetsChangedDetail = { ...detail, changedAt: Date.now() };
  window.dispatchEvent(new CustomEvent(TIMESHEETS_CHANGED_EVENT, { detail: payload }));
  getUpdatesChannel()?.postMessage(payload);
}

export function subscribeTimesheetsChanged(
  listener: (detail: TimesheetsChangedDetail) => void
) {
  if (typeof window === "undefined") return () => {};

  const handleWindowEvent = (event: Event) => {
    listener((event as CustomEvent<TimesheetsChangedDetail>).detail);
  };
  const channel = getUpdatesChannel();
  const handleChannelMessage = (event: MessageEvent<TimesheetsChangedDetail>) => {
    listener(event.data);
  };

  window.addEventListener(TIMESHEETS_CHANGED_EVENT, handleWindowEvent);
  channel?.addEventListener("message", handleChannelMessage);

  return () => {
    window.removeEventListener(TIMESHEETS_CHANGED_EVENT, handleWindowEvent);
    channel?.removeEventListener("message", handleChannelMessage);
  };
}
