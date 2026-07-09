import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, LockKeyhole, Power, PowerOff } from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import {
  canControlVehicleGpsVisibility,
  setVehicleGpsVisibilityBlocked,
  subscribeVehicleGpsVisibility,
  type VehicleGpsVisibilityState,
} from "../services/vehiclesService";

const DEFAULT_VISIBILITY_STATE: VehicleGpsVisibilityState = {
  blocked: false,
  updatedAt: 0,
  updatedBy: "",
  updatedByName: "",
};

type VehicleGpsVisibilityGateProps = {
  children: ReactNode;
};

export function VehicleGpsVisibilityGate({ children }: VehicleGpsVisibilityGateProps) {
  const { user } = useAuth();
  const [state, setState] = useState<VehicleGpsVisibilityState>(DEFAULT_VISIBILITY_STATE);
  const [loading, setLoading] = useState(true);
  const canControl = useMemo(() => canControlVehicleGpsVisibility(user?.email), [user?.email]);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeVehicleGpsVisibility((nextState) => {
      setState(nextState);
      setLoading(false);
    });

    return () => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("[VehicleGpsVisibilityGate][unsubscribe]", error);
      }
    };
  }, []);

  if (!canControl && loading) {
    return (
      <section className="page-section">
        <div className="vehicle-gps-visibility-page">
          <div className="vehicle-gps-visibility-card">
            <div className="vehicle-gps-visibility-icon vehicle-gps-visibility-icon--muted">
              <LockKeyhole size={22} />
            </div>
            <h1>Se verifica accesul GPS</h1>
            <p>Pregatim datele vehiculelor.</p>
          </div>
        </div>
      </section>
    );
  }

  if (!canControl && state.blocked) {
    return <VehicleGpsUnavailablePage />;
  }

  return <>{children}</>;
}

export function VehicleGpsVisibilityToggle() {
  const { user } = useAuth();
  const [state, setState] = useState<VehicleGpsVisibilityState>(DEFAULT_VISIBILITY_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canControl = canControlVehicleGpsVisibility(user?.email);

  useEffect(() => {
    if (!canControl) return undefined;

    setLoading(true);
    const unsubscribe = subscribeVehicleGpsVisibility((nextState) => {
      setState(nextState);
      setLoading(false);
    });

    return () => {
      try {
        unsubscribe();
      } catch (unsubscribeError) {
        console.error("[VehicleGpsVisibilityToggle][unsubscribe]", unsubscribeError);
      }
    };
  }, [canControl]);

  if (!canControl) return null;

  const handleToggle = async () => {
    setSaving(true);
    setError("");
    try {
      await setVehicleGpsVisibilityBlocked(!state.blocked, {
        email: user?.email,
        displayName: user?.displayName,
      });
    } catch (toggleError) {
      console.error("[VehicleGpsVisibilityToggle]", toggleError);
      setError("Nu am putut schimba vizibilitatea GPS.");
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || saving;
  const label = state.blocked ? "GPS blocat" : "GPS vizibil";
  const hint = state.blocked ? "Utilizatorii vad pagina tehnica" : "Utilizatorii vad masinile";

  return (
    <div className={`vehicle-gps-visibility-toggle ${state.blocked ? "is-blocked" : ""}`}>
      <button
        type="button"
        className="vehicle-gps-visibility-toggle__button"
        onClick={handleToggle}
        disabled={disabled}
        aria-pressed={state.blocked}
        title="Controleaza vizibilitatea paginilor GPS pentru ceilalti utilizatori"
      >
        <span className="vehicle-gps-visibility-toggle__icon">
          {state.blocked ? <PowerOff size={15} /> : <Power size={15} />}
        </span>
        <span>
          <strong>{loading ? "Se verifica..." : label}</strong>
          <small>{hint}</small>
        </span>
      </button>
      {error ? <span className="vehicle-gps-visibility-toggle__error">{error}</span> : null}
    </div>
  );
}

function VehicleGpsUnavailablePage() {
  return (
    <section className="page-section">
      <div className="vehicle-gps-visibility-page">
        <div className="vehicle-gps-visibility-card">
          <div className="vehicle-gps-visibility-icon">
            <AlertTriangle size={23} />
          </div>
          <span className="vehicle-gps-visibility-eyebrow">Modul indisponibil temporar</span>
          <h1>Datele GPS nu pot fi afisate acum</h1>
          <p>
            Se fac verificari tehnice pentru vehicule si trasee. Pagina revine automat cand
            modulul este disponibil.
          </p>
          <Link to="/dashboard" className="secondary-btn">
            Inapoi la dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
