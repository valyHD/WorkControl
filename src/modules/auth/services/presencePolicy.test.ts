import { describe, expect, it } from "vitest";
import {
  shouldWritePresence,
  USER_PRESENCE_HEARTBEAT_MS,
} from "./presencePolicy";

describe("presence write policy", () => {
  it("writes immediately when the online state changes", () => {
    expect(shouldWritePresence({ lastOnline: true, lastWriteAt: 100 }, false, 101)).toBe(true);
    expect(shouldWritePresence({ lastOnline: false, lastWriteAt: 100 }, true, 101)).toBe(true);
  });

  it("deduplicates focus, online and visibility storms", () => {
    const state = { lastOnline: true, lastWriteAt: 1_000 };
    for (let index = 0; index < 100; index += 1) {
      expect(shouldWritePresence(state, true, 1_001 + index)).toBe(false);
    }
  });

  it("allows one online heartbeat every four minutes", () => {
    const state = { lastOnline: true, lastWriteAt: 1_000 };
    expect(
      shouldWritePresence(state, true, 1_000 + USER_PRESENCE_HEARTBEAT_MS - 1)
    ).toBe(false);
    expect(
      shouldWritePresence(state, true, 1_000 + USER_PRESENCE_HEARTBEAT_MS)
    ).toBe(true);
  });

  it("does not repeat offline writes", () => {
    expect(
      shouldWritePresence({ lastOnline: false, lastWriteAt: 1_000 }, false, 99_000)
    ).toBe(false);
  });
});
