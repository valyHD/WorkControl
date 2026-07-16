import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { TimesheetItem } from "../../../types/timesheet";
import TimesheetCalendar from "./TimesheetCalendar";

function timesheet(overrides: Partial<TimesheetItem>): TimesheetItem {
  return {
    id: "timesheet-1",
    userId: "user-1",
    userName: "Ionut Test",
    userThemeKey: "u6",
    projectId: "project-1",
    projectCode: "",
    projectName: "Mentenanta",
    status: "inchis",
    explanation: "",
    startAt: new Date("2026-06-12T08:00:00+03:00").getTime(),
    stopAt: new Date("2026-06-12T16:00:00+03:00").getTime(),
    workedMinutes: 480,
    startLocation: { lat: null, lng: null, label: "Bucuresti" },
    stopLocation: { lat: null, lng: null, label: "Bucuresti" },
    startSource: "web",
    stopSource: "web",
    workDate: "2026-06-12",
    yearMonth: "2026-06",
    weekKey: "2026-W24",
    createdAt: new Date("2026-06-12T08:00:00+03:00").getTime(),
    updatedAt: new Date("2026-06-12T16:00:00+03:00").getTime(),
    ...overrides,
  };
}

describe("TimesheetCalendar", () => {
  it("navigates to the previous month and shows its persisted hours", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TimesheetCalendar
          timesheets={[timesheet({})]}
          userThemeKey="u6"
          initialMonth={new Date(2026, 6, 1)}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/iulie 2026/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Luna anterioara" }));
    expect(screen.getByText(/iunie 2026/i)).toBeInTheDocument();
    expect(screen.getByText("8h 00m")).toBeInTheDocument();
  });

  it("uses the user's visual theme and identifies one-minute sessions", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TimesheetCalendar
          timesheets={[timesheet({ workedMinutes: 1, stopAt: new Date("2026-06-12T08:01:00+03:00").getTime() })]}
          userThemeKey="u6"
          initialMonth={new Date(2026, 5, 1)}
        />
      </MemoryRouter>
    );

    const dayButton = screen.getByRole("button", { name: /12\s*complet\s*0h 01m/i });
    expect(dayButton).toHaveClass("user-theme-u6");
    await user.click(dayButton);
    expect(screen.getByText(/sesiune foarte scurta/i)).toBeInTheDocument();
  });
});
