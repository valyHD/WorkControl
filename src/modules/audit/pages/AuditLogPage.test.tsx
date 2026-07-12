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
    vi.mocked(getAuditLogs).mockResolvedValue([]);
    vi.mocked(getAllUsers).mockResolvedValue([]);
  });

  it("does not read activity until the user explicitly requests it", async () => {
    render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    );

    expect(getAuditLogs).not.toHaveBeenCalled();
    expect(getAllUsers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /afiseaza activitatea/i }));

    await waitFor(() => expect(getAuditLogs).toHaveBeenCalledWith(200));
    expect(getAllUsers).toHaveBeenCalledTimes(1);
  });
});
