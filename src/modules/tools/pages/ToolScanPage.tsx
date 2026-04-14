import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ToolQrScanner from "../components/ToolQrScanner";
import { findToolByQrCode } from "../services/toolsService";

export default function ToolScanPage() {
  const [manualValue, setManualValue] = useState("");
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();

  async function goToToolByQr(value: string) {
    const clean = value.trim();
    if (!clean) return;

    setSearching(true);
    setMessage("");

    try {
      const tool = await findToolByQrCode(clean);

      if (!tool) {
        setMessage("Nu am gasit nicio scula pentru acest cod QR.");
        return;
      }

      navigate(`/tools/${tool.id}`);
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="page-section">
      <div className="panel">
        <h2 className="panel-title">Scaneaza codul QR</h2>
        <p className="tools-subtitle">
          Poti folosi camera telefonului sau poti introduce manual valoarea codului.
        </p>

        <div className="tool-scan-grid">
          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Scanner camera</h3>
            <ToolQrScanner onDetected={(value) => void goToToolByQr(value)} />
          </div>

          <div className="panel tool-inner-panel">
            <h3 className="panel-title">Introducere manuala</h3>

            <input
              className="tool-input"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="Ex: A91K-77PL-0021"
            />

            <div className="tool-form-actions">
              <button
                className="primary-btn"
                type="button"
                onClick={() => void goToToolByQr(manualValue)}
                disabled={searching}
              >
                {searching ? "Se cauta..." : "Cauta scula"}
              </button>
            </div>

            {message && <div className="tool-message">{message}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}