export function getVehicleDetailsPathAfterSave(
  vehicleId: string,
  uploadedDocumentCount: number
) {
  const basePath = `/vehicles/${encodeURIComponent(vehicleId)}`;
  return uploadedDocumentCount > 0
    ? `${basePath}?tab=documents&focus=upload`
    : basePath;
}
