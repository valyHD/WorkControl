import { describe, expect, it } from "vitest";
import {
  NAVIGATION_ITEMS,
  getNavigationItemForPath,
  getNavigationItemsForRole,
  isNavigationItemActive,
} from "./navigation";
import { getPageExperience } from "./pageExperience";

describe("navigation registry", () => {
  it("contains the required metadata without duplicate ids", () => {
    const ids = new Set<string>();
    NAVIGATION_ITEMS.forEach((item) => {
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(item.label).toBeTruthy();
      expect(item.path.startsWith("/")).toBe(true);
      expect(item.aliases.length).toBeGreaterThan(0);
      expect(item.keywords.length).toBeGreaterThan(0);
      expect(item.mobilePriority).toBeGreaterThan(0);
    });
  });

  it("hides administration-only pages from employees", () => {
    const employeeIds = getNavigationItemsForRole("angajat").map((item) => item.id);
    expect(employeeIds).not.toContain("control-panel");
    expect(employeeIds).not.toContain("history");
    expect(employeeIds).not.toContain("ui-lab");
    expect(employeeIds).toContain("dashboard");
    expect(employeeIds).toContain("my-timesheets");
  });

  it("keeps UI Lab available to admins and resolves the most specific route", () => {
    const adminIds = getNavigationItemsForRole("admin").map((item) => item.id);
    expect(adminIds).toContain("ui-lab");
    expect(getNavigationItemForPath("/control-panel/ui-lab")?.id).toBe("ui-lab");
    expect(getNavigationItemForPath("/maintenance/orders")?.id).toBe("maintenance-orders");
  });

  it("resolves dynamic page experience definitions", () => {
    expect(getPageExperience("/vehicles/vehicle-1/edit")?.id).toBe("vehicles-edit");
    expect(getPageExperience("/users/user-1")?.id).toBe("users-details");
    expect(getPageExperience("/control-panel/ui-lab")?.requiredRole).toBe("admin");
  });

  it("keeps special active-state rules inside the navigation registry", () => {
    expect(isNavigationItemActive({
      pathname: "/vehicles/vehicle-1",
      search: "?view=my-vehicle",
      itemPath: "/my-vehicle",
      routerIsActive: false,
    })).toBe(true);
    expect(isNavigationItemActive({
      pathname: "/maintenance/orders",
      search: "",
      itemPath: "/maintenance",
      routerIsActive: true,
    })).toBe(false);
  });
});
