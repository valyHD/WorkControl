import { useState } from "react";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import {
  deleteSavedView,
  readSavedViews,
  saveView,
  type SavedView,
} from "../../lib/productIntelligence/savedViews";

export default function SavedViewsBar<T>({
  namespace,
  userId,
  value,
  onApply,
}: {
  namespace: string;
  userId: string;
  value: T;
  onApply: (value: T) => void;
}) {
  const [views, setViews] = useState<SavedView<T>[]>(() => readSavedViews(namespace, userId));

  const add = () => {
    const name = window.prompt("Nume pentru vederea salvata:");
    if (!name) return;
    setViews(saveView(namespace, userId, name, value));
  };

  return (
    <div className="wc-saved-views" aria-label="Filtre salvate">
      <span className="wc-saved-views__label"><Bookmark size={15} /> Vederi</span>
      <div className="wc-saved-views__items">
        {views.map((view) => (
          <span className="wc-saved-view" key={view.id}>
            <button type="button" onClick={() => onApply(view.value)}>{view.name}</button>
            <button
              type="button"
              aria-label={`Sterge vederea ${view.name}`}
              title="Sterge vederea"
              onClick={() => setViews(deleteSavedView<T>(namespace, userId, view.id))}
            >
              <Trash2 size={13} />
            </button>
          </span>
        ))}
      </div>
      <button className="secondary-btn secondary-btn--compact" type="button" onClick={add}>
        <Plus size={14} /> Salveaza vederea
      </button>
    </div>
  );
}
