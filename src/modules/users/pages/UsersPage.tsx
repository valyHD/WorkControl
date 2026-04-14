import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAllUsers } from "../services/usersService";
import type { AppUserItem } from "../../../types/user";
import { useAuth } from "../../../providers/AuthProvider";
import { getUserInitials, getUserThemeClass } from "../../../lib/ui/userTheme";

export default function UsersPage() {
  const { role } = useAuth();
  const [users, setUsers] = useState<AppUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await getAllUsers();
      setUsers(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();

    return users.filter((user) => {
      if (!q) return true;
      return (
        user.fullName.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        user.role.toLowerCase().includes(q)
      );
    });
  }, [users, search]);

  if (role !== "admin") {
    return (
      <div className="placeholder-page">
        <h2>Acces restrictionat</h2>
        <p>Doar adminul poate gestiona utilizatorii.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">Utilizatori</h2>
            <p className="tools-subtitle">
              Administrare conturi, roluri si stare activ/inactiv.
            </p>
          </div>

          <div className="tools-header-actions">
            <Link to="/users/new" className="primary-btn">
              Adauga utilizator
            </Link>
          </div>
        </div>

        <div className="tools-filters">
          <input
            className="tool-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cauta dupa nume, email sau rol"
          />
          <div />
        </div>

        {loading ? (
          <div className="placeholder-page">
            <h2>Se incarca...</h2>
            <p>Preluam utilizatorii din Firestore.</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="placeholder-page">
            <h2>Nu exista utilizatori</h2>
            <p>Adauga primul utilizator.</p>
          </div>
        ) : (
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Nume</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Status</th>
                  <th>Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const userThemeClass = getUserThemeClass(user.themeKey);

                  return (
                    <tr key={user.id} className={`user-table-row ${userThemeClass}`}>
                      <td>
                        <div className="user-table-name">
                          <span className="user-accent-avatar">
                            {getUserInitials(user.fullName)}
                          </span>

                          <div className="user-table-meta">
                            <span className="user-accent-name">{user.fullName}</span>
                            <span className="simple-list-subtitle">{user.uid}</span>
                          </div>
                        </div>
                      </td>

                      <td>{user.email}</td>

                      <td>
                        <span className="user-accent-chip">{user.role}</span>
                      </td>

                      <td>
                        <span className={user.active ? "badge badge-green" : "badge badge-red"}>
                          {user.active ? "activ" : "inactiv"}
                        </span>
                      </td>

                      <td>
                        <Link to={`/users/${user.id}/edit`} className="secondary-btn">
                          Editeaza
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}