import { useEffect } from "react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { isDynamicImportFailure, reloadOnceForFreshAssets } from "../routing/dynamicImportRecovery";

function getRouteErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    return error.statusText || `Eroare ${error.status}`;
  }
  if (error instanceof Error) return error.message;
  return String(error || "Eroare neasteptata.");
}

export function RouteErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = getRouteErrorMessage(error);
  const isImportError = isDynamicImportFailure(error);

  useEffect(() => {
    if (isImportError) {
      const timer = window.setTimeout(() => {
        reloadOnceForFreshAssets();
      }, 200);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isImportError]);

  return (
    <div className="auth-page">
      <div className="auth-card route-error-card">
        <h1 className="auth-title">
          {isImportError ? "Actualizam aplicatia..." : "Pagina nu s-a putut incarca"}
        </h1>
        <p className="auth-subtitle">
          {isImportError
             ? "A aparut o versiune noua a aplicatiei. Reincarcam automat pagina ca sa luam fisierele noi."
            : message}
        </p>
        <div className="tool-form-actions" style={{ justifyContent: "center", marginTop: 12 }}>
          <button className="primary-btn" type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={16} />
            Reincarca pagina
          </button>
          <button className="secondary-btn" type="button" onClick={() => navigate("/dashboard", { replace: true })}>
            Mergi la dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
