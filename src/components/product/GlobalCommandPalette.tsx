import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CarFront,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  Search,
  UserRound,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../providers/AuthProvider";
import { normalizeAssistantText } from "../../lib/assistant/runtime/assistantFuzzy";
import {
  ASSISTANT_ACTION_IDS,
} from "../../lib/assistant/assistantActionCatalog";
import { getAssistantGlobalNavigationActions } from "../../lib/assistant/assistantGlobalActionRegistry";
import {
  searchWorkControlEntities,
  type GlobalSearchResult,
} from "../../lib/search/globalSearchService";

type PaletteResult = GlobalSearchResult & {
  actionId?: string;
  icon?: LucideIcon;
};

const RECENT_COMMANDS_KEY = "wc_command_palette_recent:v1";
const MAX_RECENT_COMMANDS = 6;

const typeIcons: Record<GlobalSearchResult["type"], LucideIcon> = {
  page: LayoutDashboard,
  vehicle: CarFront,
  tool: Wrench,
  user: UserRound,
  project: BriefcaseBusiness,
  client: Building2,
  lift: BarChart3,
};

function readRecentCommands() {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_COMMANDS_KEY) || "[]") as PaletteResult[];
    return Array.isArray(value) ? value.slice(0, MAX_RECENT_COMMANDS) : [];
  } catch {
    return [];
  }
}

function writeRecentCommand(result: PaletteResult) {
  if (typeof window === "undefined") return;
  const safeResult: PaletteResult = {
    id: result.id,
    actionId: result.actionId,
    type: result.type,
    title: result.title,
    subtitle: result.subtitle,
    path: result.path,
    keywords: result.keywords,
  };
  const next = [safeResult, ...readRecentCommands().filter((item) => item.id !== safeResult.id)].slice(
    0,
    MAX_RECENT_COMMANDS
  );
  try {
    window.localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
  } catch {
    // The palette remains usable when storage is unavailable.
  }
}

export default function GlobalCommandPalette({ buttonOnly = false }: { buttonOnly?: boolean }) {
  const { role } = useAuth();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<GlobalSearchResult[]>([]);
  const [recentResults, setRecentResults] = useState<PaletteResult[]>(readRecentCommands);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  function closePalette() {
    setOpen(false);
    setLoading(false);
    window.setTimeout(() => document.getElementById("wc-command-trigger")?.focus(), 0);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!open) setRecentResults(readRecentCommands());
        setOpen((value) => !value);
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        closePalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute("aria-hidden"));
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
    dialog.addEventListener("keydown", trapFocus);
    return () => dialog.removeEventListener("keydown", trapFocus);
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    const normalized = normalizeAssistantText(query);
    if (!open || normalized.length < 2) {
      const clearTimer = window.setTimeout(() => {
        setRemoteResults([]);
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchWorkControlEntities(normalized, role || "angajat")
        .then((items) => {
          if (!cancelled) setRemoteResults(items.slice(0, 8));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, role]);

  const navigationActions = useMemo(
    () => getAssistantGlobalNavigationActions(role || "angajat"),
    [role]
  );

  const navigationResults = useMemo<PaletteResult[]>(() => {
    const normalized = normalizeAssistantText(query);
    return navigationActions
      .filter((action) => {
        if (!normalized) return true;
        return normalizeAssistantText(
          `${action.label} ${action.description} ${action.aliases.join(" ")} ${action.keywords.join(" ")}`
        ).includes(normalized);
      })
      .map((action) => ({
        id: `page:${action.id}`,
        actionId: action.id,
        type: "page",
        title: action.label,
        subtitle: action.description,
        path: action.path,
        keywords: [...action.aliases, ...action.keywords].join(" "),
        icon: action.icon,
      }));
  }, [navigationActions, query]);

  const visibleRecentResults = useMemo(() => {
    const actionIds = new Set(navigationActions.map((action) => action.id));
    const privileged = role === "admin" || role === "manager";
    return recentResults.filter((result) => {
      if (result.type === "page") return Boolean(result.actionId && actionIds.has(result.actionId));
      if (result.type === "user" || result.type === "client" || result.type === "lift") return privileged;
      return true;
    });
  }, [navigationActions, recentResults, role]);

  const results = useMemo<PaletteResult[]>(() => {
    const hasQuery = normalizeAssistantText(query).length > 0;
    const candidates = hasQuery
      ? [...navigationResults, ...remoteResults]
      : [...visibleRecentResults, ...navigationResults];
    const unique = new Map<string, PaletteResult>();
    candidates.forEach((item) => {
      if (!unique.has(item.id)) unique.set(item.id, item);
    });
    return Array.from(unique.values()).slice(0, 14);
  }, [navigationResults, query, remoteResults, visibleRecentResults]);

  function selectResult(result: PaletteResult) {
    writeRecentCommand(result);
    setRecentResults(readRecentCommands());
    setQuery("");
    closePalette();
    navigate(result.path);
  }

  return (
    <>
      <button
        id="wc-command-trigger"
        className="wc-command-trigger"
        type="button"
        onClick={() => {
          setSelectedIndex(0);
          setRecentResults(readRecentCommands());
          setOpen(true);
        }}
        aria-label="Cauta in WorkControl"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-assistant-action={ASSISTANT_ACTION_IDS.openGlobalSearch}
      >
        <Search size={17} strokeWidth={2.1} />
        {!buttonOnly ? <span>Cauta in WorkControl</span> : null}
        <kbd>Ctrl K</kbd>
      </button>

      {open ? (
        <div
          className="wc-command-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePalette();
          }}
        >
          <section
            ref={dialogRef}
            className="wc-command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Cautare globala"
          >
            <div className="wc-command-search">
              <Search size={20} aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedIndex((value) => Math.min(results.length - 1, value + 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedIndex((value) => Math.max(0, value - 1));
                  } else if (event.key === "Enter" && results[selectedIndex]) {
                    event.preventDefault();
                    selectResult(results[selectedIndex]);
                  }
                }}
                placeholder="Masina, scula, utilizator, client, lift, proiect..."
                aria-label="Cauta"
                aria-controls="wc-command-results"
                aria-activedescendant={results[selectedIndex] ? `wc-command-${selectedIndex}` : undefined}
              />
              {loading ? <LoaderCircle size={18} className="spin-icon" aria-label="Se cauta" /> : null}
              <button type="button" onClick={closePalette} aria-label="Inchide cautarea">
                <X size={18} />
              </button>
            </div>

            {!query && visibleRecentResults.length ? <div className="wc-command-group-label">Comenzi recente</div> : null}
            <div className="wc-command-results" id="wc-command-results" role="listbox">
              {results.length ? (
                results.map((result, index) => {
                  const Icon = result.icon || typeIcons[result.type];
                  return (
                    <button
                      id={`wc-command-${index}`}
                      key={result.id}
                      className={`wc-command-result${index === selectedIndex ? " is-selected" : ""}`}
                      type="button"
                      role="option"
                      aria-selected={index === selectedIndex}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => selectResult(result)}
                    >
                      <span className="wc-command-result__icon">
                        <Icon size={18} />
                      </span>
                      <span className="wc-command-result__copy">
                        <strong>{result.title}</strong>
                        <small>{result.subtitle}</small>
                      </span>
                      <span className="wc-command-result__type">{result.type}</span>
                    </button>
                  );
                })
              ) : (
                <div className="wc-command-empty">
                  <FileText size={22} />
                  <strong>Niciun rezultat</strong>
                  <span>Incearca numele complet sau numarul de inmatriculare.</span>
                </div>
              )}
            </div>
            <footer className="wc-command-footer">
              <span><kbd>Up</kbd><kbd>Down</kbd> navigare</span>
              <span><kbd>Enter</kbd> deschide</span>
              <span><kbd>Esc</kbd> inchide</span>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
