const { GoogleAuth } = require("google-auth-library");
const { buildLiveCostEstimate } = require("./liveCostEstimate");

const MONITORING_SCOPE = "https://www.googleapis.com/auth/monitoring.read";
const METRIC_TYPES = Object.freeze({
  reads: "firestore.googleapis.com/document/read_ops_count",
  writes: "firestore.googleapis.com/document/write_ops_count",
  deletes: "firestore.googleapis.com/document/delete_ops_count",
  snapshotListeners: "firestore.googleapis.com/network/snapshot_listeners",
  activeConnections: "firestore.googleapis.com/network/active_connections",
  functionRequests: "run.googleapis.com/request_count",
});
const QUERY_LOOKBACK_MINUTES = 70;
const LIVE_ESTIMATE_CACHE_MS = 15 * 60_000;
const monitoringAuth = new GoogleAuth({ scopes: [MONITORING_SCOPE] });
let liveEstimateCache = null;
let liveEstimateRequest = null;

async function queryMetricPoints(
  client,
  projectId,
  metricType,
  startTime,
  endTime,
  aligner = "ALIGN_SUM",
  reducer = "REDUCE_SUM"
) {
  const params = new URLSearchParams({
    filter: `metric.type="${metricType}"`,
    "interval.startTime": startTime.toISOString(),
    "interval.endTime": endTime.toISOString(),
    "aggregation.alignmentPeriod": "60s",
    "aggregation.perSeriesAligner": aligner,
    "aggregation.crossSeriesReducer": reducer,
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

function pointNumber(point) {
  const value = Number(point?.value?.int64Value ?? point?.value?.doubleValue ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function averageMetric(points, maxItems = 15) {
  const values = (Array.isArray(points) ? points : []).slice(0, maxItems).map(pointNumber);
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function sumMetric(points, maxItems = 60) {
  return Math.round(
    (Array.isArray(points) ? points : [])
      .slice(0, maxItems)
      .reduce((sum, point) => sum + pointNumber(point), 0)
  );
}

async function getLiveFirebaseCostEstimate({
  projectId,
  usdPerEur,
  rateDate,
  now = new Date(),
  force = false,
}) {
  if (!force && liveEstimateCache?.expiresAt > now.getTime()) return liveEstimateCache.value;
  if (liveEstimateRequest) return liveEstimateRequest;

  liveEstimateRequest = (async () => {
    const client = await monitoringAuth.getClient();
    const startTime = new Date(now.getTime() - QUERY_LOOKBACK_MINUTES * 60_000);
    const [
      readPoints,
      writePoints,
      deletePoints,
      snapshotListenerPoints,
      activeConnectionPoints,
      functionRequestPoints,
    ] = await Promise.all([
      queryMetricPoints(client, projectId, METRIC_TYPES.reads, startTime, now),
      queryMetricPoints(client, projectId, METRIC_TYPES.writes, startTime, now),
      queryMetricPoints(client, projectId, METRIC_TYPES.deletes, startTime, now),
      queryMetricPoints(
        client,
        projectId,
        METRIC_TYPES.snapshotListeners,
        startTime,
        now,
        "ALIGN_MEAN",
        "REDUCE_SUM"
      ),
      queryMetricPoints(
        client,
        projectId,
        METRIC_TYPES.activeConnections,
        startTime,
        now,
        "ALIGN_MEAN",
        "REDUCE_SUM"
      ),
      queryMetricPoints(client, projectId, METRIC_TYPES.functionRequests, startTime, now),
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
      refreshSeconds: 15 * 60,
      snapshotListeners: averageMetric(snapshotListenerPoints),
      activeConnections: averageMetric(activeConnectionPoints),
      functionRequestsLastHour: sumMetric(functionRequestPoints),
      pricing: {
        model: "firestore_standard_default",
        location: "europe-west1",
        priceDate: "2026-07-12",
      },
      excludes: ["storage", "cloud_functions", "free_quota", "discounts"],
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
