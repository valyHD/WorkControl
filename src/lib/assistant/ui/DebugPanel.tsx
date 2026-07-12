import { Bug } from "lucide-react";
import type { AssistantDebugEntry } from "./types";
import styles from "./assistantUi.module.css";

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|credential|password|secret|token|api.?key)/i;

function formatDebugValue(entry: AssistantDebugEntry) {
  if (entry.sensitive || SENSITIVE_KEY_PATTERN.test(`${entry.id} ${entry.label}`))
    return "[ascuns]";
  if (entry.value === undefined) return "-";
  if (entry.value === null) return "null";
  if (typeof entry.value === "string") return entry.value;
  try {
    return JSON.stringify(entry.value, null, 2);
  } catch {
    return String(entry.value);
  }
}

export type DebugPanelProps = {
  entries: readonly AssistantDebugEntry[];
  title?: string;
  defaultOpen?: boolean;
};

export function DebugPanel({
  entries,
  title = "Detalii tehnice",
  defaultOpen = false,
}: DebugPanelProps) {
  return (
    <details className={styles.debugPanel} open={defaultOpen}>
      <summary>
        <Bug size={16} aria-hidden="true" />
        {title}
      </summary>
      <dl>
        {entries.map((entry) => (
          <div key={entry.id}>
            <dt>{entry.label}</dt>
            <dd>
              <pre>{formatDebugValue(entry)}</pre>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
