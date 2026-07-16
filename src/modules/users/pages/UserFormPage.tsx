import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BriefcaseBusiness, Building2, Save } from "lucide-react";
import UserForm from "../components/UserForm";
import { adminCreateUserWithEmail } from "../services/adminCreateUserService";
import { getAllUsers, getUserById, updateUserProfile } from "../services/usersService";
import { useAuth } from "../../../providers/AuthProvider";
import type { UserRole } from "../../../types/user";
import { pickNextAvailableThemeKey } from "../../../lib/ui/userTheme";
import ActionBar from "../../../components/ActionBar";
import PageQuickActions from "../../../components/PageQuickActions";
import { ASSISTANT_FILL_USER_FORM_EVENT } from "../../../lib/assistant/runtime/assistantFormFill";
import { registerAssistantFormDraftAdapter } from "../../../lib/assistant/adapters/assistantFormDraftChannel";
import {
  getAvailableCompanyChoices,
  type CompanyChoice,
} from "../../companies/services/companiesService";

type UserFormValues = {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  roleTitle: string;
  department: string;
  companyId: string;
  active: boolean;
};

const emptyValues: UserFormValues = {
  fullName: "",
  email: "",
  password: "",
  role: "angajat",
  roleTitle: "",
  department: "",
  companyId: "",
  active: true,
};

async function getNextUserThemeKey() {
  try {
    const users = await getAllUsers();
    const usedThemeKeys = users.map((item) => String(item.themeKey || "").trim().toLowerCase());
    return pickNextAvailableThemeKey(usedThemeKeys);
  } catch {
    return pickNextAvailableThemeKey([]);
  }
}

function getSaveErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : "";
  if (code.includes("already-exists")) {
    return "Exista deja un utilizator intern cu acest email.";
  }
  if (code.includes("permission-denied")) {
    return "Nu ai permisiunea de a crea utilizatorul pentru firma selectata.";
  }
  if (code.includes("invalid-argument") && message) return message;
  return "Nu am putut salva utilizatorul.";
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
  const [companyChoices, setCompanyChoices] = useState<CompanyChoice[]>([]);

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
              companyId: found.primaryCompanyId || found.companyIds?.[0] || "",
              active: found.active,
            });
          }
        } else {
          const companies = await getAvailableCompanyChoices();
          setCompanyChoices(companies);
          const preferredCompanyId = user?.primaryCompanyId ||
            (companies.length === 1 ? companies[0].companyId : "");
          setInitialValues((current) => ({
            ...current,
            companyId: current.companyId || preferredCompanyId,
          }));
        }
      } catch (loadError) {
        console.error(loadError);
        setError(userId
          ? "Utilizatorul nu a putut fi incarcat."
          : "Lista firmelor nu a putut fi incarcata. Poti folosi firma implicita a contului.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [user?.primaryCompanyId, userId]);

  useEffect(() => {
    if (isEdit) return undefined;
    const handleDraft = (fields: Readonly<Record<string, unknown>>) => {
      setInitialValues((current) => ({
        ...current,
        fullName: String(fields.fullName ?? current.fullName),
        email: String(fields.email ?? current.email),
        roleTitle: String(fields.roleTitle ?? current.roleTitle),
        department: String(fields.department ?? current.department),
        active: typeof fields.active === "boolean" ? fields.active : current.active,
      }));
    };
    return registerAssistantFormDraftAdapter(ASSISTANT_FILL_USER_FORM_EVENT, handleDraft);
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

      const themeKey = await getNextUserThemeKey();
      await adminCreateUserWithEmail({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password.trim(),
        role: values.role,
        roleTitle: values.roleTitle.trim(),
        department: values.department.trim(),
        themeKey,
        companyId: values.companyId || undefined,
      });

      navigate("/users");
    } catch (err) {
      console.error(err);
      setError(getSaveErrorMessage(err));
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
          companyChoices={companyChoices}
          onSubmit={handleSubmit}
        />
      </div>
    </section>
  );
}
