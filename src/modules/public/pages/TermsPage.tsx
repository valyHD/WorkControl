import { Link } from "react-router-dom";

export default function TermsPage() {
  return (
    <main className="auth-page">
      <section className="auth-card" style={{ maxWidth: 860 }}>
        <h1 className="auth-title">Terms of Service</h1>
        <p className="auth-subtitle">Last updated: April 25, 2026</p>
        <p className="auth-subtitle">
          WorkControl is provided for authorized business use only. Users are responsible for entering
          accurate operational data and for sending generated reports only to intended recipients.
        </p>
        <p className="auth-subtitle">
          Access may be limited, changed or removed by the WorkControl administrator. The application is
          provided without warranty and is intended for internal operational workflows.
        </p>
        <p className="auth-subtitle">
          For support or account access questions, contact liftultau@gmail.com.
        </p>
        <div className="auth-actions" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
          <Link className="secondary-btn" to="/">
            Home
          </Link>
          <Link className="primary-btn" to="/login">
            Login
          </Link>
        </div>
      </section>
    </main>
  );
}
