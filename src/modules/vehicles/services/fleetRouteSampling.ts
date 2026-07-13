export type FleetRouteSamplingWindow = {
  fromTs: number;
  toTs: number;
  includeLastPoint: boolean;
};

export type FleetRouteSamplingSegment = {
  dayKey: string;
  fromTs: number;
  toTs: number;
};

export type FleetRouteSamplingPlan = FleetRouteSamplingSegment & {
  maxReads: number;
  windows: FleetRouteSamplingWindow[];
};

function clampReadBudget(maxItems: number) {
  return Math.max(1, Math.min(2_000, Math.round(maxItems)));
}

export function buildFleetRouteSamplingWindows(
  fromTs: number,
  toTs: number,
  maxReads: number
): FleetRouteSamplingWindow[] {
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) return [];

  const safeReads = clampReadBudget(maxReads);
  const durationMs = Math.max(1, toTs - fromTs + 1);
  const windowCount = Math.max(1, Math.min(Math.ceil(safeReads / 2), durationMs));

  return Array.from({ length: windowCount }, (_, index) => {
    const windowStart = fromTs + Math.floor((durationMs * index) / windowCount);
    const nextWindowStart = fromTs + Math.floor((durationMs * (index + 1)) / windowCount);
    return {
      fromTs: windowStart,
      toTs: index === windowCount - 1 ? toTs : Math.max(windowStart, nextWindowStart - 1),
      includeLastPoint: index * 2 + 1 < safeReads,
    };
  });
}

export function buildFleetRouteSamplingPlan(
  segments: FleetRouteSamplingSegment[],
  maxItems: number
): FleetRouteSamplingPlan[] {
  const validSegments = segments.filter(
    (segment) =>
      segment.dayKey &&
      Number.isFinite(segment.fromTs) &&
      Number.isFinite(segment.toTs) &&
      segment.fromTs <= segment.toTs
  );
  if (!validSegments.length) return [];

  const safeLimit = clampReadBudget(maxItems);
  const selectedSegments =
    validSegments.length <= safeLimit ? validSegments : validSegments.slice(-safeLimit);
  const durations = selectedSegments.map((segment) => segment.toTs - segment.fromTs + 1);
  const totalDuration = durations.reduce((total, duration) => total + duration, 0);
  const remainingAfterMinimum = safeLimit - selectedSegments.length;
  const proportionalReads = durations.map(
    (duration) => (remainingAfterMinimum * duration) / totalDuration
  );
  const allocations = proportionalReads.map((reads) => 1 + Math.floor(reads));
  let remainingReads = safeLimit - allocations.reduce((total, reads) => total + reads, 0);
  const allocationOrder = proportionalReads
    .map((reads, index) => ({ index, fraction: reads - Math.floor(reads) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const allocation of allocationOrder) {
    if (remainingReads <= 0) break;
    allocations[allocation.index] += 1;
    remainingReads -= 1;
  }

  return selectedSegments.map((segment, index) => {
    const maxReads = allocations[index] ?? 1;
    return {
      ...segment,
      maxReads,
      windows: buildFleetRouteSamplingWindows(segment.fromTs, segment.toTs, maxReads),
    };
  });
}
