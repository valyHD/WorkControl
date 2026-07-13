import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CloudOff, LoaderCircle, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";

export function LoadingState({
  title = "Se incarca datele",
  description = "Te rugam sa astepti cateva momente.",
}: {
  title?: string;
  description?: ReactNode;
}) {
  return (
    <div className="wc-page-state wc-page-state--loading" role="status" aria-label={title} aria-live="polite">
      <LoaderCircle className="wc-state-spinner" size={26} aria-hidden="true" />
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

export function ErrorState({
  title = "Datele nu au putut fi incarcate",
  description,
  retry,
}: {
  title?: string;
  description?: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="wc-page-state wc-page-state--error" role="alert">
      <AlertCircle size={26} aria-hidden="true" />
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {retry ? (
        <button type="button" className="secondary-btn" onClick={retry}>
          <RefreshCw size={16} aria-hidden="true" /> Reincearca
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ lines = 3, label = "Se incarca" }: { lines?: number; label?: string }) {
  return (
    <div className="wc-page-skeleton" role="status" aria-label={label} aria-live="polite">
      {Array.from({ length: Math.max(1, lines) }, (_, index) => <span key={index} />)}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function InlineError({ message, retry }: { message: ReactNode; retry?: () => void }) {
  return (
    <div className="wc-inline-state wc-inline-state--error" role="alert">
      <AlertTriangle size={18} />
      <span>{message}</span>
      {retry ? <button type="button" onClick={retry}><RefreshCw size={15} /> Reincearca</button> : null}
    </div>
  );
}

export function OfflineState({ retry }: { retry?: () => void }) {
  return (
    <div className="wc-page-state" role="status">
      <WifiOff size={25} />
      <strong>Conexiunea la internet este intrerupta</strong>
      <p>Datele deja incarcate raman vizibile. Reincearca dupa reconectare.</p>
      {retry ? <button type="button" className="secondary-btn" onClick={retry}><RefreshCw size={16} /> Reincearca</button> : null}
    </div>
  );
}

export function StaleState({ updatedLabel, retry }: { updatedLabel?: string; retry?: () => void }) {
  return (
    <div className="wc-inline-state wc-inline-state--warning" role="status" aria-live="polite">
      <CloudOff size={18} />
      <span>Datele pot fi vechi{updatedLabel ? ` - ultima actualizare ${updatedLabel}` : ""}.</span>
      {retry ? <button type="button" onClick={retry}><RefreshCw size={15} /> Actualizeaza</button> : null}
    </div>
  );
}

export function PermissionState({ message = "Nu ai permisiunea necesara pentru aceasta pagina." }: { message?: string }) {
  return (
    <div className="wc-page-state wc-page-state--permission" role="alert">
      <ShieldAlert size={26} />
      <strong>Acces restrictionat</strong>
      <p>{message}</p>
    </div>
  );
}
