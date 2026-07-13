import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose, open]);
  return ref;
}

type OverlayProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
};

export function DetailsDrawer({ open, title, description, children, onClose }: OverlayProps) {
  const ref = useDialogFocus(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="wc-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className="wc-details-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Inchide"><X size={18} /></button>
        </header>
        <div className="wc-details-drawer__content">{children}</div>
      </div>
    </div>
  );
}

export function MobileActionSheet({ open, title, description, children, onClose }: OverlayProps) {
  const ref = useDialogFocus(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="wc-overlay wc-overlay--bottom" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className="wc-mobile-action-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="wc-mobile-action-sheet__handle" aria-hidden="true" />
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Inchide"><X size={18} /></button>
        </header>
        <div>{children}</div>
      </div>
    </div>
  );
}

export function FilterDrawer({ open, title = "Filtre", description, children, onClose }: OverlayProps) {
  const ref = useDialogFocus(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="wc-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className="wc-details-drawer wc-filter-drawer-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Inchide filtrele"><X size={18} /></button>
        </header>
        <div className="wc-details-drawer__content">{children}</div>
      </div>
    </div>
  );
}
