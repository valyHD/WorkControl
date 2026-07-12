const { BigQuery } = require("@google-cloud/bigquery");
const { logger } = require("firebase-functions");
const {
  addDays,
  buildBillingQuery,
  dateKeyInTimeZone,
  isEcbRateCacheFresh,
  parseEcbRates,
  summarizeBillingRows,
} = require("./billingMetrics");

const DATASET_ID = process.env.BILLING_DATASET_ID || "firebase_billing_export";
const BIGQUERY_LOCATION = "EU";
const ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
let ecbMemoryCache = null;

function createBigQuery(projectId) {
  return new BigQuery({ projectId, location: BIGQUERY_LOCATION });
}

async function findStandardBillingTable(bigQuery, projectId) {
  const dataset = bigQuery.dataset(DATASET_ID);
  const [exists] = await dataset.exists();
  if (!exists) return null;
  const [tables] = await dataset.getTables({ maxResults: 100 });
  const table = tables.find((item) => String(item.id || "").startsWith("gcp_billing_export_v1_"));
  return table ? `${projectId}.${DATASET_ID}.${table.id}` : null;
}

async function getEcbRates(db) {
  if (isEcbRateCacheFresh(ecbMemoryCache)) return ecbMemoryCache;
  const ref = db.collection("systemMetrics").doc("exchangeRates");
  const cached = await ref.get();
  const cachedData = cached.exists ? cached.data() || {} : {};
  if (isEcbRateCacheFresh(cachedData)) {
    ecbMemoryCache = cachedData;
    return cachedData;
  }

  try {
    const response = await fetch(ECB_RATES_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`ECB HTTP ${response.status}`);
    const parsed = parseEcbRates(await response.text());
    if (!parsed.rateDate || Object.keys(parsed.rates).length < 2) {
      throw new Error("ECB response did not include usable rates.");
    }
    const payload = {
      ...parsed,
      source: "ECB",
      fetchedAt: Date.now(),
    };
    await ref.set(payload, { merge: true });
    ecbMemoryCache = payload;
    return payload;
  } catch (error) {
    if (cachedData.rates?.EUR === 1) {
      logger.warn("[refreshBillingMetrics] ECB unavailable, using last valid rate.", {
        rateDate: cachedData.rateDate || null,
        error: error instanceof Error ? error.message : String(error),
      });
      ecbMemoryCache = cachedData;
      return cachedData;
    }
    throw error;
  }
}

async function writeAwaitingExport(db, admin, reason) {
  await db.collection("systemMetrics").doc("billing").set(
    {
      currency: "EUR",
      sourceCurrency: null,
      actualCostToday: null,
      actualCost7Days: null,
      actualCostMonth: null,
      projectedMonthCost: null,
      creditsMonth: null,
      netCostMonth: null,
      readsToday: null,
      reads7Days: null,
      writesToday: null,
      writes7Days: null,
      egressGiB7Days: null,
      functionsInvocations7Days: null,
      gpsEstimatedCost7Days: null,
      nonGpsEstimatedCost7Days: null,
      dailyCosts: [],
      dailyUsage: [],
      serviceBreakdown: [],
      skuBreakdown: [],
      freshnessStatus: "awaiting_export",
      freshnessReason: reason,
      source: "cloud_billing_bigquery_standard",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
    },
    { merge: true }
  );
  return { status: "awaiting_export", reason };
}

async function refreshBillingMetrics({ db, admin, projectId }) {
  const bigQuery = createBigQuery(projectId);
  let tablePath = null;
  try {
    tablePath = await findStandardBillingTable(bigQuery, projectId);
  } catch (error) {
    if (error?.code === 404) return writeAwaitingExport(db, admin, "dataset_missing");
    throw error;
  }
  if (!tablePath) return writeAwaitingExport(db, admin, "standard_export_table_missing");

  const today = dateKeyInTimeZone(new Date());
  const startDay = addDays(today, -34);
  // The SQL groups in Europe/Bucharest. A slightly wider UTC range keeps DST boundaries safe.
  const startTime = new Date(`${addDays(startDay, -1)}T00:00:00Z`);
  const endTime = new Date(`${addDays(today, 2)}T00:00:00Z`);
  const query = buildBillingQuery(tablePath);
  const [rowsJob] = await bigQuery.createQueryJob({
    query,
    params: { startTime, endTime },
    location: BIGQUERY_LOCATION,
    maximumBytesBilled: "1073741824",
    labels: { module: "workcontrol_billing_metrics" },
  });
  const [rows] = await rowsJob.getQueryResults();
  if (!rows.length) return writeAwaitingExport(db, admin, "standard_export_table_empty");
  const rates = await getEcbRates(db);
  const settingsSnap = await db.collection("systemCostSettings").doc("billing").get();
  const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
  const summary = summarizeBillingRows(rows, {
    rates: rates.rates,
    budgetMonthlyEur: settings.budgetMonthlyEur,
  });
  const payload = {
    ...summary,
    exchangeRate: {
      source: rates.source || "ECB",
      rateDate: rates.rateDate || null,
      rates: rates.rates || {},
    },
    source: "cloud_billing_bigquery_standard",
    freshnessStatus: rows.length ? "current" : "delayed",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: Date.now(),
  };

  const batch = db.batch();
  batch.set(db.collection("systemMetrics").doc("billing"), payload, { merge: true });
  for (const daily of summary.dailyCosts) {
    batch.set(
      db.collection("systemMetricDaily").doc(daily.day),
      {
        day: daily.day,
        currency: "EUR",
        netCost: daily.cost,
        source: payload.source,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();

  logger.info("[refreshBillingMetrics] Billing cache refreshed.", {
    rows: rows.length,
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
    currency: summary.currency,
    freshnessStatus: payload.freshnessStatus,
  });
  return { status: "ok", rows: rows.length, updatedAtMs: payload.updatedAtMs };
}

module.exports = {
  findStandardBillingTable,
  getEcbRates,
  refreshBillingMetrics,
};
