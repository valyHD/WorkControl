const FIRESTORE_STANDARD_PRICES_USD_PER_100K = Object.freeze({
  reads: 0.03,
  writes: 0.09,
  deletes: 0.01,
});
const ESTIMATED_EGRESS_BYTES_PER_READ = 3.78 * 1024;
const INTERNET_EGRESS_USD_PER_GIB = 0.12;

// A five-minute sample overreacts to page reloads and route-history bursts.
// Fifteen minutes remains operationally useful, while the 60-minute total is
// the stable hourly number shown in the Control Panel.
const LIVE_RATE_WINDOW_MINUTES = 15;
const LAST_HOUR_MINUTES = 60;
const COST_TIME_ZONE = "Europe/Bucharest";

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeMonitoringPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => ({
      timestampMs: Date.parse(point?.interval?.endTime || ""),
      value: Math.max(0, toFiniteNumber(point?.value?.int64Value ?? point?.value?.doubleValue, 0)),
    }))
    .filter((point) => Number.isFinite(point.timestampMs))
    .sort((left, right) => left.timestampMs - right.timestampMs);
}

function sumWindow(points, startMs, endMs) {
  return points.reduce(
    (total, point) =>
      point.timestampMs > startMs && point.timestampMs <= endMs ? total + point.value : total,
    0
  );
}

function operationCostUsd({ reads = 0, writes = 0, deletes = 0 }) {
  return (
    (reads / 100_000) * FIRESTORE_STANDARD_PRICES_USD_PER_100K.reads +
    (writes / 100_000) * FIRESTORE_STANDARD_PRICES_USD_PER_100K.writes +
    (deletes / 100_000) * FIRESTORE_STANDARD_PRICES_USD_PER_100K.deletes
  );
}

function estimatedEgressCostUsd(reads = 0) {
  const bytes = Math.max(0, toFiniteNumber(reads)) * ESTIMATED_EGRESS_BYTES_PER_READ;
  return (bytes / 1024 ** 3) * INTERNET_EGRESS_USD_PER_GIB;
}

function estimatedTotalCostUsd(counts) {
  return operationCostUsd(counts) + estimatedEgressCostUsd(counts.reads);
}

function round(value, digits = 8) {
  return Number(toFiniteNumber(value).toFixed(digits));
}

function dateKeyInTimeZone(timestampMs, timeZone = COST_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const value = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(dayKey, days) {
  const [year, month, day] = String(dayKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dailyTotals(points, dayKeys) {
  const allowedDays = new Set(dayKeys);
  const totals = new Map(dayKeys.map((day) => [day, 0]));
  for (const point of normalizeMonitoringPoints(points)) {
    const day = dateKeyInTimeZone(point.timestampMs);
    if (allowedDays.has(day)) totals.set(day, (totals.get(day) || 0) + point.value);
  }
  return totals;
}

function buildHistoricalCostEstimate({
  readPoints,
  writePoints,
  deletePoints,
  functionRequestPoints,
  usdPerEur,
  now = new Date(),
  historyDays = 14,
}) {
  const rate = toFiniteNumber(usdPerEur);
  const today = dateKeyInTimeZone(now.getTime());
  const days = Array.from({ length: historyDays }, (_, index) =>
    addDays(today, index - historyDays + 1)
  );
  const sevenDays = new Set(days.slice(-7));
  const readsByDay = dailyTotals(readPoints, days);
  const writesByDay = dailyTotals(writePoints, days);
  const deletesByDay = dailyTotals(deletePoints, days);
  const functionsByDay = dailyTotals(functionRequestPoints, days);
  const dailyUsage = days.map((day) => ({
    day,
    reads: Math.round(readsByDay.get(day) || 0),
    writes: Math.round(writesByDay.get(day) || 0),
    deletes: Math.round(deletesByDay.get(day) || 0),
  }));
  const dailyEstimatedCosts = dailyUsage.map((item) => ({
    day: item.day,
    cost:
      rate > 0
        ? round(
            estimatedTotalCostUsd({
              reads: item.reads,
              writes: item.writes,
              deletes: item.deletes,
            }) / rate
          )
        : null,
  }));
  const todayUsage = dailyUsage.find((item) => item.day === today);
  const sevenDayUsage = dailyUsage
    .filter((item) => sevenDays.has(item.day))
    .reduce(
      (total, item) => ({
        reads: total.reads + item.reads,
        writes: total.writes + item.writes,
        deletes: total.deletes + item.deletes,
      }),
      { reads: 0, writes: 0, deletes: 0 }
    );
  const estimatedCost7DaysEur = rate > 0 ? estimatedTotalCostUsd(sevenDayUsage) / rate : null;
  const [year, month] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    estimatedCostTodayEur:
      rate > 0 && todayUsage ? round(estimatedTotalCostUsd(todayUsage) / rate) : null,
    estimatedCost7DaysEur: estimatedCost7DaysEur === null ? null : round(estimatedCost7DaysEur),
    projectedMonthEur:
      estimatedCost7DaysEur === null ? null : round((estimatedCost7DaysEur / 7) * daysInMonth),
    estimatedEgressMiB7Days: round(
      (sevenDayUsage.reads * ESTIMATED_EGRESS_BYTES_PER_READ) / 1024 ** 2,
      3
    ),
    readsToday: todayUsage?.reads ?? 0,
    writesToday: todayUsage?.writes ?? 0,
    deletesToday: todayUsage?.deletes ?? 0,
    reads7Days: sevenDayUsage.reads,
    writes7Days: sevenDayUsage.writes,
    deletes7Days: sevenDayUsage.deletes,
    functionsInvocations7Days: Math.round(
      [...functionsByDay.entries()]
        .filter(([day]) => sevenDays.has(day))
        .reduce((total, [, value]) => total + value, 0)
    ),
    dailyUsage,
    dailyEstimatedCosts,
  };
}

function buildLiveCostEstimate({
  readPoints,
  writePoints,
  deletePoints,
  usdPerEur,
  rateDate,
  now = new Date(),
}) {
  const normalized = {
    reads: normalizeMonitoringPoints(readPoints),
    writes: normalizeMonitoringPoints(writePoints),
    deletes: normalizeMonitoringPoints(deletePoints),
  };
  const allPoints = [...normalized.reads, ...normalized.writes, ...normalized.deletes];
  const dataAsOfMs = allPoints.reduce((latest, point) => Math.max(latest, point.timestampMs), 0);
  const rate = toFiniteNumber(usdPerEur);

  if (!dataAsOfMs || rate <= 0) {
    return {
      status: "unavailable",
      currency: "EUR",
      dataAsOfMs: dataAsOfMs || null,
      lagSeconds: null,
      sampledWindowMinutes: LIVE_RATE_WINDOW_MINUTES,
      costPerMinuteEur: null,
      projectedHourlyEur: null,
      estimatedLastHourEur: null,
      estimatedEgressMiBPerMinute: null,
      estimatedEgressMiBLastHour: null,
      readsPerMinute: null,
      writesPerMinute: null,
      deletesPerMinute: null,
      readsLastHour: null,
      writesLastHour: null,
      deletesLastHour: null,
      exchangeRate: { source: "ECB", rateDate: rateDate || null },
    };
  }

  const liveStartMs = dataAsOfMs - LIVE_RATE_WINDOW_MINUTES * 60_000;
  const hourStartMs = dataAsOfMs - LAST_HOUR_MINUTES * 60_000;
  const liveTotals = {
    reads: sumWindow(normalized.reads, liveStartMs, dataAsOfMs),
    writes: sumWindow(normalized.writes, liveStartMs, dataAsOfMs),
    deletes: sumWindow(normalized.deletes, liveStartMs, dataAsOfMs),
  };
  const hourTotals = {
    reads: sumWindow(normalized.reads, hourStartMs, dataAsOfMs),
    writes: sumWindow(normalized.writes, hourStartMs, dataAsOfMs),
    deletes: sumWindow(normalized.deletes, hourStartMs, dataAsOfMs),
  };
  const liveCostEur = estimatedTotalCostUsd(liveTotals) / rate;
  const costPerMinuteEur = liveCostEur / LIVE_RATE_WINDOW_MINUTES;
  const lagSeconds = Math.max(0, Math.round((now.getTime() - dataAsOfMs) / 1000));

  return {
    status: lagSeconds > 10 * 60 ? "delayed" : "current",
    currency: "EUR",
    dataAsOfMs,
    lagSeconds,
    sampledWindowMinutes: LIVE_RATE_WINDOW_MINUTES,
    costPerMinuteEur: round(costPerMinuteEur),
    projectedHourlyEur: round(costPerMinuteEur * 60),
    estimatedLastHourEur: round(estimatedTotalCostUsd(hourTotals) / rate),
    estimatedEgressMiBPerMinute: round(
      ((liveTotals.reads / LIVE_RATE_WINDOW_MINUTES) * ESTIMATED_EGRESS_BYTES_PER_READ) / 1024 ** 2,
      3
    ),
    estimatedEgressMiBLastHour: round(
      (hourTotals.reads * ESTIMATED_EGRESS_BYTES_PER_READ) / 1024 ** 2,
      3
    ),
    readsPerMinute: round(liveTotals.reads / LIVE_RATE_WINDOW_MINUTES, 2),
    writesPerMinute: round(liveTotals.writes / LIVE_RATE_WINDOW_MINUTES, 2),
    deletesPerMinute: round(liveTotals.deletes / LIVE_RATE_WINDOW_MINUTES, 2),
    readsLastHour: Math.round(hourTotals.reads),
    writesLastHour: Math.round(hourTotals.writes),
    deletesLastHour: Math.round(hourTotals.deletes),
    exchangeRate: { source: "ECB", rateDate: rateDate || null },
  };
}

module.exports = {
  FIRESTORE_STANDARD_PRICES_USD_PER_100K,
  ESTIMATED_EGRESS_BYTES_PER_READ,
  INTERNET_EGRESS_USD_PER_GIB,
  LIVE_RATE_WINDOW_MINUTES,
  buildLiveCostEstimate,
  buildHistoricalCostEstimate,
  estimatedEgressCostUsd,
  normalizeMonitoringPoints,
  operationCostUsd,
};
