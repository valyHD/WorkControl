const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDocumentJobId,
  buildDocumentOperationId,
  buildVehicleRovinietaRuleId,
  buildVehicleDocumentSummary,
  cleanFirestoreDocumentId,
  createDocumentIntelligenceHandlers,
  isValidIsoDate,
  normalizeExtraction,
  shouldAutoApplyRovinieta,
} = require("./documentIntelligence");

test("preserves exact legacy Firestore document ids", () => {
  assert.equal(cleanFirestoreDocumentId("legacy-vehicle "), "legacy-vehicle ");
  assert.equal(cleanFirestoreDocumentId(" legacy-vehicle"), " legacy-vehicle");
  assert.equal(cleanFirestoreDocumentId("   "), "");
  assert.equal(cleanFirestoreDocumentId("vehicle/child"), "");
});

test("validates ISO dates without JavaScript rollover", () => {
  assert.equal(isValidIsoDate("2028-02-29"), true);
  assert.equal(isValidIsoDate("2026-02-29"), false);
  assert.equal(isValidIsoDate("2026-02-31"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("00.08.2026"), false);
});

test("builds deterministic company-scoped dedupe identifiers", () => {
  const first = buildDocumentJobId("company-a", "file-hash");
  assert.equal(first, buildDocumentJobId("company-a", "file-hash"));
  assert.notEqual(first, buildDocumentJobId("company-b", "file-hash"));
  assert.notEqual(first, buildDocumentJobId("company-a", "other-file"));
});

test("builds a stable operation id for one vehicle document review", () => {
  const first = buildDocumentOperationId("job", "vehicle", "document");
  assert.equal(first, buildDocumentOperationId("job", "vehicle", "document"));
  assert.notEqual(first, buildDocumentOperationId("job", "vehicle", "other-document"));
});

test("builds compact vehicle document summaries", () => {
  const summary = buildVehicleDocumentSummary([
    { id: "expired", expiryDate: "2026-07-01", intelligenceStatus: "applied" },
    { id: "next", expiryDate: "2026-07-20", intelligenceStatus: "needs_review" },
    { id: "invalid", expiryDate: "2026-02-31", intelligenceStatus: "queued" },
  ], Date.UTC(2026, 6, 15, 9, 0, 0));

  assert.equal(summary.count, 3);
  assert.equal(summary.nextExpiryAt, "2026-07-20");
  assert.equal(summary.expiredCount, 1);
  assert.equal(summary.needsReviewCount, 1);
});

test("normalizes field confidence and rejects invalid extracted dates", () => {
  const result = normalizeExtraction({
    documentType: { value: "RCA", confidence: 0.97 },
    expiryDate: { value: "2026-02-31", confidence: 0.99 },
    issueDate: { value: "2026-01-15", confidence: 0.88 },
    policyNumber: { value: "  ABC-123  ", confidence: 2 },
    providerName: { value: "Asigurator Test", confidence: 0.76 },
    vehiclePlateNumber: { value: "B 33 LGR", confidence: 0.91 },
    notes: "  verificare necesara  ",
  });

  assert.deepEqual(result.documentType, {
    value: "rca",
    confidence: 0.97,
    validationErrors: [],
  });
  assert.equal(result.expiryDate.value, "");
  assert.deepEqual(result.expiryDate.validationErrors, ["invalid_calendar_date"]);
  assert.equal(result.issueDate.value, "2026-01-15");
  assert.equal(result.policyNumber.value, "ABC-123");
  assert.equal(result.policyNumber.confidence, 1);
  assert.equal(result.vehiclePlateNumber.value, "B33LGR");
  assert.equal(result.notes, "verificare necesara");
});

test("auto-applies only a high-confidence future rovinieta for the same vehicle", () => {
  const extraction = normalizeExtraction({
    documentType: { value: "rovinieta", confidence: 0.98 },
    expiryDate: { value: "2026-08-31", confidence: 0.97 },
    issueDate: { value: "2026-07-20", confidence: 0.9 },
    policyNumber: { value: "R-123", confidence: 0.8 },
    providerName: { value: "CNAIR", confidence: 0.9 },
    vehiclePlateNumber: { value: "B 33 LGR", confidence: 0.96 },
    notes: "",
  });
  const vehicle = { plateNumber: "B33LGR" };

  assert.equal(shouldAutoApplyRovinieta(extraction, vehicle, new Date("2026-07-22T08:00:00Z")), true);
  assert.equal(
    shouldAutoApplyRovinieta(
      { ...extraction, expiryDate: { ...extraction.expiryDate, confidence: 0.7 } },
      vehicle,
      new Date("2026-07-22T08:00:00Z")
    ),
    false
  );
  assert.equal(
    shouldAutoApplyRovinieta(
      { ...extraction, vehiclePlateNumber: { value: "B99XYZ", confidence: 0.99 } },
      vehicle,
      new Date("2026-07-22T08:00:00Z")
    ),
    false
  );
  assert.equal(
    shouldAutoApplyRovinieta(extraction, vehicle, new Date("2026-09-01T08:00:00Z")),
    false
  );
});

test("builds one deterministic notification rule id per vehicle", () => {
  assert.equal(buildVehicleRovinietaRuleId("vehicle-1"), buildVehicleRovinietaRuleId("vehicle-1"));
  assert.notEqual(buildVehicleRovinietaRuleId("vehicle-1"), buildVehicleRovinietaRuleId("vehicle-2"));
});

test("assigned driver cannot queue a privileged document analysis", async () => {
  class TestHttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const vehicle = {
    companyId: "company-a",
    ownerUserId: "owner-1",
    currentDriverUserId: "driver-1",
  };
  const handlers = createDocumentIntelligenceHandlers({
    db: {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => vehicle }),
        }),
      }),
    },
    bucket: {
      file: () => {
        throw new Error("storage must not be reached");
      },
    },
    fieldValue: {},
    HttpsError: TestHttpsError,
    logger: { warn() {}, error() {} },
    openaiApiKey: { value: () => "" },
    assertActiveInternalRequest: async () => ({
      role: "angajat",
      globalAdmin: false,
      companyIds: ["company-a"],
    }),
    canAccessCompany: (actor, companyId) => actor.companyIds.includes(companyId),
    buildAuditPayload: (value) => value,
  });

  await assert.rejects(
    handlers.createVehicleDocumentIngestionJob({
      auth: { uid: "driver-1" },
      data: {
        vehicleId: "vehicle-1",
        documentId: "document-1",
        storagePath: "vehicles/vehicle-1/documents/document-1.pdf",
      },
    }),
    (error) => error.code === "permission-denied"
  );
});
