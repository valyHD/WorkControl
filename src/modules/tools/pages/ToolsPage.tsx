import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ToolItem } from "../../../types/tool";
import { getToolsList } from "../services/toolsService";
import ToolStatusBadge from "../components/ToolStatusBadge";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import SafeImage from "../../../components/SafeImage";

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("toate");
  const [error, setError] = useState("");

  async function loadTools() {
    setLoading(true);
    setError("");

    try {
      const data = await getToolsList();
      setTools(data);
    } catch (err: any) {
      console.error(err);
      setError("Nu am putut incarca sculele. Verifica regulile Firebase.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTools();
  }, []);

  const filteredTools = useMemo(() => {
    return tools.filter((tool) => {
      const q = search.trim().toLowerCase();

      const matchesSearch =
        !q ||
        tool.name.toLowerCase().includes(q) ||
        tool.internalCode.toLowerCase().includes(q) ||
        tool.qrCodeValue.toLowerCase().includes(q) ||
        tool.ownerUserName.toLowerCase().includes(q) ||
        tool.currentHolderUserName.toLowerCase().includes(q) ||
        tool.locationLabel.toLowerCase().includes(q);

      const matchesStatus = statusFilter === "toate" || tool.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [tools, search, statusFilter]);

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Scule</h2>
            <p className="tools-subtitle">
              Inventar complet, QR asociat, responsabil principal si detinator curent.
            </p>
          </div>

          <div className="tools-header-actions">
            <Link to="/tools/scan" className="secondary-btn">
              Scaneaza QR
            </Link>
            <Link to="/tools/new" className="primary-btn">
              Adauga scula
            </Link>
          </div>
        </div>

        <div className="tools-filters">
          <input
            className="tool-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cauta dupa nume, cod intern, QR, responsabil sau detinator"
          />

          <select
            className="tool-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="toate">Toate statusurile</option>
            <option value="depozit">Depozit</option>
            <option value="atribuita">Atribuita</option>
            <option value="defecta">Defecta</option>
            <option value="pierduta">Pierduta</option>
          </select>
        </div>

        {error ? (
          <div className="placeholder-page">
            <h2>Eroare Firebase</h2>
            <p>{error}</p>
          </div>
        ) : loading ? (
          <div className="placeholder-page">
            <h2>Se incarca...</h2>
            <p>Preluam sculele din Firestore.</p>
          </div>
        ) : filteredTools.length === 0 ? (
          <div className="placeholder-page">
            <h2>Nu exista scule</h2>
            <p>Apasa pe „Adauga scula” pentru a crea prima scula.</p>
          </div>
        ) : (
          <div className="tools-grid">
            {filteredTools.map((tool) => {
const userThemeClass = getUserThemeClass(
  tool.currentHolderThemeKey || tool.ownerThemeKey || null
);

              return (
                <Link to={`/tools/${tool.id}`} key={tool.id} className="tool-card-link">
                  <div className={`tool-card user-accent-card ${userThemeClass}`}>
                    <div className="tool-card-top">
                      <div className="tool-card-avatar">
                        <SafeImage
                          src={tool.coverThumbUrl || tool.coverImageUrl}
                          alt={tool.name}
                          className="tool-card-avatar-image"
                          fallbackText={tool.name}
                          sizes="72px"
                        />
                      </div>

                      <ToolStatusBadge status={tool.status} />
                    </div>

                    <div className="tool-card-title user-accent-title">{tool.name}</div>
                    <div className="tool-card-code">Cod intern: {tool.internalCode || "-"}</div>
                    <div className="tool-card-code">QR: {tool.qrCodeValue || "-"}</div>

                    <div className="tool-card-meta">
                      <strong>Responsabil:</strong> {tool.ownerUserName || "-"}
                    </div>

                    <div className="tool-card-meta">
                      <strong>La cine se afla:</strong> {tool.currentHolderUserName || "Depozit"}
                    </div>

                    <div className="tool-card-actions">
                      <span className="user-accent-chip">
                        <span
                          className="user-accent-avatar"
                          style={{ width: 24, height: 24, fontSize: 10 }}
                        >
                          {getUserInitials(tool.currentHolderUserName || tool.ownerUserName || "D")}
                        </span>
                        {tool.currentHolderUserName || tool.ownerUserName || "Depozit"}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
