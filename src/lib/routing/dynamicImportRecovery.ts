import { lazy, type ComponentType } from "react";

type LazyModule<T extends ComponentType<any>> = {
  default: T;
};

const RELOAD_KEY = "wc_dynamic_import_reload_at";
const RELOAD_COOLDOWN_MS = 45_000;

export function isDynamicImportFailure(error: unknown) {
  const message =
    error instanceof Error
       ? `${error.name} ${error.message} ${error.stack || ""}`
      : String(error || "");

  return /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message);
}

export function reloadOnceForFreshAssets() {
  if (typeof window === "undefined") return false;

  try {
    const lastReloadAt = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0);
    if (lastReloadAt > 0 && Date.now() - lastReloadAt < RELOAD_COOLDOWN_MS) {
      return false;
    }
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // If sessionStorage is blocked, still try one reload.
  }

  window.location.reload();
  return true;
}

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<LazyModule<T>>
) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (error) {
      if (isDynamicImportFailure(error) && reloadOnceForFreshAssets()) {
        return new Promise<LazyModule<T>>(() => {
          // The page is reloading. Keep React suspended until navigation happens.
        });
      }

      throw error;
    }
  });
}
