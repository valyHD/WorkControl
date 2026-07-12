import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function ConnectivityBanner() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (online) return null;
  return (
    <div className="wc-connectivity-banner" role="status" aria-live="polite">
      <WifiOff size={17} />
      <span>Esti offline. Datele deja incarcate raman vizibile pana revine conexiunea.</span>
    </div>
  );
}
