const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBillingQuery,
  convertToEur,
  parseEcbRates,
  summarizeBillingRows,
} = require("./billingMetrics");
const { findStandardBillingTable } = require("./billingMetricsRuntime");

test("parses ECB rates and converts source currency to EUR", () => {
  const parsed = parseEcbRates(
    "<Cube><Cube time='2026-07-10'><Cube currency='USD' rate='1.1430'/><Cube currency='RON' rate='5.2333'/></Cube></Cube>"
  );
  assert.equal(parsed.rateDate, "2026-07-10");
  assert.equal(parsed.rates.USD, 1.143);
  assert.equal(Number(convertToEur(13.5, "USD", parsed.rates).toFixed(2)), 11.81);
});

test("summarizes net billing cost, usage and projections without inventing missing values", () => {
  const rows = [
    {
      day: "2026-07-11",
      currency: "USD",
      service: "Cloud Firestore",
      sku: "Cloud Firestore Read Ops Belgium",
      cost: 6.19,
      credits: 0,
      netCost: 6.19,
      usageAmount: 19_103_161,
      usageUnit: "count",
    },
    {
      day: "2026-07-11",
      currency: "USD",
      service: "Cloud Firestore",
      sku: "Cloud Firestore Internet Data Transfer Out Europe to Europe",
      cost: 6.88,
      credits: -0.25,
      netCost: 6.63,
      usageAmount: 67.22,
      usageUnit: "GiBy",
    },
  ];
  const summary = summarizeBillingRows(rows, {
    now: new Date("2026-07-11T12:00:00Z"),
    rates: { EUR: 1, USD: 1.143 },
    budgetMonthlyEur: 50,
  });

  assert.equal(summary.currency, "EUR");
  assert.equal(summary.reads7Days, 19_103_161);
  assert.equal(summary.writes7Days, null);
  assert.equal(summary.egressGiB7Days, 67.22);
  assert.ok(summary.actualCost7Days > 11);
  assert.ok(summary.gpsEstimatedCost7Days < summary.actualCost7Days);
  assert.equal(summary.dailyCosts.length, 30);
  assert.equal(summary.dailyUsage.length, 30);
  assert.equal(summary.dailyUsage.at(-1).reads, 19_103_161);
  assert.ok(summary.budgetUsedPercent > 0);
});

test("builds a bounded, parameterized and partition-filtered BigQuery query", () => {
  const query = buildBillingQuery(
    "workcontrol-53b1d.firebase_billing_export.gcp_billing_export_v1_test"
  );
  assert.match(query, /usage_start_time >= @startTime/);
  assert.match(query, /usage_start_time < @endTime/);
  assert.doesNotMatch(query, /SELECT\s+\*/i);
  assert.throws(() => buildBillingQuery("unsafe`table"));
});

test("discovers only the Standard billing table through a mocked BigQuery client", async () => {
  const fakeBigQuery = {
    dataset(datasetId) {
      assert.equal(datasetId, "firebase_billing_export");
      return {
        async exists() {
          return [true];
        },
        async getTables() {
          return [[{ id: "other_table" }, { id: "gcp_billing_export_v1_account" }]];
        },
      };
    },
  };

  assert.equal(
    await findStandardBillingTable(fakeBigQuery, "workcontrol-53b1d"),
    "workcontrol-53b1d.firebase_billing_export.gcp_billing_export_v1_account"
  );
});
