import {
  useId,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { AlertCircle, Bot, LoaderCircle, Mic, Send, ShieldCheck, X } from "lucide-react";
import type { AssistantUiState } from "./types";
import styles from "./assistantUi.module.css";

const DEFAULT_STATE_LABELS: Record<AssistantUiState, string> = {
  idle: "Pregătit",
  listening: "Ascult...",
  thinking: "Analizez comanda...",
  confirming: "Aștept confirmarea",
  executing: "Execut planul...",
  error: "Este nevoie de atenție",
};

function StateIcon({ state }: { state: AssistantUiState }) {
  if (state === "listening") return <Mic size={18} aria-hidden="true" />;
  if (state === "thinking" || state === "executing") {
    return <LoaderCircle className={styles.spin} size={18} aria-hidden="true" />;
  }
  if (state === "confirming") return <ShieldCheck size={18} aria-hidden="true" />;
  if (state === "error") return <AlertCircle size={18} aria-hidden="true" />;
  return <Bot size={18} aria-hidden="true" />;
}

export type AssistantPanelProps = {
  open?: boolean;
  state: AssistantUiState;
  title?: string;
  statusText?: string;
  transcript?: string;
  interimTranscript?: string;
  children?: ReactNode;
  onClose: () => void;
  onListenStart?: () => void;
  onListenEnd?: () => void;
  onListenCancel?: () => void;
  listenDisabled?: boolean;
  speechSupported?: boolean;
  holdToTalkLabel?: string;
  manualValue?: string;
  manualPlaceholder?: string;
  onManualChange?: (value: string) => void;
  onManualSubmit?: () => void;
  serverFallbackAvailable?: boolean;
  serverFallbackConsent?: boolean;
  onServerFallbackConsentChange?: (value: boolean) => void;
  showComposer?: boolean;
};

export function AssistantPanel({
  open = true,
  state,
  title = "Asistent WorkControl",
  statusText,
  transcript = "",
  interimTranscript = "",
  children,
  onClose,
  onListenStart,
  onListenEnd,
  onListenCancel,
  listenDisabled = false,
  speechSupported = true,
  holdToTalkLabel = "Ține apăsat",
  manualValue,
  manualPlaceholder = "Scrie comanda...",
  onManualChange,
  onManualSubmit,
  serverFallbackAvailable = false,
  serverFallbackConsent = false,
  onServerFallbackConsentChange,
  showComposer = true,
}: AssistantPanelProps) {
  const titleId = useId();
  const statusId = useId();
  const transcriptId = useId();
  const pressedRef = useRef(false);
  const busy = state === "thinking" || state === "executing";
  const holdDisabled = listenDisabled || busy || !speechSupported || !onListenStart || !onListenEnd;

  if (!open) return null;

  const finishHold = (event: PointerEvent<HTMLButtonElement>) => {
    if (!pressedRef.current) return;
    event.preventDefault();
    pressedRef.current = false;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    onListenEnd?.();
  };

  const cancelHold = () => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    onListenCancel?.();
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (holdDisabled || pressedRef.current) return;
    pressedRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement, not a requirement.
    }
    onListenStart?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    if (holdDisabled || pressedRef.current) return;
    pressedRef.current = true;
    onListenStart?.();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!pressedRef.current) return;
    pressedRef.current = false;
    onListenEnd?.();
  };

  const submitManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onManualSubmit?.();
  };

  return (
    <section
      className={styles.panel}
      data-state={state}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={statusId}
      aria-busy={busy}
      data-composer={showComposer ? "visible" : "hidden"}
    >
      <header className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.assistantIcon} aria-hidden="true">
            <Bot size={19} />
          </span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <div
              className={styles.stateLine}
              data-state={state}
              id={statusId}
              role="status"
              aria-live="polite"
            >
              <StateIcon state={state} />
              <span>{statusText || DEFAULT_STATE_LABELS[state]}</span>
            </div>
          </div>
        </div>
        <button
          className={styles.iconButton}
          type="button"
          onClick={onClose}
          aria-label="Închide asistentul"
          title="Închide"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.panelBody}>
        {transcript || interimTranscript ? (
          <section className={styles.transcript} aria-labelledby={transcriptId}>
            <h3 id={transcriptId}>Comanda auzită</h3>
            <p>
              {transcript}
              {interimTranscript ? (
                <span className={styles.interim}> {interimTranscript}</span>
              ) : null}
            </p>
          </section>
        ) : null}
        {children}
      </div>

      {showComposer ? (
        <footer className={styles.panelFooter}>
          <button
            className={styles.holdButton}
            type="button"
            disabled={holdDisabled}
            onPointerDown={handlePointerDown}
            onPointerUp={finishHold}
            onPointerCancel={cancelHold}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onBlur={cancelHold}
            onClick={(event) => event.preventDefault()}
            onContextMenu={(event) => event.preventDefault()}
            aria-pressed={state === "listening"}
            aria-describedby={statusId}
          >
            {state === "listening" ? (
              <Mic size={18} aria-hidden="true" />
            ) : (
              <Bot size={18} aria-hidden="true" />
            )}
            <span>{state === "listening" ? "Ascult..." : holdToTalkLabel}</span>
          </button>

          {manualValue !== undefined && onManualChange && onManualSubmit ? (
            <form className={styles.manualForm} onSubmit={submitManual}>
              <label className={styles.visuallyHidden} htmlFor={`${titleId}-manual`}>
                Comandă scrisă
              </label>
              <input
                id={`${titleId}-manual`}
                value={manualValue}
                onChange={(event) => onManualChange(event.target.value)}
                placeholder={manualPlaceholder}
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !manualValue.trim()}
                aria-label="Trimite comanda"
                title="Trimite"
              >
                <Send size={17} aria-hidden="true" />
              </button>
            </form>
          ) : null}
          {serverFallbackAvailable && onServerFallbackConsentChange ? (
            <label className={styles.audioConsent}>
              <input
                type="checkbox"
                checked={serverFallbackConsent}
                onChange={(event) => onServerFallbackConsentChange(event.target.checked)}
                disabled={busy || state === "listening"}
              />
              <span>
                Permite trimiterea audio catre OpenAI numai cand transcrierea din browser esueaza.
              </span>
            </label>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
