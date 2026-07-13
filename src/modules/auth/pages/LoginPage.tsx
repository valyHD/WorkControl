import { useState } from "react";
import { Navigate } from "react-router-dom";
import { loginWithEmail } from "../services/authService";
import { InternalAccessError } from "../services/internalAccessPolicy";
import { useAuth } from "../../../providers/AuthProvider";

export default function LoginPage() {
  const { user, loading } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const formData = new FormData(event.currentTarget);

      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      if (!email || !password) {
        setError("Completeaza emailul si parola.");
        return;
      }

      await loginWithEmail(email, password);
    } catch (err: unknown) {
      console.error(err);
      setError(
        err instanceof InternalAccessError
          ? err.message
          : "Autentificare esuata. Verifica emailul si parola."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-badge">WC</div>
          <div>
            <div className="brand-title">WorkControl</div>
            <div className="brand-subtitle">Autentificare</div>
          </div>
        </div>

        <h1 className="auth-title">Conectare</h1>

        <p className="auth-subtitle">
          Accesul este disponibil numai conturilor create de administrator.
        </p>

        <form className="tool-form" onSubmit={handleSubmit}>
          <div className="tool-form-block">
            <label className="tool-form-label">Email</label>
            <input
              className="tool-input"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Ex: admin@workcontrol.ro"
            />
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label">Parola</label>
            <input
              className="tool-input"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Introdu parola"
            />
          </div>

          {error && <div className="tool-message">{error}</div>}

          <div className="tool-form-actions">
            <button className="primary-btn" type="submit" disabled={submitting}>
              {submitting ? "Se proceseaza..." : "Conecteaza-te"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
