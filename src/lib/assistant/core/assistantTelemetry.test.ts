import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantTelemetry } from "./assistantTelemetry";

const mocks = vi.hoisted(() => ({ logAssistantAudit: vi.fn() }));

vi.mock("../runtime/assistantAudit", () => ({
  logAssistantAudit: mocks.logAssistantAudit,
}));

describe("assistant telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never turns a successful controlled action into a user-visible failure", async () => {
    mocks.logAssistantAudit.mockRejectedValueOnce(new Error("trace missing"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const telemetry = createAssistantTelemetry({ userId: "user-1", userName: "User Test" });

    await expect(
      telemetry({
        command: "Genereaza raport revizie pentru Vali",
        toolId: "maintenance.report.send",
        module: "maintenance",
        risk: "high",
        actorId: "user-1",
        status: "success",
        input: { fields: { clientQuery: "Vali", reportType: "revizie" } },
        output: { message: "Raport trimis." },
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
