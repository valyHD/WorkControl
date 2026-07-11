import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectItem, TimesheetItem } from "../../../types/timesheet";
import TimesheetForm from "./TimesheetForm";

vi.mock("../services/geocodingService", () => ({
  geocodeAddress: vi.fn(),
  reverseGeocode: vi.fn().mockResolvedValue("Locatie test"),
}));

const project: ProjectItem = {
  id: "project-test",
  code: "P-TEST",
  name: "Proiect Test",
  status: "activ",
  createdAt: 1,
  updatedAt: 1,
};

function activeTimesheet(): TimesheetItem {
  return {
    id: "timesheet-test",
    userId: "user-test",
    userName: "Utilizator Test",
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    status: "activ",
    explanation: "",
    startAt: Date.UTC(2026, 6, 10, 8),
    stopAt: null,
    workedMinutes: 0,
    startLocation: { lat: 44.4, lng: 26.1, label: "Locatie test" },
    stopLocation: null,
    startSource: "web",
    stopSource: "",
    workDate: "2026-07-10",
    yearMonth: "2026-07",
    weekKey: "2026-W28",
    createdAt: Date.UTC(2026, 6, 10, 8),
    updatedAt: Date.UTC(2026, 6, 10, 8),
  };
}

describe("TimesheetForm", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 10, 8, 0));
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) =>
          success({ coords: { latitude: 44.4, longitude: 26.1 } })
        ),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the active timesheet card and stop action", () => {
    render(
      <TimesheetForm
        projects={[project]}
        activeTimesheet={activeTimesheet()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        loading={false}
      />
    );

    expect(screen.getByText("Proiect Test")).toBeInTheDocument();
    expect(screen.getByText("activ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Opreste pontaj" })).toHaveAttribute(
      "data-assistant-action",
      "stop-my-timesheet"
    );
  });

  it("starts only after the user selects a project and presses the highlighted action", async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <TimesheetForm
        projects={[project]}
        activeTimesheet={null}
        onStart={onStart}
        onStop={vi.fn()}
        loading={false}
        attentionActive
      />
    );

    const startButton = screen.getByRole("button", { name: "Porneste pontaj" });
    expect(startButton).toHaveClass("attention-pulse");
    expect(onStart).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByRole("combobox"), project.id);
    await user.click(startButton);

    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith(
        project.id,
        expect.objectContaining({ lat: 44.4, lng: 26.1 }),
        "",
        "",
        "08:00"
      )
    );
  });
});
