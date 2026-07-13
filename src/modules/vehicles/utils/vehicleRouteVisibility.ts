import type { VehiclePositionItem } from "../../../types/vehicle";
import { filterStationaryGpsJitter } from "./vehicleGps";

export type HiddenGpsInterval = { startTs: number; endTs: number };

export function filterHiddenRealGpsPositions(
  positions: VehiclePositionItem[],
  intervals: HiddenGpsInterval[]
) {
  if (!positions.length || !intervals.length) return positions;

  return positions.filter((point) => {
    const timestamp = point.gpsTimestamp;
    return !intervals.some(
      (interval) => timestamp >= interval.startTs && timestamp <= interval.endTs
    );
  });
}

function crossesHiddenRealGpsInterval(
  prevTs: number,
  nextTs: number,
  intervals: HiddenGpsInterval[]
) {
  return intervals.some((interval) => prevTs < interval.startTs && nextTs > interval.endTs);
}

export function splitVisibleRealGpsSegments(
  positions: VehiclePositionItem[],
  intervals: HiddenGpsInterval[]
) {
  const visible = filterHiddenRealGpsPositions(positions, intervals);
  if (!visible.length) return [];
  if (!intervals.length)
    return [filterStationaryGpsJitter(visible)].filter((segment) => segment.length > 0);

  const rawSegments: VehiclePositionItem[][] = [];
  let current: VehiclePositionItem[] = [];

  for (const point of visible) {
    const previous = current[current.length - 1];
    if (
      previous &&
      crossesHiddenRealGpsInterval(previous.gpsTimestamp, point.gpsTimestamp, intervals)
    ) {
      if (current.length) rawSegments.push(current);
      current = [point];
      continue;
    }

    current.push(point);
  }

  if (current.length) rawSegments.push(current);
  return rawSegments.map(filterStationaryGpsJitter).filter((segment) => segment.length > 0);
}
