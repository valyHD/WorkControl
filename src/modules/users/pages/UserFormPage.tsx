import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { ArrowLeft, BriefcaseBusiness, Building2, Save } from "lucide-react";
import UserForm from "../components/UserForm";
import { adminCreateUserWithEmail } from "../services/adminCreateUserService";
import { getUserById, updateUserProfile } from "../services/usersService";
import { useAuth } from "../../../providers/AuthProvider";
import type { UserRole } from "../../../types/user";
import { db } from "../../../lib/firebase/firebase";
import { pickNextAvailableThemeKey } from "../../../lib/ui/userTheme";
import ActionBar from "../../../components/ActionBar";
import PageQuickActions from "../../../components/PageQuickActions";
import { ASSISTANT_FILL_USER_FORM_EVENT } from "../../../lib/assistant/runtime/assistantFormFill";

type UserFormValues = {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  roleTitle: string;
  department: string;
  active: boolean;
};

const emptyValues: UserFormValues = {
  fullName: "",
  email: "",
  password: "",
  role: "angajat",
  roleTitle: "",
  department: "",
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
              roleTitle: found.roleTitle || "",
              department: found.department || "",
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

  useEffect(() => {
    if (isEdit) return undefined;
    const handleDraft = (event: Event) => {
      const fields = (event as CustomEvent<Record<string, unknown>>).detail || {};
      setInitialValues((current) => ({
        ...current,
        fullName: String(fields.fullName ?? current.fullName),
        email: String(fields.email ?? current.email),
        roleTitle: String(fields.roleTitle ?? current.roleTitle),
        department: String(fields.department ?? current.department),
        active: typeof fields.active === "boolean" ? fields.active : current.active,
      }));
    };
    window.addEventListener(ASSISTANT_FILL_USER_FORM_EVENT, handleDraft);
    return () => window.removeEventListener(ASSISTANT_FILL_USER_FORM_EVENT, handleDraft);
  }, [isEdit]);

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
          roleTitle: values.roleTitle.trim(),
          department: values.department.trim(),
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
        roleTitle: values.roleTitle.trim(),
        department: values.department.trim(),
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
      <ActionBar
        title={title}
        subtitle="Gestioneaza conturile, rolurile, functia, departamentul si statusul utilizatorilor."
        actions={[
          {
            label: "Inapoi la utilizatori",
            href: "/users",
            icon: <ArrowLeft size={16} />,
            tooltip: "Revino la lista de utilizatori",
          },
        ]}
      />

      <PageQuickActions
        actions={[
          {
            label: "Salveaza",
            href: "#user-save",
            icon: <Save size={16} />,
            assistantAction: "save-user",
            tooltip: "Salveaza modificarile utilizatorului",
            variant: "primary",
          },
          {
            label: "Schimba functia",
            href: "#user-roleTitle",
            icon: <BriefcaseBusiness size={16} />,
            assistantField: "roleTitle",
            tooltip: "Mergi la campul Functie / Post",
          },
          {
            label: "Schimba departament",
            href: "#user-department",
            icon: <Building2 size={16} />,
            assistantField: "department",
            tooltip: "Mergi la campul Departament",
          },
        ]}
      />

      <div className="panel" data-assistant-section="user-form">

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
