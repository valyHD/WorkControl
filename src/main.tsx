import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/shell.css";
import "./styles/buttons.css";
import "./styles/forms.css";
import "./styles/module-legacy.css";
import "./styles/tables.css";
import "./styles/form-support.css";
import "./styles/feedback.css";
import "./styles/navigation.css";
import "./styles/responsive.css";
import "./styles/legacy-foundation.css";
import "./app/app.css";
import "./styles/cards.css";
import "./styles/browser-compatibility.css";
import "./styles/product-system.css";
import "./styles/experience.css";
import "./styles/product-intelligence.css";
import { AuthProvider } from "./providers/AuthProvider";
import { AppErrorBoundary } from "./lib/errors/AppErrorBoundary";
import {
  isDynamicImportFailure,
  reloadOnceForFreshAssets,
} from "./lib/routing/dynamicImportRecovery";
import { initSentry } from "./lib/monitoring/sentry";
import { FeatureFlagProvider } from "./lib/productIntelligence";

const FORCE_LIGHT_BACKGROUND =
  'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY/jw5ed/AAmSA90f2KU2AAAAAElFTkSuQmCC")';

function markBrowserCompatibilityFlags() {
  const root = document.documentElement;
  const ua = navigator.userAgent || "";

  if (/SamsungBrowser/i.test(ua)) root.classList.add("is-samsung-internet");
  if (/Android/i.test(ua)) root.classList.add("is-android");
  if (/Mobile/i.test(ua)) root.classList.add("is-mobile-browser");
}

function applyForcedLightSurface() {
  const root = document.documentElement;
  const targets = [root, document.body, document.getElementById("root")].filter(
    (item): item is HTMLElement => Boolean(item)
  );

  root.classList.add("wc-force-light");
  for (const target of targets) {
    target.style.setProperty("background-color", "#f0f4f9", "important");
    target.style.setProperty("background-image", FORCE_LIGHT_BACKGROUND, "important");
    target.style.setProperty("background-repeat", "repeat", "important");
    target.style.setProperty("color", "#0c1728", "important");
    target.style.setProperty("color-scheme", "only light", "important");
    target.style.setProperty("forced-color-adjust", "none", "important");
  }

  const lightBg = document.getElementById("wc-light-bg");
  if (lightBg) {
    lightBg.style.setProperty("background-color", "#f0f4f9", "important");
    lightBg.style.setProperty("background-image", FORCE_LIGHT_BACKGROUND, "important");
    lightBg.style.setProperty("background-repeat", "repeat", "important");
    lightBg.style.setProperty("forced-color-adjust", "none", "important");
  }
}

markBrowserCompatibilityFlags();
applyForcedLightSurface();
initSentry();

window.addEventListener("unhandledrejection", (event) => {
  if (isDynamicImportFailure(event.reason)) {
    event.preventDefault();
    reloadOnceForFreshAssets();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/notification-sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        void registration.update();
      })
      .catch((error) => {
        console.error("Nu s-a putut inregistra service worker-ul de notificari:", error);
      });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <FeatureFlagProvider>
          <RouterProvider router={router} />
        </FeatureFlagProvider>
      </AuthProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
