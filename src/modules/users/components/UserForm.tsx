import { useEffect, useState } from "react";
import type { UserRole } from "../../../types/user";

type UserFormValues = {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  active: boolean;
};

type Props = {
  initialValues: UserFormValues;
  isEdit?: boolean;
  submitting: boolean;
  onSubmit: (values: UserFormValues) => Promise<void>;
};

export default function UserForm({
  initialValues,
  isEdit = false,
  submitting,
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
            value={values.fullName}
            onChange={(e) => setValues((prev) => ({ ...prev, fullName: e.target.value }))}
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Email</label>
          <input
            className="tool-input"
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
              type="password"
              value={values.password}
              onChange={(e) => setValues((prev) => ({ ...prev, password: e.target.value }))}
            />
          </div>
        )}

        <div className="tool-form-block">
          <label className="tool-form-label">Rol</label>
          <select
            className="tool-input"
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

        {isEdit && (
          <div className="tool-form-block">
            <label className="tool-form-label">Activ</label>
            <select
              className="tool-input"
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
        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? "Se salveaza..." : isEdit ? "Salveaza modificari" : "Creeaza utilizator"}
        </button>
      </div>
    </form>
  );
}