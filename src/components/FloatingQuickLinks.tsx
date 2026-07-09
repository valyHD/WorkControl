import { Link } from "react-router-dom";
import { CarFront, Clock3 } from "lucide-react";

export function FloatingQuickLinks() {
  return (
    <nav className="floating-quick-links" aria-label="Scurtaturi rapide">
      <Link className="floating-quick-links__button" to="/my-vehicle" title="Masina mea" aria-label="Masina mea">
        <CarFront size={20} />
      </Link>
      <Link className="floating-quick-links__button" to="/my-timesheets" title="Pontajul meu" aria-label="Pontajul meu">
        <Clock3 size={20} />
      </Link>
    </nav>
  );
}
