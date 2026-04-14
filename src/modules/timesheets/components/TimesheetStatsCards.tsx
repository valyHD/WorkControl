import { formatMinutes } from "../services/timesheetsService";

type Props = {
  todayMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
  avgMinutesPerWorkedDayMonth: number;
};

export default function TimesheetStatsCards({
  todayMinutes,
  weekMinutes,
  monthMinutes,
  avgMinutesPerWorkedDayMonth,
}: Props) {
  return (
    <div className="kpi-grid">
      <div className="kpi-card">
        <div className="kpi-label">Ore azi</div>
        <div className="kpi-value">{formatMinutes(todayMinutes)}</div>
      </div>

      <div className="kpi-card">
        <div className="kpi-label">Ore saptamana</div>
        <div className="kpi-value">{formatMinutes(weekMinutes)}</div>
      </div>

      <div className="kpi-card">
        <div className="kpi-label">Ore luna curenta</div>
        <div className="kpi-value">{formatMinutes(monthMinutes)}</div>
      </div>

      <div className="kpi-card">
        <div className="kpi-label">Media / zi lucrata</div>
        <div className="kpi-value">{formatMinutes(avgMinutesPerWorkedDayMonth)}</div>
      </div>
    </div>
  );
}