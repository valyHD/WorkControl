import { useEffect, useState } from "react";
import type { AppUser, ToolItem } from "../../../types/tool";
import { useAuth } from "../../../providers/AuthProvider";
import {
  getToolsHeldByUserFromOthers,
  getToolsOwnedByUser,
  getToolsOwnedByUserButHeldByOthers,
  getUsersList,
} from "../../tools/services/toolsService";
import MyToolCard from "../components/MyToolCard";

export default function MyProfilePage() {
  const { user } = useAuth();

  const [ownedTools, setOwnedTools] = useState<ToolItem[]>([]);
  const [borrowedTools, setBorrowedTools] = useState<ToolItem[]>([]);
  const [givenTools, setGivenTools] = useState<ToolItem[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user?.uid) return;

    setLoading(true);
    try {
      const [owned, borrowed, given, usersData] = await Promise.all([
        getToolsOwnedByUser(user.uid),
        getToolsHeldByUserFromOthers(user.uid),
        getToolsOwnedByUserButHeldByOthers(user.uid),
        getUsersList(),
      ]);

      setOwnedTools(owned);
      setBorrowedTools(borrowed);
      setGivenTools(given);
      setUsers(usersData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [user?.uid]);

  if (!user) {
    return (
      <div className="placeholder-page">
        <h2>Nu esti autentificat</h2>
        <p>Intra in cont pentru a vedea profilul.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca profilul...</h2>
        <p>Preluam sculele tale.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        <h2 className="panel-title">Profilul meu</h2>
        <div className="tool-detail-line">
          <strong>Nume:</strong> {user.displayName}
        </div>
        <div className="tool-detail-line">
          <strong>Email:</strong> {user.email}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Sculele mele</h3>
        {ownedTools.length === 0 ? (
          <p className="tools-subtitle">Nu ai scule in responsabilitate.</p>
        ) : (
          <div className="tools-grid">
            {ownedTools.map((tool) => (
              <MyToolCard
                key={tool.id}
                tool={tool}
                users={users}
                onChanged={load}
                showOwner={false}
                canManage={true}
              />
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">Scule primite de la altii</h3>
        {borrowedTools.length === 0 ? (
          <p className="tools-subtitle">Nu ai scule primite de la alti utilizatori.</p>
        ) : (
          <div className="tools-grid">
            {borrowedTools.map((tool) => (
              <MyToolCard
                key={tool.id}
                tool={tool}
                users={users}
                onChanged={load}
                canManage={false}
              />
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">Scule date altora</h3>
        {givenTools.length === 0 ? (
          <p className="tools-subtitle">Nu ai scule date altor utilizatori.</p>
        ) : (
          <div className="tools-grid">
            {givenTools.map((tool) => (
              <MyToolCard
                key={tool.id}
                tool={tool}
                users={users}
                onChanged={load}
                showOwner={false}
                canManage={true}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}