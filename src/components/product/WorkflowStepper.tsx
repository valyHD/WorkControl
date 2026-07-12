import { Check } from "lucide-react";

export type WorkflowStep = {
  id: string;
  label: string;
  description?: string;
};

export default function WorkflowStepper({ steps, activeStep }: { steps: WorkflowStep[]; activeStep: number }) {
  return (
    <ol className="wc-workflow-stepper" aria-label="Progres workflow" data-assistant-section="workflow-progress">
      {steps.map((step, index) => {
        const state = index < activeStep ? "complete" : index === activeStep ? "active" : "pending";
        return (
          <li key={step.id} className={`wc-workflow-step wc-workflow-step--${state}`} aria-current={state === "active" ? "step" : undefined}>
            <span className="wc-workflow-step__number">{state === "complete" ? <Check size={15} /> : index + 1}</span>
            <span className="wc-workflow-step__copy">
              <strong>{step.label}</strong>
              {step.description ? <small>{step.description}</small> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
