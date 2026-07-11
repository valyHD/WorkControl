export function normalizeVehiclePlate(value?: string | null): string {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function isValidVehicleKm(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function assertValidVehicleKm(
  value: unknown,
  label = "Kilometrajul"
): asserts value is number {
  if (!isValidVehicleKm(value)) {
    throw new Error(`${label} trebuie sa fie un numar pozitiv sau zero.`);
  }
}
