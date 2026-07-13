import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, CheckCircle2, Flag, HelpCircle, Lightbulb, MessageSquare, Rocket, X } from "lucide-react";
import {
  getContextualHelp,
  hasUsageAnalyticsConsent,
  setUsageAnalyticsConsent,
  useFeatureFlags,
  WORKCONTROL_FEATURE_FLAG_LABELS,
  WORKCONTROL_RELEASE_NOTES,
  type WorkControlFeatureFlag,
} from "../../lib/productIntelligence";
import { submitAppFeedback, type FeedbackCategory } from "../../modules/feedback/services/feedbackService";

type HubTab = "help" | "release" | "feedback" | "preferences";

function onboardingKey(userId: string) {
  return `wc_onboarding_complete:${userId}:v1`;
}

export default function ProductIntelligenceHub({
  userId,
  role,
  pathname,
}: {
  userId: string;
  role: string;
  pathname: string;
}) {
  const { flags, setFlag } = useFeatureFlags();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [onboardingPending, setOnboardingPending] = useState(() =>
    Boolean(userId && window.localStorage.getItem(onboardingKey(userId)) !== "yes")
  );
  const [tab, setTab] = useState<HubTab>("help");
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [analyticsConsent, setAnalyticsConsentState] = useState(hasUsageAnalyticsConsent);
  const helpItems = useMemo(() => getContextualHelp(pathname), [pathname]);

  const closeHub = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHub();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const frame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>('button[aria-label="Inchide"]')?.focus({ preventScroll: true });
    });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeHub, open]);

  const completeOnboarding = () => {
    window.localStorage.setItem(onboardingKey(userId), "yes");
    setOnboardingPending(false);
    closeHub();
  };

  const submit = async () => {
    setStatus("");
    try {
      await submitAppFeedback({ ownerUserId: userId, category, message, path: pathname });
      setMessage("");
      setStatus("Feedback trimis. Multumim.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Feedbackul nu a putut fi trimis.");
    }
  };

  return (
    <>
      <span className="wc-help-trigger-wrap">
        <button
          ref={triggerRef}
          className="wc-help-trigger"
          type="button"
          aria-label="Ajutor si noutati WorkControl"
          title="Ajutor si noutati"
          onClick={() => setOpen(true)}
        >
          <HelpCircle size={18} />
        </button>
        {onboardingPending ? <span className="wc-help-trigger-dot" title="Ghid WorkControl disponibil" /> : null}
      </span>
      {open ? createPortal(
        <div className="wc-intelligence-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeHub();
        }}>
          <section ref={dialogRef} className="wc-intelligence-hub" role="dialog" aria-modal="true" aria-label="Centru ajutor WorkControl">
            <header>
              <div>
                <span className="wc-product-eyebrow">WorkControl</span>
                <h2>Ajutor, noutati si preferinte</h2>
              </div>
              <button type="button" onClick={closeHub} aria-label="Inchide"><X size={18} /></button>
            </header>
            <nav aria-label="Sectiuni ajutor">
              {([
                ["help", "Ajutor", BookOpen, true],
                ["release", "Noutati", Rocket, flags.releaseNotes],
                ["feedback", "Feedback", MessageSquare, flags.feedback],
                ["preferences", "Preferinte", Flag, true],
              ] as const).filter(([, , , visible]) => visible).map(([id, label, Icon]) => (
                <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </nav>
            <div className="wc-intelligence-hub__body">
              {tab === "help" ? (
                <div className="wc-help-list">
                  <div className="wc-onboarding-banner">
                    <Lightbulb size={19} />
                    <div><strong>Incepe cu actiunea principala</strong><p>Fiecare pagina are filtre, actiuni rapide si ajutor adaptat contextului curent.</p></div>
                  </div>
                  {helpItems.map((item) => <article key={item.title}><h3>{item.title}</h3><p>{item.description}</p></article>)}
                  <button className="primary-btn" type="button" onClick={completeOnboarding}><CheckCircle2 size={16} /> Am inteles</button>
                </div>
              ) : null}
              {tab === "release" ? (
                <div className="wc-release-list">
                  {WORKCONTROL_RELEASE_NOTES.map((note) => (
                    <article key={note.version}>
                      <small>{note.releasedAt} · {note.version}</small>
                      <h3>{note.title}</h3>
                      <ul>{note.items.map((item) => <li key={item}>{item}</li>)}</ul>
                    </article>
                  ))}
                </div>
              ) : null}
              {tab === "feedback" && flags.feedback ? (
                <div className="wc-feedback-form">
                  <label>Tip<select value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}><option value="idea">Idee</option><option value="problem">Problema</option><option value="usability">Usurinta in folosire</option></select></label>
                  <label>Mesaj<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1500} rows={6} placeholder="Spune-ne ce ai incercat si ce ai vrea sa fie mai simplu." /></label>
                  {status ? <p role="status">{status}</p> : null}
                  <button className="primary-btn" type="button" onClick={() => void submit()} disabled={message.trim().length < 5}>Trimite feedback</button>
                </div>
              ) : null}
              {tab === "preferences" ? (
                <div className="wc-preferences-list">
                  {flags.usageAnalytics ? <label><input type="checkbox" checked={analyticsConsent} onChange={(event) => { const next = event.target.checked; setAnalyticsConsentState(next); void setUsageAnalyticsConsent(next); }} /><span><strong>Analytics de utilizare</strong><small>Trimite doar ruta anonimizata si tipul actiunii, fara continut, nume sau identificatori.</small></span></label> : null}
                  {role === "admin" ? Object.entries(WORKCONTROL_FEATURE_FLAG_LABELS).map(([flag, label]) => (
                    <label key={flag}><input type="checkbox" checked={flags[flag as WorkControlFeatureFlag]} onChange={(event) => setFlag(flag as WorkControlFeatureFlag, event.target.checked)} /><span><strong>{label}</strong><small>Activ pe acest dispozitiv.</small></span></label>
                  )) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>,
        document.body
      ) : null}
    </>
  );
}
