import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_FILL_LEAVE_EVENT } from "../../../lib/assistant/runtime/assistantFormFill";
import LeavePlannerPage from "./LeavePlannerPage";

const leaveServiceMocks = vi.hoisted(() => ({
  approveLeaveRequest: vi.fn(),
  deleteLeaveRequest: vi.fn(),
  getLeaveDateSet: vi.fn(() => new Set<string>()),
  getWorkedMinutesByDay: vi.fn(() => ({})),
  saveLeaveRequest: vi.fn(),
}));

const highlighterMocks = vi.hoisted(() => ({
  highlightAssistantElement: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn((...parts: unknown[]) => ({ parts })),
  documentId: vi.fn(() => ({ fieldPath: "__name__" })),
  limit: vi.fn((value: unknown) => ({ limit: value })),
  onSnapshot: vi.fn((...args: unknown[]) => {
    const onData = args.find((arg) => typeof arg === "function") as
      ((value: { docs: never[] }) => void) | undefined;
    onData?.({ docs: [] });
    return vi.fn();
  }),
  orderBy: vi.fn((...parts: unknown[]) => ({ orderBy: parts })),
  query: vi.fn((...parts: unknown[]) => ({ query: parts })),
  where: vi.fn((...parts: unknown[]) => ({ where: parts })),
}));

vi.mock("../../../lib/firebase/firebase", () => ({ db: { project: "test" } }));
vi.mock("../../../providers/AuthProvider", () => ({
  useAuth: () => ({
    role: "angajat",
    loading: false,
    user: {
      uid: "leave-user-test",
      email: "leave@example.test",
      displayName: "Utilizator Test",
      primaryCompanyName: "Companie Test",
      roleTitle: "Tehnician",
      department: "Service",
    },
  }),
}));
vi.mock("../services/leaveRequestsService", () => leaveServiceMocks);
vi.mock("../../../lib/assistant/runtime/assistantButtonHighlighter", () => highlighterMocks);
vi.mock("../../../lib/files/downloadFile", () => ({ downloadFileFromUrl: vi.fn() }));
vi.mock("../../../components/UserProfileLink", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

describe("LeavePlannerPage form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts assistant values but does not submit without explicit user action", async () => {
    render(
      <MemoryRouter initialEntries={["/my-leave"]}>
        <LeavePlannerPage />
      </MemoryRouter>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(ASSISTANT_FILL_LEAVE_EVENT, {
          detail: {
            command: "programeaza concediu ultima saptamana din august 2026",
            reason: "Odihna",
          },
        })
      );
    });

    expect(await screen.findByDisplayValue("2026-08-24")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-08-30")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Odihna")).toBeInTheDocument();
    expect(leaveServiceMocks.saveLeaveRequest).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(highlighterMocks.highlightAssistantElement).toHaveBeenCalledWith(
        "[data-assistant-action='submit-leave-request']"
      )
    );
  });

  it("does not submit the leave request without a signature", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/my-leave?assistant=leave&start=2026-08-24&end=2026-08-30"]}>
        <LeavePlannerPage />
      </MemoryRouter>
    );

    const form = screen.getByRole("button", { name: "Trimite cererea" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(await screen.findByText("Semnatura este obligatorie.")).toBeInTheDocument();
    expect(leaveServiceMocks.saveLeaveRequest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Trimite cererea" }));
    expect(leaveServiceMocks.saveLeaveRequest).not.toHaveBeenCalled();
  });
});
