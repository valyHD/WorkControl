import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import StatusBadge from "../../../components/StatusBadge";
import {
  getAssistantObservabilityTraces,
  type AssistantObservabilityTrace,
} from "../services/assistantObservabilityService";

type AssistantObservabilityPanelProps = {
  isAdmin: boolean;
};

function outcomeLabel(status: string) {
  const labels: Record<string, string> = {
    interpreted: "Interpretată",
    executed: "Executată",
    failed: "Eșuată",
    cancelled: "Anulată",
    needs_clarification: "Clarificare",
    interpretation_failed: "Interpretare eșuată",
  };
  return labels[status] || status;
}

function outcomeTone(status: string): "green" | "orange" | "red" | "blue" | "muted" {
  if (status === "executed") return "green";
  if (status === "failed" || status === "interpretation_failed") return "red";
  if (status === "needs_clarification" || status === "cancelled") return "orange";
  if (status === "interpreted") return "blue";
  return "muted";
}

function formatConfidence(value: number | null) {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

function formatCost(value: number | null) {
  if (value === null) return "-";
  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

export default function AssistantObservabilityPanel({ isAdmin }: AssistantObservabilityPanelProps) {
  const [traces, setTraces] = useState<AssistantObservabilityTrace[]>([]);
  const [loading, setLoading] = useState(isAdmin);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError("");
    try {
      setTraces(await getAssistantObservabilityTraces(100));
    } catch {
      setError("Nu am putut încărca urmele asistentului.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let active = true;
    getAssistantObservabilityTraces(100)
      .then((nextTraces) => {
        if (active) setTraces(nextTraces);
      })
      .catch(() => {
        if (active) setError("Nu am putut încărca urmele asistentului.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isAdmin]);

  const summary = useMemo(
    () => ({
      executed: traces.filter((trace) => trace.outcome === "executed").length,
      failed: traces.filter(
        (trace) => trace.outcome === "failed" || trace.outcome === "interpretation_failed"
      ).length,
      clarification: traces.filter((trace) => trace.clarificationRequired).length,
      tokens: traces.reduce((total, trace) => total + trace.totalTokens, 0),
    }),
    [traces]
  );

  if (!isAdmin) return null;

  return (
    <section aria-label="Observabilitate asistent AI">
      <div className="tools-header">
        <div>
          <h4 className="panel-subtitle">Observabilitate AI</h4>
          <p className="tools-subtitle">
            Ultimele {traces.length} din maximum 100 de urme, cu retenție de 30 de zile.
          </p>
        </div>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Reîncarcă urmele AI"
          title="Reîncarcă urmele AI"
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="quick-actions-grid" aria-label="Rezumat urme AI">
        <div className="quick-action-card">
          <div className="quick-action-title">Executate</div>
          <div className="quick-action-subtitle">{summary.executed}</div>
        </div>
        <div className="quick-action-card">
          <div className="quick-action-title">Erori</div>
          <div className="quick-action-subtitle">{summary.failed}</div>
        </div>
        <div className="quick-action-card">
          <div className="quick-action-title">Clarificări</div>
          <div className="quick-action-subtitle">{summary.clarification}</div>
        </div>
        <div className="quick-action-card">
          <div className="quick-action-title">Tokeni</div>
          <div className="quick-action-subtitle">{summary.tokens.toLocaleString("ro-RO")}</div>
        </div>
      </div>

      {loading ? (
        <div className="tool-message" role="status">
          Se încarcă urmele AI...
        </div>
      ) : null}
      {error ? (
        <div className="tool-message error-message" role="alert">
          {error}
        </div>
      ) : null}
      {!loading && !error && traces.length === 0 ? (
        <div className="tool-message">Nu există urme AI în perioada de retenție.</div>
      ) : null}

      {traces.length > 0 ? (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Dată</th>
                <th>Rezultat</th>
                <th>Interpretare</th>
                <th>Transcript redactat</th>
                <th>Încredere</th>
                <th>Latență</th>
                <th>Tokeni</th>
                <th>Cost estimat</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr key={trace.id}>
                  <td>
                    {trace.createdAt ? new Date(trace.createdAt).toLocaleString("ro-RO") : "-"}
                  </td>
                  <td>
                    <StatusBadge tone={outcomeTone(trace.outcome)}>
                      {outcomeLabel(trace.outcome)}
                    </StatusBadge>
                  </td>
                  <td>
                    <strong>{trace.intent}</strong>
                    <div className="quick-action-subtitle">
                      {[trace.targetModule, trace.toolCallIds.join(", ")]
                        .filter(Boolean)
                        .join(" · ") || "-"}
                    </div>
                  </td>
                  <td>{trace.transcript}</td>
                  <td>{formatConfidence(trace.confidence)}</td>
                  <td>{trace.latencyMs.toLocaleString("ro-RO")} ms</td>
                  <td title={`${trace.inputTokens} intrare, ${trace.outputTokens} ieșire`}>
                    {trace.totalTokens.toLocaleString("ro-RO")}
                  </td>
                  <td title={`Model: ${trace.model}`}>{formatCost(trace.estimatedCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
