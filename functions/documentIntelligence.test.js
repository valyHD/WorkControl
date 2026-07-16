const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDocumentJobId,
  buildDocumentOperationId,
  createDocumentIntelligenceHandlers,
  isValidIsoDate,
  normalizeExtraction,
} = require("./documentIntelligence");

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
