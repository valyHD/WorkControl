import { useEffect, useState } from "react";
import type { UserRole } from "../../../types/user";
import type { CompanyChoice } from "../../companies/services/companiesService";

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

const ROLE_TITLE_OPTIONS = [
  "Electrician",
  "Montator lifturi",
  "Tehnician service lifturi",
  "Mecanic utilaje",
  "Operator utilaje",
  "Sofer",
  "Lacatus mecanic",
  "Sudor",
  "Gestionar depozit",
  "Coordonator echipa",
  "Inginer",
  "Administrator",
  "Ajutor montator",
  "Necalificat",
];

const DEPARTMENT_OPTIONS = [
  "Montaj Lifturi",
  "Service si Intretinere Lifturi",
  "Logistica si Transport",
  "Depozit si Aprovizionare",
  "Administrativ",
];

type Props = {
  initialValues: UserFormValues;
  isEdit?: boolean;
  submitting: boolean;
  companyChoices?: CompanyChoice[];
  onSubmit: (values: UserFormValues) => Promise<void>;
};

export default function UserForm({
  initialValues,
  isEdit = false,
  submitting,
  companyChoices = [],
  onSubmit,
}: Props) {
  const [values, setValues] = useState<UserFormValues>(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(values);
  }

  return (
    <form className="tool-form" onSubmit={handleSubmit}>
      <div className="tool-form-grid">
        <div className="tool-form-block">
          <label className="tool-form-label">Nume complet</label>
          <input
            className="tool-input"
            data-assistant-field="fullName"
            value={values.fullName}
            onChange={(e) => setValues((prev) => ({ ...prev, fullName: e.target.value }))}
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Email</label>
          <input
            className="tool-input"
            data-assistant-field="email"
            type="email"
            value={values.email}
            disabled={isEdit}
            onChange={(e) => setValues((prev) => ({ ...prev, email: e.target.value }))}
          />
        </div>

        {!isEdit && (
          <div className="tool-form-block">
            <label className="tool-form-label">Parola initiala</label>
            <input
              className="tool-input"
              data-assistant-field="password"
              type="password"
              value={values.password}
              onChange={(e) => setValues((prev) => ({ ...prev, password: e.target.value }))}
            />
          </div>
        )}

        {!isEdit && companyChoices.length > 0 && (
          <div className="tool-form-block">
            <label className="tool-form-label" htmlFor="user-company">Firma</label>
            <select
              id="user-company"
              className="tool-input"
              data-assistant-field="companyId"
              value={values.companyId}
              onChange={(event) => setValues((current) => ({
                ...current,
                companyId: event.target.value,
              }))}
              required
            >
              <option value="">Alege firma</option>
              {companyChoices.map((company) => (
                <option key={company.companyId} value={company.companyId}>
                  {company.companyName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="tool-form-block">
          <label className="tool-form-label">Rol</label>
          <select
            className="tool-input"
            data-assistant-field="role"
            value={values.role}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                role: e.target.value as UserRole,
              }))
            }
          >
            <option value="admin">admin</option>
            <option value="manager">manager</option>
            <option value="angajat">angajat</option>
          </select>
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Functie / Post</label>
          <select
            id="user-roleTitle"
            className="tool-input"
            data-assistant-field="roleTitle"
            title="Alege functia sau postul utilizatorului"
            value={values.roleTitle}
            onChange={(e) => setValues((prev) => ({ ...prev, roleTitle: e.target.value }))}
          >
            <option value="">Alege functia</option>
            {ROLE_TITLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Departament</label>
          <select
            id="user-department"
            className="tool-input"
            data-assistant-field="department"
            title="Alege departamentul utilizatorului"
            value={values.department}
            onChange={(e) => setValues((prev) => ({ ...prev, department: e.target.value }))}
          >
            <option value="">Alege departamentul</option>
            {DEPARTMENT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {isEdit && (
          <div className="tool-form-block">
            <label className="tool-form-label">Activ</label>
            <select
              className="tool-input"
              data-assistant-field="active"
              value={values.active ? "true" : "false"}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  active: e.target.value === "true",
                }))
              }
            >
              <option value="true">activ</option>
              <option value="false">inactiv</option>
            </select>
          </div>
        )}
      </div>

      <div className="tool-form-actions">
        <button id="user-save" className="primary-btn" data-assistant-action="save-user" type="submit" title="Salveaza utilizatorul" disabled={submitting}>
          {submitting ? "Se salveaza..." : isEdit ? "Salveaza modificari" : "Creeaza utilizator"}
        </button>
      </div>
    </form>
  );
}
