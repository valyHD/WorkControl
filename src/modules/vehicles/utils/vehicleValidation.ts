export function normalizeVehiclePlate(value?: string | null): string {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function isValidVehicleKm(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseVehicleKm(value: string): number | null {
  const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return isValidVehicleKm(parsed) ? parsed : null;
}

export function assertValidVehicleKm(
  value: unknown,
  label = "Kilometrajul"
): asserts value is number {
  if (!isValidVehicleKm(value)) {
    throw new Error(`${label} trebuie sa fie un numar pozitiv sau zero.`);
  }
}
