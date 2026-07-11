import * as Sentry from "@sentry/react";

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.user;
      delete event.request;
      return event;
    },
  });
}

export function captureRuntimeError(error: Error, context?: Record<string, unknown>) {
  if (!import.meta.env.VITE_SENTRY_DSN) return;

  Sentry.captureException(error, {
    extra: context,
  });
}
