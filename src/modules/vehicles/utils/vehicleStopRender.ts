import type { VehicleStopItem } from "../../../types/vehicle";

function isSimulationBoundaryStop(item: VehicleStopItem) {
  return item.id.includes("sim") || item.id.includes("pre-simulation-stop");
}

function isLiveRealStop(item: VehicleStopItem) {
  return item.id.startsWith("real-contact-off-");
}

function sortStopsByTime(items: VehicleStopItem[]) {
  return [...items].sort((left, right) => left.end.gpsTimestamp - right.end.gpsTimestamp);
}

export function selectStopItemsForRender(
  items: VehicleStopItem[],
  renderLimit: number
): VehicleStopItem[] {
  const sorted = sortStopsByTime(items);
  if (renderLimit <= 0) return [];
  if (sorted.length <= renderLimit) return sorted;

  const mustKeep = new Map<string, VehicleStopItem>();
  const keep = (item: VehicleStopItem | undefined) => {
    if (item) mustKeep.set(item.id, item);
  };

  keep(sorted[0]);
  keep(sorted[sorted.length - 1]);

  for (const item of sorted) {
    if (isSimulationBoundaryStop(item) || isLiveRealStop(item)) {
      keep(item);
    }
  }

  const remainingSlots = Math.max(0, renderLimit - mustKeep.size);
  if (remainingSlots > 0) {
    const optional = sorted.filter((item) => !mustKeep.has(item.id));
    const stride = Math.max(1, Math.ceil(optional.length / remainingSlots));
    optional.forEach((item, index) => {
      if (index % stride === 0 && mustKeep.size < renderLimit) {
        keep(item);
      }
    });
  }

  return sortStopsByTime([...mustKeep.values()]);
}
