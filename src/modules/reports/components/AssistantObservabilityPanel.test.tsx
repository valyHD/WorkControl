import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssistantObservabilityPanel from "./AssistantObservabilityPanel";
import { getAssistantObservabilityTraces } from "../services/assistantObservabilityService";

vi.mock("../services/assistantObservabilityService", () => ({
  getAssistantObservabilityTraces: vi.fn(),
}));

const mockedGetTraces = vi.mocked(getAssistantObservabilityTraces);

describe("AssistantObservabilityPanel", () => {
  beforeEach(() => {
    mockedGetTraces.mockReset();
  });

  it("does not read or render traces for non-admin users", () => {
    const { container } = render(<AssistantObservabilityPanel isAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockedGetTraces).not.toHaveBeenCalled();
  });

  it("renders the latest redacted traces and operational metrics for an admin", async () => {
    mockedGetTraces.mockResolvedValue([
      {
        id: "trace-1",
        transcript: "Actualizează [PLATE] la [NUMBER] km",
        intent: "update_vehicle",
        targetModule: "vehicles",
        toolCallIds: ["vehicles.update"],
        confidence: 0.96,
        latencyMs: 820,
        outcome: "executed",
        clarificationRequired: false,
        missingInformation: [],
        model: "gpt-4.1-mini",
        inputTokens: 900,
        outputTokens: 100,
        totalTokens: 1_000,
        estimatedCostUsd: 0.00052,
        createdAt: Date.UTC(2026, 6, 12, 8, 30),
        expiresAt: Date.UTC(2026, 7, 11, 8, 30),
      },
      {
        id: "trace-2",
        transcript: "Deschide vehiculul",
        intent: "open_vehicle",
        targetModule: "vehicles",
        toolCallIds: [],
        confidence: 0.62,
        latencyMs: 410,
        outcome: "needs_clarification",
        clarificationRequired: true,
        missingInformation: ["entity"],
        model: "gpt-4.1-mini",
        inputTokens: 400,
        outputTokens: 60,
        totalTokens: 460,
        estimatedCostUsd: 0.000256,
        createdAt: Date.UTC(2026, 6, 12, 8, 25),
        expiresAt: Date.UTC(2026, 7, 11, 8, 25),
      },
    ]);

    render(<AssistantObservabilityPanel isAdmin />);

    expect(await screen.findByText("Actualizează [PLATE] la [NUMBER] km")).toBeInTheDocument();
    expect(mockedGetTraces).toHaveBeenCalledWith(100);
    expect(screen.getByText("Executată")).toBeInTheDocument();
    expect(screen.getByText("Clarificare")).toBeInTheDocument();
    expect(screen.getByText("1.460")).toBeInTheDocument();
    expect(screen.queryByText(/ionut@example/i)).not.toBeInTheDocument();
  });

  it("shows a controlled read error", async () => {
    mockedGetTraces.mockRejectedValue(new Error("permission-denied"));
    render(<AssistantObservabilityPanel isAdmin />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Nu am putut încărca urmele asistentului."
      )
    );
  });
});
