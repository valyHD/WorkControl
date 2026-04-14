import { useEffect, useMemo } from "react";
import { Html5Qrcode } from "html5-qrcode";

type Props = {
  onDetected: (value: string) => void;
  scannerId?: string;
};

export default function ToolQrScanner({ onDetected, scannerId }: Props) {
  const elementId = useMemo(
    () => scannerId ?? `tool-qr-reader-${Math.random().toString(36).slice(2)}`,
    [scannerId]
  );

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(elementId);
    let cancelled = false;

    async function start() {
      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 220 },
          (decodedText) => {
            if (cancelled) return;
            onDetected(decodedText);
            html5QrCode.stop().catch(() => undefined);
          },
          () => undefined
        );
      } catch (error) {
        console.error("Nu s-a putut porni scannerul QR:", error);
      }
    }

    void start();

    return () => {
      cancelled = true;
      html5QrCode
        .stop()
        .catch(() => undefined)
        .finally(() => {
          try {
            html5QrCode.clear();
          } catch {
            // ignoram erorile de cleanup
          }
        });
    };
  }, [elementId, onDetected]);

  return <div id={elementId} className="tool-qr-scanner" />;
}