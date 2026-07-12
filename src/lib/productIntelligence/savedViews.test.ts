import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSavedView, readSavedViews, saveView } from "./savedViews";

describe("saved views", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Date, "now").mockReturnValue(1_750_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.25);
  });

  it("isolates saved filters per user and namespace", () => {
    saveView("vehicles", "user-1", "GPS live", { gps: "fresh" });
    expect(readSavedViews<{ gps: string }>("vehicles", "user-1")).toHaveLength(1);
    expect(readSavedViews("vehicles", "user-2")).toEqual([]);
    expect(readSavedViews("notifications", "user-1")).toEqual([]);
  });

  it("deletes only the selected view", () => {
    const views = saveView("vehicles", "user-1", "Service", { attention: "service" });
    expect(deleteSavedView("vehicles", "user-1", views[0].id)).toEqual([]);
  });
});
