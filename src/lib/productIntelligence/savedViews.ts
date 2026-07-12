export type SavedView<T> = {
  id: string;
  name: string;
  value: T;
  createdAt: number;
};

function storageKey(namespace: string, userId: string) {
  return `wc_saved_views:${userId || "anonymous"}:${namespace}`;
}

export function readSavedViews<T>(namespace: string, userId: string): SavedView<T>[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(namespace, userId)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
      .slice(0, 12) as SavedView<T>[];
  } catch {
    return [];
  }
}

export function saveView<T>(namespace: string, userId: string, name: string, value: T) {
  const cleanName = name.trim().slice(0, 48);
  if (!cleanName) throw new Error("Numele filtrului lipseste.");
  const current = readSavedViews<T>(namespace, userId);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const next = [{ id, name: cleanName, value, createdAt: Date.now() }, ...current].slice(0, 12);
  window.localStorage.setItem(storageKey(namespace, userId), JSON.stringify(next));
  return next;
}

export function deleteSavedView<T>(namespace: string, userId: string, id: string) {
  const next = readSavedViews<T>(namespace, userId).filter((item) => item.id !== id);
  window.localStorage.setItem(storageKey(namespace, userId), JSON.stringify(next));
  return next;
}
