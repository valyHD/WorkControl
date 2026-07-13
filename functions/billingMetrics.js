const BILLING_TIME_ZONE = "Europe/Bucharest";

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

function isEcbRateCacheFresh(cachedData, now = new Date()) {
  const fetchedAt = Number(cachedData?.fetchedAt);
  return (
    cachedData?.rates?.EUR === 1 &&
    Number.isFinite(fetchedAt) &&
    dateKeyInTimeZone(new Date(fetchedAt)) === dateKeyInTimeZone(now)
  );
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

function daysBetween(fromDay, toDay) {
  if (!fromDay || !toDay) return null;
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
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
  const exportedDays = [...new Set(rows.map((row) => row.day).filter(Boolean))].sort();
  const exportFromDay = exportedDays[0] || null;
  const exportThroughDay = exportedDays.at(-1) || null;
  const exportLagDays = daysBetween(exportThroughDay, today);
  const exportedWindowStart = exportThroughDay ? addDays(exportThroughDay, -29) : null;
  const exportedWindowRows = exportedWindowStart
    ? rows.filter((row) => row.day >= exportedWindowStart && row.day <= exportThroughDay)
    : [];
  const todayRows = rows.filter((row) => row.day === today);
  const sevenDayRows = rows.filter((row) => row.day >= sevenDayStart && row.day <= today);
  const monthRows = rows.filter((row) => row.day.startsWith(monthPrefix));
  const sourceCurrencies = [...new Set(rows.map((row) => row.sourceCurrency))];

  const actualCostToday = todayRows.length ? sum(todayRows, (row) => row.netCost) : null;
  const actualCost7Days = sevenDayRows.length ? sum(sevenDayRows, (row) => row.netCost) : null;
  const actualCostMonth = monthRows.length ? sum(monthRows, (row) => row.cost) : null;
  const creditsMonth = monthRows.length ? Math.abs(sum(monthRows, (row) => row.credits)) : null;
  const netCostMonth = monthRows.length ? sum(monthRows, (row) => row.netCost) : null;
  const latestMonthDay = exportThroughDay?.startsWith(monthPrefix)
    ? Number(exportThroughDay.slice(8, 10))
    : 0;
  const [year, month] = monthPrefix.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const projectedMonthCost =
    latestMonthDay > 0 && netCostMonth !== null
      ? (netCostMonth / latestMonthDay) * daysInMonth
      : null;
  const dailyCosts = exportThroughDay
    ? enumerateDayKeys(exportedWindowStart, exportThroughDay).map((day) => ({
        day,
        cost: roundMoney(
          sum(
            rows.filter((row) => row.day === day),
            (row) => row.netCost
          )
        ),
      }))
    : [];
  const dailyUsage = exportThroughDay
    ? enumerateDayKeys(exportedWindowStart, exportThroughDay).map((day) => {
        const dayRows = rows.filter((row) => row.day === day);
        return {
          day,
          reads: usageForSku(dayRows, ["read ops", "document read"]),
          writes: usageForSku(dayRows, ["entity writes", "document write"]),
        };
      })
    : [];

  return {
    currency: "EUR",
    sourceCurrency: sourceCurrencies.length === 1 ? sourceCurrencies[0] : "MIXED",
    actualCostToday: actualCostToday === null ? null : roundMoney(actualCostToday),
    actualCost7Days: actualCost7Days === null ? null : roundMoney(actualCost7Days),
    actualCostMonth: actualCostMonth === null ? null : roundMoney(actualCostMonth),
    projectedMonthCost: projectedMonthCost === null ? null : roundMoney(projectedMonthCost),
    creditsMonth: creditsMonth === null ? null : roundMoney(creditsMonth),
    netCostMonth: netCostMonth === null ? null : roundMoney(netCostMonth),
    readsToday: usageForSku(todayRows, ["read ops", "document read"]),
    reads7Days: usageForSku(sevenDayRows, ["read ops", "document read"]),
    writesToday: usageForSku(todayRows, ["entity writes", "document write"]),
    writes7Days: usageForSku(sevenDayRows, ["entity writes", "document write"]),
    egressGiB7Days: egressGiB(sevenDayRows),
    functionsInvocations7Days: usageForSku(sevenDayRows, ["invocation"]),
    gpsEstimatedCost7Days: null,
    nonGpsEstimatedCost7Days: null,
    budgetMonthlyEur,
    budgetUsedPercent:
      budgetMonthlyEur > 0 && netCostMonth !== null
        ? Number(((netCostMonth / budgetMonthlyEur) * 100).toFixed(1))
        : null,
    dailyCosts,
    dailyUsage,
    serviceBreakdown: aggregateBreakdown(exportedWindowRows, "service"),
    skuBreakdown: aggregateBreakdown(exportedWindowRows, "sku"),
    periodStart: exportedWindowStart || exportFromDay,
    periodEnd: exportThroughDay,
    exportFromDay,
    exportThroughDay,
    exportLagDays,
    costAttributionStatus: "unavailable",
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
  isEcbRateCacheFresh,
  parseEcbRates,
  summarizeBillingRows,
};
