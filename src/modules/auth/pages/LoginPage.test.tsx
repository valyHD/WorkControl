import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

const authService = vi.hoisted(() => ({
  loginWithEmail: vi.fn(),
  registerWithEmail: vi.fn(),
}));

vi.mock("../services/authService", () => authService);
vi.mock("../../../providers/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

describe("LoginPage account flows", () => {
  beforeEach(() => {
    authService.loginWithEmail.mockReset();
    authService.registerWithEmail.mockReset();
    authService.loginWithEmail.mockResolvedValue({});
    authService.registerWithEmail.mockResolvedValue({});
  });

  it("creates a new account only after validating the complete registration form", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Cont nou" }));
    await user.type(screen.getByLabelText("Nume complet"), "Ion Popescu");
    await user.type(screen.getByLabelText("Email"), "ION@example.test");
    await user.type(screen.getByLabelText("Parola"), "password123");
    await user.type(screen.getByLabelText("Confirma parola"), "password123");
    await user.click(screen.getByRole("button", { name: "Creeaza cont" }));

    expect(authService.registerWithEmail).toHaveBeenCalledWith({
      fullName: "Ion Popescu",
      email: "ION@example.test",
      password: "password123",
    });
    expect(authService.loginWithEmail).not.toHaveBeenCalled();
  });

  it("does not create the account when password confirmation differs", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("tab", { name: "Cont nou" }));
    await user.type(screen.getByLabelText("Nume complet"), "Ion Popescu");
    await user.type(screen.getByLabelText("Email"), "ion@example.test");
    await user.type(screen.getByLabelText("Parola"), "password123");
    await user.type(screen.getByLabelText("Confirma parola"), "password456");
    await user.click(screen.getByRole("button", { name: "Creeaza cont" }));

    expect(await screen.findByText("Parolele nu coincid.")).toBeInTheDocument();
    expect(authService.registerWithEmail).not.toHaveBeenCalled();
  });
});
