import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TimesheetItem } from "../../../types/timesheet";
import { formatMinutes } from "../services/timesheetsService";
import StatusBadge from "../../../components/StatusBadge";
import { getUserThemeClass } from "../../../lib/ui/userTheme";
import {
  getLocalDateKey,
  getProjectLabel,
  getTimesheetMinutesForDay,
  getTimesheetStatusLabel,
  getTimesheetStatusTone,
  isIncompleteTimesheet,
} from "../utils/timesheetAnalytics";

type Props = {
  timesheets: TimesheetItem[];
  userThemeKey?: string | null;
  initialMonth?: Date;
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

function firstDayOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export default function TimesheetCalendar({ timesheets, userThemeKey, initialMonth }: Props) {
  const todayKey = getLocalDateKey();
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [visibleMonth, setVisibleMonth] = useState(() => firstDayOfMonth(initialMonth ?? new Date()));
  const monthDays = useMemo(() => getMonthDays(visibleMonth), [visibleMonth]);
  const byDay = useMemo(() => {
    const map = new Map<string, TimesheetItem[]>();
    for (const date of monthDays) {
      const dayKey = getLocalDateKey(date.getTime());
      const items = timesheets.filter((item) =>
        item.workDate === dayKey || getTimesheetMinutesForDay(item, dayKey) > 0
      );
      map.set(dayKey, items);
    }
    return map;
  }, [monthDays, timesheets]);
  const selectedItems = byDay.get(selectedDay) ?? [];
  const selectedTotalMinutes = selectedItems.reduce(
    (sum, item) => sum + getTimesheetMinutesForDay(item, selectedDay),
    0
  );
  const monthTitle = visibleMonth.toLocaleDateString("ro-RO", { month: "long", year: "numeric" });
  const monthEntryCount = useMemo(
    () => new Set([...byDay.values()].flat().map((item) => item.id)).size,
    [byDay]
  );
  function changeMonth(offset: number) {
    const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
    setVisibleMonth(nextMonth);
    const currentMonth = new Date();
    const nextSelected = nextMonth.getFullYear() === currentMonth.getFullYear() && nextMonth.getMonth() === currentMonth.getMonth()
      ? todayKey
      : getLocalDateKey(nextMonth.getTime());
    setSelectedDay(nextSelected);
  }

  return (
    <div className="panel timesheet-calendar-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Calendar pontaj</h2>
          <p className="panel-subtitle">Verde complet, portocaliu incomplet, rosu lipsa, albastru activ.</p>
        </div>
        <div className="timesheet-calendar-nav" aria-label="Navigare calendar pontaje">
          <button className="secondary-btn icon-btn" type="button" onClick={() => changeMonth(-1)} aria-label="Luna anterioara">
            <ChevronLeft size={16} />
          </button>
          <StatusBadge tone="blue">{monthTitle} · {monthEntryCount} pontaje</StatusBadge>
          <button className="secondary-btn icon-btn" type="button" onClick={() => changeMonth(1)} aria-label="Luna urmatoare">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="timesheet-month-grid">
        {monthDays.map((date) => {
          const dayKey = getLocalDateKey(date.getTime());
          const items = byDay.get(dayKey) ?? [];
          const tone = getDayTone(items, date);
          const totalMinutes = items.reduce((sum, item) => sum + getTimesheetMinutesForDay(item, dayKey), 0);
          const themeClass = getUserThemeClass(items[0]?.userThemeKey ?? userThemeKey);
          return (
            <button
              key={dayKey}
              type="button"
              className={`timesheet-day-cell user-accent-surface ${themeClass} timesheet-day-cell--${tone} ${selectedDay === dayKey ? "is-selected" : ""}`}
              onClick={() => setSelectedDay(dayKey)}
            >
              <strong>{date.getDate()}</strong>
              <span>{getDayLabel(tone)}</span>
              {totalMinutes > 0 ? (
                <small
                  className="timesheet-day-hours"
                  aria-label={`Ore pontate: ${formatMinutes(totalMinutes)}`}
                >
                  {formatMinutes(totalMinutes)}
                </small>
              ) : null}
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
            {selectedItems.map((item) => {
              const dayMinutes = getTimesheetMinutesForDay(item, selectedDay);
              const shortSession = item.status !== "activ" && dayMinutes <= 1;
              return (
              <Link key={item.id} to={`/timesheets/${item.id}`} className={`simple-list-item user-history-row ${getUserThemeClass(item.userThemeKey ?? userThemeKey)}`}>
                <div className="simple-list-text">
                  <div className="simple-list-label user-accent-name">{getProjectLabel(item)}</div>
                  <div className="simple-list-subtitle">
                    Start: {new Date(item.startAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}
                    {" - "}
                    Stop: {item.stopAt ? new Date(item.stopAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }) : "-"}
                    {" - "}
                    Ore: {formatMinutes(dayMinutes)}
                  </div>
                  {shortSession ? <div className="simple-list-subtitle timesheet-short-session">Sesiune foarte scurta inregistrata (1 minut sau mai putin).</div> : null}
                  {item.explanation || item.startExplanation || item.stopExplanation ? (
                    <div className="simple-list-subtitle">
                      Observatii: {item.explanation || item.startExplanation || item.stopExplanation}
                    </div>
                  ) : null}
                </div>
                <StatusBadge tone={getTimesheetStatusTone(item.status)}>{getTimesheetStatusLabel(item.status)}</StatusBadge>
              </Link>
              );
            })}
          </div>
        ) : (
          <p className="tools-subtitle">Nu exista start/stop in ziua selectata.</p>
        )}
      </div>
    </div>
  );
}
