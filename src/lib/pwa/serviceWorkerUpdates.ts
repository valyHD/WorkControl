const UPDATE_ACTIVATION_TIMEOUT_MS = 10_000;

function isWorkControlWorker(worker: ServiceWorker | null): worker is ServiceWorker {
  if (!worker?.scriptURL) return false;
  try {
    return new URL(worker.scriptURL).pathname.endsWith("/notification-sw.js");
  } catch {
    return worker.scriptURL.endsWith("/notification-sw.js");
  }
}

export function hasWaitingWorkControlUpdate(registration: ServiceWorkerRegistration): boolean {
  return isWorkControlWorker(registration.waiting);
}

export async function activateWaitingWorkControlUpdate(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  const registrations = await navigator.serviceWorker.getRegistrations();
  const registration = registrations.find(hasWaitingWorkControlUpdate);
  const waitingWorker = registration?.waiting;
  if (!waitingWorker) return false;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      if (error) reject(error);
      else resolve();
    };
    const handleControllerChange = () => finish();
    const timeoutId = window.setTimeout(() => {
      finish(new Error("Actualizarea aplicației nu a putut prelua controlul în timp util."));
    }, UPDATE_ACTIVATION_TIMEOUT_MS);

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange, {
      once: true,
    });
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  });

  return true;
}
