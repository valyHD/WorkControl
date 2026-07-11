import * as Sentry from "@sentry/react";

export function sanitizeSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.user;
  delete event.request;
  delete event.breadcrumbs;
  delete event.message;
  delete event.transaction;

  for (const exception of event.exception?.values || []) {
    delete exception.value;
  }

  const componentStack = event.extra?.componentStack;
  event.extra = typeof componentStack === "string" ? { componentStack } : undefined;
  return event;
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeSentryEvent,
  });
}

export function captureRuntimeError(error: Error, context?: Record<string, unknown>) {
  if (!import.meta.env.VITE_SENTRY_DSN) return;

  Sentry.captureException(error, {
    extra: context,
  });
}
