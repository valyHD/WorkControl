export function clampQueryLimit(
  requested: number | undefined,
  fallback: number,
  maximum = fallback
): number {
  if (!Number.isFinite(requested)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(requested as number)));
}
