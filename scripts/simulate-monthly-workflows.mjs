const WORK_DAYS_IN_MONTH = 22;
const USER_COUNT = 15;

const users = Array.from({ length: USER_COUNT }, (_, index) => ({
  id: `user_${index + 1}`,
  name: `User ${index + 1}`,
  role: index < 2 ? "admin" : index < 4 ? "manager" : "user",
}));

const admins = users.filter((user) => user.role === "admin");
const projects = [
  { id: "service", code: "Service", name: "Mentenanta" },
  { id: "montaj", code: "Montaj", name: "Regina Maria BV" },
  { id: "revizie", code: "Revizie", name: "Lifturi" },
];

const state = {
  activeTimesheets: new Map(),
  timesheets: [],
  expenses: [],
  leaveRequests: [],
  maintenanceReports: [],
  vehicleTrips: [],
  notifications: [],
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function notifyAdmins(eventType, entityId, message) {
  for (const admin of admins) {
    state.notifications.push({
      userId: admin.id,
      eventType,
      entityId,
      message,
    });
  }
}

function startTimesheet(user, day) {
  assert(!state.activeTimesheets.has(user.id), `Pontaj activ duplicat pentru ${user.id} in ziua ${day}.`);
  const project = projects[(day + user.id.length) % projects.length];
  const timesheet = {
    id: `ts_${user.id}_${day}`,
    userId: user.id,
    projectId: project.id,
    startDay: day,
    startLocation: {
      lat: day % 5 === 0 ? null : 44.4 + day / 1000,
      lng: day % 5 === 0 ? null : 26.1 + day / 1000,
      label: day % 5 === 0 ? `Adresa custom start ${day}` : `GPS start ${day}`,
    },
  };
  state.activeTimesheets.set(user.id, timesheet);
  notifyAdmins("timesheet_started", timesheet.id, `${user.name} a pornit pontajul.`);
}

function stopTimesheet(user, day) {
  const timesheet = state.activeTimesheets.get(user.id);
  assert(timesheet, `Stop pontaj fara pontaj activ pentru ${user.id} in ziua ${day}.`);
  timesheet.stopDay = day;
  timesheet.workedMinutes = 480 + ((day + user.id.length) % 70);
  timesheet.stopLocation = {
    lat: day % 7 === 0 ? null : 44.45 + day / 1000,
    lng: day % 7 === 0 ? null : 26.15 + day / 1000,
    label: day % 7 === 0 ? `Adresa custom stop ${day}` : `GPS stop ${day}`,
  };
  state.timesheets.push(timesheet);
  state.activeTimesheets.delete(user.id);
  notifyAdmins("timesheet_stopped", timesheet.id, `${user.name} a oprit pontajul.`);
}

function driveVehicle(user, day) {
  const km = 12 + ((day * user.id.length) % 55);
  state.vehicleTrips.push({
    id: `trip_${user.id}_${day}`,
    userId: user.id,
    day,
    km,
  });
  if (km > 60) {
    notifyAdmins("vehicle_oil_service_due_soon", `vehicle_${user.id}`, `${user.name} se apropie de revizie ulei.`);
  }
}

function scanExpense(user, day) {
  if ((day + user.id.length) % 3 !== 0) return;
  const reimbursable = day % 6 === 0;
  const kind = day % 4 === 0 ? "factura" : "bon";
  const expense = {
    id: `expense_${user.id}_${day}`,
    userId: user.id,
    documentKind: kind,
    reimbursable,
    total: 40 + day * 3,
    vat: 7 + day,
  };
  state.expenses.push(expense);
  notifyAdmins(
    reimbursable ? "expense_reimbursable_created" : kind === "factura" ? "expense_invoice_created" : "expense_document_created",
    expense.id,
    `${user.name} a introdus ${kind}.`
  );
}

function requestLeave(user, day) {
  if (day !== 10 || user.role === "admin") return;
  const request = {
    id: `leave_${user.id}`,
    userId: user.id,
    periodStart: day + 5,
    periodEnd: day + 6,
    status: "in_asteptare",
  };
  state.leaveRequests.push(request);
  notifyAdmins("leave_request_submitted", request.id, `${user.name} a depus cerere de concediu.`);
}

function createMaintenanceReport(day) {
  if (day % 5 !== 0) return;
  const report = {
    id: `maintenance_${day}`,
    day,
    type: day % 10 === 0 ? "interventie" : "revizie",
  };
  state.maintenanceReports.push(report);
  notifyAdmins("maintenance_report_created", report.id, `Raport ${report.type} generat.`);
}

for (let day = 1; day <= WORK_DAYS_IN_MONTH; day += 1) {
  createMaintenanceReport(day);
  for (const user of users) {
    startTimesheet(user, day);
    driveVehicle(user, day);
    scanExpense(user, day);
    requestLeave(user, day);
    stopTimesheet(user, day);
  }
}

assert(state.activeTimesheets.size === 0, "Au ramas pontaje active dupa rulare.");
assert(state.timesheets.length === USER_COUNT * WORK_DAYS_IN_MONTH, "Numarul de pontaje inchise nu corespunde.");
assert(state.timesheets.every((item) => item.startLocation.label && item.stopLocation.label), "Exista pontaj fara locatie text.");
assert(state.expenses.length > 0, "Nu s-a generat niciun document de cheltuiala.");
assert(state.notifications.every((item) => admins.some((admin) => admin.id === item.userId)), "Exista notificari catre non-admin in fluxul admin.");
assert(state.notifications.some((item) => item.eventType.startsWith("expense_")), "Lipsesc notificarile pentru bonuri/facturi.");
assert(state.leaveRequests.length === USER_COUNT - admins.length, "Numarul de cereri concediu nu corespunde.");
assert(state.maintenanceReports.length >= 4, "Rapoartele de mentenanta nu s-au generat pe luna.");

console.log(JSON.stringify({
  users: users.length,
  workDays: WORK_DAYS_IN_MONTH,
  timesheets: state.timesheets.length,
  vehicleTrips: state.vehicleTrips.length,
  expenses: state.expenses.length,
  leaveRequests: state.leaveRequests.length,
  maintenanceReports: state.maintenanceReports.length,
  adminNotifications: state.notifications.length,
  status: "OK",
}, null, 2));
