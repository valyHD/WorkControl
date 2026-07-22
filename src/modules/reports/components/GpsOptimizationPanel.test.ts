import { describe, expect, it } from "vitest";
import { formatLocalConsumerLabel } from "../utils/billingTelemetryLabels";

describe("formatLocalConsumerLabel", () => {
  it("uses a neutral vehicle route label for internal route diagnostics", () => {
    expect(formatLocalConsumerLabel("simulation-routes")).toBe("trasee vehicul");
    expect(formatLocalConsumerLabel("gps-route-cache")).toBe("gps route cache");
  });
});
