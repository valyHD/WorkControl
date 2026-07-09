import { Link } from "react-router-dom";

export default function PublicHomePage() {
  return (
    <main className="auth-page">
      <section className="auth-card" style={{ maxWidth: 760 }}>
        <h1 className="auth-title">WorkControl</h1>
        <p className="auth-subtitle">
          WorkControl este o aplicatie privata pentru management operational: clienti de mentenanta,
          rapoarte PDF, utilizatori, unelte, vehicule, notificari si evidenta activitatilor interne.
        </p>
        <p className="auth-subtitle">
          Accesul in aplicatie este permis doar utilizatorilor autorizati de administratorul WorkControl.
        </p>
        <div className="auth-actions" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
          <Link className="primary-btn" to="/login">
            Login
          </Link>
          <Link className="secondary-btn" to="/privacy-policy">
            Privacy Policy
          </Link>
          <Link className="secondary-btn" to="/terms">
            Terms
          </Link>
        </div>
      </section>
    </main>
  );
}
