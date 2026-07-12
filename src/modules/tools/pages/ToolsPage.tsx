import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ToolItem } from "../../../types/tool";
import { getToolsList } from "../services/toolsService";
import ToolStatusBadge from "../components/ToolStatusBadge";
import { getUserThemeClass } from "../../../lib/ui/userTheme";
import SafeImage, { preloadImageUrls } from "../../../components/SafeImage";
import UserProfileLink from "../../../components/UserProfileLink";
import { Plus, QrCode } from "lucide-react";
import { PageHeader, PageLayout } from "../../../components/experience";

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("toate");
  const [locationFilter, setLocationFilter] = useState("toate");
  const [holderFilter, setHolderFilter] = useState("toate");
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

  useEffect(() => {
    preloadImageUrls(tools.map((tool) => tool.coverThumbUrl || tool.coverImageUrl), 48);
  }, [tools]);

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
      const matchesLocation =
        locationFilter === "toate" || tool.locationType === locationFilter;
      const matchesHolder =
        holderFilter === "toate" ||
        (holderFilter === "assigned" ? Boolean(tool.currentHolderUserId) : !tool.currentHolderUserId);
      return matchesSearch && matchesStatus && matchesLocation && matchesHolder;
    });
  }, [holderFilter, locationFilter, tools, search, statusFilter]);

  return (
    <PageLayout>
      <PageHeader
        eyebrow="Active și inventar"
        title="Scule"
        description={`${tools.length} scule · responsabil, deținător, stare și locație`}
        actions={[
          { id: "scan", label: "Scanează QR", to: "/tools/scan", icon: QrCode, assistantAction: "scan-tool" },
          { id: "new", label: "Adaugă sculă", to: "/tools/new", icon: Plus, tone: "primary", assistantAction: "create-tool" },
        ]}
      />
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Inventar</h2>
            <p className="tools-subtitle">Filtrează rapid și deschide fișa completă a unei scule.</p>
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
          <select
            className="tool-input"
            value={locationFilter}
            onChange={(event) => setLocationFilter(event.target.value)}
          >
            <option value="toate">Toate locatiile</option>
            <option value="depozit">Depozit</option>
            <option value="utilizator">La utilizator</option>
          </select>
          <select
            className="tool-input"
            value={holderFilter}
            onChange={(event) => setHolderFilter(event.target.value)}
          >
            <option value="toate">Orice detinator</option>
            <option value="assigned">Atribuite</option>
            <option value="unassigned">Neatribuite</option>
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
            {filteredTools.map((tool, index) => {
const userThemeClass = getUserThemeClass(
  tool.currentHolderThemeKey || tool.ownerThemeKey || null
);
const prioritizeImage = index < 18;

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
                          loading={prioritizeImage ? "eager" : "lazy"}
                          fetchPriority={prioritizeImage ? "high" : "low"}
                          sizes="72px"
                        />
                      </div>

                      <ToolStatusBadge status={tool.status} />
                    </div>

                    <div className="tool-card-title user-accent-title">{tool.name}</div>
                    <div className="tool-card-code">Cod intern: {tool.internalCode || "-"}</div>
                    <div className="tool-card-code">QR: {tool.qrCodeValue || "-"}</div>

                    <div className="tool-card-meta">
                      <strong>Responsabil:</strong>{" "}
                      <UserProfileLink
                        userId={tool.ownerUserId}
                        name={tool.ownerUserName}
                        themeKey={tool.ownerThemeKey}
                        className="user-profile-link--plain"
                      />
                    </div>

                    <div className="tool-card-meta">
                      <strong>La cine se afla:</strong>{" "}
                      <UserProfileLink
                        userId={tool.currentHolderUserId}
                        name={tool.currentHolderUserName}
                        themeKey={tool.currentHolderThemeKey}
                        fallback="Depozit"
                        className="user-profile-link--plain"
                      />
                    </div>

                    <div className="tool-card-actions">
                      <UserProfileLink
                        userId={tool.currentHolderUserId || tool.ownerUserId}
                        name={tool.currentHolderUserName || tool.ownerUserName}
                        themeKey={tool.currentHolderThemeKey || tool.ownerThemeKey}
                        fallback="Depozit"
                        showAvatar
                        avatarClassName="user-profile-small-avatar"
                        className="user-profile-link--chip"
                      />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
