import { useEffect, useMemo, useState } from "react";
import { Download, Share2, Smartphone, X } from "lucide-react";

type BeforeInstallPromptOutcome = "accepted" | "dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: BeforeInstallPromptOutcome; platform: string }>;
};

const DISMISSED_STORAGE_KEY = "wc_install_banner_dismissed_at";
const DISMISS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
let pendingInstallPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event: Event) => {
    event.preventDefault();
    pendingInstallPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event("workcontrol-install-prompt-ready"));
  });

  window.addEventListener("appinstalled", () => {
    pendingInstallPrompt = null;
  });
}

function isStandaloneApp() {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isMobileDevice() {
  return (
    window.matchMedia("(max-width: 900px)").matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isIosDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent);
}

function isChromeAndroid() {
  const ua = navigator.userAgent;
  return (
    /Android/i.test(ua) &&
    /Chrome\/|CriOS\//i.test(ua) &&
    !/SamsungBrowser|EdgA|OPR\/|Firefox|DuckDuckGo|FBAN|FBAV|Instagram|Line|MicroMessenger|TikTok|WhatsApp|Snapchat|Twitter|LinkedInApp/i.test(ua)
  );
}

function isEdgeAndroid() {
  return /EdgA/i.test(navigator.userAgent);
}

function isSamsungInternet() {
  return /SamsungBrowser/i.test(navigator.userAgent);
}

function isFirefoxAndroid() {
  return /Android/i.test(navigator.userAgent) && /Firefox/i.test(navigator.userAgent);
}

function isInAppBrowser() {
  return /FBAN|FBAV|Instagram|Line|MicroMessenger|TikTok|WhatsApp|Snapchat|Twitter|LinkedInApp/i.test(
    navigator.userAgent
  );
}

function getBrowserName() {
  if (isSamsungInternet()) return "Samsung Internet";
  if (isEdgeAndroid()) return "Edge";
  if (isFirefoxAndroid()) return "Firefox";
  if (isChromeAndroid()) return "Chrome";
  if (isIosDevice()) return "Safari";
  return "browser";
}

function getFallbackInstallText(isIos: boolean, isAndroid: boolean, inAppBrowser: boolean) {
  if (inAppBrowser && isAndroid) {
    return "Deschide pagina in browserul telefonului, apoi apasa Instaleaza aplicatia.";
  }

  if (inAppBrowser && isIos) {
    return "Deschide pagina in Safari, apoi Share si Add to Home Screen.";
  }

  if (isIos) {
    return "Pe iPhone: Safari, Share, Add to Home Screen si Open as Web App.";
  }

  if (isAndroid) {
    const browserName = getBrowserName();
    if (browserName === "Samsung Internet") return "Apasa aici, apoi Meniu si Adauga pagina la / Instalare aplicatie.";
    if (browserName === "Edge") return "Apasa aici, apoi meniul Edge si Adauga pe telefon / Install app.";
    if (browserName === "Firefox") return "Apasa aici, apoi meniul Firefox si Instaleaza / Add to Home screen.";
    return "Apasa aici pentru instalare sau pentru pasii de adaugare pe ecran.";
  }

  return "Din meniul browserului alege Instaleaza aplicatia sau Add to Home screen.";
}

function shouldForceInstallBanner() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("install") === "1";
  } catch {
    return false;
  }
}

function wasRecentlyDismissed() {
  try {
    const dismissedAt = Number(window.localStorage.getItem(DISMISSED_STORAGE_KEY) || 0);
    return dismissedAt > 0 && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, String(Date.now()));
  } catch {
    // Ignore storage errors.
  }
}

export function InstallAppBanner() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [installing, setInstalling] = useState(false);
  const isIos = useMemo(() => (typeof window === "undefined" ? false : isIosDevice()), []);
  const isAndroid = useMemo(() => (typeof window === "undefined" ? false : isAndroidDevice()), []);
  const inAppBrowser = useMemo(() => (typeof window === "undefined" ? false : isInAppBrowser()), []);
  const samsungInternet = useMemo(() => (typeof window === "undefined" ? false : isSamsungInternet()), []);
  const edgeAndroid = useMemo(() => (typeof window === "undefined" ? false : isEdgeAndroid()), []);
  const firefoxAndroid = useMemo(() => (typeof window === "undefined" ? false : isFirefoxAndroid()), []);
  const browserName = useMemo(() => (typeof window === "undefined" ? "browser" : getBrowserName()), []);
  const canUseNativePrompt = Boolean(installPrompt);
  const canShowInstallAction = canUseNativePrompt || isIos || isAndroid;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandaloneApp()) return;

    const forceInstallBanner = shouldForceInstallBanner();
    const mobileDevice = isMobileDevice();
    if (wasRecentlyDismissed() && !forceInstallBanner) return;

    const showInstallPrompt = () => {
      if (!pendingInstallPrompt) return;
      setInstallPrompt(pendingInstallPrompt);
      setVisible(true);
    };

    showInstallPrompt();
    window.addEventListener("workcontrol-install-prompt-ready", showInstallPrompt);

    const fallbackTimer = window.setTimeout(() => {
      if (isStandaloneApp()) return;
      if (wasRecentlyDismissed() && !forceInstallBanner) return;
      if (!mobileDevice && !pendingInstallPrompt && !forceInstallBanner) return;
      setVisible(true);
    }, 1400);

    return () => {
      window.removeEventListener("workcontrol-install-prompt-ready", showInstallPrompt);
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const showInstallGuide = () => {
      setVisible(true);
      if (isIosDevice()) {
        setShowIosGuide(true);
      } else if (isAndroidDevice()) {
        setShowAndroidGuide(true);
      }
    };

    window.addEventListener("workcontrol-show-install-guide", showInstallGuide);
    return () => window.removeEventListener("workcontrol-show-install-guide", showInstallGuide);
  }, []);

  useEffect(() => {
    const handleInstalled = () => {
      setVisible(false);
      setInstallPrompt(null);
    };

    window.addEventListener("appinstalled", handleInstalled);
    return () => window.removeEventListener("appinstalled", handleInstalled);
  }, []);

  function openInChrome() {
    const url = new URL(window.location.href);
    url.searchParams.set("install", "1");
    const currentUrl = url.href;
    const withoutScheme = currentUrl.replace(/^https?:\/\//i, "");
    const fallback = encodeURIComponent(currentUrl);
    window.location.href = `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
  }

  async function handleInstall() {
    if (canUseNativePrompt && installPrompt) {
      if (installing) return;
      setInstalling(true);

      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setVisible(false);
        }
        if (pendingInstallPrompt === installPrompt) {
          pendingInstallPrompt = null;
        }
        setInstallPrompt(null);
      } catch (error) {
        console.warn("[InstallAppBanner][install]", error);
        if (isAndroid) {
          setShowAndroidGuide(true);
        }
      } finally {
        setInstalling(false);
      }
      return;
    }

    if (isIos) {
      setVisible(true);
      setShowIosGuide(true);
      return;
    }
    if (isAndroid) {
      setVisible(true);
      setShowAndroidGuide(true);
      return;
    }
  }

  function handleClose() {
    markDismissed();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <>
      <div
        className={`install-app-banner ${canShowInstallAction ? "install-app-banner--clickable" : ""}`}
        role={canShowInstallAction ? "button" : "region"}
        tabIndex={canShowInstallAction ? 0 : undefined}
        aria-label="Instaleaza aplicatia WorkControl"
        onClick={canShowInstallAction ? () => void handleInstall() : undefined}
        onKeyDown={
          canShowInstallAction
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void handleInstall();
                }
              }
            : undefined
        }
      >
        <div className="install-app-banner__icon">
          <Smartphone size={18} />
        </div>
        <div className="install-app-banner__text">
          <strong>Instaleaza aplicatia</strong>
          <span>
            {canUseNativePrompt
              ? `Instalare disponibila in ${browserName}. Apasa Instaleaza.`
              : samsungInternet
              ? "Samsung Internet: apasa si vezi pasii de instalare din meniul browserului."
              : edgeAndroid
              ? "Edge: apasa si vezi pasii de instalare pe telefon."
              : firefoxAndroid
              ? "Firefox: apasa si vezi pasii de adaugare pe ecran."
              : getFallbackInstallText(isIos, isAndroid, inAppBrowser)}
          </span>
        </div>
        {canShowInstallAction ? (
          <button
            className="install-app-banner__button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void handleInstall();
            }}
            disabled={installing}
          >
            {isIos ? <Share2 size={15} /> : <Download size={15} />}
            {installing ? "Se deschide..." : canUseNativePrompt ? "Instaleaza" : "Vezi pasii"}
          </button>
        ) : (
          <div className="install-app-banner__hint" aria-hidden="true">
            <Share2 size={15} />
          </div>
        )}
        <button
          className="install-app-banner__close"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleClose();
          }}
          aria-label="Inchide"
        >
          <X size={15} />
        </button>
      </div>

      {showIosGuide && (
        <div className="install-guide-modal" role="dialog" aria-modal="true" aria-label="Instalare WorkControl pe iPhone">
          <div className="install-guide-modal__panel">
            <button className="install-guide-modal__close" type="button" onClick={() => setShowIosGuide(false)} aria-label="Inchide">
              <X size={16} />
            </button>
            <div className="install-guide-modal__icon">
              <Share2 size={22} />
            </div>
            <h3>Instalare pe iPhone</h3>
            <ol>
              <li>Apasa butonul Share din bara Safari.</li>
              <li>Alege Add to Home Screen / Adauga pe ecranul principal.</li>
              <li>Deschide WorkControl din iconita noua, apoi activeaza notificarile.</li>
            </ol>
            <button className="primary-btn" type="button" onClick={() => setShowIosGuide(false)}>
              Am inteles
            </button>
          </div>
        </div>
      )}

      {showAndroidGuide && (
        <div className="install-guide-modal" role="dialog" aria-modal="true" aria-label="Instalare WorkControl pe Android">
          <div className="install-guide-modal__panel">
            <button className="install-guide-modal__close" type="button" onClick={() => setShowAndroidGuide(false)} aria-label="Inchide">
              <X size={16} />
            </button>
            <div className="install-guide-modal__icon">
              <Download size={22} />
            </div>
            <h3>Instalare pe {browserName}</h3>
            {samsungInternet ? (
              <ol>
                <li>Apasa meniul Samsung Internet din bara browserului.</li>
                <li>Alege Adauga pagina la, Ecran principal sau Instalare aplicatie.</li>
                <li>Daca nu apare optiunea, reincarca pagina dupa update si incearca din nou din meniul browserului.</li>
              </ol>
            ) : edgeAndroid ? (
              <ol>
                <li>Apasa meniul Edge din bara de jos.</li>
                <li>Alege Adauga pe telefon sau Install app.</li>
                <li>Confirma instalarea WorkControl.</li>
              </ol>
            ) : firefoxAndroid ? (
              <ol>
                <li>Apasa meniul Firefox.</li>
                <li>Alege Instaleaza sau Add to Home screen.</li>
                <li>Deschide WorkControl din iconita noua.</li>
              </ol>
            ) : (
              <ol>
                <li>Apasa meniul browserului.</li>
                <li>Alege Instaleaza aplicatia sau Add to Home screen.</li>
                <li>Confirma instalarea WorkControl.</li>
              </ol>
            )}
            <button className="secondary-btn" type="button" onClick={openInChrome}>
              Deschide in Chrome
            </button>
            <button className="primary-btn" type="button" onClick={() => setShowAndroidGuide(false)}>
              Am inteles
            </button>
          </div>
        </div>
      )}
    </>
  );
}
