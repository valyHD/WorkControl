import { useId } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { AssistantChoice } from "./types";
import styles from "./assistantUi.module.css";

export type ChoiceCardProps<TId extends string = string> = {
  title?: string;
  description?: string;
  choices: readonly AssistantChoice<TId>[];
  selectedId?: TId;
  onSelect: (choice: AssistantChoice<TId>) => void;
};

export function ChoiceCard<TId extends string = string>({
  title = "Alege o variantă",
  description,
  choices,
  selectedId,
  onSelect,
}: ChoiceCardProps<TId>) {
  const titleId = useId();
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.cardHeader}>
        <div>
          <h3 id={titleId}>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <div className={styles.choiceList} role="radiogroup" aria-label={title}>
        {choices.map((choice, index) => {
          const selected = selectedId === choice.id;
          return (
            <button
              className={styles.choiceButton}
              data-selected={selected || undefined}
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={choice.disabled}
              onClick={() => onSelect(choice)}
            >
              <span className={styles.choiceIndex} aria-hidden="true">
                {selected ? <Check size={15} /> : index + 1}
              </span>
              <span className={styles.choiceCopy}>
                <strong>{choice.label}</strong>
                {choice.description ? <small>{choice.description}</small> : null}
              </span>
              {choice.meta ? <span className={styles.choiceMeta}>{choice.meta}</span> : null}
              <ChevronRight size={17} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
