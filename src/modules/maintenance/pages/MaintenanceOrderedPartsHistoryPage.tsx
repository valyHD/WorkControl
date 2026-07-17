import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, History, Search } from "lucide-react";
import { Link } from "react-router-dom";
import type { MaintenancePartOrder } from "../../../types/maintenance";
import { subscribeMaintenancePartOrders } from "../services/partOrdersService";
import { buildOrderedPartHistory } from "../utils/partOrdersDomain";

function formatDate(value: number) {
  return new Date(value).toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export default function MaintenanceOrderedPartsHistoryPage() {
  const [orders, setOrders] = useState<MaintenancePartOrder[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => subscribeMaintenancePartOrders(
    (items) => {
      setOrders(items);
      setLoading(false);
    },
    (err) => {
      console.error("[MaintenanceOrderedPartsHistoryPage]", err);
      setError("Nu am putut incarca istoricul pieselor comandate.");
      setLoading(false);
    }
  ), []);

  const history = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ro");
    return buildOrderedPartHistory(orders).filter((item) => {
      if (!needle) return true;
      return [
        item.line.name,
        item.line.code,
        item.line.supplier,
        item.clientName,
        item.liftSerialNumber,
        item.orderTitle,
      ].join(" ").toLocaleLowerCase("ro").includes(needle);
    });
  }, [orders, search]);

  return (
    <section className="page-section maintenance-ordered-history-page">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h1 className="panel-title"><History size={20} /> Piese comandate</h1>
            <p className="panel-subtitle">
              Istoric permanent pentru comenzile ajunse cel putin in statusul Comandata.
            </p>
          </div>
          <Link className="secondary-btn" to="/maintenance/orders">
            <ArrowLeft size={16} /> Inapoi la comenzi
          </Link>
        </div>
        <div className="maintenance-history-search">
          <Search size={17} aria-hidden="true" />
          <input
            className="tool-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cauta piesa, cod, furnizor, client sau lift"
          />
        </div>
      </div>

      <div className="panel">
        {error ? (
          <div className="tool-message">{error}</div>
        ) : loading ? (
          <p className="tools-subtitle">Se incarca istoricul...</p>
        ) : history.length === 0 ? (
          <p className="tools-subtitle">Nu exista piese comandate pentru cautarea curenta.</p>
        ) : (
          <div className="maintenance-ordered-history-grid">
            {history.map((item) => (
              <article key={item.key} className="maintenance-ordered-history-card">
                <div className="maintenance-ordered-history-card__head">
                  <div>
                    <strong>{item.line.name}</strong>
                    <span>{item.line.code || "Fara cod"}</span>
                  </div>
                  <span className="status-badge status-active">{item.status}</span>
                </div>
                <dl>
                  <div><dt>Cantitate</dt><dd>{item.line.quantity} {item.line.unit || "buc"}</dd></div>
                  <div><dt>Furnizor</dt><dd>{item.line.supplier || "-"}</dd></div>
                  <div><dt>Pret furnizor</dt><dd>{formatMoney(item.line.supplierOfferUnitPrice || item.line.estimatedPrice)}</dd></div>
                  <div><dt>Pret client</dt><dd>{formatMoney(item.line.clientOfferUnitPrice)}</dd></div>
                  <div><dt>Client</dt><dd>{item.clientName || "-"}</dd></div>
                  <div><dt>Lift</dt><dd>{item.liftSerialNumber || "-"}</dd></div>
                </dl>
                <footer>
                  <span>{item.orderTitle || "Comanda piese"}</span>
                  <time dateTime={new Date(item.orderedAt).toISOString()}>{formatDate(item.orderedAt)}</time>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
