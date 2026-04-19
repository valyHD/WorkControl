import {
  Gauge,
  LogIn,
  LogOut,
  PauseCircle,
  PlayCircle,
  Route,
  Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { VehicleGeoEvent } from "../../../types/vehicle";

type Props = { items: VehicleGeoEvent[] };

function formatDate(ts: number) {
  if (!ts || !Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleString("ro-RO");
}

type EventConfigItem = {
  Icon: LucideIcon;
  colorClass: string;
  chipLabel: string;
};

const EVENT_CONFIG: Partial<Record<VehicleGeoEvent["type"], EventConfigItem>> = {
  ignition_on: {
    Icon: LogIn,
    colorClass: "timeline-dot--green",
    chipLabel: "Contact ON",
  },
  ignition_off: {
    Icon: LogOut,
    colorClass: "timeline-dot--red",
    chipLabel: "Contact OFF",
  },
  stop: {
    Icon: PauseCircle,
    colorClass: "timeline-dot--orange",
    chipLabel: "Oprire",
  },
  overspeed: {
    Icon: Gauge,
    colorClass: "timeline-dot--danger",
    chipLabel: "Viteza",
  },
  moving: {
    Icon: PlayCircle,
    colorClass: "timeline-dot--blue",
    chipLabel: "Miscare",
  },
  geo_fence_in: {
    Icon: Route,
    colorClass: "timeline-dot--purple",
    chipLabel: "Geo IN",
  },
  geo_fence_out: {
    Icon: Route,
    colorClass: "timeline-dot--purple",
    chipLabel: "Geo OUT",
  },
  tracker_event: {
    Icon: Activity,
    colorClass: "timeline-dot--muted",
    chipLabel: "Tracker",
  },
};

function getConfig(type: VehicleGeoEvent["type"]): EventConfigItem {
  return (
    EVENT_CONFIG[type] ?? {
      Icon: Activity,
      colorClass: "timeline-dot--muted",
      chipLabel: String(type),
    }
  );
}

export default function VehicleTripTimeline({ items }: Props) {
  if (!Array.isArray(items)) return null;

  return (
    <div className="panel vehicle-timeline-card">
      <h4 className="panel-title">Trip timeline</h4>

      {items.length === 0 ? (
        <div className="empty-state" style={{ padding: "24px 16px" }}>
          <div className="empty-state-icon" style={{ width: 40, height: 40 }}>
            <Activity size={18} strokeWidth={1.7} />
          </div>
          <div className="empty-state-title" style={{ fontSize: 13 }}>
            Nu exista evenimente pentru intervalul selectat
          </div>
        </div>
      ) : (
        <div className="vehicle-timeline-list">
          {items.map((item, idx) => {
            const { Icon, colorClass, chipLabel } = getConfig(item.type);
            const isLast = idx === items.length - 1;

            const speedKmh =
              typeof item.metadata?.speedKmh === "number"
                ? item.metadata.speedKmh
                : null;

            const durationMs =
              typeof item.metadata?.durationMs === "number"
                ? item.metadata.durationMs
                : null;

            return (
              <div
                key={item.id}
                className="vehicle-timeline-item"
                style={{ paddingBottom: isLast ? 0 : undefined }}
              >
                <div className="vehicle-timeline-item__track">
                  <span className={`vehicle-timeline-dot ${colorClass}`}>
                    <Icon size={12} strokeWidth={2.2} />
                  </span>
                  {!isLast && <span className="vehicle-timeline-line" />}
                </div>

                <div className="vehicle-timeline-item__body">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span className="vehicle-timeline-item__title">
                      {item.label}
                    </span>
                    <span className={`vehicle-timeline-chip type-${item.type}`}>
                      {chipLabel}
                    </span>
                  </div>

                  <div className="vehicle-timeline-item__meta">
                    {formatDate(item.timestamp)}
                  </div>

                  {(speedKmh !== null || durationMs !== null) && (
                    <div
                      className="vehicle-timeline-item__meta"
                      style={{ marginTop: 2 }}
                    >
                      {speedKmh !== null && <span>{speedKmh} km/h</span>}
                      {durationMs !== null && (
                        <span>
                          {speedKmh !== null ? " · " : ""}
                          {Math.round(durationMs / 60000)} min
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}