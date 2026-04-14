export type ProjectStatus = "activ" | "inactiv" | "finalizat";

export interface ProjectItem {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
}

export type TimesheetStatus =
  | "activ"
  | "inchis"
  | "intarziat"
  | "neinchis"
  | "corectat";

export interface TimesheetLocation {
  lat: number | null;
  lng: number | null;
  label: string;
}

export interface TimesheetItem {
  id: string;
  userId: string;
  userName: string;
  userThemeKey?: string | null;

  projectId: string;
  projectCode: string;
  projectName: string;

  status: TimesheetStatus;
  explanation: string;

  startAt: number;
  stopAt: number | null;
  workedMinutes: number;

  startLocation: TimesheetLocation;
  stopLocation: TimesheetLocation | null;

  startSource: "web" | "android";
  stopSource: "web" | "android" | "";

  workDate: string;
  yearMonth: string;
  weekKey: string;

  createdAt: number;
  updatedAt: number;
}

export interface ProjectFormValues {
  code: string;
  name: string;
  status: ProjectStatus;
}

export interface TimesheetStatsSummary {
  todayMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
  avgMinutesPerWorkedDayMonth: number;
}