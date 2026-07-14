export const USER_PRESENCE_HEARTBEAT_MS = 4 * 60 * 1000;

export type PresenceWriteState = {
  lastOnline: boolean | null;
  lastWriteAt: number;
};

export function shouldWritePresence(
  state: PresenceWriteState,
  nextOnline: boolean,
  now: number,
  force = false
): boolean {
  if (force || state.lastOnline === null) return true;
  if (state.lastOnline !== nextOnline) return true;
  return nextOnline && now - state.lastWriteAt >= USER_PRESENCE_HEARTBEAT_MS;
}
