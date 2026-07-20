import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditLogPage from "./AuditLogPage";
import { getAuditLogs } from "../services/auditLogService";
import { getAllUsers } from "../../users/services/usersService";

vi.mock("../../../providers/AuthProvider", () => ({
  useAuth: () => ({ role: "admin", user: { uid: "admin-1" } }),
}));
vi.mock("../services/auditLogService", () => ({ getAuditLogs: vi.fn() }));
vi.mock("../../users/services/usersService", () => ({ getAllUsers: vi.fn() }));
vi.mock("../../../components/UserProfileLink", () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

describe("AuditLogPage lazy activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuditLogs).mockResolvedValue([]);
    vi.mocked(getAllUsers).mockResolvedValue([]);
  });

  it("loads only ten recent activities by default and expands only on request", async () => {
    render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(getAuditLogs).toHaveBeenCalledWith(10));
    expect(getAllUsers).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/numar activitati/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /afiseaza 1000/i }));

    await waitFor(() => expect(getAuditLogs).toHaveBeenLastCalledWith(1000));
    expect(getAllUsers).toHaveBeenCalledTimes(1);
  });
});
