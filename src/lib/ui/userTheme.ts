export const USER_THEME_KEYS = [
  "u1",
  "u2",
  "u3",
  "u4",
  "u5",
  "u6",
  "u7",
  "u8",
  "u9",
  "u10",
  "u11",
  "u12",
  "u13",
  "u14",
  "u15",
  "u16",
  "u17",
  "u18",
  "u19",
  "u20",
] as const;

export type UserThemeKey = (typeof USER_THEME_KEYS)[number];

export function getUserThemeClass(themeKey?: string | null) {
  const safeKey = (themeKey || "u1").trim().toLowerCase();
  return `user-theme-${safeKey}`;
}

export function getUserInitials(name?: string | null) {
  const safeName = (name || "?").trim();
  if (!safeName) return "?";

  const parts = safeName
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return "?";

  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

export function pickNextAvailableThemeKey(
  usedThemeKeys: Array<string | null | undefined>
) {
  const used = new Set(
    usedThemeKeys
      .map((k) => (k || "").toLowerCase())
      .filter(Boolean)
  );

  const free = USER_THEME_KEYS.find((k) => !used.has(k));
  return free || USER_THEME_KEYS[0];
}