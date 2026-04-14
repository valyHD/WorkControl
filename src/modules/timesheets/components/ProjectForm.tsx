import { useEffect, useState } from "react";
import type { ProjectStatus } from "../../../types/timesheet";

type ProjectFormValues = {
  code: string;
  name: string;
  status: ProjectStatus;
};

type Props = {
  initialValues: ProjectFormValues;
  submitting: boolean;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
};

export default function ProjectForm({ initialValues, submitting, onSubmit }: Props) {
  const [values, setValues] = useState<ProjectFormValues>(initialValues);

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
          <label className="tool-form-label">Cod proiect</label>
          <input
            className="tool-input"
            value={values.code}
            onChange={(e) => setValues((prev) => ({ ...prev, code: e.target.value }))}
            placeholder="Ex: PRJ-001"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Nume proiect</label>
          <input
            className="tool-input"
            value={values.name}
            onChange={(e) => setValues((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Ex: Montaj lift A"
          />
        </div>

        <div className="tool-form-block">
          <label className="tool-form-label">Status</label>
          <select
            className="tool-input"
            value={values.status}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                status: e.target.value as ProjectStatus,
              }))
            }
          >
            <option value="activ">activ</option>
            <option value="inactiv">inactiv</option>
            <option value="finalizat">finalizat</option>
          </select>
        </div>
      </div>

      <div className="tool-form-actions">
        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? "Se salveaza..." : "Salveaza proiect"}
        </button>
      </div>
    </form>
  );
}