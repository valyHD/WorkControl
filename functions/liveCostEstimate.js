const FIRESTORE_STANDARD_PRICES_USD_PER_100K = Object.freeze({
  reads: 0.03,
  writes: 0.09,
  deletes: 0.01,
});

const LIVE_RATE_WINDOW_MINUTES = 5;
const LAST_HOUR_MINUTES = 60;

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

function round(value, digits = 8) {
  return Number(toFiniteNumber(value).toFixed(digits));
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
  const liveCostEur = operationCostUsd(liveTotals) / rate;
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
    estimatedLastHourEur: round(operationCostUsd(hourTotals) / rate),
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
  LIVE_RATE_WINDOW_MINUTES,
  buildLiveCostEstimate,
  normalizeMonitoringPoints,
  operationCostUsd,
};
