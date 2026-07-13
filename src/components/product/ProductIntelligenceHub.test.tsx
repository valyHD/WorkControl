import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductIntelligenceHub from "./ProductIntelligenceHub";

vi.mock("../../lib/productIntelligence", () => ({
  getContextualHelp: () => [{ title: "Ajutor contextual", description: "Pasul urmator." }],
  hasUsageAnalyticsConsent: () => false,
  setUsageAnalyticsConsent: vi.fn(async () => undefined),
  useFeatureFlags: () => ({
    flags: { releaseNotes: true, feedback: true, usageAnalytics: true },
    setFlag: vi.fn(),
  }),
  WORKCONTROL_FEATURE_FLAG_LABELS: {},
  WORKCONTROL_RELEASE_NOTES: [],
}));

vi.mock("../../modules/feedback/services/feedbackService", () => ({
  submitAppFeedback: vi.fn(async () => undefined),
}));

describe("ProductIntelligenceHub", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders its dialog in the document portal and closes from the backdrop", async () => {
    const user = userEvent.setup();
    render(<ProductIntelligenceHub userId="user-1" role="angajat" pathname="/maintenance" />);
    const trigger = screen.getByRole("button", { name: "Ajutor si noutati WorkControl" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Centru ajutor WorkControl" });
    const backdrop = dialog.parentElement;
    expect(backdrop).toHaveClass("wc-intelligence-backdrop");
    expect(backdrop?.parentElement).toBe(document.body);
    await user.click(backdrop!);

    expect(screen.queryByRole("dialog", { name: "Centru ajutor WorkControl" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<ProductIntelligenceHub userId="user-1" role="angajat" pathname="/dashboard" />);
    await user.click(screen.getByRole("button", { name: "Ajutor si noutati WorkControl" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Centru ajutor WorkControl" })).not.toBeInTheDocument();
  });
});
