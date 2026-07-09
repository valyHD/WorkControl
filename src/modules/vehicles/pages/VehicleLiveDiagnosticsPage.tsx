import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bluetooth,
  CalendarDays,
  CircleGauge,
  Clock3,
  Cpu,
  Fuel,
  Gauge,
  PlugZap,
  Radio,
  Satellite,
  Table2,
  Thermometer,
  Zap,
} from "lucide-react";
import type {
  VehicleDailyDiagnosticEvent,
  VehicleDailyDiagnosticSample,
  VehicleDailyDiagnosticsSummary,
  VehicleItem,
  VehicleLiveDiagnostics,
  VehicleLiveIoGroup,
  VehicleLiveIoItem,
} from "../../../types/vehicle";
import VehicleStatusBadge from "../components/VehicleStatusBadge";
import {
  subscribeVehicleById,
  subscribeVehicleDailyDiagnostics,
  subscribeVehicleDiagnosticHistory,
} from "../services/vehiclesService";

const GROUP_LABELS: Record<VehicleLiveIoGroup, string> = {
  gps: "GPS si miscare",
  obd: "OBD2 motor",
  power: "Alimentare",
  connectivity: "Conectivitate",
  input_output: "Intrari / iesiri",
  bluetooth: "Bluetooth",
  system: "Sistem FMC130",
  unknown: "Alte date raw",
};

const GROUP_ORDER: VehicleLiveIoGroup[] = [
  "obd",
  "gps",
  "power",
  "bluetooth",
  "connectivity",
  "input_output",
  "system",
  "unknown",
];

const LIVE_FRESH_WINDOW_MS = 30_000;
const LIVE_TICK_MS = 1_000;

type MetricCard = {
  label: string;
  value: string;
  hint: string;
  icon?: ReactNode;
  tone?: "normal" | "warning" | "critical";
};

function getLocalDayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function formatDateTime(ts?: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ro-RO");
}

function formatDate(ts?: number, fallback = "-"): string {
  if (!ts) return fallback;
  return new Date(ts).toLocaleDateString("ro-RO");
}

function formatTime(ts?: number): string {
  if (!ts) return "--:--";
  return new Date(ts).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAge(ts?: number): string {
  if (!ts) return "fara date";

  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s in urma`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min in urma`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h in urma`;

  const days = Math.round(hours / 24);
  return `${days} zile in urma`;
}

function formatNumber(value: unknown, digits = 0): string {
  if (value === null || value === undefined || value === "") return "-";

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";

  return numeric.toLocaleString("ro-RO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMetric(value: unknown, unit = "", digits = 0): string {
  const numberText = formatNumber(value, digits);
  if (numberText === "-") return "-";
  return unit ? `${numberText} ${unit}` : numberText;
}

function formatDurationFromSeconds(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function readObdNumber(diagnostics: VehicleLiveDiagnostics | null | undefined, key: string): number | null {
  const value = diagnostics?.obd?.[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isDiagnosticsFresh(
  diagnostics: VehicleLiveDiagnostics | null | undefined,
  nowTs: number
): boolean {
  if (!diagnostics?.serverTimestamp) return false;
  if (diagnostics.expiresAt) return diagnostics.expiresAt >= nowTs;
  return nowTs - diagnostics.serverTimestamp <= LIVE_FRESH_WINDOW_MS;
}

function buildGenericRawIo(rawIo?: Record<string, unknown>): VehicleLiveIoItem[] {
  if (!rawIo) return [];

  return Object.entries(rawIo)
    .map(([id, value]) => {
      const numericId = Number(id);
      const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value ?? "-");

      return {
        id: Number.isFinite(numericId) ? numericId : 0,
        key: `avl_${id}`,
        label: `AVL ${id}`,
        group: "unknown" as const,
        value:
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null
            ? value
            : displayValue,
        rawValue: value,
        displayValue,
      };
    })
    .sort((a, b) => a.id - b.id);
}

function getRawIo(vehicle: VehicleItem | null): Record<string, unknown> {
  return vehicle?.liveDiagnostics?.rawIo ?? vehicle?.gpsSnapshot?.rawIo ?? {};
}

function getDecodedIo(vehicle: VehicleItem | null): VehicleLiveIoItem[] {
  const decoded = vehicle?.liveDiagnostics?.decodedIo ?? [];
  if (decoded.length > 0) return decoded;

  return buildGenericRawIo(getRawIo(vehicle));
}

function getBooleanLabel(value: boolean | null | undefined): string {
  if (value === true) return "Da";
  if (value === false) return "Nu";
  return "-";
}

function filterGroup(items: VehicleLiveIoItem[], group: VehicleLiveIoGroup): VehicleLiveIoItem[] {
  return items.filter((item) => item.group === group);
}

function StatCard({ label, value, hint, icon, tone = "normal" }: MetricCard) {
  return (
    <div className={`vehicle-live-metric vehicle-live-metric--${tone}`}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function DailyEventItem({ event }: { event: VehicleDailyDiagnosticEvent }) {
  return (
    <div className={`vehicle-live-event vehicle-live-event--${event.severity}`}>
      <div className="vehicle-live-event__time">
        <Clock3 size={14} />
        {formatTime(event.timestamp)}
      </div>
      <div className="vehicle-live-event__body">
        <strong>{event.label}</strong>
        <span>
          {event.value !== undefined && event.value !== null && event.value !== ""
            ? `${event.value}${event.unit ? ` ${event.unit}` : ""}`
            : event.details || event.type}
        </span>
        {event.details ? <small>{event.details}</small> : null}
      </div>
    </div>
  );
}

function DailySummaryPanel({
  summary,
  dayKey,
}: {
  summary: VehicleDailyDiagnosticsSummary | null;
  dayKey: string;
}) {
  const stats = summary?.stats ?? {};
  const events = summary?.events ?? [];
  const criticalCount = events.filter((event) => event.severity === "critical").length;
  const warningCount = events.filter((event) => event.severity === "warning").length;

  return (
    <section className="panel vehicle-live-daily">
      <div className="panel-head">
        <h3 className="panel-title">
          <CalendarDays size={16} />
          Rezumat diagnostic azi
        </h3>
        <span className="tools-subtitle">{dayKey}</span>
      </div>

      <div className="vehicle-live-daily__body">
        <div className="vehicle-live-daily__summary">
          <strong>{summary?.summaryText || "Nu exista inca rezumat pentru ziua curenta."}</strong>
          <span>
            {summary?.firstRecordAt ? `${formatTime(summary.firstRecordAt)} - ${formatTime(summary.lastRecordAt)}` : "Astept primul pachet FMC130."}
          </span>
        </div>

        <div className="vehicle-live-daily__stats">
          <StatCard
            label="Pachete azi"
            value={formatNumber(summary?.packetsCount)}
            hint="AVL acceptate"
            icon={<Radio size={13} />}
          />
          <StatCard
            label="Evenimente"
            value={formatNumber(events.length)}
            hint={`${criticalCount} critice, ${warningCount} avertizari`}
            icon={<AlertTriangle size={13} />}
            tone={criticalCount ? "critical" : warningCount ? "warning" : "normal"}
          />
          <StatCard
            label="Viteza maxima"
            value={formatMetric(stats.maxSpeedKmh, "km/h")}
            hint="GPS/OBD"
            icon={<Gauge size={13} />}
          />
          <StatCard
            label="Odometru"
            value={formatMetric(stats.maxTotalOdometerKm, "km", 1)}
            hint="AVL 16"
            icon={<Gauge size={13} />}
          />
          <StatCard
            label="Turatie maxima"
            value={formatMetric(stats.maxEngineRpm, "rpm")}
            hint="OBD"
            icon={<CircleGauge size={13} />}
          />
          <StatCard
            label="Temp. motor max"
            value={formatMetric(stats.maxCoolantTemperatureC, "C")}
            hint="Coolant"
            icon={<Thermometer size={13} />}
          />
          <StatCard
            label="Tensiune minima"
            value={formatMetric(stats.minExternalVoltageV, "V", 2)}
            hint="Alimentare"
            icon={<Zap size={13} />}
          />
        </div>

        {events.length === 0 ? (
          <div className="vehicle-live-empty">Nu sunt evenimente neobisnuite inregistrate azi.</div>
        ) : (
          <div className="vehicle-live-events-list">
            {events.slice(0, 12).map((event) => (
              <DailyEventItem key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

type DiagnosticHistoryRow = {
  dayKey: string;
  event: VehicleDailyDiagnosticEvent;
};

type DiagnosticSampleHistoryRow = {
  dayKey: string;
  sample: VehicleDailyDiagnosticSample;
};

function buildDiagnosticHistoryRows(
  summaries: VehicleDailyDiagnosticsSummary[]
): DiagnosticHistoryRow[] {
  return summaries
    .flatMap((summary) =>
      summary.events.map((event) => ({
        dayKey: summary.dayKey,
        event,
      }))
    )
    .sort((a, b) => b.event.timestamp - a.event.timestamp)
    .slice(0, 120);
}

function DiagnosticEventsHistoryTable({
  summaries,
}: {
  summaries: VehicleDailyDiagnosticsSummary[];
}) {
  const rows = useMemo(() => buildDiagnosticHistoryRows(summaries), [summaries]);

  return (
    <section className="panel vehicle-live-events-history">
      <div className="panel-head">
        <h3 className="panel-title">
          <AlertTriangle size={16} />
          Istoric evenimente neobisnuite
        </h3>
        <span className="tools-subtitle">Ultimele {summaries.length} zile</span>
      </div>

      {rows.length === 0 ? (
        <div className="vehicle-live-empty">Nu exista evenimente neobisnuite salvate in istoric.</div>
      ) : (
        <div className="vehicle-live-table-wrap">
          <table className="vehicle-live-table vehicle-live-events-table">
            <thead>
              <tr>
                <th>Zi</th>
                <th>Ora</th>
                <th>Severitate</th>
                <th>Eveniment</th>
                <th>Valoare</th>
                <th>Detalii</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ dayKey, event }) => (
                <tr key={`${dayKey}-${event.id}`}>
                  <td>{formatDate(event.timestamp, dayKey)}</td>
                  <td>{formatTime(event.timestamp)}</td>
                  <td>
                    <span className={`vehicle-live-severity vehicle-live-severity--${event.severity}`}>
                      {event.severity}
                    </span>
                  </td>
                  <td>
                    <strong>{event.label}</strong>
                    <small>{event.type}</small>
                  </td>
                  <td>
                    {event.value !== undefined && event.value !== null && event.value !== ""
                      ? `${event.value}${event.unit ? ` ${event.unit}` : ""}`
                      : "-"}
                  </td>
                  <td>{event.details || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function buildDiagnosticSampleHistoryRows(
  summaries: VehicleDailyDiagnosticsSummary[]
): DiagnosticSampleHistoryRow[] {
  return summaries
    .flatMap((summary) =>
      (summary.samples ?? []).map((sample) => ({
        dayKey: summary.dayKey,
        sample,
      }))
    )
    .sort((a, b) => b.sample.timestamp - a.sample.timestamp)
    .slice(0, 240);
}

function DiagnosticSamplesHistoryTable({
  summaries,
}: {
  summaries: VehicleDailyDiagnosticsSummary[];
}) {
  const rows = useMemo(() => buildDiagnosticSampleHistoryRows(summaries), [summaries]);

  return (
    <section className="panel vehicle-live-events-history">
      <div className="panel-head">
        <h3 className="panel-title">
          <Table2 size={16} />
          Istoric valori OBD / GPS
        </h3>
        <span className="tools-subtitle">Ultimele {rows.length} esantioane salvate</span>
      </div>

      {rows.length === 0 ? (
        <div className="vehicle-live-empty">
          Nu exista inca esantioane OBD/GPS salvate in istoricul zilnic.
        </div>
      ) : (
        <div className="vehicle-live-table-wrap">
          <table className="vehicle-live-table vehicle-live-events-table">
            <thead>
              <tr>
                <th>Zi</th>
                <th>Ora</th>
                <th>Viteza</th>
                <th>RPM</th>
                <th>Temp. motor</th>
                <th>Combustibil</th>
                <th>Voltaj</th>
                <th>Sarcina</th>
                <th>Acceleratie</th>
                <th>Odometru</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ dayKey, sample }) => (
                <tr key={`${dayKey}-${sample.timestamp}`}>
                  <td>{formatDate(sample.timestamp, dayKey)}</td>
                  <td>{formatTime(sample.timestamp)}</td>
                  <td>{formatMetric(sample.speedKmh, "km/h")}</td>
                  <td>{formatMetric(sample.engineRpm, "rpm")}</td>
                  <td>{formatMetric(sample.coolantTemperatureC, "C")}</td>
                  <td>{formatMetric(sample.fuelLevelPct, "%")}</td>
                  <td>{formatMetric(sample.externalVoltageV, "V", 2)}</td>
                  <td>{formatMetric(sample.engineLoadPct, "%")}</td>
                  <td>{formatMetric(sample.throttlePositionPct, "%")}</td>
                  <td>{formatMetric(sample.totalOdometerKm, "km", 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DiagnosticsTable({
  icon,
  title,
  items,
  emptyText,
}: {
  icon: ReactNode;
  title: string;
  items: VehicleLiveIoItem[];
  emptyText: string;
}) {
  return (
    <section className="panel vehicle-live-panel">
      <div className="panel-head">
        <h3 className="panel-title">
          {icon}
          {title}
        </h3>
        <span className="tools-subtitle">{items.length} valori</span>
      </div>

      {items.length === 0 ? (
        <div className="vehicle-live-empty">{emptyText}</div>
      ) : (
        <div className="vehicle-live-table-wrap">
          <table className="vehicle-live-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nume</th>
                <th>Valoare</th>
                <th>Raw</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.group}-${item.id}-${item.key}`}>
                  <td>{item.id || "-"}</td>
                  <td>
                    <strong>{item.label}</strong>
                    {item.description ? <small>{item.description}</small> : null}
                  </td>
                  <td>{item.displayValue}</td>
                  <td>{String(item.rawValue ?? "-")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function VehicleLiveDiagnosticsPage() {
  const { vehicleId = "" } = useParams();
  const mountedRef = useRef(true);
  const [vehicle, setVehicle] = useState<VehicleItem | null>(null);
  const [dailySummary, setDailySummary] = useState<VehicleDailyDiagnosticsSummary | null>(null);
  const [diagnosticHistory, setDiagnosticHistory] = useState<VehicleDailyDiagnosticsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayKey, setDayKey] = useState(() => getLocalDayKey());
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    mountedRef.current = true;
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
      setDayKey(getLocalDayKey());
    }, LIVE_TICK_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!vehicleId) return;

    setLoading(true);
    const unsubscribe = subscribeVehicleById(vehicleId, (vehicleData) => {
      if (!mountedRef.current) return;
      setVehicle(vehicleData);
      setLoading(false);
    });

    return () => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("[VehicleLiveDiagnosticsPage][unsubscribe]", error);
      }
    };
  }, [vehicleId]);

  useEffect(() => {
    if (!vehicleId || !dayKey) {
      setDailySummary(null);
      return;
    }

    const unsubscribe = subscribeVehicleDailyDiagnostics(vehicleId, dayKey, (summary) => {
      if (!mountedRef.current) return;
      setDailySummary(summary);
    });

    return () => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("[VehicleLiveDiagnosticsPage][unsubscribeDaily]", error);
      }
    };
  }, [dayKey, vehicleId]);

  useEffect(() => {
    if (!vehicleId) {
      setDiagnosticHistory([]);
      return;
    }

    const unsubscribe = subscribeVehicleDiagnosticHistory(vehicleId, (items) => {
      if (!mountedRef.current) return;
      setDiagnosticHistory(items);
    });

    return () => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("[VehicleLiveDiagnosticsPage][unsubscribeHistory]", error);
      }
    };
  }, [vehicleId]);

  const diagnostics = vehicle?.liveDiagnostics ?? null;
  const liveFresh = isDiagnosticsFresh(diagnostics, nowTick);
  const liveDiagnostics = liveFresh ? diagnostics : null;
  const liveGpsSnapshot = liveFresh ? vehicle?.gpsSnapshot : null;
  const liveVehicle = liveFresh ? vehicle : null;
  const decodedIo = useMemo(() => getDecodedIo(liveVehicle), [liveVehicle]);
  const rawIo = useMemo(() => getRawIo(liveVehicle), [liveVehicle]);
  const groupedItems = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      items: filterGroup(decodedIo, group),
    })).filter((entry) => entry.items.length > 0 || entry.group === "obd" || entry.group === "gps");
  }, [decodedIo]);

  const metrics = useMemo<MetricCard[]>(() => {
    const totalOdometer = readObdNumber(liveDiagnostics, "totalOdometerKm") ?? liveGpsSnapshot?.odometerKm ?? null;
    const tripOdometer = readObdNumber(liveDiagnostics, "tripOdometerKm") ?? liveGpsSnapshot?.tripOdometerKm ?? null;
    const rpm = readObdNumber(liveDiagnostics, "engineRpm");
    const obdSpeed = readObdNumber(liveDiagnostics, "vehicleSpeedKmh");
    const coolant = readObdNumber(liveDiagnostics, "coolantTemperatureC");
    const oil = readObdNumber(liveDiagnostics, "engineOilTemperatureC");
    const intakeTemp = readObdNumber(liveDiagnostics, "intakeAirTemperatureC");
    const fuelLevel = readObdNumber(liveDiagnostics, "fuelLevelPct");
    const externalVoltage = readObdNumber(liveDiagnostics, "externalVoltageV");
    const batteryVoltage = readObdNumber(liveDiagnostics, "batteryVoltageV");
    const batteryCurrent = readObdNumber(liveDiagnostics, "batteryCurrentA");
    const moduleVoltage = readObdNumber(liveDiagnostics, "controlModuleVoltageV");
    const fuelRate = readObdNumber(liveDiagnostics, "fuelRateLh");
    const fuelRateGps = readObdNumber(liveDiagnostics, "fuelRateGpsL100Km");
    const fuelUsedGps = readObdNumber(liveDiagnostics, "fuelUsedGpsL");
    const engineLoad = readObdNumber(liveDiagnostics, "engineLoadPct");
    const throttle = readObdNumber(liveDiagnostics, "throttlePositionPct");
    const fuelPressure = readObdNumber(liveDiagnostics, "fuelPressureKpa");
    const intakeMap = readObdNumber(liveDiagnostics, "intakeMapKpa");
    const maf = readObdNumber(liveDiagnostics, "mafGps");
    const runtime = readObdNumber(liveDiagnostics, "engineRuntimeSec");
    const dtcCount = readObdNumber(liveDiagnostics, "dtcCount");
    const ambient = readObdNumber(liveDiagnostics, "ambientAirTemperatureC");
    const barometric = readObdNumber(liveDiagnostics, "barometricPressureKpa");
    const distanceMil = readObdNumber(liveDiagnostics, "distanceMilOnKm");
    const gsmSignal = readObdNumber(liveDiagnostics, "gsmSignal");
    const gnssHdop = readObdNumber(liveDiagnostics, "gnssHdop");
    const gnssPdop = readObdNumber(liveDiagnostics, "gnssPdop");

    return [
      {
        label: "Odometru total",
        value: formatMetric(totalOdometer, "km", 1),
        hint: "AVL 16 - sursa OBD in FMC",
        icon: <Gauge size={13} />,
      },
      {
        label: "Odometer trip",
        value: formatMetric(tripOdometer, "km", 1),
        hint: "Trip Odometer",
        icon: <Gauge size={13} />,
      },
      {
        label: "Viteza",
        value: formatMetric(obdSpeed ?? liveDiagnostics?.gps?.speedKmh ?? liveGpsSnapshot?.speedKmh, "km/h"),
        hint: obdSpeed !== null ? "OBD2" : "GPS",
        icon: <Gauge size={13} />,
      },
      {
        label: "Turatie",
        value: formatMetric(rpm, "rpm"),
        hint: "Engine RPM",
        icon: <CircleGauge size={13} />,
        tone: rpm !== null && rpm >= 4000 ? "warning" : "normal",
      },
      {
        label: "Temperatura motor",
        value: formatMetric(coolant, "C"),
        hint: "Coolant",
        icon: <Thermometer size={13} />,
        tone: coolant !== null && coolant >= 105 ? "warning" : "normal",
      },
      {
        label: "Temperatura ulei",
        value: formatMetric(oil, "C"),
        hint: "Engine oil",
        icon: <Thermometer size={13} />,
      },
      {
        label: "Combustibil",
        value: formatMetric(fuelLevel, "%"),
        hint: "Nivel rezervor",
        icon: <Fuel size={13} />,
        tone: fuelLevel !== null && fuelLevel <= 10 ? "warning" : "normal",
      },
      {
        label: "Alimentare",
        value: formatMetric(externalVoltage, "V", 2),
        hint: "Tensiune externa",
        icon: <Zap size={13} />,
        tone: externalVoltage !== null && externalVoltage < 11.5 ? "warning" : "normal",
      },
      {
        label: "Baterie FMC",
        value: formatMetric(batteryVoltage, "V", 2),
        hint: "Battery voltage",
        icon: <Zap size={13} />,
      },
      {
        label: "Curent baterie",
        value: formatMetric(batteryCurrent, "A", 3),
        hint: "Battery current",
        icon: <Zap size={13} />,
      },
      {
        label: "Tensiune ECU",
        value: formatMetric(moduleVoltage, "V", 2),
        hint: "Control module",
        icon: <PlugZap size={13} />,
      },
      {
        label: "Consum instant",
        value: formatMetric(fuelRate, "L/h", 2),
        hint: "Fuel rate",
        icon: <Fuel size={13} />,
      },
      {
        label: "Consum GPS",
        value: formatMetric(fuelRateGps, "L/100km", 2),
        hint: "Fuel rate GPS",
        icon: <Fuel size={13} />,
      },
      {
        label: "Combustibil folosit",
        value: formatMetric(fuelUsedGps, "L", 2),
        hint: "Fuel used GPS",
        icon: <Fuel size={13} />,
      },
      {
        label: "Sarcina motor",
        value: formatMetric(engineLoad, "%"),
        hint: "Engine load",
        icon: <Activity size={13} />,
      },
      {
        label: "Acceleratie",
        value: formatMetric(throttle, "%"),
        hint: "Throttle",
        icon: <Activity size={13} />,
      },
      {
        label: "Presiune combustibil",
        value: formatMetric(fuelPressure, "kPa"),
        hint: "Fuel pressure",
        icon: <Gauge size={13} />,
      },
      {
        label: "MAP admisie",
        value: formatMetric(intakeMap, "kPa"),
        hint: "Intake MAP",
        icon: <Gauge size={13} />,
      },
      {
        label: "Debit aer MAF",
        value: formatMetric(maf, "g/sec", 2),
        hint: "Air flow",
        icon: <Activity size={13} />,
      },
      {
        label: "Temp. admisie",
        value: formatMetric(intakeTemp, "C"),
        hint: "Intake air",
        icon: <Thermometer size={13} />,
      },
      {
        label: "Temp. exterioara",
        value: formatMetric(ambient, "C"),
        hint: "Ambient",
        icon: <Thermometer size={13} />,
      },
      {
        label: "Pres. barometrica",
        value: formatMetric(barometric, "kPa"),
        hint: "Barometric",
        icon: <Gauge size={13} />,
      },
      {
        label: "Motor pornit",
        value: formatDurationFromSeconds(runtime),
        hint: "Runtime",
        icon: <Clock3 size={13} />,
      },
      {
        label: "DTC",
        value: formatNumber(dtcCount),
        hint: "Coduri defecte",
        icon: <AlertTriangle size={13} />,
        tone: dtcCount !== null && dtcCount > 0 ? "warning" : "normal",
      },
      {
        label: "Km cu MIL",
        value: formatMetric(distanceMil, "km"),
        hint: "Check engine",
        icon: <AlertTriangle size={13} />,
      },
      {
        label: "Semnal GSM",
        value: formatMetric(gsmSignal, "/5"),
        hint: "Conectivitate",
        icon: <Radio size={13} />,
      },
      {
        label: "GNSS HDOP",
        value: formatNumber(gnssHdop, 1),
        hint: "Precizie orizontala",
        icon: <Satellite size={13} />,
      },
      {
        label: "GNSS PDOP",
        value: formatNumber(gnssPdop, 1),
        hint: "Precizie pozitie",
        icon: <Satellite size={13} />,
      },
    ];
  }, [liveDiagnostics, liveGpsSnapshot?.odometerKm, liveGpsSnapshot?.speedKmh, liveGpsSnapshot?.tripOdometerKm]);

  if (loading) {
    return (
      <section className="page-section">
        <div className="panel">
          <h2 className="panel-title">Se incarca datele live...</h2>
        </div>
      </section>
    );
  }

  if (!vehicle) {
    return (
      <div className="placeholder-page">
        <h2>Masina nu a fost gasita</h2>
        <Link to="/vehicles" className="secondary-btn" style={{ marginTop: 16, display: "inline-flex" }}>
          <ArrowLeft size={15} /> Inapoi la masini
        </Link>
      </div>
    );
  }

  const lastSeenAt = diagnostics?.serverTimestamp || vehicle.tracker?.lastSeenAt || vehicle.gpsSnapshot?.serverTimestamp;
  const liveStatusText = !diagnostics
    ? "Fara pachet live"
    : liveFresh
      ? "Live sub 30s"
      : "Date live expirate";
  const hasRawIo = Object.keys(rawIo).length > 0;
  const allItems = decodedIo.length > 0 ? decodedIo : buildGenericRawIo(rawIo);

  return (
    <section className="page-section vehicle-live-page">
      <div className="panel vehicle-live-hero">
        <div className="vehicle-live-hero__main">
          <div className="vehicle-live-title-line">
            <Activity size={20} />
            <div>
              <h2 className="panel-title">Detalii live functionare masina</h2>
              <p className="tools-subtitle">
                {vehicle.plateNumber} - {vehicle.brand} {vehicle.model}
              </p>
            </div>
          </div>

          <div className="vehicle-live-status-row">
            <VehicleStatusBadge status={vehicle.status} />
            <span className={`vehicle-live-chip ${liveFresh ? "vehicle-live-chip--ok" : ""}`}>
              <Radio size={13} />
              {liveStatusText}
            </span>
            <span className="vehicle-live-chip">
              <Bluetooth size={13} />
              OBD2: {liveFresh ? getBooleanLabel(liveDiagnostics?.obdConnected) : "expirat"}
            </span>
            <span className="vehicle-live-chip">
              Ultimul pachet: {formatAge(lastSeenAt)}
            </span>
          </div>
        </div>

        <div className="vehicle-live-hero__actions">
          <Link to={`/vehicles/${vehicle.id}`} className="secondary-btn">
            <ArrowLeft size={14} /> Inapoi
          </Link>
        </div>
      </div>

      {!liveFresh ? (
        <div className="vehicle-live-stale-note">
          <AlertTriangle size={15} />
          Datele live raman afisate intre pachete si expira dupa 30 secunde fara pachet nou. Verifica FMC130 si conexiunea OBD2 Bluetooth daca nu se actualizeaza.
        </div>
      ) : null}

      <div className="vehicle-live-metrics-grid">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <DailySummaryPanel summary={dailySummary} dayKey={dayKey} />

      <div className="panel vehicle-live-summary">
        <div className="panel-head">
          <h3 className="panel-title">
            <Satellite size={16} />
            Snapshot FMC130
          </h3>
          <span className="tools-subtitle">{diagnostics?.imei || vehicle.tracker?.imei || "IMEI lipsa"}</span>
        </div>

        <div className="vehicle-info-grid">
          <div className="vehicle-info-item">
            <span>GPS timestamp</span>
            <strong>{formatDateTime(liveDiagnostics?.recordTimestamp ?? liveGpsSnapshot?.gpsTimestamp)}</strong>
          </div>
          <div className="vehicle-info-item">
            <span>Server timestamp</span>
            <strong>{formatDateTime(liveDiagnostics?.serverTimestamp ?? liveGpsSnapshot?.serverTimestamp)}</strong>
          </div>
          <div className="vehicle-info-item">
            <span>Coordonate</span>
            <strong>
              {formatNumber(liveDiagnostics?.gps?.lat ?? liveGpsSnapshot?.lat, 6)},{" "}
              {formatNumber(liveDiagnostics?.gps?.lng ?? liveGpsSnapshot?.lng, 6)}
            </strong>
          </div>
          <div className="vehicle-info-item">
            <span>Sateliti / altitudine</span>
            <strong>
              {formatNumber(liveDiagnostics?.gps?.satellites ?? liveGpsSnapshot?.satellites)} /{" "}
              {formatMetric(liveDiagnostics?.gps?.altitude ?? liveGpsSnapshot?.altitude, "m")}
            </strong>
          </div>
          <div className="vehicle-info-item">
            <span>Event IO / Total IO</span>
            <strong>{formatNumber(liveDiagnostics?.eventIoId)} / {formatNumber(liveDiagnostics?.totalIo)}</strong>
          </div>
          <div className="vehicle-info-item">
            <span>Protocol</span>
            <strong>{liveDiagnostics?.protocol || vehicle.tracker?.protocol || "-"}</strong>
          </div>
        </div>
      </div>

      {groupedItems.map((entry) => (
        <DiagnosticsTable
          key={entry.group}
          icon={
            entry.group === "obd" ? (
              <CircleGauge size={16} />
            ) : entry.group === "gps" ? (
              <Satellite size={16} />
            ) : entry.group === "power" ? (
              <PlugZap size={16} />
            ) : entry.group === "bluetooth" ? (
              <Bluetooth size={16} />
            ) : entry.group === "connectivity" ? (
              <Radio size={16} />
            ) : entry.group === "system" ? (
              <Cpu size={16} />
            ) : (
              <Gauge size={16} />
            )
          }
          title={GROUP_LABELS[entry.group]}
          items={entry.items}
          emptyText={
            entry.group === "obd"
              ? "Nu au venit inca valori OBD2 de la adaptor."
              : "Nu exista valori in acest grup."
          }
        />
      ))}

      <DiagnosticsTable
        icon={<Table2 size={16} />}
        title="Toate valorile AVL raw"
        items={allItems}
        emptyText={hasRawIo ? "Date raw indisponibile pentru afisare." : "Nu a venit inca niciun pachet IO."}
      />

      <DiagnosticEventsHistoryTable summaries={diagnosticHistory} />
      <DiagnosticSamplesHistoryTable summaries={diagnosticHistory} />
    </section>
  );
}
