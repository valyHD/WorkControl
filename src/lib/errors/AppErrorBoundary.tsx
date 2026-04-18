import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || "A apărut o eroare neașteptată.",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, errorInfo);
    try {
      localStorage.setItem(
        "wc_last_runtime_error",
        JSON.stringify({
          message: error.message,
          stack: error.stack,
          time: Date.now(),
        })
      );
    } catch {
      // no-op
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="auth-page">
          <div className="auth-card">
            <h1 className="auth-title">Aplicația s-a protejat de un crash</h1>
            <p className="auth-subtitle">
              {this.state.message}. Reîncarcă pagina. Ultima eroare a fost salvată local pentru debug.
            </p>
            <button className="primary-btn" type="button" onClick={() => window.location.reload()}>
              Reîncarcă aplicația
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
