import { useState } from "react";
import { Navigate } from "react-router-dom";
import {
  loginWithEmail,
  registerWithEmail,
} from "../services/authService";
import { useAuth } from "../../../providers/AuthProvider";

export default function LoginPage() {
  const { user, loading } = useAuth();

  const [mode, setMode] = useState<"login" | "register">("login");
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

      const fullName = String(formData.get("fullName") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      if (!email || !password) {
        setError("Completeaza emailul si parola.");
        return;
      }

      if (mode === "register") {
        if (!fullName) {
          setError("Completeaza numele complet.");
          return;
        }

        await registerWithEmail(fullName, email, password);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: any) {
      console.error(err);
      setError("Autentificare esuata. Verifica emailul si parola.");
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

        <h1 className="auth-title">
          {mode === "login" ? "Conectare" : "Creeaza cont"}
        </h1>

        <p className="auth-subtitle">
          {mode === "login"
            ? "Intra in panoul de control."
            : "Primul user creat se salveaza automat in Firestore."}
        </p>

        <form className="tool-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <div className="tool-form-block">
              <label className="tool-form-label">Nume complet</label>
              <input
                className="tool-input"
                name="fullName"
                autoComplete="name"
                placeholder="Ex: Ionut Matura"
              />
            </div>
          )}

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
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="Introdu parola"
            />
          </div>

          {error && <div className="tool-message">{error}</div>}

          <div className="tool-form-actions">
            <button className="primary-btn" type="submit" disabled={submitting}>
              {submitting
                ? "Se proceseaza..."
                : mode === "login"
                ? "Conecteaza-te"
                : "Creeaza cont"}
            </button>

            <button
              className="secondary-btn"
              type="button"
              onClick={() =>
                setMode((prev) => (prev === "login" ? "register" : "login"))
              }
            >
              {mode === "login"
                ? "Nu ai cont? Creeaza cont"
                : "Ai deja cont? Conecteaza-te"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}