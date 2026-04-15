import { Gauge, LogIn, LogOut, PauseCircle, PlayCircle, Route } from "lucide-react";
import type { VehicleGeoEvent } from "../../../types/vehicle";

type Props = {
  items: VehicleGeoEvent[];
};

function formatDate(ts: number) {
  return new Date(ts).toLocaleString("ro-RO");
}

function eventIcon(type: VehicleGeoEvent["type"]) {
  if (type === "ignition_on") return <LogIn size={15} />;
  if (type === "ignition_off") return <LogOut size={15} />;
  if (type === "stop") return <PauseCircle size={15} />;
  if (type === "overspeed") return <Gauge size={15} />;
  if (type === "moving") return <PlayCircle size={15} />;
  return <Route size={15} />;
}

export default function VehicleTripTimeline({ items }: Props) {
  return (
    <div className="panel vehicle-timeline-card">
      <h4 className="panel-title">Trip timeline</h4>
      {!items.length ? (
        <p className="tools-subtitle">Nu exista evenimente derivate pentru intervalul selectat.</p>
      ) : (
        <div className="vehicle-timeline-list">
          {items.map((item) => (
            <div key={item.id} className={`vehicle-timeline-item type-${item.type}`}>
              <span className="vehicle-timeline-item__icon">{eventIcon(item.type)}</span>
              <div>
                <div className="vehicle-timeline-item__title">{item.label}</div>
                <div className="vehicle-timeline-item__meta">{formatDate(item.timestamp)}</div>
              </div>
              <span className="vehicle-gps-chip">{item.type.replace("_", " ")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
