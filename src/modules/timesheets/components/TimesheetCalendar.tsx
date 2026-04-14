import type { TimesheetItem } from "../../../types/timesheet";
import { formatMinutes } from "../services/timesheetsService";

type Props = {
  timesheets: TimesheetItem[];
};

export default function TimesheetCalendar({ timesheets }: Props) {
  const totalsByDay = timesheets.reduce<Record<string, number>>((acc, item) => {
    acc[item.workDate] = (acc[item.workDate] || 0) + item.workedMinutes;
    return acc;
  }, {});

  const sortedDays = Object.keys(totalsByDay).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="panel">
      <h2 className="panel-title">Calendar ore lucrate</h2>

      {sortedDays.length === 0 ? (
        <p className="tools-subtitle">Nu exista zile lucrate inregistrate.</p>
      ) : (
        <div className="simple-list">
          {sortedDays.map((day) => (
            <div key={day} className="simple-list-item">
              <div className="simple-list-text">
                <div className="simple-list-label">{day}</div>
                <div className="simple-list-subtitle">
                  Ore lucrate: {formatMinutes(totalsByDay[day])}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}