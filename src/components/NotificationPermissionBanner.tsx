import { useCallback, useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import {
  activatePushNotifications,
  hasPushVapidKey,
  hasUserPushToken,
} from "../lib/notifications/pushNotifications";

type PermissionStatus =
  | NotificationPermission
  | "unsupported"
  | "missing_vapid"
  | "ios_requires_install";

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isSamsungInternet() {
  if (typeof navigator === "undefined") return false;
  return /SamsungBrowser/i.test(navigator.userAgent);
}

function getPermissionStatus(): PermissionStatus {
  if (isIosDevice() && !isStandaloneApp()) return "ios_requires_install";
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (!hasPushVapidKey()) return "missing_vapid";
  return Notification.permission;
}

function getBannerText(permission: PermissionStatus, message: string) {
  if (message) return message;
  if (permission === "ios_requires_install") {
    return "Pe iPhone, instaleaza WorkControl pe ecranul principal si deschide aplicatia din icon, apoi activeaza notificarile.";
  }
  if (permission === "unsupported") {
    if (isSamsungInternet()) {
      return "Samsung Internet nu permite notificari push pe aceasta versiune/dispozitiv. Actualizeaza browserul si instaleaza WorkControl din meniu, apoi incearca din nou.";
    }
    return "Browserul acesta nu suporta notificari web. Deschide in Chrome, Edge sau Safari instalat pe ecranul principal.";
  }
  return "Primeste alerte pentru pontaj, scule, masini, facturi si activitate importanta.";
}

export function NotificationPermissionBanner({ userId }: { userId?: string }) {
  const [permission, setPermission] = useState<PermissionStatus>(() => getPermissionStatus());
  const [activated, setActivated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState("");

  const refreshStatus = useCallback(async () => {
    const nextPermission = getPermissionStatus();
    setPermission(nextPermission);
    setMessage("");

    if (!userId || nextPermission === "unsupported" || nextPermission === "missing_vapid" || nextPermission === "ios_requires_install") {
      setActivated(false);
      setChecking(false);
      return;
    }

    try {
      const hasToken = nextPermission === "granted" ? await hasUserPushToken(userId) : false;
      setActivated(nextPermission === "granted" && hasToken);
    } catch (error) {
      console.warn("[NotificationPermissionBanner][status]", error);
      setActivated(false);
    } finally {
      setChecking(false);
    }
  }, [userId]);

  useEffect(() => {
    setChecking(true);
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshStatus();
      }
    };
    window.addEventListener("focus", refreshStatus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", refreshStatus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshStatus]);

  async function handleActivate() {
    if (!userId || activating) return;
    if (permission === "ios_requires_install") {
      window.dispatchEvent(new Event("workcontrol-show-install-guide"));
      return;
    }

    setActivating(true);
    setMessage("");
    try {
      const result = await activatePushNotifications(userId);
      setPermission(getPermissionStatus());
      if (result.ok) {
        setActivated(true);
        return;
      }

      if (result.reason === "permission_denied") {
        setMessage("Notificarile sunt blocate in browser. Activeaza-le din setarile site-ului.");
      } else if (result.reason === "ios_requires_install") {
        setMessage("Pe iPhone, instaleaza aplicatia pe ecranul principal si deschide-o din icon inainte de activare.");
      } else if (result.reason === "unsupported") {
        setMessage(
          isSamsungInternet()
            ? "Samsung Internet nu a expus suportul push necesar. Actualizeaza browserul sau instaleaza WorkControl din meniu si incearca din nou."
            : "Browserul acesta nu suporta notificari web pentru WorkControl."
        );
      } else if (result.reason === "token_error") {
        setMessage(
          isSamsungInternet()
            ? "Nu am putut salva tokenul push in Samsung Internet. Reincarca pagina dupa update, apoi apasa din nou Activeaza."
            : "Nu am putut activa notificarile pe acest dispozitiv."
        );
      } else {
        setMessage("Nu am putut activa notificarile pe acest dispozitiv.");
      }
    } finally {
      setActivating(false);
    }
  }

  if (!userId || checking || activated || permission === "missing_vapid") {
    return null;
  }

  return (
    <div className="notification-permission-banner" role="region" aria-label="Activeaza notificarile">
      <div className="notification-permission-banner__icon">
        <BellRing size={18} />
      </div>
      <div className="notification-permission-banner__text">
        <strong>Activeaza notificarile</strong>
        <span>{getBannerText(permission, message)}</span>
      </div>
      <button
        className="notification-permission-banner__button"
        type="button"
        onClick={() => void handleActivate()}
        disabled={activating || permission === "denied" || permission === "unsupported"}
      >
        {activating
          ? "Se activeaza..."
          : permission === "denied"
            ? "Blocat"
            : permission === "ios_requires_install"
              ? "Vezi pasii"
              : permission === "unsupported"
                ? "Nesuportat"
                : "Activeaza"}
      </button>
    </div>
  );
}
