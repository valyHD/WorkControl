import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Mail, Save, X } from "lucide-react";
import type { MaintenancePartOrder } from "../../../types/maintenance";
import {
  calculateClientOfferTotal,
  calculateSupplierOfferTotal,
} from "../utils/partOrdersDomain";

type SupplierQuoteValues = {
  supplierOfferAmount: number;
  lineSupplierPrices: Record<string, number>;
};

type ClientOfferValues = {
  clientEmail: string;
  clientOfferAmount: number;
  clientOfferNotes: string;
  lineClientPrices: Record<string, number>;
};

type DialogShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  onClose: () => void;
};

function DialogShell({ title, subtitle, children, onClose }: DialogShellProps) {
  return (
    <div className="maintenance-offer-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="maintenance-offer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="maintenance-offer-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="maintenance-offer-dialog__header">
          <div>
            <h2 id="maintenance-offer-dialog-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Inchide formularul">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function SupplierQuoteDialog({
  order,
  saving,
  onClose,
  onSave,
}: {
  order: MaintenancePartOrder;
  saving: boolean;
  onClose: () => void;
  onSave: (values: SupplierQuoteValues) => Promise<void>;
}) {
  const [linePrices, setLinePrices] = useState<Record<string, number>>({});
  const [generalTotal, setGeneralTotal] = useState(0);

  useEffect(() => {
    const nextPrices = Object.fromEntries(
      order.lines.map((line) => [line.id, line.supplierOfferUnitPrice || line.estimatedPrice || 0])
    );
    setLinePrices(nextPrices);
    setGeneralTotal(order.supplierOfferAmount || calculateSupplierOfferTotal(order.lines));
  }, [order]);

  const calculatedTotal = useMemo(
    () =>
      order.lines.reduce(
        (sum, line) => sum + Number(line.quantity || 0) * Number(linePrices[line.id] || 0),
        0
      ),
    [linePrices, order.lines]
  );

  return (
    <DialogShell
      title="Oferta primita de la furnizor"
      subtitle={`${order.clientName || "Client"} · lift ${order.liftSerialNumber || "-"}`}
      onClose={onClose}
    >
      <div className="maintenance-offer-dialog__body">
        <div className="maintenance-offer-dialog__lines">
          {order.lines.map((line) => (
            <label key={line.id} className="maintenance-offer-line">
              <span>
                <strong>{line.name}</strong>
                <small>{line.quantity} {line.unit || "buc"}</small>
              </span>
              <span className="maintenance-offer-line__price">
                <input
                  className="tool-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={linePrices[line.id] ?? 0}
                  onChange={(event) =>
                    setLinePrices((current) => ({ ...current, [line.id]: Number(event.target.value || 0) }))
                  }
                  aria-label={`Pret furnizor pentru ${line.name}`}
                />
                <span>RON / {line.unit || "buc"}</span>
              </span>
            </label>
          ))}
        </div>

        <label className="tool-form-block">
          <span className="tool-form-label">Total general furnizor</span>
          <input
            className="tool-input"
            type="number"
            min="0"
            step="0.01"
            value={generalTotal}
            onChange={(event) => setGeneralTotal(Number(event.target.value || 0))}
          />
          <small>Total calculat din piese: {calculatedTotal.toFixed(2)} RON</small>
        </label>
      </div>
      <footer className="maintenance-offer-dialog__actions">
        <button className="secondary-btn" type="button" onClick={onClose} disabled={saving}>Anuleaza</button>
        <button
          className="primary-btn"
          type="button"
          disabled={saving}
          onClick={() => void onSave({ supplierOfferAmount: generalTotal || calculatedTotal, lineSupplierPrices: linePrices })}
        >
          <Save size={16} />
          {saving ? "Se salveaza..." : "Salveaza oferta"}
        </button>
      </footer>
    </DialogShell>
  );
}

export function ClientOfferDialog({
  order,
  saving,
  onClose,
  onSave,
}: {
  order: MaintenancePartOrder;
  saving: boolean;
  onClose: () => void;
  onSave: (values: ClientOfferValues, sendEmail: boolean) => Promise<void>;
}) {
  const [clientEmail, setClientEmail] = useState(order.clientEmail);
  const [notes, setNotes] = useState(order.clientOfferNotes);
  const [linePrices, setLinePrices] = useState<Record<string, number>>({});

  useEffect(() => {
    setClientEmail(order.clientEmail);
    setNotes(order.clientOfferNotes);
    setLinePrices(
      Object.fromEntries(order.lines.map((line) => [line.id, line.clientOfferUnitPrice || 0]))
    );
  }, [order]);

  const total = useMemo(() => {
    const lines = order.lines.map((line) => ({ ...line, clientOfferUnitPrice: linePrices[line.id] || 0 }));
    return calculateClientOfferTotal(lines);
  }, [linePrices, order.lines]);

  const values: ClientOfferValues = {
    clientEmail,
    clientOfferAmount: total,
    clientOfferNotes: notes,
    lineClientPrices: linePrices,
  };

  return (
    <DialogShell
      title="Oferta separata pentru client"
      subtitle="Preturile clientului nu modifica oferta primita de la furnizor."
      onClose={onClose}
    >
      <div className="maintenance-offer-dialog__body">
        <label className="tool-form-block">
          <span className="tool-form-label">Email client</span>
          <input
            className="tool-input"
            type="email"
            value={clientEmail}
            onChange={(event) => setClientEmail(event.target.value)}
            placeholder="client@firma.ro"
          />
        </label>

        <div className="maintenance-offer-dialog__lines">
          {order.lines.map((line) => (
            <label key={line.id} className="maintenance-offer-line">
              <span>
                <strong>{line.name}</strong>
                <small>{line.quantity} {line.unit || "buc"}</small>
              </span>
              <span className="maintenance-offer-line__price">
                <input
                  className="tool-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={linePrices[line.id] ?? 0}
                  onChange={(event) =>
                    setLinePrices((current) => ({ ...current, [line.id]: Number(event.target.value || 0) }))
                  }
                  aria-label={`Pret client pentru ${line.name}`}
                />
                <span>RON / {line.unit || "buc"}</span>
              </span>
            </label>
          ))}
        </div>

        <label className="tool-form-block">
          <span className="tool-form-label">Observatii pentru client</span>
          <textarea className="tool-textarea" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="maintenance-offer-dialog__total">Total oferta client: {total.toFixed(2)} RON</div>
      </div>
      <footer className="maintenance-offer-dialog__actions">
        <button className="secondary-btn" type="button" onClick={onClose} disabled={saving}>Anuleaza</button>
        <button className="secondary-btn" type="button" disabled={saving} onClick={() => void onSave(values, false)}>
          <Save size={16} /> Salveaza
        </button>
        <button className="primary-btn" type="button" disabled={saving || !clientEmail.trim()} onClick={() => void onSave(values, true)}>
          <Mail size={16} /> {saving ? "Se trimite..." : "Salveaza si trimite"}
        </button>
      </footer>
    </DialogShell>
  );
}
