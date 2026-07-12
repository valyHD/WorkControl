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
} from "lucide-react";
import { useAuth } from "../../providers/AuthProvider";
import { normalizeAssistantText } from "../../lib/assistant/runtime/assistantFuzzy";
import { searchWorkControlEntities, type GlobalSearchResult } from "../../lib/search/globalSearchService";

type PageCommand = GlobalSearchResult & { roles?: string[] };

const PAGE_COMMANDS: PageCommand[] = [
  { id: "page:dashboard", type: "page", title: "Dashboard", subtitle: "Command Center", path: "/dashboard", keywords: "acasa overview principal" },
  { id: "page:my-timesheets", type: "page", title: "Pontajul meu", subtitle: "Start, stop și ultimele zile", path: "/my-timesheets", keywords: "ore cronometru" },
  { id: "page:timesheets", type: "page", title: "Pontaje", subtitle: "Echipă, filtre și rapoarte", path: "/timesheets", keywords: "angajati ore" },
  { id: "page:leave", type: "page", title: "Concedii", subtitle: "Calendar și cereri", path: "/my-leave", keywords: "liber vacanta" },
  { id: "page:vehicles", type: "page", title: "Mașini", subtitle: "Flotă și documente", path: "/vehicles", keywords: "vehicule auto" },
  { id: "page:gps", type: "page", title: "Toate GPS-urile", subtitle: "Hartă live flotă", path: "/vehicles/gps-map", keywords: "harta trackere trasee" },
  { id: "page:tools", type: "page", title: "Scule", subtitle: "Inventar și transferuri", path: "/tools", keywords: "unelte echipamente" },
  { id: "page:projects", type: "page", title: "Proiecte", subtitle: "Proiectele pentru pontaj", path: "/projects", keywords: "lucrari santiere" },
  { id: "page:expenses", type: "page", title: "Scanare bonuri", subtitle: "Încărcare și OCR", path: "/expenses/scan", keywords: "cheltuieli poza bon" },
  { id: "page:maintenance", type: "page", title: "Mentenanță", subtitle: "Clienți, lifturi și rapoarte", path: "/maintenance", keywords: "service revizii" },
  { id: "page:maintenance-reports", type: "page", title: "Istoric rapoarte", subtitle: "Rapoarte revizie și intervenție", path: "/maintenance?tab=history", keywords: "pdf mentenanta revizie interventie" },
  { id: "page:users", type: "page", title: "Utilizatori", subtitle: "Echipă și permisiuni", path: "/users", keywords: "angajati", roles: ["admin", "manager"] },
  { id: "page:control", type: "page", title: "Control Panel", subtitle: "Firebase, GPS, billing și health", path: "/control-panel", keywords: "admin server cost", roles: ["admin"] },
];

const typeIcons = {
  page: LayoutDashboard,
  vehicle: CarFront,
  tool: Wrench,
  user: UserRound,
  project: BriefcaseBusiness,
  client: Building2,
  lift: BarChart3,
};

export default function GlobalCommandPalette({ buttonOnly = false }: { buttonOnly?: boolean }) {
  const { role } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        setOpen(false);
        setLoading(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    const normalized = normalizeAssistantText(query);
    if (!open || normalized.length < 2) {
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchWorkControlEntities(normalized, role || "angajat")
        .then((items) => {
          if (!cancelled) setRemoteResults(items);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, role]);

  const pageResults = useMemo(() => {
    const normalized = normalizeAssistantText(query);
    return PAGE_COMMANDS.filter((item) => !item.roles || item.roles.includes(role || ""))
      .filter((item) => !normalized || normalizeAssistantText(`${item.title} ${item.subtitle} ${item.keywords || ""}`).includes(normalized));
  }, [query, role]);

  const results = useMemo(
    () => [...pageResults, ...(normalizeAssistantText(query).length >= 2 ? remoteResults : [])].slice(0, 14),
    [pageResults, query, remoteResults]
  );

  function selectResult(result: GlobalSearchResult) {
    setOpen(false);
    setLoading(false);
    setQuery("");
    navigate(result.path);
  }

  const trigger = (
    <button
      className="wc-command-trigger"
      type="button"
      onClick={() => { setSelectedIndex(0); setOpen(true); }}
      aria-label="Caută în WorkControl"
      data-assistant-action="open-global-search"
    >
      <Search size={17} strokeWidth={2.1} />
      {!buttonOnly ? <span>Caută în WorkControl</span> : null}
      <kbd>Ctrl K</kbd>
    </button>
  );

  return (
    <>
      {trigger}
      {open ? (
        <div className="wc-command-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setOpen(false);
            setLoading(false);
          }
        }}>
          <section className="wc-command-palette" role="dialog" aria-modal="true" aria-label="Căutare globală">
            <div className="wc-command-search">
              <Search size={20} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedIndex(0);
                  if (normalizeAssistantText(event.target.value).length < 2) setLoading(false);
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
                placeholder="Mașină, sculă, utilizator, client, lift, proiect..."
                aria-label="Caută"
              />
              {loading ? <LoaderCircle size={18} className="spin-icon" /> : null}
              <button type="button" onClick={() => { setOpen(false); setLoading(false); }} aria-label="Închide căutarea"><X size={18} /></button>
            </div>
            <div className="wc-command-results" role="listbox">
              {results.length ? results.map((result, index) => {
                const Icon = typeIcons[result.type];
                return (
                  <button
                    key={result.id}
                    className={`wc-command-result${index === selectedIndex ? " is-selected" : ""}`}
                    type="button"
                    role="option"
                    aria-selected={index === selectedIndex}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => selectResult(result)}
                  >
                    <span className="wc-command-result__icon"><Icon size={18} /></span>
                    <span className="wc-command-result__copy"><strong>{result.title}</strong><small>{result.subtitle}</small></span>
                    <span className="wc-command-result__type">{result.type}</span>
                  </button>
                );
              }) : (
                <div className="wc-command-empty"><FileText size={22} /><strong>Niciun rezultat</strong><span>Încearcă numele complet sau numărul de înmatriculare.</span></div>
              )}
            </div>
            <footer className="wc-command-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> navigare</span>
              <span><kbd>Enter</kbd> deschide</span>
              <span><kbd>Esc</kbd> închide</span>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
