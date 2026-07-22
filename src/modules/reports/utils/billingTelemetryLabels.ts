export function formatLocalConsumerLabel(value: string) {
  const normalized = String(value || "").trim();
  if (normalized === "simulation-routes") return "trasee vehicul";
  return normalized.replace(/simulation/gi, "traseu").replace(/[-_]+/g, " ");
}
