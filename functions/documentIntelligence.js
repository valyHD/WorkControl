const crypto = require("node:crypto");

const DOCUMENT_JOB_SCHEMA_VERSION = 1;
const DOCUMENT_EXTRACTION_VERSION = "vehicle-v1";
const DOCUMENT_JOB_MAX_BYTES = 18 * 1024 * 1024;
const DOCUMENT_JOB_MAX_ATTEMPTS = 3;
const DOCUMENT_JOB_RATE_LIMIT_PER_HOUR = 30;
const DOCUMENT_TYPES = [
  "itp",
  "rca",
  "casco",
  "rovinieta",
  "service",
  "leasing_rate",
  "amenda",
  "other",
  "unknown",
];
const APPLY_FIELDS = new Set(["documentType", "expiryDate"]);

function cleanText(value, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanText(value, 10));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function normalizeDocumentType(value) {
  const normalized = cleanText(value, 40).toLowerCase();
  return DOCUMENT_TYPES.includes(normalized) ? normalized : "unknown";
}

function normalizeTextField(field, maxLength = 300) {
  return {
    value: cleanText(field?.value, maxLength),
    confidence: cleanConfidence(field?.confidence),
    validationErrors: [],
  };
}

function normalizeDateField(field) {
  const value = cleanText(field?.value, 10);
  if (!value) {
    return { value: "", confidence: 0, validationErrors: [] };
  }
  if (!isValidIsoDate(value)) {
    return { value: "", confidence: 0, validationErrors: ["invalid_calendar_date"] };
  }
  return {
    value,
    confidence: cleanConfidence(field?.confidence),
    validationErrors: [],
  };
}

function normalizeExtraction(raw) {
  const documentType = normalizeTextField(raw?.documentType, 40);
  documentType.value = normalizeDocumentType(documentType.value);
  return {
    documentType,
    expiryDate: normalizeDateField(raw?.expiryDate),
    issueDate: normalizeDateField(raw?.issueDate),
    policyNumber: normalizeTextField(raw?.policyNumber, 160),
    providerName: normalizeTextField(raw?.providerName, 200),
    vehiclePlateNumber: {
      ...normalizeTextField(raw?.vehiclePlateNumber, 40),
      value: cleanText(raw?.vehiclePlateNumber?.value, 40).toUpperCase().replace(/\s+/g, ""),
    },
    notes: cleanText(raw?.notes, 500),
  };
}

function fieldSchema(valueSchema) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      value: valueSchema,
      confidence: { type: "number" },
    },
    required: ["value", "confidence"],
  };
}

const VEHICLE_DOCUMENT_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: fieldSchema({ type: "string", enum: DOCUMENT_TYPES }),
    expiryDate: fieldSchema({
      type: "string",
      description: "Data expirarii in format YYYY-MM-DD sau string gol.",
    }),
    issueDate: fieldSchema({
      type: "string",
      description: "Data emiterii in format YYYY-MM-DD sau string gol.",
    }),
    policyNumber: fieldSchema({ type: "string" }),
    providerName: fieldSchema({ type: "string" }),
    vehiclePlateNumber: fieldSchema({ type: "string" }),
    notes: { type: "string" },
  },
  required: [
    "documentType",
    "expiryDate",
    "issueDate",
    "policyNumber",
    "providerName",
    "vehiclePlateNumber",
    "notes",
  ],
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildDocumentJobId(companyId, fileHash) {
  return sha256(
    `${companyId}:${fileHash}:${DOCUMENT_EXTRACTION_VERSION}:${DOCUMENT_JOB_SCHEMA_VERSION}`
  );
}

function buildDocumentOperationId(jobId, vehicleId, documentId) {
  return sha256(`${jobId}:${vehicleId}:${documentId}`).slice(0, 48);
}

function inferContentType(fileName, contentType) {
  const provided = cleanText(contentType, 120).toLowerCase();
  if (provided) return provided;
  const name = cleanText(fileName, 240).toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".doc")) return "application/msword";
  if (name.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function isSupportedDocumentMime(contentType) {
  return (
    contentType.startsWith("image/") ||
    contentType === "application/pdf" ||
    contentType === "application/msword" ||
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    contentType.startsWith("text/")
  );
}

function extractResponseText(responseJson) {
  if (typeof responseJson?.output_text === "string") return responseJson.output_text;
  const chunks = [];
  for (const outputItem of responseJson?.output || []) {
    for (const contentItem of outputItem?.content || []) {
      if (typeof contentItem?.text === "string") chunks.push(contentItem.text);
    }
  }
  return chunks.join("\n").trim();
}

function timestampToMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

function sanitizeJob(jobId, data, decision = null) {
  return {
    jobId,
    status: cleanText(data?.status, 40) || "queued",
    result: data?.result || null,
    model: cleanText(data?.model, 80),
    extractionVersion: cleanText(data?.extractionVersion, 80),
    attempts: Number(data?.attempts || 0),
    errorCode: cleanText(data?.errorCode, 80),
    createdAt: Number(data?.createdAt || timestampToMillis(data?.createdAtServer)),
    updatedAt: Number(data?.updatedAt || timestampToMillis(data?.updatedAtServer)),
    decision: decision?.status || "",
  };
}

function buildVehicleDocumentPrompt() {
  return [
    "Citeste documentul pentru un autovehicul din Romania.",
    "Extrage numai campurile vizibile si sigure.",
    "Tipurile permise sunt ITP, RCA, CASCO, rovinieta, service, leasing, amenda sau other.",
    "Pentru fiecare camp intoarce separat valoarea si confidence intre 0 si 1.",
    "Data expirarii este data pana la care documentul este valabil.",
    "Pentru ITP cauta urmatoarea inspectie sau valabil pana la.",
    "Pentru RCA si CASCO cauta finalul perioadei de valabilitate.",
    "Pentru rovinieta cauta sfarsitul valabilitatii.",
    "Foloseste YYYY-MM-DD. Daca nu esti sigur, lasa valoarea goala si confidence 0.",
    "Nu deduce kilometraj, proprietar, sofer, companie sau statusul masinii.",
  ].join(" ");
}

function createDocumentIntelligenceHandlers(dependencies) {
  const {
    db,
    bucket,
    fieldValue,
    HttpsError,
    logger,
    openaiApiKey,
    assertActiveInternalRequest,
    canAccessCompany,
    buildAuditPayload,
    fetchImpl = fetch,
  } = dependencies;

  function canOperateVehicle(actor, userId, vehicle) {
    const companyId = cleanText(vehicle?.companyId, 120);
    if (!canAccessCompany(actor, companyId)) return false;
    if (actor.globalAdmin || actor.role === "admin" || actor.role === "manager") return true;
    return (
      userId === cleanText(vehicle?.ownerUserId, 160) ||
      userId === cleanText(vehicle?.currentDriverUserId, 160)
    );
  }

  function canReviewVehicleDocument(actor, userId, vehicle) {
    const companyId = cleanText(vehicle?.companyId, 120);
    if (!canAccessCompany(actor, companyId)) return false;
    if (actor.globalAdmin || actor.role === "admin" || actor.role === "manager") return true;
    return userId === cleanText(vehicle?.ownerUserId, 160);
  }

  async function loadVehicleForActor(request, vehicleId, options = {}) {
    const actor = await assertActiveInternalRequest(request);
    const vehicleRef = db.collection("vehicles").doc(vehicleId);
    const vehicleSnap = await vehicleRef.get();
    const vehicle = vehicleSnap.data() || {};
    if (!vehicleSnap.exists) throw new HttpsError("not-found", "Vehiculul nu exista.");
    if (!canOperateVehicle(actor, request.auth.uid, vehicle)) {
      throw new HttpsError("permission-denied", "Nu ai acces la documentele acestui vehicul.");
    }
    if (options.requireReview && !canReviewVehicleDocument(actor, request.auth.uid, vehicle)) {
      throw new HttpsError(
        "permission-denied",
        "Nu ai dreptul sa confirmi datele documentelor acestui vehicul."
      );
    }
    return { actor, vehicle, vehicleRef };
  }

  function validateVehicleDocumentPath(vehicleId, storagePath) {
    const expectedPrefix = `vehicles/${vehicleId}/documents/`;
    return (
      storagePath.startsWith(expectedPrefix) &&
      !storagePath.includes("..") &&
      storagePath.length <= 800
    );
  }

  async function createVehicleDocumentIngestionJob(request) {
    const vehicleId = cleanText(request.data?.vehicleId, 160);
    const documentId = cleanText(request.data?.documentId, 160);
    const storagePath = cleanText(request.data?.storagePath, 800);
    const fileName = cleanText(request.data?.fileName, 240) || "document";
    if (!vehicleId || !documentId || !validateVehicleDocumentPath(vehicleId, storagePath)) {
      throw new HttpsError("invalid-argument", "Documentul sau calea Storage este invalida.");
    }
    const { actor, vehicle } = await loadVehicleForActor(request, vehicleId, {
      requireReview: true,
    });
    const companyId = cleanText(vehicle.companyId, 120);
    const file = bucket.file(storagePath);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch (error) {
      logger.warn("[documentIntelligence][metadata]", {
        vehicleId,
        code: cleanText(error?.code, 80),
      });
      throw new HttpsError("not-found", "Fisierul documentului nu exista in Storage.");
    }
    const sizeBytes = Number(metadata?.size || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > DOCUMENT_JOB_MAX_BYTES) {
      throw new HttpsError(
        "invalid-argument",
        "Documentul este gol sau depaseste limita de 18 MB."
      );
    }
    const contentType = inferContentType(
      fileName,
      metadata?.contentType || request.data?.contentType
    );
    if (!isSupportedDocumentMime(contentType)) {
      throw new HttpsError("invalid-argument", "Tipul documentului nu poate fi analizat automat.");
    }
    const [buffer] = await file.download();
    const fileHash = sha256(buffer);
    const jobId = buildDocumentJobId(companyId, fileHash);
    const jobRef = db.collection("documentIngestionJobs").doc(jobId);
    const rateBucket = new Date().toISOString().slice(0, 13).replace(/[-T:]/g, "");
    const rateRef = db
      .collection("documentIngestionRateLimits")
      .doc(`${request.auth.uid}_${rateBucket}`);
    const now = Date.now();

    const outcome = await db.runTransaction(async (tx) => {
      const [existingSnap, rateSnap] = await Promise.all([tx.get(jobRef), tx.get(rateRef)]);
      if (existingSnap.exists && cleanText(existingSnap.data()?.status, 40) !== "failed") {
        return { created: false, data: existingSnap.data() || {} };
      }
      const currentCount = Number(rateSnap.data()?.count || 0);
      if (currentCount >= DOCUMENT_JOB_RATE_LIMIT_PER_HOUR) {
        throw new HttpsError(
          "resource-exhausted",
          "Limita orara pentru analiza documentelor a fost atinsa."
        );
      }
      const jobData = {
        schemaVersion: DOCUMENT_JOB_SCHEMA_VERSION,
        extractionVersion: DOCUMENT_EXTRACTION_VERSION,
        companyId,
        entityType: "vehicle",
        sourceEntityId: vehicleId,
        sourceDocumentId: documentId,
        storagePath,
        fileName,
        contentType,
        sizeBytes,
        sha256: fileHash,
        dedupeKey: `${companyId}:${fileHash}:${DOCUMENT_EXTRACTION_VERSION}:${DOCUMENT_JOB_SCHEMA_VERSION}`,
        status: "queued",
        attempts: existingSnap.exists ? Number(existingSnap.data()?.attempts || 0) : 0,
        createdByUserId: request.auth.uid,
        createdAt: existingSnap.exists ? Number(existingSnap.data()?.createdAt || now) : now,
        createdAtServer: existingSnap.exists
          ? existingSnap.data()?.createdAtServer || fieldValue.serverTimestamp()
          : fieldValue.serverTimestamp(),
        updatedAt: now,
        updatedAtServer: fieldValue.serverTimestamp(),
        expiresAt: new Date(now + 90 * 24 * 60 * 60 * 1000),
        result: null,
        errorCode: "",
      };
      tx.set(jobRef, jobData, { merge: false });
      tx.set(
        rateRef,
        {
          companyId,
          userId: request.auth.uid,
          count: currentCount + 1,
          bucket: rateBucket,
          updatedAt: now,
          updatedAtServer: fieldValue.serverTimestamp(),
          expiresAt: new Date(now + 48 * 60 * 60 * 1000),
        },
        { merge: true }
      );
      return { created: true, data: jobData };
    });
    return { ...sanitizeJob(jobId, outcome.data), created: outcome.created };
  }

  async function claimQueuedJob(jobRef, workerId) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      const data = snap.data() || {};
      if (!snap.exists || cleanText(data.status, 40) !== "queued") return null;
      const attempts = Number(data.attempts || 0);
      if (attempts >= DOCUMENT_JOB_MAX_ATTEMPTS) {
        tx.update(jobRef, {
          status: "failed",
          errorCode: "attempt_limit",
          updatedAt: Date.now(),
          updatedAtServer: fieldValue.serverTimestamp(),
        });
        return null;
      }
      tx.update(jobRef, {
        status: "processing",
        attempts: attempts + 1,
        leaseOwner: workerId,
        leaseExpiresAt: new Date(Date.now() + 3 * 60 * 1000),
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      return { ...data, attempts: attempts + 1 };
    });
  }

  async function requestExtraction(job) {
    const apiKey = openaiApiKey.value() || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("openai_not_configured");
    const [buffer] = await bucket.file(job.storagePath).download();
    if (!buffer?.length || buffer.length > DOCUMENT_JOB_MAX_BYTES)
      throw new Error("invalid_document_size");
    const base64 = buffer.toString("base64");
    const fileInput = job.contentType.startsWith("image/")
      ? { type: "input_image", image_url: `data:${job.contentType};base64,${base64}` }
      : {
          type: "input_file",
          filename: job.fileName,
          file_data: `data:${job.contentType};base64,${base64}`,
        };
    const model = cleanText(process.env.OPENAI_DOCUMENT_MODEL, 80) || "gpt-4.1-mini";
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [fileInput, { type: "input_text", text: buildVehicleDocumentPrompt() }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "workcontrol_vehicle_document_v1",
            strict: true,
            schema: VEHICLE_DOCUMENT_EXTRACTION_SCHEMA,
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`openai_http_${response.status}`);
    const payload = await response.json();
    const outputText = extractResponseText(payload);
    if (!outputText) throw new Error("empty_openai_response");
    let raw;
    try {
      raw = JSON.parse(outputText);
    } catch {
      throw new Error("invalid_openai_json");
    }
    return {
      result: normalizeExtraction(raw),
      model,
      usage: {
        inputTokens: Number(payload?.usage?.input_tokens || 0),
        outputTokens: Number(payload?.usage?.output_tokens || 0),
        totalTokens: Number(payload?.usage?.total_tokens || 0),
      },
    };
  }

  async function processDocumentIngestionJob(event) {
    const after = event.data?.after;
    if (!after?.exists || cleanText(after.data()?.status, 40) !== "queued") return;
    const jobRef = after.ref;
    const workerId = cleanText(event.id, 160) || crypto.randomUUID();
    const job = await claimQueuedJob(jobRef, workerId);
    if (!job) return;
    try {
      const extraction = await requestExtraction(job);
      await jobRef.update({
        status: "needs_review",
        result: extraction.result,
        model: extraction.model,
        usage: extraction.usage,
        completedAt: Date.now(),
        completedAtServer: fieldValue.serverTimestamp(),
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
        leaseOwner: fieldValue.delete(),
        leaseExpiresAt: fieldValue.delete(),
        errorCode: "",
      });
    } catch (error) {
      const errorCode = cleanText(error?.message, 100) || "document_processing_failed";
      logger.error("[documentIntelligence][process]", {
        jobId: jobRef.id,
        companyId: cleanText(job.companyId, 120),
        errorCode,
      });
      await jobRef.update({
        status: "failed",
        errorCode,
        failedAt: Date.now(),
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
        leaseOwner: fieldValue.delete(),
        leaseExpiresAt: fieldValue.delete(),
      });
    }
  }

  async function loadJobAndVehicleForActor(request, options = {}) {
    const jobId = cleanText(request.data?.jobId, 80);
    const vehicleId = cleanText(request.data?.vehicleId, 160);
    const documentId = cleanText(request.data?.documentId, 160);
    if (!jobId || !vehicleId || !documentId) {
      throw new HttpsError("invalid-argument", "Referinta documentului este incompleta.");
    }
    const [jobSnap, vehicleContext] = await Promise.all([
      db.collection("documentIngestionJobs").doc(jobId).get(),
      loadVehicleForActor(request, vehicleId, options),
    ]);
    if (!jobSnap.exists) throw new HttpsError("not-found", "Analiza documentului nu exista.");
    const job = jobSnap.data() || {};
    if (cleanText(job.companyId, 120) !== cleanText(vehicleContext.vehicle.companyId, 120)) {
      throw new HttpsError("permission-denied", "Analiza nu apartine firmei vehiculului.");
    }
    const document = Array.isArray(vehicleContext.vehicle.documents)
      ? vehicleContext.vehicle.documents.find((item) => cleanText(item?.id, 160) === documentId)
      : null;
    if (!document || cleanText(document.intelligenceJobId, 80) !== jobId) {
      throw new HttpsError("failed-precondition", "Documentul nu este asociat acestei analize.");
    }
    return { jobId, vehicleId, documentId, jobSnap, job, document, ...vehicleContext };
  }

  async function getVehicleDocumentIngestionJob(request) {
    const context = await loadJobAndVehicleForActor(request);
    const decisionId = buildDocumentOperationId(
      context.jobId,
      context.vehicleId,
      context.documentId
    );
    const decisionSnap = await db.collection("documentReviewDecisions").doc(decisionId).get();
    return sanitizeJob(
      context.jobId,
      context.job,
      decisionSnap.exists ? decisionSnap.data() : null
    );
  }

  async function retryVehicleDocumentIngestionJob(request) {
    const context = await loadJobAndVehicleForActor(request, { requireReview: true });
    const jobRef = context.jobSnap.ref;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      const data = snap.data() || {};
      if (cleanText(data.status, 40) !== "failed") return;
      if (Number(data.attempts || 0) >= DOCUMENT_JOB_MAX_ATTEMPTS) {
        throw new HttpsError("failed-precondition", "Analiza a atins limita de reincercari.");
      }
      tx.update(jobRef, {
        status: "queued",
        errorCode: "",
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
    });
    return { jobId: context.jobId, status: "queued" };
  }

  function flattenAnalysis(result) {
    const confidences = [
      result.documentType?.confidence,
      result.expiryDate?.confidence,
      result.issueDate?.confidence,
      result.policyNumber?.confidence,
      result.providerName?.confidence,
      result.vehiclePlateNumber?.confidence,
    ].map(cleanConfidence);
    return {
      documentType: normalizeDocumentType(result.documentType?.value),
      expiryDate: cleanText(result.expiryDate?.value, 10),
      issueDate: cleanText(result.issueDate?.value, 10),
      policyNumber: cleanText(result.policyNumber?.value, 160),
      providerName: cleanText(result.providerName?.value, 200),
      vehiclePlateNumber: cleanText(result.vehiclePlateNumber?.value, 40),
      confidence: Math.max(...confidences, 0),
      fieldConfidence: {
        documentType: confidences[0],
        expiryDate: confidences[1],
        issueDate: confidences[2],
        policyNumber: confidences[3],
        providerName: confidences[4],
        vehiclePlateNumber: confidences[5],
      },
      notes: cleanText(result.notes, 500),
      analyzedAt: Date.now(),
    };
  }

  async function applyVehicleDocumentIngestionJob(request) {
    if (request.data?.confirm !== true) {
      throw new HttpsError("failed-precondition", "Aplicarea necesita confirmare explicita.");
    }
    const context = await loadJobAndVehicleForActor(request, { requireReview: true });
    const acceptedFields = Array.isArray(request.data?.acceptedFields)
      ? [
          ...new Set(
            request.data.acceptedFields
              .map((item) => cleanText(item, 40))
              .filter((item) => APPLY_FIELDS.has(item))
          ),
        ]
      : [];
    if (!acceptedFields.length)
      throw new HttpsError("invalid-argument", "Nu ai selectat campuri de aplicat.");
    const operationId = buildDocumentOperationId(
      context.jobId,
      context.vehicleId,
      context.documentId
    );
    const operationRef = db.collection("documentApplyOperations").doc(operationId);
    const decisionRef = db.collection("documentReviewDecisions").doc(operationId);
    const jobRef = context.jobSnap.ref;
    const now = Date.now();

    const result = await db.runTransaction(async (tx) => {
      const [jobSnap, vehicleSnap, operationSnap] = await Promise.all([
        tx.get(jobRef),
        tx.get(context.vehicleRef),
        tx.get(operationRef),
      ]);
      if (operationSnap.exists && cleanText(operationSnap.data()?.status, 40) === "applied") {
        return { duplicate: true };
      }
      const job = jobSnap.data() || {};
      if (cleanText(job.status, 40) !== "needs_review" || !job.result) {
        throw new HttpsError("failed-precondition", "Analiza nu este pregatita pentru verificare.");
      }
      const vehicle = vehicleSnap.data() || {};
      const documents = Array.isArray(vehicle.documents) ? [...vehicle.documents] : [];
      const documentIndex = documents.findIndex(
        (item) => cleanText(item?.id, 160) === context.documentId
      );
      if (
        documentIndex < 0 ||
        cleanText(documents[documentIndex]?.intelligenceJobId, 80) !== context.jobId
      ) {
        throw new HttpsError("failed-precondition", "Documentul s-a schimbat intre timp.");
      }
      const beforeDocument = documents[documentIndex];
      const analysis = flattenAnalysis(job.result);
      const nextCategory =
        acceptedFields.includes("documentType") && analysis.documentType !== "unknown"
          ? analysis.documentType
          : beforeDocument.category;
      const suggestedExpiry = analysis.expiryDate;
      const nextExpiry =
        acceptedFields.includes("expiryDate") && isValidIsoDate(suggestedExpiry)
          ? suggestedExpiry
          : cleanText(beforeDocument.expiryDate, 10);
      const afterDocument = {
        ...beforeDocument,
        category: nextCategory,
        expiryDate: nextExpiry,
        expirySource:
          nextExpiry !== cleanText(beforeDocument.expiryDate, 10)
            ? "ai_confirmed"
            : beforeDocument.expirySource || "",
        aiAnalysis: analysis,
        intelligenceStatus: "applied",
        intelligenceReviewedAt: now,
        intelligenceReviewedByUserId: request.auth.uid,
      };
      documents[documentIndex] = afterDocument;
      const expiryFieldByCategory = {
        itp: "nextItpDate",
        rca: "nextRcaDate",
        casco: "nextCascoDate",
        rovinieta: "nextRovinietaDate",
      };
      const expiryField = acceptedFields.includes("expiryDate")
        ? expiryFieldByCategory[nextCategory] || ""
        : "";
      const beforeExpiryValue = expiryField ? cleanText(vehicle[expiryField], 10) : "";
      const vehicleUpdate = {
        documents,
        updatedAt: now,
        updatedAtServer: fieldValue.serverTimestamp(),
      };
      if (expiryField && nextExpiry) vehicleUpdate[expiryField] = nextExpiry;
      tx.update(context.vehicleRef, vehicleUpdate);
      tx.set(operationRef, {
        companyId: cleanText(vehicle.companyId, 120),
        jobId: context.jobId,
        vehicleId: context.vehicleId,
        documentId: context.documentId,
        acceptedFields,
        beforeDocument,
        afterDocument,
        expiryField,
        beforeExpiryValue,
        afterExpiryValue: expiryField ? nextExpiry : "",
        status: "applied",
        appliedByUserId: request.auth.uid,
        appliedAt: now,
        appliedAtServer: fieldValue.serverTimestamp(),
      });
      tx.set(decisionRef, {
        companyId: cleanText(vehicle.companyId, 120),
        jobId: context.jobId,
        vehicleId: context.vehicleId,
        documentId: context.documentId,
        status: "applied",
        reviewedByUserId: request.auth.uid,
        reviewedAt: now,
        reviewedAtServer: fieldValue.serverTimestamp(),
      });
      tx.update(jobRef, {
        lastReviewedAt: now,
        lastReviewedAtServer: fieldValue.serverTimestamp(),
        updatedAt: now,
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(
        db.collection("auditLogs").doc(),
        buildAuditPayload({
          companyId: cleanText(vehicle.companyId, 120),
          category: "vehicles",
          action: "vehicle_document_ai_applied",
          title: "Date document confirmate",
          message: `Datele documentului ${cleanText(beforeDocument.name, 160)} au fost confirmate.`,
          actorUserId: request.auth.uid,
          actorUserName: cleanText(
            context.actor.user?.fullName || context.actor.user?.displayName,
            160
          ),
          entityId: context.vehicleId,
          entityLabel: cleanText(vehicle.plateNumber, 40),
          path: `/vehicles/${context.vehicleId}?tab=documents`,
          metadata: { documentId: context.documentId, jobId: context.jobId, acceptedFields },
        })
      );
      return { duplicate: false, category: nextCategory, expiryDate: nextExpiry };
    });
    return { operationId, ...result };
  }

  async function rejectVehicleDocumentIngestionJob(request) {
    if (request.data?.confirm !== true) {
      throw new HttpsError("failed-precondition", "Respingerea necesita confirmare explicita.");
    }
    const context = await loadJobAndVehicleForActor(request, { requireReview: true });
    const decisionId = buildDocumentOperationId(
      context.jobId,
      context.vehicleId,
      context.documentId
    );
    const decisionRef = db.collection("documentReviewDecisions").doc(decisionId);
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const vehicleSnap = await tx.get(context.vehicleRef);
      const vehicle = vehicleSnap.data() || {};
      const documents = Array.isArray(vehicle.documents) ? [...vehicle.documents] : [];
      const index = documents.findIndex((item) => cleanText(item?.id, 160) === context.documentId);
      if (index < 0 || cleanText(documents[index]?.intelligenceJobId, 80) !== context.jobId) {
        throw new HttpsError("failed-precondition", "Documentul s-a schimbat intre timp.");
      }
      documents[index] = {
        ...documents[index],
        intelligenceStatus: "rejected",
        intelligenceReviewedAt: now,
        intelligenceReviewedByUserId: request.auth.uid,
      };
      tx.update(context.vehicleRef, {
        documents,
        updatedAt: now,
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.set(decisionRef, {
        companyId: cleanText(vehicle.companyId, 120),
        jobId: context.jobId,
        vehicleId: context.vehicleId,
        documentId: context.documentId,
        status: "rejected",
        reviewedByUserId: request.auth.uid,
        reviewedAt: now,
        reviewedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(
        db.collection("auditLogs").doc(),
        buildAuditPayload({
          companyId: cleanText(vehicle.companyId, 120),
          category: "vehicles",
          action: "vehicle_document_ai_rejected",
          title: "Analiza document respinsa",
          message: `Sugestiile pentru ${cleanText(documents[index].name, 160)} au fost respinse.`,
          actorUserId: request.auth.uid,
          actorUserName: cleanText(
            context.actor.user?.fullName || context.actor.user?.displayName,
            160
          ),
          entityId: context.vehicleId,
          entityLabel: cleanText(vehicle.plateNumber, 40),
          path: `/vehicles/${context.vehicleId}?tab=documents`,
          metadata: { documentId: context.documentId, jobId: context.jobId },
        })
      );
    });
    return { decisionId, status: "rejected" };
  }

  async function rollbackVehicleDocumentIngestionJob(request) {
    if (request.data?.confirm !== true) {
      throw new HttpsError("failed-precondition", "Rollback-ul necesita confirmare explicita.");
    }
    const context = await loadJobAndVehicleForActor(request, { requireReview: true });
    const operationId = buildDocumentOperationId(
      context.jobId,
      context.vehicleId,
      context.documentId
    );
    const operationRef = db.collection("documentApplyOperations").doc(operationId);
    const decisionRef = db.collection("documentReviewDecisions").doc(operationId);
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const [vehicleSnap, operationSnap] = await Promise.all([
        tx.get(context.vehicleRef),
        tx.get(operationRef),
      ]);
      if (!operationSnap.exists || cleanText(operationSnap.data()?.status, 40) !== "applied") {
        throw new HttpsError("failed-precondition", "Nu exista o aplicare activa pentru rollback.");
      }
      const vehicle = vehicleSnap.data() || {};
      const operation = operationSnap.data() || {};
      const documents = Array.isArray(vehicle.documents) ? [...vehicle.documents] : [];
      const index = documents.findIndex((item) => cleanText(item?.id, 160) === context.documentId);
      if (index < 0 || cleanText(documents[index]?.intelligenceJobId, 80) !== context.jobId) {
        throw new HttpsError("failed-precondition", "Documentul s-a schimbat dupa aplicare.");
      }
      const expiryField = cleanText(operation.expiryField, 40);
      if (
        expiryField &&
        cleanText(vehicle[expiryField], 10) !== cleanText(operation.afterExpiryValue, 10)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Data a fost modificata ulterior si nu poate fi suprascrisa prin rollback."
        );
      }
      documents[index] = {
        ...(operation.beforeDocument || documents[index]),
        intelligenceStatus: "needs_review",
      };
      const vehicleUpdate = {
        documents,
        updatedAt: now,
        updatedAtServer: fieldValue.serverTimestamp(),
      };
      if (expiryField) vehicleUpdate[expiryField] = cleanText(operation.beforeExpiryValue, 10);
      tx.update(context.vehicleRef, vehicleUpdate);
      tx.update(operationRef, {
        status: "rolled_back",
        rolledBackByUserId: request.auth.uid,
        rolledBackAt: now,
        rolledBackAtServer: fieldValue.serverTimestamp(),
      });
      tx.set(decisionRef, {
        companyId: cleanText(vehicle.companyId, 120),
        jobId: context.jobId,
        vehicleId: context.vehicleId,
        documentId: context.documentId,
        status: "rolled_back",
        reviewedByUserId: request.auth.uid,
        reviewedAt: now,
        reviewedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(
        db.collection("auditLogs").doc(),
        buildAuditPayload({
          companyId: cleanText(vehicle.companyId, 120),
          category: "vehicles",
          action: "vehicle_document_ai_rolled_back",
          title: "Aplicare document anulata",
          message: `Datele aplicate din ${cleanText(documents[index].name, 160)} au fost anulate.`,
          actorUserId: request.auth.uid,
          actorUserName: cleanText(
            context.actor.user?.fullName || context.actor.user?.displayName,
            160
          ),
          entityId: context.vehicleId,
          entityLabel: cleanText(vehicle.plateNumber, 40),
          path: `/vehicles/${context.vehicleId}?tab=documents`,
          metadata: { documentId: context.documentId, jobId: context.jobId, operationId },
        })
      );
    });
    return { operationId, status: "rolled_back" };
  }

  return {
    createVehicleDocumentIngestionJob,
    processDocumentIngestionJob,
    getVehicleDocumentIngestionJob,
    retryVehicleDocumentIngestionJob,
    applyVehicleDocumentIngestionJob,
    rejectVehicleDocumentIngestionJob,
    rollbackVehicleDocumentIngestionJob,
  };
}

module.exports = {
  DOCUMENT_EXTRACTION_VERSION,
  DOCUMENT_JOB_SCHEMA_VERSION,
  VEHICLE_DOCUMENT_EXTRACTION_SCHEMA,
  buildDocumentJobId,
  buildDocumentOperationId,
  createDocumentIntelligenceHandlers,
  isValidIsoDate,
  normalizeExtraction,
};
