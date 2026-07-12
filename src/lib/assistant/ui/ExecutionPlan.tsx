import { useId } from "react";
import { AlertCircle, Check, Circle, CirclePause, LoaderCircle, ShieldCheck } from "lucide-react";
import type { AssistantExecutionStep, AssistantExecutionStepStatus } from "./types";
import styles from "./assistantUi.module.css";

function StepIcon({ status }: { status: AssistantExecutionStepStatus }) {
  if (status === "completed") return <Check size={16} aria-hidden="true" />;
  if (status === "active")
    return <LoaderCircle className={styles.spin} size={16} aria-hidden="true" />;
  if (status === "failed") return <AlertCircle size={16} aria-hidden="true" />;
  if (status === "blocked") return <CirclePause size={16} aria-hidden="true" />;
  return <Circle size={14} aria-hidden="true" />;
}

export type ExecutionPlanProps = {
  steps: readonly AssistantExecutionStep[];
  title?: string;
  description?: string;
};

export function ExecutionPlan({
  steps,
  title = "Plan de execuție",
  description,
}: ExecutionPlanProps) {
  const titleId = useId();
  return (
    <section className={styles.plan} aria-labelledby={titleId}>
      <div className={styles.cardHeader}>
        <div>
          <h3 id={titleId}>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <ol className={styles.planList}>
        {steps.map((step) => (
          <li
            className={styles.planStep}
            data-status={step.status}
            key={step.id}
            aria-current={step.status === "active" ? "step" : undefined}
          >
            <span className={styles.stepIcon}>
              <StepIcon status={step.status} />
            </span>
            <span className={styles.stepCopy}>
              <strong>{step.label}</strong>
              {step.description ? <small>{step.description}</small> : null}
            </span>
            {step.requiresConfirmation ? (
              <span className={styles.confirmationMarker} title="Necesită confirmare">
                <ShieldCheck size={15} aria-hidden="true" />
                <span className={styles.visuallyHidden}>Necesită confirmare</span>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
