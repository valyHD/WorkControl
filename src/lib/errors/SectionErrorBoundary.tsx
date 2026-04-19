import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  sectionName?: string;
};

type State = {
  hasError: boolean;
};

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[SectionErrorBoundary:${this.props.sectionName ?? "unknown"}]`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="vehicle-live-route-card__empty" role="alert">
          Sectiunea „{this.props.sectionName ?? "componenta"}” nu a putut fi afisata. Reincarca pagina.
        </div>
      );
    }

    return this.props.children;
  }
}
