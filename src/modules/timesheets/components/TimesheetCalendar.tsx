import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { TimesheetItem } from "../../../types/timesheet";
import { formatMinutes } from "../services/timesheetsService";
import StatusBadge from "../../../components/StatusBadge";
import {
  getEffectiveWorkedMinutes,
  getLocalDateKey,
  getProjectLabel,
  getTimesheetStatusLabel,
  getTimesheetStatusTone,
  isIncompleteTimesheet,
} from "../utils/timesheetAnalytics";

type Props = {
  timesheets: TimesheetItem[];
};

function getMonthDays(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const days: Date[] = [];
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push(new Date(first.getFullYear(), first.getMonth(), day));
  }
  return days;
}

function getDayTone(items: TimesheetItem[], date: Date) {
  const isFuture = date.getTime() > Date.now();
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  if (isFuture || isWeekend) return "muted";
  if (items.some((item) => item.status === "activ")) return "blue";
  if (items.some(isIncompleteTimesheet)) return "orange";
  if (items.length > 0) return "green";
  return "red";
}

function getDayLabel(tone: string) {
  if (tone === "blue") return "Activ";
  if (tone === "green") return "Complet";
  if (tone === "orange") return "Incomplet";
  if (tone === "red") return "Lipsa";
  return "Liber";
}

export default function TimesheetCalendar({ timesheets }: Props) {
  const todayKey = getLocalDateKey();
  const [selectedDay, setSelectedDay] = useState(todayKey);

  const byDay = useMemo(() => {
    const map = new Map<string, TimesheetItem[]>();
    for (const item of timesheets) {
      const list = map.get(item.workDate) ?? [];
      list.push(item);
      map.set(item.workDate, list);
    }
    return map;
  }, [timesheets]);

  const monthDays = useMemo(() => getMonthDays(), []);
  const selectedItems = byDay.get(selectedDay) ?? [];
  const selectedTotalMinutes = selectedItems.reduce((sum, item) => sum + getEffectiveWorkedMinutes(item), 0);

  return (
    <div className="panel timesheet-calendar-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Calendar pontaj</h2>
          <p className="panel-subtitle">Verde complet, portocaliu incomplet, rosu lipsa, albastru activ.</p>
        </div>
        <StatusBadge tone="blue">{new Date().toLocaleDateString("ro-RO", { month: "long", year: "numeric" })}</StatusBadge>
      </div>

      <div className="timesheet-month-grid">
        {monthDays.map((date) => {
          const dayKey = getLocalDateKey(date.getTime());
          const items = byDay.get(dayKey) ?? [];
          const tone = getDayTone(items, date);
          const totalMinutes = items.reduce((sum, item) => sum + getEffectiveWorkedMinutes(item), 0);
          return (
            <button
              key={dayKey}
              type="button"
              className={`timesheet-day-cell timesheet-day-cell--${tone} ${selectedDay === dayKey ? "is-selected" : ""}`}
              onClick={() => setSelectedDay(dayKey)}
            >
              <strong>{date.getDate()}</strong>
              <span>{getDayLabel(tone)}</span>
              {totalMinutes > 0 ? <small>{formatMinutes(totalMinutes)}</small> : null}
            </button>
          );
        })}
      </div>

      <div className="timesheet-day-details">
        <div className="timesheet-day-details__head">
          <strong>{selectedDay}</strong>
          <span>{selectedItems.length ? `${selectedItems.length} pontaje - ${formatMinutes(selectedTotalMinutes)}` : "Niciun pontaj"}</span>
        </div>
        {selectedItems.length ? (
          <div className="simple-list">
            {selectedItems.map((item) => (
              <Link key={item.id} to={`/timesheets/${item.id}`} className="simple-list-item">
                <div className="simple-list-text">
                  <div className="simple-list-label">{getProjectLabel(item)}</div>
                  <div className="simple-list-subtitle">
                    Start: {new Date(item.startAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}
                    {" - "}
                    Stop: {item.stopAt ? new Date(item.stopAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }) : "-"}
                    {" - "}
                    Ore: {formatMinutes(getEffectiveWorkedMinutes(item))}
                  </div>
                  {item.explanation || item.startExplanation || item.stopExplanation ? (
                    <div className="simple-list-subtitle">
                      Observatii: {item.explanation || item.startExplanation || item.stopExplanation}
                    </div>
                  ) : null}
                </div>
                <StatusBadge tone={getTimesheetStatusTone(item.status)}>{getTimesheetStatusLabel(item.status)}</StatusBadge>
              </Link>
            ))}
          </div>
        ) : (
          <p className="tools-subtitle">Nu exista start/stop in ziua selectata.</p>
        )}
      </div>
    </div>
  );
}
