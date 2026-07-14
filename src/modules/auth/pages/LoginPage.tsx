import { useState } from "react";
import { Navigate } from "react-router-dom";
import { loginWithEmail, registerWithEmail } from "../services/authService";
import { InternalAccessError } from "../services/internalAccessPolicy";
import { useAuth } from "../../../providers/AuthProvider";

type AuthMode = "login" | "register";

function getAuthErrorMessage(error: unknown, mode: AuthMode): string {
  if (error instanceof InternalAccessError) return error.message;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (code.includes("email-already-in-use")) {
    return "Exista deja un cont cu acest email. Foloseste Conectare.";
  }
  if (code.includes("weak-password")) return "Parola trebuie sa aiba minimum 8 caractere.";
  if (code.includes("invalid-email")) return "Adresa de email nu este valida.";
  if (code.includes("too-many-requests")) return "Prea multe incercari. Incearca din nou mai tarziu.";
  if (code.includes("network-request-failed")) return "Conexiunea la internet nu este disponibila.";
  return mode === "register"
    ? "Contul nu a putut fi creat. Verifica datele si incearca din nou."
    : "Autentificare esuata. Verifica emailul si parola.";
}

export default function LoginPage() {
  const { user, loading } = useAuth();

  const [mode, setMode] = useState<AuthMode>("login");
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

      if (mode === "register") {
        const fullName = String(formData.get("fullName") || "").trim();
        const confirmPassword = String(formData.get("confirmPassword") || "");
        if (!fullName) {
          setError("Completeaza numele complet.");
          return;
        }
        if (password.length < 8) {
          setError("Parola trebuie sa aiba minimum 8 caractere.");
          return;
        }
        if (password !== confirmPassword) {
          setError("Parolele nu coincid.");
          return;
        }
        await registerWithEmail({ fullName, email, password });
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: unknown) {
      console.error(err);
      setError(getAuthErrorMessage(err, mode));
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

        <div className="auth-mode-tabs" role="tablist" aria-label="Tip acces">
          <button
            className={mode === "login" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Conectare
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            onClick={() => {
              setMode("register");
              setError("");
            }}
          >
            Cont nou
          </button>
        </div>

        <h1 className="auth-title">{mode === "login" ? "Conectare" : "Creeaza cont"}</h1>

        <p className="auth-subtitle">
          {mode === "login"
            ? "Conecteaza-te cu datele contului WorkControl."
            : "Dupa creare vei alege firma in care lucrezi."}
        </p>

        <form className="tool-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <div className="tool-form-block">
              <label className="tool-form-label" htmlFor="register-full-name">Nume complet</label>
              <input
                id="register-full-name"
                className="tool-input"
                name="fullName"
                autoComplete="name"
                placeholder="Ex: Popescu Ion"
              />
            </div>
          )}

          <div className="tool-form-block">
            <label className="tool-form-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="tool-input"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Ex: admin@workcontrol.ro"
            />
          </div>

          <div className="tool-form-block">
            <label className="tool-form-label" htmlFor="auth-password">Parola</label>
            <input
              id="auth-password"
              className="tool-input"
              name="password"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder="Introdu parola"
            />
          </div>

          {mode === "register" && (
            <div className="tool-form-block">
              <label className="tool-form-label" htmlFor="register-confirm-password">
                Confirma parola
              </label>
              <input
                id="register-confirm-password"
                className="tool-input"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                placeholder="Repeta parola"
              />
            </div>
          )}

          {error && <div className="tool-message">{error}</div>}

          <div className="tool-form-actions">
            <button className="primary-btn" type="submit" disabled={submitting}>
              {submitting
                ? "Se proceseaza..."
                : mode === "register"
                  ? "Creeaza cont"
                  : "Conecteaza-te"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
