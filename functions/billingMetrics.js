const BILLING_TIME_ZONE = "Europe/Bucharest";
const GPS_FIRESTORE_COST_SHARE = 0.98;

function toNumber(value, fallback = 0) {
  const numeric = Number(value?.value ?? value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toDayKey(value) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value?.value) return String(value.value).slice(0, 10);
  return "";
}

function dateKeyInTimeZone(date = new Date(), timeZone = BILLING_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(dayKey, days) {
  const [year, month, day] = String(dayKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function enumerateDayKeys(fromDay, toDay) {
  const result = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) result.push(day);
  return result;
}

function parseEcbRates(xml) {
  const rates = { EUR: 1 };
  const rateDate = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] || "";
  const regex = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
  let match = regex.exec(xml);
  while (match) {
    const rate = Number(match[2]);
    if (Number.isFinite(rate) && rate > 0) rates[match[1]] = rate;
    match = regex.exec(xml);
  }
  return { rateDate, rates };
}

function convertToEur(amount, currency, rates) {
  const numeric = toNumber(amount);
  const code = String(currency || "EUR").toUpperCase();
  if (code === "EUR") return numeric;
  const rate = toNumber(rates?.[code]);
  return rate > 0 ? numeric / rate : null;
}

function normalizeBillingRow(row, rates) {
  const currency = String(row.currency || "EUR").toUpperCase();
  const cost = convertToEur(row.cost, currency, rates);
  const credits = convertToEur(row.credits, currency, rates);
  const netCost = convertToEur(row.netCost, currency, rates);
  if (cost === null || credits === null || netCost === null) return null;

  return {
    day: toDayKey(row.day),
    sourceCurrency: currency,
    service: String(row.service || "Necunoscut"),
    sku: String(row.sku || "Necunoscut"),
    cost,
    credits,
    netCost,
    usageAmount: toNumber(row.usageAmount),
    usageUnit: String(row.usageUnit || ""),
  };
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(4));
}

function sum(rows, selector) {
  return rows.reduce((total, row) => total + toNumber(selector(row)), 0);
}

function aggregateBreakdown(rows, field) {
  const totals = new Map();
  for (const row of rows) {
    const key = row[field] || "Necunoscut";
    totals.set(key, (totals.get(key) || 0) + row.netCost);
  }
  return [...totals.entries()]
    .map(([name, cost]) => ({ name, cost: roundMoney(cost) }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 20);
}

function usageForSku(rows, patterns) {
  const matches = rows.filter((row) => {
    const sku = row.sku.toLowerCase();
    return patterns.some((pattern) => sku.includes(pattern));
  });
  return matches.length ? Math.round(sum(matches, (row) => row.usageAmount)) : null;
}

function egressGiB(rows) {
  const matches = rows.filter((row) => {
    const sku = row.sku.toLowerCase();
    const unit = row.usageUnit.toLowerCase();
    return (
      (sku.includes("data transfer") || sku.includes("egress")) &&
      (unit.includes("gib") || unit.includes("giby"))
    );
  });
  return matches.length ? Number(sum(matches, (row) => row.usageAmount).toFixed(3)) : null;
}

function summarizeBillingRows(rawRows, options = {}) {
  const now = options.now || new Date();
  const rates = options.rates || { EUR: 1 };
  const budgetMonthlyEur = Math.max(0, toNumber(options.budgetMonthlyEur));
  const today = dateKeyInTimeZone(now);
  const sevenDayStart = addDays(today, -6);
  const thirtyDayStart = addDays(today, -29);
  const monthPrefix = today.slice(0, 7);
  const rows = rawRows.map((row) => normalizeBillingRow(row, rates)).filter(Boolean);
  const todayRows = rows.filter((row) => row.day === today);
  const sevenDayRows = rows.filter((row) => row.day >= sevenDayStart && row.day <= today);
  const thirtyDayRows = rows.filter((row) => row.day >= thirtyDayStart && row.day <= today);
  const monthRows = rows.filter((row) => row.day.startsWith(monthPrefix));
  const sourceCurrencies = [...new Set(rows.map((row) => row.sourceCurrency))];

  const actualCostToday = sum(todayRows, (row) => row.netCost);
  const actualCost7Days = sum(sevenDayRows, (row) => row.netCost);
  const actualCostMonth = sum(monthRows, (row) => row.cost);
  const creditsMonth = Math.abs(sum(monthRows, (row) => row.credits));
  const netCostMonth = sum(monthRows, (row) => row.netCost);
  const dayOfMonth = Number(today.slice(8, 10));
  const [year, month] = monthPrefix.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const projectedMonthCost = dayOfMonth > 0 ? (netCostMonth / dayOfMonth) * daysInMonth : 0;
  const firestoreGpsRows = sevenDayRows.filter((row) => {
    const service = row.service.toLowerCase();
    const sku = row.sku.toLowerCase();
    return (
      service.includes("firestore") &&
      (sku.includes("read ops") || sku.includes("data transfer") || sku.includes("egress"))
    );
  });
  const gpsEstimatedCost7Days =
    sum(firestoreGpsRows, (row) => row.netCost) * GPS_FIRESTORE_COST_SHARE;
  const dailyCosts = enumerateDayKeys(thirtyDayStart, today).map((day) => ({
    day,
    cost: roundMoney(
      sum(
        rows.filter((row) => row.day === day),
        (row) => row.netCost
      )
    ),
  }));
  const dailyUsage = enumerateDayKeys(thirtyDayStart, today).map((day) => {
    const dayRows = rows.filter((row) => row.day === day);
    return {
      day,
      reads: usageForSku(dayRows, ["read ops", "document read"]),
      writes: usageForSku(dayRows, ["entity writes", "document write"]),
    };
  });

  return {
    currency: "EUR",
    sourceCurrency: sourceCurrencies.length === 1 ? sourceCurrencies[0] : "MIXED",
    actualCostToday: roundMoney(actualCostToday),
    actualCost7Days: roundMoney(actualCost7Days),
    actualCostMonth: roundMoney(actualCostMonth),
    projectedMonthCost: roundMoney(projectedMonthCost),
    creditsMonth: roundMoney(creditsMonth),
    netCostMonth: roundMoney(netCostMonth),
    readsToday: usageForSku(todayRows, ["read ops", "document read"]),
    reads7Days: usageForSku(sevenDayRows, ["read ops", "document read"]),
    writesToday: usageForSku(todayRows, ["entity writes", "document write"]),
    writes7Days: usageForSku(sevenDayRows, ["entity writes", "document write"]),
    egressGiB7Days: egressGiB(sevenDayRows),
    functionsInvocations7Days: usageForSku(sevenDayRows, ["invocation"]),
    gpsEstimatedCost7Days: roundMoney(gpsEstimatedCost7Days),
    nonGpsEstimatedCost7Days: roundMoney(Math.max(0, actualCost7Days - gpsEstimatedCost7Days)),
    budgetMonthlyEur,
    budgetUsedPercent:
      budgetMonthlyEur > 0 ? Number(((netCostMonth / budgetMonthlyEur) * 100).toFixed(1)) : null,
    dailyCosts,
    dailyUsage,
    serviceBreakdown: aggregateBreakdown(monthRows, "service"),
    skuBreakdown: aggregateBreakdown(monthRows, "sku"),
    periodStart: thirtyDayStart,
    periodEnd: today,
  };
}

function buildBillingQuery(tablePath) {
  if (!/^[A-Za-z0-9_.:-]+$/.test(tablePath)) throw new Error("Invalid BigQuery table path.");
  return `
    SELECT
      DATE(usage_start_time, "${BILLING_TIME_ZONE}") AS day,
      currency,
      service.description AS service,
      sku.description AS sku,
      SUM(cost) AS cost,
      SUM(IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS credits,
      SUM(cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS netCost,
      SUM(usage.amount_in_pricing_units) AS usageAmount,
      ANY_VALUE(usage.pricing_unit) AS usageUnit
    FROM \`${tablePath}\`
    WHERE usage_start_time >= @startTime
      AND usage_start_time < @endTime
    GROUP BY day, currency, service, sku
    ORDER BY day ASC, netCost DESC
  `;
}

module.exports = {
  BILLING_TIME_ZONE,
  addDays,
  buildBillingQuery,
  convertToEur,
  dateKeyInTimeZone,
  parseEcbRates,
  summarizeBillingRows,
};
