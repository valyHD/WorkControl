import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import type { ToolEventItem, ToolItem, AppUser } from "../../../types/tool";
import ToolStatusBadge from "../components/ToolStatusBadge";
import ToolChangeHolderCard from "../components/ToolChangeHolderCard";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";
import {
  acceptToolHolderChange,
  claimToolForCurrentUser,
  getToolById,
  getToolEvents,
  getUsersList,
  removeToolImage,
  setToolCoverImage,
} from "../services/toolsService";
import { useAuth } from "../../../providers/AuthProvider";
import SafeImage from "../../../components/SafeImage";

function formatDate(ts: number) {
  return new Date(ts).toLocaleString("ro-RO");
}

export default function ToolDetailsPage() {
  const { toolId = "" } = useParams();
  const { user } = useAuth();

  const [tool, setTool] = useState<ToolItem | null>(null);
  const [events, setEvents] = useState<ToolEventItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const toolData = await getToolById(toolId);
      setTool(toolData);

      try {
        const eventsData = await getToolEvents(toolId);
        setEvents(eventsData);
      } catch (eventError) {
        console.error("Eroare la istoric:", eventError);
        setEvents([]);
      }

      try {
        const usersData = await getUsersList();
        setUsers(usersData);
      } catch (usersError) {
        console.error("Eroare la users:", usersError);
        setUsers([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [toolId]);

  async function handleSetCover(url: string) {
    if (!tool || !user || tool.ownerUserId !== user.uid) return;
    await setToolCoverImage(tool.id, url);
    await load();
  }

  async function handleDeleteImage(imageId: string) {
    if (!tool || !user || tool.ownerUserId !== user.uid) return;
    await removeToolImage(tool.id, tool.images, imageId);
    await load();
  }

  async function handleClaimTool() {
    if (!tool || !user?.uid) return;

await claimToolForCurrentUser(
  tool.id,
  user.uid,
  user.displayName || user.email || "Utilizator",
  user.themeKey ?? null
);

    await load();
  }

  async function handleAcceptPendingHolder() {
    if (!tool || !user?.uid) return;
    await acceptToolHolderChange(tool.id, user.uid);
    await load();
  }

  const qrDisplayValue = useMemo(() => {
    if (!tool) return "";
    return tool.qrCodeValue || `${window.location.origin}/tools/${tool.id}`;
  }, [tool]);

  const isOwner = useMemo(() => {
    if (!tool || !user) return false;
    return tool.ownerUserId === user.uid;
  }, [tool, user]);
  const isCurrentHolder = useMemo(() => {
    if (!tool || !user) return false;
    return tool.currentHolderUserId === user.uid;
  }, [tool, user]);

  const needsRepair = useMemo(() => {
    if (!tool) return false;

    return (
      !tool.ownerUserId ||
      !tool.ownerUserName ||
      (!tool.currentHolderUserId && tool.locationLabel !== "Depozit")
    );
  }, [tool]);

  const hasPendingHolderRequest = useMemo(() => {
    return Boolean(tool?.pendingHolderUserId);
  }, [tool?.pendingHolderUserId]);

  const isPendingForCurrentUser = useMemo(() => {
    if (!tool?.pendingHolderUserId || !user?.uid) return false;
    return tool.pendingHolderUserId === user.uid;
  }, [tool?.pendingHolderUserId, user?.uid]);

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca...</h2>
        <p>Preluam profilul sculei.</p>
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="placeholder-page">
        <h2>Scula nu a fost gasita</h2>
        <p>Verifica linkul sau codul QR asociat.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div className="tool-details-header">
            <div className="tool-details-avatar">
              {tool.coverImageUrl ? (
                <SafeImage
                  src={tool.coverThumbUrl || tool.coverImageUrl}
                  alt={tool.name}
                  className="tool-details-avatar-image"
                  loading="eager"
                  fetchPriority="high"
                  fallbackText={tool.name}
                />
              ) : (
                <span>{tool.name.slice(0, 1).toUpperCase()}</span>
              )}
            </div>

            <div>
              <h2 className="panel-title">{tool.name}</h2>
              <div className="tool-detail-line">
                <strong>Cod intern:</strong> {tool.internalCode}
              </div>
              <div className="tool-detail-line">
                <strong>QR asociat:</strong> {tool.qrCodeValue || "-"}
              </div>
              <div className="tool-detail-line">
                <strong>Status:</strong> <ToolStatusBadge status={tool.status} />
              </div>
            </div>
          </div>

          <div className="tools-header-actions">
            {isOwner && (
              <Link to={`/tools/${tool.id}/edit`} className="primary-btn">
                Editeaza
              </Link>
            )}
            <Link to="/tools" className="secondary-btn">
              Inapoi
            </Link>
          </div>
        </div>

        <div className="tool-details-grid">
          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Date generale</h3>

            <div className="tool-detail-line">
              <strong>Responsabil principal:</strong> {tool.ownerUserName || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>La cine se afla:</strong> {tool.currentHolderUserName || "Depozit"}
            </div>
            <div className="tool-detail-line">
              <strong>Garantie:</strong> {tool.warrantyText || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>Garantie pana la:</strong> {tool.warrantyUntil || "-"}
            </div>
            <div className="tool-detail-line">
              <strong>Descriere:</strong> {tool.description || "-"}
            </div>
          </div>

          <div className="panel tool-inner-panel">
            <h3 className="panel-title">QR pentru aceasta scula</h3>

            <div className="tool-qr-preview">
              <QRCodeSVG value={qrDisplayValue} size={180} />
            </div>

            <div className="tool-detail-line">
              <strong>Valoare QR folosita:</strong>
            </div>
            <div className="tool-qr-value-box">{qrDisplayValue}</div>

            <p className="tool-qr-text">
              Daca imprimanta ta genereaza un cod propriu, salvezi acea valoare la
              campul „Cod QR asociat”. Daca lasi gol, profilul poate fi deschis si
              prin linkul intern al sculei.
            </p>
          </div>
        </div>
      </div>

      {needsRepair && user && (
        <div className="panel">
          <h3 className="panel-title">Reparare rapida date scula</h3>
          <p className="tools-subtitle" style={{ marginBottom: 16 }}>
            Aceasta scula are date vechi sau incomplete. Poti sa o treci rapid pe profilul tau.
          </p>

          <div className="tool-form-actions">
            <button className="primary-btn" type="button" onClick={() => void handleClaimTool()}>
              Preia responsabilitatea si seteaza-ma detinator
            </button>
          </div>
        </div>
      )}

      {(isOwner || isCurrentHolder) && (
        <ToolChangeHolderCard
          tool={tool}
          users={users}
          initiator={{
            userId: user?.uid ?? "",
            userName: user?.displayName || user?.email || "Utilizator",
            userThemeKey: user?.themeKey ?? null,
          }}
          onChanged={load}
        />
      )}

      {hasPendingHolderRequest && (
        <div className="panel">
          <h3 className="panel-title">Solicitare schimbare detinator</h3>
          <p className="tools-subtitle" style={{ marginBottom: 12 }}>
            Solicitare pentru: <strong>{tool.pendingHolderUserName || "utilizator"}</strong>.
            {tool.pendingHolderRequestedAt
              ? ` Trimisa la ${formatDate(tool.pendingHolderRequestedAt)}.`
              : ""}
          </p>

          {isPendingForCurrentUser ? (
            <div className="tool-form-actions">
              <button className="primary-btn" type="button" onClick={() => void handleAcceptPendingHolder()}>
                Accepta si devino detinator
              </button>
            </div>
          ) : (
            <p className="tools-subtitle">In asteptarea acceptarii de catre utilizatorul selectat.</p>
          )}
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title">Galerie poze</h3>

        {tool.images.length === 0 ? (
          <p className="tools-subtitle">Nu exista poze incarcate.</p>
        ) : (
          <div className="tool-gallery">
            {tool.images.map((image) => (
              <div key={image.id} className="tool-gallery-item">
                <SafeImage
                  src={image.thumbUrl || image.url}
                  alt={image.fileName}
                  className="tool-gallery-image"
                  loading="lazy"
                  decoding="async"
                  fallbackText={tool.name}
                />
                {isOwner && (
                  <div className="tool-gallery-actions">
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={() => handleSetCover(image.url)}
                    >
                      Seteaza avatar
                    </button>
                    <button
                      className="danger-btn"
                      type="button"
                      onClick={() => handleDeleteImage(image.id)}
                    >
                      Sterge
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">Istoric</h3>

        {events.length === 0 ? (
          <p className="tools-subtitle">Nu exista actiuni inregistrate.</p>
        ) : (
          <div className="simple-list">
{events.map((event) => {
  const userThemeClass = getUserThemeClass(event.actorUserThemeKey);

  return (
    <div key={event.id} className={`simple-list-item user-history-row ${userThemeClass}`}>
      <div className="simple-list-text">
        <div className="user-inline-meta">
          <span className="user-accent-avatar">
            {getUserInitials(event.actorUserName || "S")}
          </span>
          <span className="simple-list-label user-accent-name">
            {event.actorUserName || "Sistem"}
          </span>
        </div>

        <div className="simple-list-subtitle">{event.message}</div>
        <div className="simple-list-subtitle">{formatDate(event.createdAt)}</div>
      </div>
    </div>
  );
})}
          </div>
        )}
      </div>
    </section>
  );
}
