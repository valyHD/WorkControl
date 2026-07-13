import { useEffect, useState, type ReactNode } from "react";
import { Building2, LoaderCircle, ShieldCheck } from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import {
  claimInitialCompany,
  getAvailableCompanyChoices,
  type CompanyChoice,
} from "../../companies/services/companiesService";

export default function CompanySelectionGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<CompanyChoice[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const hasCompany = Boolean(user?.primaryCompanyId || user?.companyIds?.length);
  const requiresSelection = Boolean(user && !user.globalAdmin && !hasCompany);

  useEffect(() => {
    if (!requiresSelection) return;
    let active = true;
    void getAvailableCompanyChoices()
      .then((items) => {
        if (!active) return;
        setCompanies(items);
        if (items.length === 1) setSelectedCompanyId(items[0].companyId);
      })
      .catch(() => {
        if (active) setError("Lista firmelor nu a putut fi incarcata.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [requiresSelection]);

  if (!requiresSelection) return children;

  async function confirmCompany() {
    if (!selectedCompanyId || saving) return;
    setSaving(true);
    setError("");
    try {
      await claimInitialCompany(selectedCompanyId);
    } catch {
      setError("Firma nu a putut fi salvata. Reincarca pagina si incearca din nou.");
      setSaving(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="company-selection-title">
        <div className="auth-logo" aria-hidden="true">
          <Building2 size={24} />
        </div>
        <h1 id="company-selection-title" className="auth-title">Alege firma ta</h1>
        <p className="auth-subtitle">
          Firma este folosita pentru proiecte, pontaje, masini, scule si rapoarte.
          Alegerea initiala se poate face o singura data.
        </p>
        {loading ? (
          <div className="wc-route-loader" aria-live="polite">
            <LoaderCircle size={20} className="spin" />
            <span>Se incarca firmele...</span>
          </div>
        ) : (
          <>
            <label className="tool-form-label" htmlFor="initial-company">Firma</label>
            <select
              id="initial-company"
              className="tool-input"
              value={selectedCompanyId}
              onChange={(event) => setSelectedCompanyId(event.target.value)}
              disabled={saving}
            >
              <option value="">Selecteaza firma</option>
              {companies.map((company) => (
                <option key={company.companyId} value={company.companyId}>
                  {company.companyName}
                </option>
              ))}
            </select>
            <button
              className="primary-btn"
              type="button"
              onClick={() => void confirmCompany()}
              disabled={!selectedCompanyId || saving}
              data-assistant-action="claim-initial-company"
            >
              <ShieldCheck size={17} />
              {saving ? "Se salveaza..." : "Confirma firma"}
            </button>
          </>
        )}
        {error && <div className="tool-message error-message" role="alert">{error}</div>}
      </section>
    </main>
  );
}
