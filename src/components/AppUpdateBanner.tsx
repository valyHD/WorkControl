import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  activateWaitingWorkControlUpdate,
  hasWaitingWorkControlUpdate,
} from "../lib/pwa/serviceWorkerUpdates";

const UPDATE_CHECK_INTERVAL_MS = 60_000;
const UPDATE_RELOAD_GRACE_MS = 5 * 60_000;
const UPDATE_RELOAD_MARK_KEY = "workcontrol:update-reload-requested-at";

function collectAssetSignature(root: Document) {
  const assetUrls = [
    ...Array.from(root.querySelectorAll<HTMLScriptElement>("script[src]")).map((node) => node.src),
    ...Array.from(root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map((node) => node.href),
  ]
    .map((value) => {
      try {
        const url = new URL(value, window.location.origin);
        return `${url.pathname}${url.search}`;
      } catch {
        return "";
      }
    })
    .filter((value) => value.includes("/assets/"))
    .sort();

  return assetUrls.join("|");
}

async function readRemoteAssetSignature() {
  const response = await fetch(`/?wc_update_check=${Date.now()}`, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) return "";

  const html = await response.text();
  const parser = new DOMParser();
  const nextDocument = parser.parseFromString(html, "text/html");
  return collectAssetSignature(nextDocument);
}

function markUpdateReloadRequested() {
  try {
    window.sessionStorage.setItem(UPDATE_RELOAD_MARK_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable in private contexts.
  }
}

function clearUpdateReloadRequested() {
  try {
    window.sessionStorage.removeItem(UPDATE_RELOAD_MARK_KEY);
  } catch {
    // Storage can be unavailable in private contexts.
  }
}

function isInsideUpdateReloadGrace() {
  try {
    const value = Number(window.sessionStorage.getItem(UPDATE_RELOAD_MARK_KEY) || 0);
    return value > 0 && Date.now() - value < UPDATE_RELOAD_GRACE_MS;
  } catch {
    return false;
  }
}

export function AppUpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const currentSignatureRef = useRef("");
  const checkingRef = useRef(false);

  useEffect(() => {
    currentSignatureRef.current = collectAssetSignature(document);

    const checkForUpdate = async () => {
      if (checkingRef.current || updateAvailable) return;
      if (isInsideUpdateReloadGrace()) return;
      checkingRef.current = true;
      try {
        const remoteSignature = await readRemoteAssetSignature();
        if (remoteSignature && currentSignatureRef.current && remoteSignature === currentSignatureRef.current) {
          clearUpdateReloadRequested();
        }
        if (remoteSignature && currentSignatureRef.current && remoteSignature !== currentSignatureRef.current) {
          setUpdateAvailable(true);
        }
      } catch {
        // Offline or blocked network checks should stay silent.
      } finally {
        checkingRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForUpdate();
      }
    };

    const intervalId = window.setInterval(() => {
      void checkForUpdate();
    }, UPDATE_CHECK_INTERVAL_MS);

    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void checkForUpdate();

    let detachUpdateFound: (() => void) | undefined;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (!registration) return;
        if (
          navigator.serviceWorker.controller &&
          hasWaitingWorkControlUpdate(registration) &&
          !isInsideUpdateReloadGrace()
        ) {
          setUpdateAvailable(true);
        }
        const handleUpdateFound = () => {
          const worker = registration.installing;
          if (!worker) return;
          const handleStateChange = () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller && !isInsideUpdateReloadGrace()) {
              setUpdateAvailable(true);
            }
          };
          worker.addEventListener("statechange", handleStateChange);
        };
        registration.addEventListener("updatefound", handleUpdateFound);
        detachUpdateFound = () => registration.removeEventListener("updatefound", handleUpdateFound);
      });
    }

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      detachUpdateFound?.();
    };
  }, [updateAvailable]);

  async function handleReloadForUpdate() {
    setUpdateAvailable(false);
    markUpdateReloadRequested();

    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map((registration) => registration.update().catch(() => undefined))
        );
        await activateWaitingWorkControlUpdate();
      }
    } catch (error) {
      console.error("Actualizarea PWA nu a putut fi activată:", error);
      setUpdateAvailable(true);
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("wc_reload", String(Date.now()));
    window.location.replace(nextUrl.toString());
  }

  if (!updateAvailable) return null;

  return (
    <div className="app-update-banner" role="status" aria-live="polite">
      <div>
        <strong>Versiune noua disponibila</strong>
        <span>Site-ul a fost actualizat. Reincarca pagina ca sa vezi ultimele modificari.</span>
      </div>
      <button className="primary-btn" type="button" onClick={() => void handleReloadForUpdate()}>
        <RefreshCw size={15} />
        Reincarca
      </button>
    </div>
  );
}
