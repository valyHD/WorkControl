import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompanySelectionGate from "./CompanySelectionGate";

const authState = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));
const companyService = vi.hoisted(() => ({
  getAvailableCompanyChoices: vi.fn(),
  claimInitialCompany: vi.fn(),
}));

vi.mock("../../../providers/AuthProvider", () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock("../../companies/services/companiesService", () => companyService);

describe("CompanySelectionGate", () => {
  beforeEach(() => {
    authState.user = {
      uid: "employee-unassigned",
      globalAdmin: false,
      companyIds: [],
      primaryCompanyId: "",
    };
    companyService.getAvailableCompanyChoices.mockReset();
    companyService.claimInitialCompany.mockReset();
    companyService.getAvailableCompanyChoices.mockResolvedValue([
      { companyId: "company-a", companyName: "Company A" },
      { companyId: "company-b", companyName: "Company B" },
    ]);
    companyService.claimInitialCompany.mockResolvedValue({
      companyId: "company-b",
      companyName: "Company B",
    });
  });

  it("blocks the application until the user claims one company", async () => {
    const user = userEvent.setup();
    render(
      <CompanySelectionGate>
        <div>Aplicatia WorkControl</div>
      </CompanySelectionGate>
    );

    expect(screen.queryByText("Aplicatia WorkControl")).not.toBeInTheDocument();
    const selector = await screen.findByLabelText("Firma");
    await user.selectOptions(selector, "company-b");
    await user.click(screen.getByRole("button", { name: "Confirma firma" }));

    expect(companyService.claimInitialCompany).toHaveBeenCalledWith("company-b");
  });

  it("lets assigned users and global admins enter without loading company choices", () => {
    authState.user = {
      uid: "global-admin",
      globalAdmin: true,
      companyIds: [],
      primaryCompanyId: "",
    };

    render(
      <CompanySelectionGate>
        <div>Aplicatia WorkControl</div>
      </CompanySelectionGate>
    );

    expect(screen.getByText("Aplicatia WorkControl")).toBeInTheDocument();
    expect(companyService.getAvailableCompanyChoices).not.toHaveBeenCalled();
  });
});
