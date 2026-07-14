const BUCHAREST_TIME_ZONE = "Europe/Bucharest";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedKey(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro-RO")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseAuditFields(metadata) {
  const source = metadata?.fieldsText;
  const lines = Array.isArray(source)
    ? source
    : typeof source === "string"
      ? source.split(/\r?\n/)
      : [];
  const fields = new Map();
  for (const rawLine of lines) {
    const line = cleanText(rawLine);
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = normalizedKey(line.slice(0, separator));
    const value = cleanText(line.slice(separator + 1));
    if (key && value && value !== "-") fields.set(key, value);
  }
  return fields;
}

function fieldValue(fields, aliases) {
  for (const alias of aliases) {
    const value = fields.get(normalizedKey(alias));
    if (value) return value;
  }
  return "";
}

function eventTimestamp(event) {
  const direct = cleanNumber(event?.createdAt);
  if (direct && direct > 0) return direct;
  const serverValue = event?.createdAtServer;
  if (typeof serverValue?.toMillis === "function") return serverValue.toMillis();
  if (serverValue?._seconds) return Number(serverValue._seconds) * 1000;
  return 0;
}

function formatBucharestDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUCHAREST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isoWeekKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekDay);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

function normalizeStatus(value, workedMinutes) {
  const status = normalizedKey(value).replace(/ /g, "");
  if (["inchis", "corectat", "intarziat", "neinchis"].includes(status)) return status;
  return workedMinutes >= 8 * 60 && workedMinutes <= 9 * 60 ? "inchis" : "corectat";
}

function eventKind(event) {
  const action = normalizedKey(event?.action).replace(/ /g, "_");
  const title = normalizedKey(event?.title);
  if (action === "timesheet_started" || title === "pontaj pornit") return "start";
  if (action === "timesheet_stopped" || title === "pontaj oprit") return "stop";
  return "";
}

function candidateScore(event, kind) {
  const fields = parseAuditFields(event?.metadata);
  let score = fields.size * 10;
  if (kind === "start" && fieldValue(fields, ["proiect"])) score += 30;
  if (kind === "stop" && fieldValue(fields, ["minute lucrate", "durata minute"])) score += 40;
  if (kind === "stop" && cleanNumber(event?.metadata?.workedMinutes) !== null) score += 15;
  return score;
}

function selectEvent(events, kind) {
  return [...events].sort((left, right) => {
    const scoreDiff = candidateScore(right, kind) - candidateScore(left, kind);
    if (scoreDiff !== 0) return scoreDiff;
    return kind === "start"
      ? eventTimestamp(left) - eventTimestamp(right)
      : eventTimestamp(right) - eventTimestamp(left);
  })[0];
}

function resolveProject(projectLabel, projects, companyId) {
  const wanted = normalizedKey(projectLabel);
  if (!wanted) return null;
  return projects.find((project) => {
    if (companyId && project.companyId && project.companyId !== companyId) return false;
    return [project.name, project.code].some((value) => normalizedKey(value) === wanted);
  }) ?? null;
}

function resolveUser(userId, users) {
  return users.find((user) => [user.id, user.uid].includes(userId)) ?? null;
}

function buildCandidate(entityId, events, users, projects) {
  const starts = events.filter((event) => eventKind(event) === "start");
  const stops = events.filter((event) => eventKind(event) === "stop");
  if (!starts.length || !stops.length) {
    return { entityId, reason: starts.length ? "missing-stop" : "missing-start" };
  }

  const startEvent = selectEvent(starts, "start");
  const stopEvent = selectEvent(stops, "stop");
  const startAt = eventTimestamp(startEvent);
  const stopAt = eventTimestamp(stopEvent);
  if (!startAt || !stopAt || stopAt < startAt) {
    return { entityId, reason: "invalid-event-interval" };
  }

  const startFields = parseAuditFields(startEvent.metadata);
  const stopFields = parseAuditFields(stopEvent.metadata);
  const userId = cleanText(startEvent.actorUserId || stopEvent.actorUserId);
  const user = resolveUser(userId, users);
  const companyId = cleanText(
    startEvent.companyId || stopEvent.companyId || user?.primaryCompanyId || user?.companyId
  );
  if (!userId) return { entityId, reason: "missing-user" };
  if (!companyId) return { entityId, reason: "missing-company" };

  const explicitMinutes = cleanNumber(
    fieldValue(stopFields, ["minute lucrate", "durata minute"]) || stopEvent.metadata?.workedMinutes
  );
  const elapsedMinutes = Math.max(1, Math.round((stopAt - startAt) / 60000));
  const workedMinutes = explicitMinutes && explicitMinutes > 0 ? Math.round(explicitMinutes) : elapsedMinutes;
  if (workedMinutes <= 0 || workedMinutes > 24 * 60 * 7) {
    return { entityId, reason: "invalid-worked-minutes" };
  }

  const requestedDate = fieldValue(startFields, ["data lucru", "data pontaj", "work date"]);
  const workDate = isValidDateKey(requestedDate) ? requestedDate : formatBucharestDate(startAt);
  const projectLabel = fieldValue(startFields, ["proiect"]) || fieldValue(stopFields, ["proiect"]);
  const project = resolveProject(projectLabel, projects, companyId);
  const startExplanation = fieldValue(startFields, ["explicatie start", "explicatie"]);
  const stopExplanation = fieldValue(stopFields, ["explicatie stop", "explicatie"]);
  const warnings = [];
  if (Math.abs(workedMinutes - elapsedMinutes) > 15) {
    warnings.push(`duration-mismatch:${workedMinutes}:${elapsedMinutes}`);
  }
  if (!project) warnings.push("project-not-resolved");

  return {
    entityId,
    warnings,
    sourceAuditIds: [startEvent.id, stopEvent.id].filter(Boolean),
    document: {
      userId,
      userName: cleanText(user?.fullName || startEvent.actorUserName || stopEvent.actorUserName || fieldValue(startFields, ["user"])) || "Utilizator",
      userThemeKey: user?.themeKey ?? startEvent.actorUserThemeKey ?? stopEvent.actorUserThemeKey ?? null,
      projectId: cleanText(project?.id),
      projectCode: cleanText(project?.code),
      projectName: cleanText(project?.name || projectLabel) || "Fara proiect",
      status: normalizeStatus(fieldValue(stopFields, ["status"]) || stopEvent.metadata?.status, workedMinutes),
      explanation: [startExplanation, stopExplanation].filter(Boolean).join("\n\n"),
      startExplanation,
      stopExplanation,
      startAt,
      stopAt,
      workedMinutes,
      startLocation: {
        lat: null,
        lng: null,
        label: fieldValue(startFields, ["locatie start", "adresa start"]),
      },
      stopLocation: {
        lat: null,
        lng: null,
        label: fieldValue(stopFields, ["locatie stop", "adresa stop"]),
      },
      startSource: "web",
      stopSource: "web",
      workDate,
      yearMonth: workDate.slice(0, 7),
      weekKey: isoWeekKey(workDate),
      createdAt: startAt,
      updatedAt: stopAt,
      companyId,
      recovery: {
        source: "auditLogs",
        sourceAuditIds: [startEvent.id, stopEvent.id].filter(Boolean),
        recoveredAt: 0,
        warnings,
      },
    },
  };
}

export function buildTimesheetRecoveryPlan({ auditLogs, existingTimesheets = [], users = [], projects = [] }) {
  const existingIds = new Set(existingTimesheets.map((item) => cleanText(item.id)).filter(Boolean));
  const grouped = new Map();
  for (const event of auditLogs) {
    const kind = eventKind(event);
    const entityId = cleanText(event?.entityId);
    if (!kind || !entityId || existingIds.has(entityId)) continue;
    const list = grouped.get(entityId) ?? [];
    list.push(event);
    grouped.set(entityId, list);
  }

  const recoverable = [];
  const manualReview = [];
  const incomplete = [];
  for (const [entityId, events] of grouped.entries()) {
    const candidate = buildCandidate(entityId, events, users, projects);
    if (candidate.document && candidate.warnings.some((warning) => warning.startsWith("duration-mismatch:"))) {
      manualReview.push(candidate);
    } else if (candidate.document) recoverable.push(candidate);
    else incomplete.push(candidate);
  }
  recoverable.sort((left, right) => left.document.startAt - right.document.startAt);
  manualReview.sort((left, right) => left.document.startAt - right.document.startAt);
  incomplete.sort((left, right) => left.entityId.localeCompare(right.entityId));
  return { recoverable, manualReview, incomplete, existingCount: existingIds.size };
}

export function summarizeRecoveryPlan(plan) {
  const byMonth = {};
  const byUser = {};
  for (const candidate of plan.recoverable) {
    const document = candidate.document;
    byMonth[document.yearMonth] = (byMonth[document.yearMonth] || 0) + 1;
    byUser[document.userName] = (byUser[document.userName] || 0) + 1;
  }
  const incompleteReasons = {};
  for (const candidate of plan.incomplete) {
    incompleteReasons[candidate.reason] = (incompleteReasons[candidate.reason] || 0) + 1;
  }
  return {
    existing: plan.existingCount,
    recoverable: plan.recoverable.length,
    incomplete: plan.incomplete.length,
    manualReview: plan.manualReview.length,
    withWarnings: plan.recoverable.filter((candidate) => candidate.warnings.length).length,
    byMonth,
    byUser,
    incompleteReasons,
  };
}
