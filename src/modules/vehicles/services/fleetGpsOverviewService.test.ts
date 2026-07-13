import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FIRESTORE_COST_CONTROL } from "../../../config/firestoreCostControl";
import { createFleetGpsOverviewPoller, type FleetGpsOverview } from "./fleetGpsOverviewService";

class VisibilityDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";

  setVisibility(value: DocumentVisibilityState) {
    this.visibilityState = value;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

const response: FleetGpsOverview = {
  config: DEFAULT_FIRESTORE_COST_CONTROL,
  vehicles: [],
  generatedAtMs: 1,
};

describe("fleet GPS overview poller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never overlaps requests and stops while the page is hidden", async () => {
    const visibility = new VisibilityDocument();
    let resolvePending: (value: FleetGpsOverview) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<FleetGpsOverview>((resolve) => {
          resolvePending = (value) => resolve(value);
        })
    );
    const poller = createFleetGpsOverviewPoller({
      load,
      onData: () => undefined,
      visibilityDocument: visibility as unknown as Document,
    });

    const start = poller.start();
    const concurrent = poller.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    resolvePending(response);
    await Promise.all([start, concurrent]);

    visibility.setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(load).toHaveBeenCalledTimes(1);

    visibility.setVisibility("visible");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    poller.stop();
  });
});
