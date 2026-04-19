import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type Props = {
  children: ReactNode;
  sectionName?: string;
  /** Custom fallback — overrides the default error UI */
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || "Eroare neașteptată.",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[SectionErrorBoundary:${this.props.sectionName ?? "unknown"}]`,
      error,
      errorInfo
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "32px 20px",
            textAlign: "center",
            background: "var(--danger-soft)",
            border: "1.5px solid var(--danger-line)",
            borderRadius: "var(--radius-lg)",
            color: "var(--danger)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 48,
              height: 48,
              borderRadius: "var(--radius-md)",
              background: "rgba(185,28,28,.12)",
            }}
          >
            <AlertTriangle size={22} strokeWidth={2} />
          </div>

          <div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              Secțiunea „{this.props.sectionName ?? "componentă"}" nu a putut fi afișată
            </div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              {this.state.message}
            </div>
          </div>

          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 18px",
              borderRadius: "var(--radius-sm)",
              background: "var(--danger)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <RefreshCw size={13} />
            Încearcă din nou
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
