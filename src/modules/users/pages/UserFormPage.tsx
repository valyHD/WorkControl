import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import UserForm from "../components/UserForm";
import { adminCreateUserWithEmail } from "../services/adminCreateUserService";
import { getUserById, updateUserProfile } from "../services/usersService";
import { useAuth } from "../../../providers/AuthProvider";
import type { UserRole } from "../../../types/user";
import { db } from "../../../lib/firebase/firebase";
import { pickNextAvailableThemeKey } from "../../../lib/ui/userTheme";

type UserFormValues = {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  active: boolean;
};

const emptyValues: UserFormValues = {
  fullName: "",
  email: "",
  password: "",
  role: "angajat",
  active: true,
};

async function getNextUserThemeKey() {
  const snapshot = await getDocs(collection(db, "users"));
  const usedThemeKeys = snapshot.docs.map((doc) =>
  String(doc.data()?.themeKey || "").trim().toLowerCase()
);
  return pickNextAvailableThemeKey(usedThemeKeys);
}

export default function UserFormPage() {
  const { role, user } = useAuth();
  const { userId } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(userId);

  const [initialValues, setInitialValues] = useState<UserFormValues>(emptyValues);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");

      try {
        if (userId) {
          const found = await getUserById(userId);

          if (found) {
            setInitialValues({
              fullName: found.fullName,
              email: found.email,
              password: "",
              role: found.role,
              active: found.active,
            });
          }
        }
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [userId]);

  async function handleSubmit(values: UserFormValues) {
    setSubmitting(true);
    setError("");

    try {
      if (!values.fullName.trim()) {
        setError("Completeaza numele.");
        return;
      }

      if (!values.email.trim()) {
        setError("Completeaza emailul.");
        return;
      }

      if (!isEdit && !values.password.trim()) {
        setError("Completeaza parola initiala.");
        return;
      }

      if (isEdit && userId) {
        await updateUserProfile(userId, {
          fullName: values.fullName.trim(),
          role: values.role,
          active: values.active,
        });

        navigate("/users");
        return;
      }

      if (!user?.email) {
        setError("Adminul curent nu are email disponibil.");
        return;
      }

      const adminPassword = window.prompt(
        "Introdu parola ta de admin pentru a crea utilizatorul:"
      );

      if (!adminPassword) {
        setError("Crearea a fost anulata. Parola admin lipseste.");
        return;
      }

      const themeKey = await getNextUserThemeKey();
console.log("THEME ales pentru user nou:", themeKey);
      await adminCreateUserWithEmail({
        adminEmail: user.email,
        adminPassword,
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password.trim(),
        role: values.role,
        themeKey,
      });

      navigate("/users");
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva utilizatorul.");
    } finally {
      setSubmitting(false);
    }
  }

  const title = useMemo(
    () => (isEdit ? "Editeaza utilizator" : "Adauga utilizator"),
    [isEdit]
  );

  if (role !== "admin") {
    return (
      <div className="placeholder-page">
        <h2>Acces restrictionat</h2>
        <p>Doar adminul poate gestiona utilizatorii.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca...</h2>
        <p>Pregatim formularul utilizatorului.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">{title}</h2>
            <p className="tools-subtitle">
              Gestioneaza conturile, rolurile si statusul utilizatorilor.
            </p>
          </div>

          <Link to="/users" className="secondary-btn">
            Inapoi la utilizatori
          </Link>
        </div>

        {error && <div className="tool-message">{error}</div>}

        <UserForm
          initialValues={initialValues}
          isEdit={isEdit}
          submitting={submitting}
          onSubmit={handleSubmit}
        />
      </div>
    </section>
  );
}