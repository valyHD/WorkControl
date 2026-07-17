export function formatAssistantReportObservation(value: string) {
  let formatted = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?])(?=[A-Za-z0-9])/g, "$1 ")
    .trim();

  if (!formatted) return "";

  formatted = formatted.replace(
    /(^|[.!?]\s+)([a-z])/g,
    (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`
  );

  if (!/[.!?]$/.test(formatted)) formatted += ".";
  return formatted;
}
