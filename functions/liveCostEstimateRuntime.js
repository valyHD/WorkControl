const { GoogleAuth } = require("google-auth-library");
const { buildLiveCostEstimate } = require("./liveCostEstimate");

const MONITORING_SCOPE = "https://www.googleapis.com/auth/monitoring.read";
const METRIC_TYPES = Object.freeze({
  reads: "firestore.googleapis.com/document/read_ops_count",
  writes: "firestore.googleapis.com/document/write_ops_count",
  deletes: "firestore.googleapis.com/document/delete_ops_count",
});
const QUERY_LOOKBACK_MINUTES = 70;
const LIVE_ESTIMATE_CACHE_MS = 45_000;
const monitoringAuth = new GoogleAuth({ scopes: [MONITORING_SCOPE] });
let liveEstimateCache = null;
let liveEstimateRequest = null;

async function queryMetricPoints(client, projectId, metricType, startTime, endTime) {
  const params = new URLSearchParams({
    filter: `metric.type="${metricType}"`,
    "interval.startTime": startTime.toISOString(),
    "interval.endTime": endTime.toISOString(),
    "aggregation.alignmentPeriod": "60s",
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
    view: "FULL",
  });
  const response = await client.request({
    method: "GET",
    url: `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params}`,
    timeout: 10_000,
  });
  const series = Array.isArray(response.data?.timeSeries) ? response.data.timeSeries : [];
  return series.flatMap((item) => (Array.isArray(item.points) ? item.points : []));
}

async function getLiveFirebaseCostEstimate({ projectId, usdPerEur, rateDate, now = new Date() }) {
  if (liveEstimateCache?.expiresAt > now.getTime()) return liveEstimateCache.value;
  if (liveEstimateRequest) return liveEstimateRequest;

  liveEstimateRequest = (async () => {
    const client = await monitoringAuth.getClient();
    const startTime = new Date(now.getTime() - QUERY_LOOKBACK_MINUTES * 60_000);
    const [readPoints, writePoints, deletePoints] = await Promise.all([
      queryMetricPoints(client, projectId, METRIC_TYPES.reads, startTime, now),
      queryMetricPoints(client, projectId, METRIC_TYPES.writes, startTime, now),
      queryMetricPoints(client, projectId, METRIC_TYPES.deletes, startTime, now),
    ]);
    const value = {
      ...buildLiveCostEstimate({
        readPoints,
        writePoints,
        deletePoints,
        usdPerEur,
        rateDate,
        now,
      }),
      source: "cloud_monitoring_firestore_operations",
      refreshSeconds: 60,
      pricing: {
        model: "firestore_standard_default",
        location: "europe-west1",
        priceDate: "2026-07-12",
      },
      excludes: ["network_egress", "storage", "cloud_functions", "free_quota", "discounts"],
    };
    liveEstimateCache = { value, expiresAt: now.getTime() + LIVE_ESTIMATE_CACHE_MS };
    return value;
  })();

  try {
    return await liveEstimateRequest;
  } finally {
    liveEstimateRequest = null;
  }
}

module.exports = {
  METRIC_TYPES,
  getLiveFirebaseCostEstimate,
  queryMetricPoints,
};
