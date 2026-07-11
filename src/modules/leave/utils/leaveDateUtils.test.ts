import { describe, expect, it } from "vitest";
import {
  calculateLeaveIntervalDays,
  inferAssistantLeaveRange,
  parseAssistantLeaveDate,
} from "./leaveDateUtils";

describe("leave date helpers", () => {
  it("calculates an inclusive leave interval", () => {
    expect(calculateLeaveIntervalDays("2026-08-24", "2026-08-30")).toBe(7);
    expect(calculateLeaveIntervalDays("2026-08-30", "2026-08-24")).toBe(0);
  });

  it("keeps calendar-day counts stable across DST changes", () => {
    expect(calculateLeaveIntervalDays("2026-03-28", "2026-03-30")).toBe(3);
    expect(calculateLeaveIntervalDays("2026-10-24", "2026-10-26")).toBe(3);
  });

  it("interprets the last complete Monday-Sunday week of August 2026", () => {
    expect(inferAssistantLeaveRange("ultima saptamana din august 2026")).toEqual({
      startDate: "2026-08-24",
      endDate: "2026-08-30",
    });
    expect(inferAssistantLeaveRange("ultima săptămână din august 2026")).toEqual({
      startDate: "2026-08-24",
      endDate: "2026-08-30",
    });
  });

  it("parses named and numeric Romanian dates", () => {
    expect(parseAssistantLeaveDate("27 august 2026")).toBe("2026-08-27");
    expect(parseAssistantLeaveDate("27.08.2026")).toBe("2026-08-27");
  });

  it("accepts leap-day dates only in leap years", () => {
    expect(parseAssistantLeaveDate("29.02.2028")).toBe("2028-02-29");
    expect(parseAssistantLeaveDate("29.02.2026")).toBe("");
    expect(calculateLeaveIntervalDays("2028-02-28", "2028-02-29")).toBe(2);
  });

  it.each(["31.02.2026", "32.08.2026", "00.08.2026", "2026-02-31"])(
    "rejects the invalid date %s",
    (value) => {
      expect(parseAssistantLeaveDate(value)).toBe("");
    }
  );
});
