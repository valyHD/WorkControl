const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2/options');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { OAuth2Client } = require('google-auth-library');
const { createGmailMimeBoundary } = require('./gmailMime');
const { sendRawGmailMessage } = require('./gmailApi');
const {
  getEcbRates,
  refreshBillingMetrics: refreshBillingMetricsCache,
} = require('./billingMetricsRuntime');
const { getLiveFirebaseCostEstimate } = require('./liveCostEstimateRuntime');
const {
  getFirestoreCostControl,
  normalizeFirestoreCostControl,
  saveFirestoreCostControl,
} = require('./firestoreCostControl');
const {
  buildLocalAssistantTraceInterpretation,
  buildAssistantTraceDocument,
  fingerprintAssistantTranscript,
  isAssistantOutcomeTransitionAllowed,
  normalizeAssistantOutcomePayload,
} = require('./assistantObservability');
const {
  decodeAssistantAudioPayload,
  requestAssistantTranscription,
} = require('./assistantTranscription');
const { createSecurityHandlers } = require('./securityActions');
const { createDocumentIntelligenceHandlers } = require('./documentIntelligence');
const {
  buildVehicleOperationalView,
  VEHICLE_OPERATIONAL_VIEW_VERSION,
} = require('./vehicleOperationalView');
const { buildInternalCompanyContext } = require('./internalRequestContext');
const {
  buildUserOperationalView,
  cleanIds: getUserOperationalCompanyIds,
  USER_OPERATIONAL_VIEW_VERSION,
  userOperationalViewId,
} = require('./userOperationalView');
const { writeProjectionIfChanged } = require('./projectionPayload');
const { GLOBAL_RUNTIME_OPTIONS } = require('./runtimeOptions');
const {
  buildDeliveryKey,
  buildNotificationForSchedule,
  buildScheduleLeasePatch,
  buildScheduleSyncPlan,
  canClaimSchedule,
  getScheduleAdvancePatch,
  stableHash,
} = require('./expiryAutomation');
const {
  TIMESHEET_REMINDER_WORKER,
  buildTimesheetScheduleSyncPlan,
  getNextTimesheetSchedulePatch,
  isStaleTimesheetSchedule,
  scheduleToRule,
} = require('./timesheetReminderSchedules');
const {
  PART_ORDER_REMINDER_WORKER,
  buildPartOrderReminderSchedules,
  buildPartOrderScheduleAdvancePatch,
  buildPartOrderScheduleSyncPlan,
  buildPartOrderScheduleTerminalPatch,
  getPartOrderReminderNextRunAt,
  normalizePartOrder,
} = require('./partOrderReminderSchedules');
const {
  EXPENSE_DOCUMENT_CACHE_SCHEMA_VERSION,
  EXPENSE_DOCUMENT_EXTRACTION_VERSION,
  buildExpenseDocumentCacheId,
  sha256Buffer,
} = require('./expenseDocumentCache');

setGlobalOptions(GLOBAL_RUNTIME_OPTIONS);

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const securityHandlers = createSecurityHandlers({
  db,
  authAdmin: admin.auth(),
  fieldValue: FieldValue,
  HttpsError,
  logger,
});
const openaiApiKey = defineSecret('OPENAI_API_KEY');
const gmailOAuthClientId = defineSecret('GMAIL_OAUTH_CLIENT_ID');
const gmailOAuthClientSecret = defineSecret('GMAIL_OAUTH_CLIENT_SECRET');
const gmailOAuthRefreshToken = defineSecret('GMAIL_OAUTH_REFRESH_TOKEN');
const SECURITY_CALLABLE_OPTIONS = {
  region: 'europe-west1',
  enforceAppCheck: process.env.WORKCONTROL_ENFORCE_APP_CHECK === 'true',
};
const DOCUMENT_CALLABLE_OPTIONS = {
  ...SECURITY_CALLABLE_OPTIONS,
  timeoutSeconds: 120,
  memory: '512MiB',
};
const documentIntelligenceHandlers = createDocumentIntelligenceHandlers({
  db,
  bucket: admin.storage().bucket(),
  fieldValue: FieldValue,
  HttpsError,
  logger,
  openaiApiKey,
  assertActiveInternalRequest,
  canAccessCompany: internalContextCanAccessCompany,
  buildAuditPayload,
});
const VEHICLE_POSITION_ARCHIVE_RETENTION_DAYS = 30;
const VEHICLE_POSITION_ARCHIVE_MAX_DAYS_PER_RUN = 80;
const FIRESTORE_DELETE_BATCH_SIZE = 450;
const FLEET_OVERVIEW_CACHE_MS = 20_000;
let fleetOverviewCache = null;
let fleetOverviewRequest = null;

exports.adminCreateUser = onCall(SECURITY_CALLABLE_OPTIONS, securityHandlers.adminCreateUser);
exports.registerInternalAccount = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.registerInternalAccount
);
exports.setPrimaryCompany = onCall(SECURITY_CALLABLE_OPTIONS, securityHandlers.setPrimaryCompany);
exports.listCompanyChoices = onCall(SECURITY_CALLABLE_OPTIONS, securityHandlers.listCompanyChoices);
exports.claimInitialCompany = onCall(SECURITY_CALLABLE_OPTIONS, securityHandlers.claimInitialCompany);
exports.assignUsersToCompany = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.assignUsersToCompany
);
exports.recordAuditEvent = onCall(SECURITY_CALLABLE_OPTIONS, securityHandlers.recordAuditEvent);
exports.dispatchNotificationEvent = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.dispatchNotificationEvent
);
exports.startTimesheetSecure = onCall(SECURITY_CALLABLE_OPTIONS, securityHandlers.startTimesheet);
exports.stopTimesheetSecure = onCall(SECURITY_CALLABLE_OPTIONS, securityHandlers.stopTimesheet);
exports.updateOwnTimesheetLocation = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.updateOwnTimesheetLocation
);
exports.requestVehicleTransfer = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.requestVehicleTransfer
);
exports.setVehicleAssignments = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.setVehicleAssignments
);
exports.acceptVehicleTransfer = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.acceptVehicleTransfer
);
exports.claimVehicle = onCall(SECURITY_CALLABLE_OPTIONS, securityHandlers.claimVehicle);
exports.updateVehicleMileage = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.updateVehicleMileage
);
exports.requestVehicleCommand = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.requestVehicleCommand
);
exports.requestToolTransfer = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.requestToolTransfer
);
exports.acceptToolTransfer = onCall(
  SECURITY_CALLABLE_OPTIONS,
  securityHandlers.acceptToolTransfer
);
exports.claimTool = onCall(SECURITY_CALLABLE_OPTIONS, securityHandlers.claimTool);
exports.createVehicleDocumentIngestionJob = onCall(
  DOCUMENT_CALLABLE_OPTIONS,
  documentIntelligenceHandlers.createVehicleDocumentIngestionJob
);
exports.getVehicleDocumentIngestionJob = onCall(
  SECURITY_CALLABLE_OPTIONS,
  documentIntelligenceHandlers.getVehicleDocumentIngestionJob
);
exports.retryVehicleDocumentIngestionJob = onCall(
  SECURITY_CALLABLE_OPTIONS,
  documentIntelligenceHandlers.retryVehicleDocumentIngestionJob
);
exports.applyVehicleDocumentIngestionJob = onCall(
  SECURITY_CALLABLE_OPTIONS,
  documentIntelligenceHandlers.applyVehicleDocumentIngestionJob
);
exports.rejectVehicleDocumentIngestionJob = onCall(
  SECURITY_CALLABLE_OPTIONS,
  documentIntelligenceHandlers.rejectVehicleDocumentIngestionJob
);
exports.rollbackVehicleDocumentIngestionJob = onCall(
  SECURITY_CALLABLE_OPTIONS,
  documentIntelligenceHandlers.rollbackVehicleDocumentIngestionJob
);
exports.createMaintenanceGmailDraft = onCall(
  {
    ...SECURITY_CALLABLE_OPTIONS,
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [gmailOAuthClientId, gmailOAuthClientSecret, gmailOAuthRefreshToken],
  },
  sendMaintenanceGmailReport
);
exports.processDocumentIngestionJob = onDocumentWritten(
  {
    document: 'documentIngestionJobs/{jobId}',
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '1GiB',
    secrets: [openaiApiKey],
    retry: false,
  },
  documentIntelligenceHandlers.processDocumentIngestionJob
);

exports.syncVehicleOperationalView = onDocumentWritten(
  {
    document: 'vehicles/{vehicleId}',
    region: 'europe-west1',
  },
  async (event) => {
    const vehicleId = event.params.vehicleId;
    const after = event.data?.after;
    const beforeData = event.data?.before?.exists ? event.data.before.data() || {} : {};
    const operationalRef = db.collection('vehicleOperationalViews').doc(vehicleId);
    const trackerAdminRef = db.collection('vehicleTrackerAdmin').doc(vehicleId);

    if (!after?.exists) {
      const scheduleDeletes = buildScheduleSyncPlan(
        vehicleId,
        beforeData,
        null,
        Date.parse(event.time || '') || Date.now()
      ).map((operation) => db.collection('notificationSchedules').doc(operation.id).delete().catch(() => undefined));
      await Promise.all([
        operationalRef.delete().catch(() => undefined),
        trackerAdminRef.delete().catch(() => undefined),
        ...scheduleDeletes,
      ]);
      return;
    }

    const afterData = after.data() || {};
    const beforeOperational = buildVehicleOperationalView(vehicleId, beforeData);
    const afterOperational = buildVehicleOperationalView(vehicleId, afterData);
    const beforeTrackerAdmin = {
      companyId: toSafeString(beforeData.companyId),
      tracker: beforeData.tracker || null,
      gpsDataUsage: beforeData.gpsDataUsage || null,
      trackerConfig: beforeData.trackerConfig || null,
    };
    const afterTrackerAdmin = {
      companyId: toSafeString(afterData.companyId),
      tracker: afterData.tracker || null,
      gpsDataUsage: afterData.gpsDataUsage || null,
      trackerConfig: afterData.trackerConfig || null,
    };
    const sourceUpdatedAtMs = after.updateTime?.toMillis?.() || Date.parse(event.time || '') || Date.now();
    const writes = [];
    if (JSON.stringify(beforeOperational) !== JSON.stringify(afterOperational)) {
      writes.push(writeProjectionIfChanged({
        db,
        ref: operationalRef,
        payload: afterOperational,
        version: VEHICLE_OPERATIONAL_VIEW_VERSION,
        sourceUpdatedAtMs,
        serverTimestamp: () => FieldValue.serverTimestamp(),
      }));
    }
    if (JSON.stringify(beforeTrackerAdmin) !== JSON.stringify(afterTrackerAdmin)) {
      writes.push(writeProjectionIfChanged({
        db,
        ref: trackerAdminRef,
        payload: afterTrackerAdmin,
        version: 1,
        sourceUpdatedAtMs,
        serverTimestamp: () => FieldValue.serverTimestamp(),
      }));
    }
    const schedulePlan = buildScheduleSyncPlan(
      vehicleId,
      beforeData,
      afterData,
      sourceUpdatedAtMs
    );
    schedulePlan.forEach((operation) => {
      const scheduleRef = db.collection('notificationSchedules').doc(operation.id);
      if (operation.type === 'delete') {
        writes.push(scheduleRef.delete().catch(() => undefined));
        return;
      }
      writes.push(scheduleRef.set({
        ...operation.value,
        createdAt: sourceUpdatedAtMs,
        createdAtServer: FieldValue.serverTimestamp(),
        updatedAt: sourceUpdatedAtMs,
        updatedAtServer: FieldValue.serverTimestamp(),
      }, { merge: false }));
    });
    await Promise.all(writes);
  }
);

exports.syncNotificationRuleSchedules = onDocumentWritten(
  {
    document: 'notificationRules/{ruleId}',
    region: 'europe-west1',
  },
  async (event) => {
    const ruleId = event.params.ruleId;
    const beforeData = event.data?.before?.exists ? event.data.before.data() || {} : null;
    const afterData = event.data?.after?.exists ? event.data.after.data() || {} : null;
    const sourceUpdatedAtMs =
      event.data?.after?.updateTime?.toMillis?.() ||
      Date.parse(event.time || '') ||
      Date.now();
    const plan = buildTimesheetScheduleSyncPlan(
      ruleId,
      beforeData,
      afterData,
      sourceUpdatedAtMs
    );

    await Promise.all(plan.map((operation) => {
      const scheduleRef = db.collection('notificationSchedules').doc(operation.id);
      if (operation.type === 'delete') {
        return scheduleRef.delete().catch(() => undefined);
      }
      return scheduleRef.set({
        ...operation.value,
        createdAt: sourceUpdatedAtMs,
        createdAtServer: FieldValue.serverTimestamp(),
        updatedAt: sourceUpdatedAtMs,
        updatedAtServer: FieldValue.serverTimestamp(),
      }, { merge: false });
    }));

    logger.info('Programari remindere pontaj sincronizate.', {
      ruleId,
      operations: plan.length,
    });
  }
);

exports.syncMaintenancePartOrderReminderSchedule = onDocumentWritten(
  {
    document: 'maintenancePartOrders/{orderId}',
    region: 'europe-west1',
  },
  async (event) => {
    const orderId = event.params.orderId;
    const beforeData = event.data?.before?.exists ? event.data.before.data() || {} : null;
    const afterData = event.data?.after?.exists ? event.data.after.data() || {} : null;
    const sourceUpdatedAtMs =
      event.data?.after?.updateTime?.toMillis?.() ||
      Date.parse(event.time || '') ||
      Date.now();
    const plan = buildPartOrderScheduleSyncPlan(orderId, beforeData, afterData);

    await Promise.all(plan.map((operation) => {
      const scheduleRef = db.collection('notificationSchedules').doc(operation.id);
      if (operation.type === 'delete') {
        return scheduleRef.delete().catch(() => undefined);
      }
      return scheduleRef.set({
        ...operation.value,
        createdAt: sourceUpdatedAtMs,
        createdAtServer: FieldValue.serverTimestamp(),
        updatedAt: sourceUpdatedAtMs,
        updatedAtServer: FieldValue.serverTimestamp(),
      }, { merge: false });
    }));

    logger.info('Programare reminder comanda piese sincronizata.', {
      orderId,
      operations: plan.length,
    });
  }
);

exports.syncUserOperationalViews = onDocumentWritten(
  {
    document: 'users/{userId}',
    region: 'europe-west1',
  },
  async (event) => {
    const userId = event.params.userId;
    const beforeData = event.data?.before?.exists ? event.data.before.data() || {} : {};
    const afterData = event.data?.after?.exists ? event.data.after.data() || {} : null;
    const beforeCompanies = getUserOperationalCompanyIds(
      beforeData.companyIds,
      beforeData.primaryCompanyId
    );
    const afterCompanies = afterData
      ? getUserOperationalCompanyIds(afterData.companyIds, afterData.primaryCompanyId)
      : [];
    const allCompanies = [...new Set([...beforeCompanies, ...afterCompanies])];
    const sourceUpdatedAtMs = event.data?.after?.updateTime?.toMillis?.()
      || Date.parse(event.time || '')
      || Date.now();
    const writes = allCompanies.map((companyId) => {
      const ref = db.collection('userOperationalViews').doc(userOperationalViewId(companyId, userId));
      if (!afterData || !afterCompanies.includes(companyId)) return ref.delete().catch(() => undefined);
      const nextView = buildUserOperationalView(userId, companyId, afterData);
      const previousView = beforeCompanies.includes(companyId)
        ? buildUserOperationalView(userId, companyId, beforeData)
        : null;
      if (previousView && JSON.stringify(previousView) === JSON.stringify(nextView)) {
        return Promise.resolve(false);
      }
      return writeProjectionIfChanged({
        db,
        ref,
        payload: nextView,
        version: USER_OPERATIONAL_VIEW_VERSION,
        sourceUpdatedAtMs,
        serverTimestamp: () => FieldValue.serverTimestamp(),
      });
    });
    await Promise.all(writes);
  }
);

const VEHICLE_DOC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentType: {
      type: 'string',
      enum: ['itp', 'rca', 'casco', 'rovinieta', 'service', 'leasing_rate', 'amenda', 'other', 'unknown'],
    },
    expiryDate: {
      type: 'string',
      description: 'Data expirarii in format YYYY-MM-DD sau string gol daca nu exista.',
    },
    issueDate: {
      type: 'string',
      description: 'Data emiterii in format YYYY-MM-DD sau string gol daca nu exista.',
    },
    policyNumber: {
      type: 'string',
      description: 'Numar polita, serie, bon sau document, daca exista.',
    },
    providerName: {
      type: 'string',
      description: 'Asigurator, emitent sau service, daca exista.',
    },
    vehiclePlateNumber: {
      type: 'string',
      description: 'Numar de inmatriculare gasit in document.',
    },
    confidence: {
      type: 'number',
      description: 'Incredere intre 0 si 1.',
    },
    notes: {
      type: 'string',
      description: 'Observatii scurte despre campurile gasite.',
    },
  },
  required: [
    'documentType',
    'expiryDate',
    'issueDate',
    'policyNumber',
    'providerName',
    'vehiclePlateNumber',
    'confidence',
    'notes',
  ],
};

const EXPENSE_DOC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentKind: {
      type: 'string',
      enum: ['bon', 'factura', 'chitanta', 'proforma', 'other', 'unknown'],
    },
    supplierName: { type: 'string' },
    supplierTaxId: { type: 'string' },
    buyerCompanyName: { type: 'string' },
    buyerTaxId: { type: 'string' },
    documentNumber: { type: 'string' },
    documentDate: {
      type: 'string',
      description: 'Data documentului in format YYYY-MM-DD sau string gol.',
    },
    dueDate: {
      type: 'string',
      description: 'Scadenta in format YYYY-MM-DD sau string gol.',
    },
    currency: { type: 'string' },
    subtotalAmount: { type: 'number' },
    vatAmount: { type: 'number' },
    totalAmount: { type: 'number' },
    paymentMethod: { type: 'string' },
    expenseCategory: { type: 'string' },
    projectHint: { type: 'string' },
    userHint: { type: 'string' },
    companyHint: { type: 'string' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
          total: { type: 'number' },
        },
        required: ['name', 'quantity', 'unitPrice', 'total'],
      },
    },
    confidence: { type: 'number' },
    notes: { type: 'string' },
  },
  required: [
    'documentKind',
    'supplierName',
    'supplierTaxId',
    'buyerCompanyName',
    'buyerTaxId',
    'documentNumber',
    'documentDate',
    'dueDate',
    'currency',
    'subtotalAmount',
    'vatAmount',
    'totalAmount',
    'paymentMethod',
    'expenseCategory',
    'projectHint',
    'userHint',
    'companyHint',
    'lineItems',
    'confidence',
    'notes',
  ],
};

const EXPENSE_CORE_DOC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentKind: {
      type: 'string',
      enum: ['bon', 'factura', 'chitanta', 'proforma', 'other', 'unknown'],
    },
    supplierName: { type: 'string' },
    supplierTaxId: { type: 'string' },
    buyerCompanyName: { type: 'string' },
    buyerTaxId: { type: 'string' },
    documentNumber: { type: 'string' },
    documentDate: {
      type: 'string',
      description: 'Data documentului in format YYYY-MM-DD sau string gol.',
    },
    dueDate: {
      type: 'string',
      description: 'Scadenta in format YYYY-MM-DD sau string gol.',
    },
    currency: { type: 'string' },
    subtotalAmount: { type: 'number' },
    vatAmount: { type: 'number' },
    totalAmount: { type: 'number' },
    paymentMethod: { type: 'string' },
    expenseCategory: { type: 'string' },
    projectHint: { type: 'string' },
    userHint: { type: 'string' },
    companyHint: { type: 'string' },
    confidence: { type: 'number' },
    notes: { type: 'string' },
  },
  required: [
    'documentKind',
    'supplierName',
    'supplierTaxId',
    'buyerCompanyName',
    'buyerTaxId',
    'documentNumber',
    'documentDate',
    'dueDate',
    'currency',
    'subtotalAmount',
    'vatAmount',
    'totalAmount',
    'paymentMethod',
    'expenseCategory',
    'projectHint',
    'userHint',
    'companyHint',
    'confidence',
    'notes',
  ],
};

const ASSISTANT_COMMAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: {
      type: 'string',
      enum: ['3'],
    },
    commandType: {
      type: 'string',
      enum: ['navigation', 'form_fill', 'entity_update', 'create_entity', 'timesheet_action', 'question', 'unknown'],
    },
    intent: {
      type: 'string',
      enum: [
        'update_vehicle',
        'update_tool',
        'update_project',
        'update_user',
        'start_timesheet',
        'stop_timesheet',
        'create_project',
        'create_vehicle',
        'create_tool',
        'create_maintenance_client',
        'fill_maintenance_client_form',
        'schedule_leave',
        'fill_leave_form',
        'open_vehicle',
        'open_tool',
        'open_project',
        'open_page',
        'click_button',
        'fill_current_page',
        'update_current_page_field',
        'submit_current_form',
        'open_dashboard',
        'open_my_vehicle',
        'open_my_timesheets',
        'open_vehicle_tracker',
        'open_vehicle_live',
        'open_gps_maps',
        'open_leave',
        'open_expense_scan',
        'open_expense_invoices',
        'open_maintenance_report',
        'update_vehicle_field',
        'update_profile_field',
        'update_notification_rule',
        'update_site_settings',
        'open_user_activity',
        'create_manual_notification',
        'unknown',
      ],
    },
    toolCalls: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          input: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              query: { type: 'string' },
              entityQuery: { type: 'string' },
              ruleQuery: { type: 'string' },
              fields: {
                type: 'object',
                additionalProperties: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'boolean' },
                    { type: 'null' },
                    { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
                  ],
                },
              },
              projectId: { type: 'string' },
              projectQuery: { type: 'string' },
              createProjectIfMissing: { type: 'boolean' },
              explanation: { type: 'string' },
              name: { type: 'string' },
            },
            required: [
              'path',
              'query',
              'entityQuery',
              'ruleQuery',
              'fields',
              'projectId',
              'projectQuery',
              'createProjectIfMissing',
              'explanation',
              'name',
            ],
          },
        },
        required: ['id', 'input'],
      },
    },
    entityReferences: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['vehicle', 'tool', 'project', 'user', 'maintenanceClient', 'page', 'currentPage', 'none'] },
          query: { type: 'string' },
          id: { type: 'string' },
        },
        required: ['type', 'query', 'id'],
      },
    },
    missingInformation: {
      type: 'array',
      items: { type: 'string' },
    },
    confirmationRequired: { type: 'boolean' },
    response: { type: 'string' },
    targetModule: {
      type: 'string',
      description: 'Modulul principal WorkControl: vehicles, tools, timesheets, leave, maintenance, expenses, users, notifications, navigation, assistant.',
    },
    entityType: {
      type: 'string',
      enum: ['vehicle', 'tool', 'project', 'user', 'maintenanceClient', 'page', 'currentPage', 'none'],
    },
    entityQuery: {
      type: 'string',
      description: 'Textul folosit pentru cautare: numar masina, marca/model, nume scula, proiect sau user.',
    },
    formSchemaId: {
      type: 'string',
      description: 'Schema formularului controlat, ex: maintenance-client, leave-request, vehicle, tool, user, timesheet sau string gol.',
    },
    fields: {
      type: 'object',
      description: 'Campuri normalizate pentru agent, identice cu fieldsToUpdate cand se modifica sau completeaza date.',
      additionalProperties: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          {
            type: 'array',
            items: {
              anyOf: [{ type: 'string' }, { type: 'number' }],
            },
          },
        ],
      },
    },
    fieldsToUpdate: {
      type: 'object',
      description: 'Campuri naturale si valori noi, ex: {"kilometri":6180,"ITP":"2026-09-20"}.',
      additionalProperties: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          {
            type: 'array',
            items: {
              anyOf: [{ type: 'string' }, { type: 'number' }],
            },
          },
        ],
      },
    },
    dateRange: {
      type: 'object',
      additionalProperties: false,
      properties: {
        startDate: { type: 'string' },
        endDate: { type: 'string' },
      },
      required: ['startDate', 'endDate'],
    },
    shouldNavigate: {
      type: 'boolean',
    },
    shouldFillForm: {
      type: 'boolean',
    },
    shouldUpdateFirestore: {
      type: 'boolean',
    },
    navigation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        shouldNavigate: { type: 'boolean' },
        path: { type: 'string' },
        section: { type: 'string' },
      },
      required: ['shouldNavigate', 'path', 'section'],
    },
    targetText: {
      type: 'string',
      description: 'Text secundar pentru compatibilitate: pagina, raport, client sau mesaj.',
    },
    targetPage: {
      type: 'string',
      description: 'Ruta recomandata pentru executie, ex: /maintenance?tab=clients&assistant=client.',
    },
    pageHint: {
      type: 'string',
      description: 'Pagina sau ruta ceruta, daca intentia este open_page.',
    },
    buttonHint: {
      type: 'string',
      description: 'Textul butonului cerut, daca intentia este click_button.',
    },
    missingFields: {
      type: 'array',
      items: { type: 'string' },
      description: 'Date lipsa pentru executie sigura.',
    },
    confidence: {
      type: 'number',
      description: 'Incredere intre 0 si 1. Sub 0.85 necesita clarificare.',
    },
    risk: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    },
    confirmation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        required: { type: 'boolean' },
        reason: { type: 'string' },
        risk: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['required', 'reason', 'risk'],
    },
    needsConfirmation: {
      type: 'boolean',
    },
    spokenSummary: {
      type: 'string',
      description: 'Rezumat scurt pentru confirmarea din UI.',
    },
    reasoning: {
      type: 'string',
      description: 'Motiv scurt pentru debug. Nu include explicatii lungi.',
    },
    executionPlan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          label: { type: 'string' },
          target: { type: 'string' },
          fields: { type: 'array', items: { type: 'string' } },
          requiresConfirmation: { type: 'boolean' },
        },
        required: ['id', 'type', 'label', 'target', 'fields', 'requiresConfirmation'],
      },
    },
  },
  required: [
    'version',
    'commandType',
    'intent',
    'toolCalls',
    'entityReferences',
    'missingInformation',
    'confirmationRequired',
    'response',
    'targetModule',
    'entityType',
    'entityQuery',
    'formSchemaId',
    'fields',
    'fieldsToUpdate',
    'dateRange',
    'shouldNavigate',
    'shouldFillForm',
    'shouldUpdateFirestore',
    'navigation',
    'targetText',
    'targetPage',
    'pageHint',
    'buttonHint',
    'missingFields',
    'confidence',
    'risk',
    'confirmation',
    'needsConfirmation',
    'spokenSummary',
    'reasoning',
    'executionPlan',
  ],
};

const EXPENSE_FAST_MAX_LINE_ITEMS = 8;
const EXPENSE_FULL_MAX_LINE_ITEMS = 40;

function buildPathFromNotification(data) {
  const moduleName = String(data.module || '').trim();
  const entityId = String(data.entityId || '').trim();
  const notificationPath = String(data.notificationPath || '').trim();

  if (notificationPath.startsWith('/')) return notificationPath;

  if (moduleName === 'tools' && entityId) return `/tools/${entityId}`;
  if (moduleName === 'vehicles' && entityId) return `/vehicles/${entityId}`;
  if (moduleName === 'timesheets' && entityId) return `/timesheets/${entityId}`;
  if (moduleName === 'timesheets') return '/timesheets';
  if (moduleName === 'leave') return '/my-leave';
  if (moduleName === 'maintenance' && String(data.eventType || '').startsWith('maintenance_part_order')) return '/maintenance/orders';
  if (moduleName === 'maintenance' && entityId) return `/maintenance/${entityId}`;
  if (moduleName === 'maintenance') return '/maintenance';
  if (moduleName === 'projects') return '/projects';
  if (moduleName === 'users') return '/users';
  if (moduleName === 'backup' || moduleName === 'web' || moduleName === 'server' || moduleName === 'system') return '/control-panel';
  if (moduleName === 'notifications') return '/notifications';

  return '/notifications';
}

function toPushTokenTimestamp(doc) {
  const data = doc.data() || {};
  return Math.max(
    Number(data.lastSeenAt || 0),
    Number(data.updatedAt || 0),
    Number(data.createdAt || 0)
  );
}

function selectUniquePushTokenDocs(tokenDocs) {
  const duplicateDocIds = [];
  const selected = [];

  const candidates = tokenDocs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        doc,
        id: doc.id,
        token: String(data.token || '').trim(),
        installationId: String(data.installationId || '').trim(),
        deviceKey: `${String(data.userAgent || '').trim()}|${String(data.platform || '').trim()}`,
        ts: toPushTokenTimestamp(doc),
      };
    })
    .filter((item) => item.token)
    .sort((a, b) => b.ts - a.ts);

  for (const item of candidates) {
    if (selected.length > 0) {
      duplicateDocIds.push(item.id);
      continue;
    }

    selected.push(item);
  }

  return { selected, duplicateDocIds };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSafeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanAuditMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const result = {};
  Object.entries(metadata).slice(0, 30).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      result[key] = value.slice(0, 500);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      result[key] = value.slice(0, 20).map((item) => String(item).slice(0, 160));
      return;
    }
    result[key] = JSON.stringify(value).slice(0, 500);
  });
  return result;
}

function shouldSkipAuditLog(input) {
  const haystack = [
    input?.category,
    input?.action,
    input?.title,
    input?.message,
    input?.entityLabel,
    JSON.stringify(input?.metadata || {}),
  ].join(' ').toLowerCase();
  return haystack.includes('gpssim') || haystack.includes('gps_sim') || haystack.includes('test gps');
}

function buildAuditSearchableText(input, metadata) {
  return [
    input.category,
    input.action,
    input.title,
    input.message,
    input.actorUserName,
    input.targetUserName,
    input.entityLabel,
    input.entityId,
    input.path,
    input.pageTitle,
    ...Object.values(metadata).map((value) => String(value)),
  ].join(' ').toLowerCase().slice(0, 5000);
}

function buildAuditPayload(input) {
  const metadata = cleanAuditMetadata(input.metadata);
  return {
    companyId: toSafeString(input.companyId),
    category: toSafeString(input.category) || 'general',
    action: toSafeString(input.action),
    title: toSafeString(input.title),
    message: toSafeString(input.message),
    actorUserId: toSafeString(input.actorUserId),
    actorUserName: toSafeString(input.actorUserName) || 'WorkControl',
    actorUserThemeKey: input.actorUserThemeKey || null,
    targetUserId: toSafeString(input.targetUserId),
    targetUserName: toSafeString(input.targetUserName),
    targetUserThemeKey: input.targetUserThemeKey || null,
    entityId: toSafeString(input.entityId),
    entityLabel: toSafeString(input.entityLabel),
    path: toSafeString(input.path),
    pageTitle: toSafeString(input.pageTitle),
    metadata,
    searchableText: buildAuditSearchableText(input, metadata),
    createdAt: Date.now(),
    createdAtServer: FieldValue.serverTimestamp(),
  };
}

async function createAuditLog(input) {
  if (shouldSkipAuditLog(input)) return;
  await db.collection('auditLogs').add(buildAuditPayload(input));
}

function inferContentType(fileName, contentType) {
  const safeContentType = toSafeString(contentType);
  if (safeContentType) return safeContentType;

  const lowerName = toSafeString(fileName).toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.doc')) return 'application/msword';
  if (lowerName.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'application/octet-stream';
}

const SHARED_MAINTENANCE_GMAIL_SENDER = 'liftultau@gmail.com';
const MAX_GMAIL_ATTACHMENTS = 8;
const MAX_GMAIL_ATTACHMENT_BYTES = 24 * 1024 * 1024;
const MAX_GMAIL_TOTAL_ATTACHMENT_BYTES = 30 * 1024 * 1024;

function cleanText(value, maxLength = 1000) {
  return toSafeString(value).replace(/\0/g, '').slice(0, maxLength);
}

function cleanEmail(value) {
  const email = cleanText(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function sanitizeHeaderValue(value, maxLength = 240) {
  return cleanText(value, maxLength).replace(/[\r\n]+/g, ' ');
}

function encodeMimeHeader(value) {
  const header = sanitizeHeaderValue(value, 240);
  if (/^[\x00-\x7F]*$/.test(header)) return header;
  return `=?UTF-8?B?${Buffer.from(header, 'utf8').toString('base64')}?=`;
}

function foldBase64(value) {
  return value.match(/.{1,76}/g)?.join('\r\n') || value;
}

function base64UrlEncodeBuffer(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizeGmailAttachmentInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const path = cleanText(value.path, 600);
  if (!path || !path.startsWith('maintenance-reports/')) return null;
  return {
    path,
    fileName: sanitizeHeaderValue(value.fileName || path.split('/').pop() || 'atasament', 180),
    contentType: inferContentType(value.fileName || path, value.contentType),
  };
}

async function readStorageAttachment(input) {
  const [buffer] = await admin.storage().bucket().file(input.path).download();
  if (buffer.length > MAX_GMAIL_ATTACHMENT_BYTES) {
    throw new HttpsError('invalid-argument', `Atasamentul ${input.fileName} este prea mare pentru Gmail.`);
  }
  return {
    ...input,
    buffer,
  };
}

function buildRawGmailMessage(input) {
  const boundary = createGmailMimeBoundary();
  const messageLines = [
    `From: "Service si Mentenanta Lift" <${SHARED_MAINTENANCE_GMAIL_SENDER}>`,
    `To: ${input.to}`,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body,
    '',
  ];

  for (const attachment of input.attachments) {
    messageLines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${sanitizeHeaderValue(attachment.fileName, 180)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${sanitizeHeaderValue(attachment.fileName, 180)}"`,
      '',
      foldBase64(attachment.buffer.toString('base64')),
      ''
    );
  }

  messageLines.push(`--${boundary}--`);
  return base64UrlEncodeBuffer(Buffer.from(messageLines.join('\r\n'), 'utf8'));
}

async function getSharedGmailAccessToken() {
  const clientId = gmailOAuthClientId.value();
  const clientSecret = gmailOAuthClientSecret.value();
  const refreshToken = gmailOAuthRefreshToken.value();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new HttpsError('failed-precondition', 'Gmail nu este configurat pe server.');
  }

  const oauthClient = new OAuth2Client(clientId, clientSecret);
  oauthClient.setCredentials({ refresh_token: refreshToken });
  try {
    const tokenResponse = await oauthClient.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
    if (!token) {
      throw new HttpsError('failed-precondition', 'Gmail nu a returnat token de acces.');
    }
    return token;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('Nu am putut reimprospata tokenul Gmail.', {
      errorMessage: error instanceof Error ? error.message : String(error || ''),
    });
    throw new HttpsError(
      'failed-precondition',
      'Gmail nu este autorizat corect pe server. Reautorizeaza contul liftultau@gmail.com cu acces Gmail compose.'
    );
  }
}

async function sendMaintenanceGmailReport(request) {
  const context = await assertActiveInternalRequest(request);
  const input = request.data || {};
  const companyId = cleanText(input.companyId, 120) || context.companyId;
  if (companyId && !internalContextCanAccessCompany(context, companyId)) {
    throw new HttpsError('permission-denied', 'Nu ai acces la firma raportului.');
  }

  const recipientEmail = cleanEmail(input.recipientEmail);
  if (!recipientEmail) {
    throw new HttpsError('invalid-argument', 'Destinatarul Gmail nu este valid.');
  }

  const pdfAttachment = normalizeGmailAttachmentInput({
    path: input.pdfPath,
    fileName: input.fileName,
    contentType: 'application/pdf',
  });
  if (!pdfAttachment) {
    throw new HttpsError('invalid-argument', 'PDF-ul raportului nu este valid.');
  }

  const extraAttachments = Array.isArray(input.attachments)
    ? input.attachments.map(normalizeGmailAttachmentInput).filter(Boolean).slice(0, MAX_GMAIL_ATTACHMENTS)
    : [];
  const attachments = await Promise.all([pdfAttachment, ...extraAttachments].map(readStorageAttachment));
  const totalAttachmentBytes = attachments.reduce((total, attachment) => total + attachment.buffer.length, 0);
  if (totalAttachmentBytes > MAX_GMAIL_TOTAL_ATTACHMENT_BYTES) {
    throw new HttpsError('invalid-argument', 'Atasamentele raportului depasesc limita Gmail.');
  }

  const subject = sanitizeHeaderValue(input.subject, 180) || 'Raport mentenanta';
  const body = cleanText(input.body, 8000) || 'Buna ziua,\n\nAveti atasat raportul de mentenanta.';
  const raw = buildRawGmailMessage({
    to: recipientEmail,
    subject,
    body,
    attachments,
  });
  const accessToken = await getSharedGmailAccessToken();
  const response = await sendRawGmailMessage({ accessToken, raw });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error('Nu am putut trimite emailul Gmail de mentenanta.', {
      status: response.status,
      statusText: response.statusText,
      actorUserId: context.userSnap.id,
      companyId,
      clientId: cleanText(input.clientId, 120),
      responseSnippet: text.slice(0, 300),
    });
    if (response.status === 401 || response.status === 403) {
      throw new HttpsError(
        'failed-precondition',
        'Gmail a refuzat autorizarea contului liftultau@gmail.com. Reautorizeaza refresh token-ul cu scope Gmail compose.'
      );
    }
    throw new HttpsError('internal', 'Nu am putut trimite emailul Gmail.');
  }

  const sentMessage = await response.json();
  try {
    await createAuditLog({
      companyId,
      category: 'maintenance',
      action: 'maintenance_gmail_email_sent',
      title: 'Raport mentenanta trimis prin Gmail',
      message: `Email Gmail trimis catre ${recipientEmail}.`,
      actorUserId: context.userSnap.id,
      actorUserName: context.user.fullName || context.user.email || 'Utilizator',
      entityId: cleanText(input.reportId || input.clientId, 120),
      entityLabel: sanitizeHeaderValue(input.clientName || subject, 160),
      path: '/maintenance?tab=report',
      pageTitle: 'Mentenanta',
      metadata: {
        clientId: cleanText(input.clientId, 120),
        reportId: cleanText(input.reportId, 120),
        attachments: attachments.length,
        totalAttachmentBytes,
      },
    });
  } catch (auditError) {
    logger.error('Emailul Gmail a fost trimis, dar auditul nu a putut fi salvat.', {
      actorUserId: context.userSnap.id,
      companyId,
      reportId: cleanText(input.reportId, 120),
      errorMessage: auditError instanceof Error ? auditError.message : String(auditError || ''),
    });
  }

  return {
    messageId: sentMessage?.id || '',
    threadId: sentMessage?.threadId || '',
    sent: true,
    senderEmail: SHARED_MAINTENANCE_GMAIL_SENDER,
  };
}

function isSupportedDocumentMime(contentType) {
  return (
    contentType.startsWith('image/') ||
    contentType === 'application/pdf' ||
    contentType === 'application/msword' ||
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType.startsWith('text/')
  );
}

function extractResponseText(responseJson) {
  if (typeof responseJson?.output_text === 'string') return responseJson.output_text;

  const chunks = [];
  for (const outputItem of responseJson?.output || []) {
    for (const contentItem of outputItem?.content || []) {
      if (typeof contentItem?.text === 'string') chunks.push(contentItem.text);
    }
  }
  return chunks.join('\n').trim();
}

function normalizeAiDocumentType(value) {
  const safeValue = toSafeString(value).toLowerCase();
  if (['itp', 'rca', 'casco', 'rovinieta', 'service', 'leasing_rate', 'amenda', 'other'].includes(safeValue)) {
    return safeValue;
  }
  return 'other';
}

function normalizeExpenseDocumentKind(value) {
  const safeValue = toSafeString(value).toLowerCase();
  if (['bon', 'factura', 'chitanta', 'proforma', 'other'].includes(safeValue)) return safeValue;
  return 'other';
}

function normalizeExpenseScanMode(value) {
  return toSafeString(value).toLowerCase() === 'fast' ? 'fast' : 'full';
}

function buildEmptyExpenseAnalysis(notes = '') {
  return {
    documentKind: 'other',
    supplierName: '',
    supplierTaxId: '',
    buyerCompanyName: '',
    buyerTaxId: '',
    documentNumber: '',
    documentDate: '',
    dueDate: '',
    currency: 'RON',
    subtotalAmount: 0,
    vatAmount: 0,
    totalAmount: 0,
    paymentMethod: '',
    expenseCategory: '',
    projectHint: '',
    userHint: '',
    companyHint: '',
    lineItems: [],
    confidence: 0,
    notes,
  };
}

function hasMeaningfulExpenseExtraction(analysis) {
  return Boolean(
    analysis?.supplierName ||
      analysis?.supplierTaxId ||
      analysis?.buyerCompanyName ||
      analysis?.documentNumber ||
      analysis?.documentDate ||
      toSafeNumber(analysis?.totalAmount, 0) > 0 ||
      toSafeNumber(analysis?.vatAmount, 0) > 0 ||
      toSafeNumber(analysis?.subtotalAmount, 0) > 0 ||
      (Array.isArray(analysis?.lineItems) && analysis.lineItems.length > 0)
  );
}

function getExpenseYearMonth(dateString) {
  const safeDate = toSafeString(dateString);
  if (/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) return safeDate.slice(0, 7);
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function analyzeExpenseStorageFile(params) {
  const contentType = inferContentType(params.fileName, params.contentType);
  const scanMode = normalizeExpenseScanMode(params.scanMode);
  const fastScan = scanMode === 'fast';
  const coreOnly = params.extractionMode === 'core';

  if (!isSupportedDocumentMime(contentType)) {
    return buildEmptyExpenseAnalysis(`Tip fisier neanalizat automat: ${contentType}`);
  }

  let fileInput;
  if (contentType.startsWith('image/') && toSafeString(params.publicUrl).startsWith('https://')) {
    fileInput = {
      type: 'input_image',
      image_url: toSafeString(params.publicUrl),
      detail: 'high',
    };
  } else {
    const buffer = Buffer.isBuffer(params.fileBuffer)
      ? params.fileBuffer
      : (await admin.storage().bucket().file(params.storagePath).download())[0];
    if (!buffer?.length) {
      throw new Error('Documentul nu a putut fi citit din Storage.');
    }

    if (buffer.length > 18 * 1024 * 1024) {
      throw new Error('Documentul este prea mare pentru analiza automata.');
    }

    const base64 = buffer.toString('base64');
    fileInput = contentType.startsWith('image/')
      ? {
        type: 'input_image',
        image_url: `data:${contentType};base64,${base64}`,
        detail: 'high',
      }
      : {
        type: 'input_file',
        filename: params.fileName,
        file_data: `data:${contentType};base64,${base64}`,
      };
  }

  const prompt = coreOnly
    ? [
        'Citeste bonul, factura sau chitanta pentru evidenta cheltuielilor.',
        'Extrage DOAR campurile principale vizibile: tip document, furnizor, CUI furnizor, cumparator/firma, CUI cumparator, numar document, data, subtotal, TVA, total, moneda, metoda plata si categorie.',
        'Nu extrage produse si nu descrie randurile din bon. Important este sa fie rapid si corect pe total/data/furnizor.',
        'Valorile numerice trebuie sa fie numere. Daca moneda lipseste si documentul este romanesc, foloseste RON.',
        'Pentru documentDate foloseste data emiterii/bonului in format YYYY-MM-DD.',
        'Lasa string gol sau 0 doar pentru campurile care chiar nu se vad in document.',
      ].join(' ')
    : fastScan
    ? [
        'Citeste bonul, factura sau chitanta pentru evidenta cheltuielilor.',
        'Extrage obligatoriu ce se vede clar: furnizor, CUI, cumparator/firma, numar document, data, total, TVA si metoda plata.',
        `Pentru produse, include maximum ${EXPENSE_FAST_MAX_LINE_ITEMS} linii clare. Daca exista total/TVA/date vizibile, nu le lasa 0.`,
        'Valorile numerice trebuie sa fie numere. Daca moneda lipseste si documentul este romanesc, foloseste RON.',
        'Pentru documentDate foloseste data emiterii/bonului in format YYYY-MM-DD.',
        'Lasa string gol sau 0 doar pentru campurile care chiar nu se vad in document.',
      ].join(' ')
    : [
        'Citeste bonul, factura sau chitanta pentru evidenta cheltuielilor.',
        'Extrage cat mai multe date clare: furnizor, CUI, cumparator/firma, numar document, data, total, TVA, metoda plata si produse.',
        'Valorile numerice trebuie sa fie numere, nu text. Daca moneda lipseste si documentul este romanesc, foloseste RON.',
        'Pentru documentDate foloseste data emiterii/bonului in format YYYY-MM-DD.',
        'Daca totalul, TVA-ul, data sau furnizorul se vad in document, nu le lasa goale sau 0.',
        'Daca un camp nu este sigur, lasa string gol sau 0 si scade confidence.',
      ].join(' ');

  const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      input: [
        {
          role: 'user',
          content: [
            fileInput,
            {
              type: 'input_text',
              text: prompt,
            },
          ],
        },
      ],
      text: {
        format: {
            type: 'json_schema',
            name: 'expense_document_extraction',
            strict: true,
            schema: coreOnly ? EXPENSE_CORE_DOC_SCHEMA : EXPENSE_DOC_SCHEMA,
          },
        },
      ...(coreOnly ? { max_output_tokens: 950 } : {}),
    }),
  });

  const responseText = await openaiResponse.text();
  if (!openaiResponse.ok) {
    logger.error('[analyzeExpenseStorageFile][openai]', responseText);
    throw new Error('OpenAI nu a putut analiza documentul.');
  }

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(responseText);
  } catch (error) {
    logger.error('[analyzeExpenseStorageFile][parse response]', error, responseText);
    throw new Error('Raspuns invalid de la OpenAI.');
  }

  const outputText = extractResponseText(parsedResponse);
  let extracted;
  try {
    extracted = JSON.parse(outputText);
  } catch (error) {
    logger.error('[analyzeExpenseStorageFile][parse output]', error, outputText);
    throw new Error('Nu am putut interpreta analiza documentului.');
  }

  const lineItemLimit = fastScan ? EXPENSE_FAST_MAX_LINE_ITEMS : EXPENSE_FULL_MAX_LINE_ITEMS;
  const lineItems = !coreOnly && Array.isArray(extracted.lineItems)
    ? extracted.lineItems.slice(0, lineItemLimit).map((item) => ({
        name: toSafeString(item?.name),
        quantity: toSafeNumber(item?.quantity, 0),
        unitPrice: toSafeNumber(item?.unitPrice, 0),
        total: toSafeNumber(item?.total, 0),
      }))
    : [];

  return {
    documentKind: normalizeExpenseDocumentKind(extracted.documentKind),
    supplierName: toSafeString(extracted.supplierName),
    supplierTaxId: toSafeString(extracted.supplierTaxId).toUpperCase(),
    buyerCompanyName: toSafeString(extracted.buyerCompanyName),
    buyerTaxId: toSafeString(extracted.buyerTaxId).toUpperCase(),
    documentNumber: toSafeString(extracted.documentNumber),
    documentDate: toSafeString(extracted.documentDate),
    dueDate: toSafeString(extracted.dueDate),
    currency: toSafeString(extracted.currency).toUpperCase() || 'RON',
    subtotalAmount: toSafeNumber(extracted.subtotalAmount, 0),
    vatAmount: toSafeNumber(extracted.vatAmount, 0),
    totalAmount: toSafeNumber(extracted.totalAmount, 0),
    paymentMethod: toSafeString(extracted.paymentMethod),
    expenseCategory: toSafeString(extracted.expenseCategory),
    projectHint: toSafeString(extracted.projectHint),
    userHint: toSafeString(extracted.userHint),
    companyHint: toSafeString(extracted.companyHint),
    lineItems,
    confidence: Math.max(0, Math.min(1, toSafeNumber(extracted.confidence, 0))),
    notes: toSafeString(extracted.notes),
  };
}

async function saveExpenseDocumentFromScanJob(jobData, analysis) {
  const now = Date.now();
  const documentDate = toSafeString(analysis.documentDate) || new Date(now).toISOString().slice(0, 10);
  const yearMonth = getExpenseYearMonth(documentDate);
  const companyName = toSafeString(jobData.companyName) || toSafeString(analysis.buyerCompanyName) || toSafeString(analysis.companyHint);

  const storedPayload = {
    companyId: toSafeString(jobData.companyId),
    ...analysis,
    documentDate,
    yearMonth,
    fileName: toSafeString(jobData.fileName),
    fileUrl: toSafeString(jobData.fileUrl),
    filePath: toSafeString(jobData.filePath),
    contentType: toSafeString(jobData.contentType),
    sizeBytes: toSafeNumber(jobData.sizeBytes, 0),
    extension: toSafeString(jobData.extension),
    sha256: toSafeString(jobData.sha256),
    analysisCacheId: toSafeString(jobData.analysisCacheId),
    analysisCacheHit: jobData.analysisCacheHit === true,
    uploadedByUserId: toSafeString(jobData.uploadedByUserId),
    uploadedByUserName: toSafeString(jobData.uploadedByUserName) || 'Utilizator',
    assignedUserId: toSafeString(jobData.assignedUserId),
    assignedUserName: toSafeString(jobData.assignedUserName),
    projectId: toSafeString(jobData.projectId),
    projectCode: toSafeString(jobData.projectCode),
    projectName: toSafeString(jobData.projectName),
    companyName,
    reimbursable: Boolean(jobData.reimbursable),
    createdAt: now,
    updatedAt: now,
    createdAtServer: FieldValue.serverTimestamp(),
    updatedAtServer: FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('expenseDocuments').add(storedPayload);
  const eventType = storedPayload.reimbursable
    ? 'expense_reimbursable_created'
    : storedPayload.documentKind === 'factura' || storedPayload.documentKind === 'proforma'
      ? 'expense_invoice_created'
      : 'expense_document_created';

  const notificationContext = await getNotificationContext();
  await dispatchNotificationEvent(
    {
      module: 'expenses',
      companyId: storedPayload.companyId,
      eventType,
      entityId: docRef.id,
      title: storedPayload.reimbursable ? 'Decontare noua' : 'Cheltuiala noua',
      message: `${storedPayload.assignedUserName || 'Utilizator'} a introdus ${storedPayload.documentKind} ${storedPayload.documentNumber || ''} de la ${storedPayload.supplierName || 'furnizor necunoscut'} (${storedPayload.totalAmount || 0} ${storedPayload.currency || 'RON'}).`,
      notificationPath: '/expenses/scan',
      directUserId: storedPayload.assignedUserId,
      ownerUserId: storedPayload.assignedUserId,
      actorUserId: storedPayload.uploadedByUserId,
      actorUserName: storedPayload.uploadedByUserName,
    },
    notificationContext
  );

  return docRef.id;
}

function getUtcDayKeyFromTs(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function getPositionArchiveCutoffDayKey(retentionDays = VEHICLE_POSITION_ARCHIVE_RETENTION_DAYS) {
  const safeRetentionDays = Math.max(1, Math.round(toSafeNumber(retentionDays, VEHICLE_POSITION_ARCHIVE_RETENTION_DAYS)));
  return getUtcDayKeyFromTs(Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000);
}

function buildVehiclePositionArchivePath(vehicleId, dayKey) {
  return `vehicle-position-archives/${vehicleId}/${dayKey}.json`;
}

function mapPositionPointForArchive(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    vehicleId: toSafeString(data.vehicleId),
    imei: toSafeString(data.imei),
    lat: toSafeNumber(data.lat, 0),
    lng: toSafeNumber(data.lng, 0),
    speedKmh: toSafeNumber(data.speedKmh, 0),
    altitude: toSafeNumber(data.altitude, 0),
    angle: toSafeNumber(data.angle, 0),
    satellites: toSafeNumber(data.satellites, 0),
    gpsTimestamp: toSafeNumber(data.gpsTimestamp, 0),
    serverTimestamp: toSafeNumber(data.serverTimestamp, 0),
    eventIoId: toSafeNumber(data.eventIoId, 0),
    ignitionOn: typeof data.ignitionOn === 'boolean' ? data.ignitionOn : null,
    odometerKm: Number.isFinite(Number(data.odometerKm)) ? Number(data.odometerKm) : null,
  };
}

async function readDayPointsForArchive(dayRef) {
  const points = [];
  let lastDoc = null;

  while (true) {
    let pointsQuery = dayRef
      .collection('points')
      .orderBy('gpsTimestamp', 'asc')
      .limit(FIRESTORE_DELETE_BATCH_SIZE);

    if (lastDoc) pointsQuery = pointsQuery.startAfter(lastDoc);

    const snap = await pointsQuery.get();
    if (snap.empty) break;

    points.push(...snap.docs.map(mapPositionPointForArchive));
    lastDoc = snap.docs[snap.docs.length - 1] || null;
    if (snap.size < FIRESTORE_DELETE_BATCH_SIZE || !lastDoc) break;
  }

  return points.filter((point) => point.lat !== 0 || point.lng !== 0 || point.gpsTimestamp > 0);
}

async function deletePositionDayPoints(dayRef) {
  let deleted = 0;

  while (true) {
    const snap = await dayRef.collection('points').limit(FIRESTORE_DELETE_BATCH_SIZE).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    deleted += snap.size;
    if (snap.size < FIRESTORE_DELETE_BATCH_SIZE) break;
  }

  return deleted;
}

async function archivePositionDay(vehicleDoc, dayDoc, options = {}) {
  const vehicleId = vehicleDoc.id;
  const dayKey = toSafeString(dayDoc.id);
  const dayRef = dayDoc.ref;
  const points = await readDayPointsForArchive(dayRef);
  const archivePath = buildVehiclePositionArchivePath(vehicleId, dayKey);

  if (!options.dryRun) {
    const dayData = dayDoc.data() || {};
    const archivePayload = {
      version: 1,
      vehicleId,
      dayKey,
      source: 'firestore-positionDays',
      archivedAt: Date.now(),
      archivedAtServer: new Date().toISOString(),
      pointCount: points.length,
      dayMeta: {
        imei: toSafeString(dayData.imei),
        updatedAt: toSafeNumber(dayData.updatedAt, 0),
        vehicleId: toSafeString(dayData.vehicleId, vehicleId),
      },
      points,
    };

    await admin
      .storage()
      .bucket()
      .file(archivePath)
      .save(JSON.stringify(archivePayload), {
        resumable: false,
        contentType: 'application/json',
        metadata: {
          cacheControl: 'private, max-age=3600',
          metadata: {
            vehicleId,
            dayKey,
            pointCount: String(points.length),
          },
        },
      });

    await db.collection('vehiclePositionArchives').doc(`${vehicleId}_${dayKey}`).set(
      {
        vehicleId,
        dayKey,
        storagePath: archivePath,
        pointCount: points.length,
        archivedAt: Date.now(),
        archivedAtServer: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const deletedPoints = await deletePositionDayPoints(dayRef);
    await dayRef.delete();

    return {
      vehicleId,
      dayKey,
      pointsArchived: points.length,
      pointsDeleted: deletedPoints,
      storagePath: archivePath,
    };
  }

  return {
    vehicleId,
    dayKey,
    pointsArchived: points.length,
    pointsDeleted: 0,
    storagePath: archivePath,
  };
}

async function archiveOldVehiclePositionDaysJob(options = {}) {
  const retentionDays = Math.max(
    1,
    Math.round(toSafeNumber(options.retentionDays, VEHICLE_POSITION_ARCHIVE_RETENTION_DAYS))
  );
  const cutoffDayKey = getPositionArchiveCutoffDayKey(retentionDays);
  const maxDays = Math.max(
    1,
    Math.round(toSafeNumber(options.maxDays, VEHICLE_POSITION_ARCHIVE_MAX_DAYS_PER_RUN))
  );
  const dryRun = Boolean(options.dryRun);
  const vehiclesSnap = await db.collection('vehicles').get();
  const archived = [];

  for (const vehicleDoc of vehiclesSnap.docs) {
    if (archived.length >= maxDays) break;

    const daysSnap = await vehicleDoc.ref
      .collection('positionDays')
      .where('dayKey', '<=', cutoffDayKey)
      .orderBy('dayKey', 'asc')
      .limit(maxDays - archived.length)
      .get();

    for (const dayDoc of daysSnap.docs) {
      const dayKey = toSafeString(dayDoc.id);
      if (!dayKey || dayKey > cutoffDayKey) continue;

      try {
        const result = await archivePositionDay(vehicleDoc, dayDoc, { dryRun });
        archived.push(result);
      } catch (error) {
        logger.error('[archiveOldVehiclePositionDays][day failed]', {
          vehicleId: vehicleDoc.id,
          dayKey,
          error,
        });
      }
    }
  }

  return {
    cutoffDayKey,
    retentionDays,
    dryRun,
    vehiclesChecked: vehiclesSnap.size,
    daysArchived: archived.length,
    pointsArchived: archived.reduce((total, item) => total + item.pointsArchived, 0),
    pointsDeleted: archived.reduce((total, item) => total + item.pointsDeleted, 0),
    archived,
  };
}

async function assertAdminRequest(request) {
  const context = await assertActiveInternalRequest(request);
  if (context.role !== 'admin' || context.globalAdmin !== true) {
    throw new HttpsError('permission-denied', 'Doar administratorul global poate executa aceasta operatie.');
  }
  return context;
}

async function assertActiveInternalRequest(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Trebuie sa fii autentificat.');
  }
  const userSnap = await db.collection('users').doc(request.auth.uid).get();
  const user = userSnap.data() || {};
  if (
    !userSnap.exists ||
    user.active !== true ||
    toSafeString(user.accessStatus) !== 'active'
  ) {
    throw new HttpsError('permission-denied', 'Contul intern nu este activ.');
  }
  const role = toSafeString(user.role);
  if (!['admin', 'manager', 'angajat'].includes(role)) {
    throw new HttpsError('permission-denied', 'Rolul intern nu este valid.');
  }
  const companyContext = buildInternalCompanyContext(user, role);
  if (companyContext.requiresCompany) {
    throw new HttpsError('failed-precondition', 'Contul nu are firma asociata.');
  }
  return {
    userSnap,
    user,
    companyId: companyContext.companyId,
    companyIds: companyContext.companyIds,
    role,
    globalAdmin: companyContext.globalAdmin,
  };
}

function internalContextCanAccessCompany(context, companyId) {
  return context.globalAdmin || (companyId && context.companyIds.includes(companyId));
}

function normalizeRule(doc) {
  const data = doc.data() || {};
  const recipients = data.recipients || {};

  return {
    id: doc.id,
    companyId: toSafeString(data.companyId),
    module: toSafeString(data.module) || 'general',
    eventType: toSafeString(data.eventType) || 'any_change',
    entityId: toSafeString(data.entityId),
    enabled: data.enabled !== false,
    scheduleTime: toSafeString(data.scheduleTime) || '08:30',
    stopTime: toSafeString(data.stopTime) || '17:00',
    weekdays: Array.isArray(data.weekdays) && data.weekdays.length > 0
      ? data.weekdays.map((day) => Math.max(1, Math.min(7, Math.round(toSafeNumber(day, 0))))).filter(Boolean)
      : [1, 2, 3, 4, 5],
    reminderDelayHours: Math.max(1, Math.min(16, Math.round(toSafeNumber(data.reminderDelayHours, 8)))),
    reminderRepeatMinutes: Math.max(5, Math.min(720, Math.round(toSafeNumber(data.reminderRepeatMinutes, 60)))),
    reminderActiveMinutes: Math.max(0, Math.min(1440, Math.round(toSafeNumber(data.reminderActiveMinutes, 120)))),
    soundEnabled: data.soundEnabled !== false,
    recipients: {
      notifyDirectUser: Boolean(recipients.notifyDirectUser),
      notifyOwner: Boolean(recipients.notifyOwner),
      notifyAdmins: Boolean(recipients.notifyAdmins),
      notifyManagers: Boolean(recipients.notifyManagers),
      specificUserIds: Array.isArray(recipients.specificUserIds) ? recipients.specificUserIds : [],
    },
  };
}

function ruleMatches(rule, moduleName, eventType, entityId) {
  const moduleMatches = rule.module === moduleName || rule.module === 'general' || rule.module === 'system';
  const eventMatches = rule.eventType === eventType || rule.eventType === 'any_change';
  const entityMatches = !rule.entityId || !entityId || rule.entityId === entityId;
  return moduleMatches && eventMatches && entityMatches;
}

async function getNotificationContext() {
  const [usersSnap, rulesSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('notificationRules').where('enabled', '==', true).get(),
  ]);

  return {
    users: usersSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        name:
          toSafeString(data.fullName) ||
          toSafeString(data.displayName) ||
          toSafeString(data.email) ||
          'Utilizator',
        role: toSafeString(data.role),
        companyIds: Array.isArray(data.companyIds)
          ? data.companyIds.map((value) => toSafeString(value)).filter(Boolean)
          : [],
        primaryCompanyId: toSafeString(data.primaryCompanyId),
        active: data.active !== false,
        themeKey: data.themeKey || null,
      };
    }),
    rules: rulesSnap.docs.map(normalizeRule),
  };
}

async function getNotificationContextForCompany(companyId) {
  const safeCompanyId = toSafeString(companyId);
  if (!safeCompanyId) return { users: [], rules: [] };
  const [usersSnap, rulesSnap] = await Promise.all([
    db.collection('userOperationalViews')
      .where('companyId', '==', safeCompanyId)
      .limit(250)
      .get(),
    db.collection('notificationRules')
      .where('companyId', '==', safeCompanyId)
      .where('enabled', '==', true)
      .limit(100)
      .get(),
  ]);
  return {
    users: usersSnap.docs.map((doc) => mapOperationalNotificationUser(doc, safeCompanyId)),
    rules: rulesSnap.docs.map(normalizeRule),
  };
}

function mapOperationalNotificationUser(doc, companyId) {
  const data = doc.data() || {};
  return {
    id: toSafeString(data.uid) || doc.id,
    name: toSafeString(data.fullName) || toSafeString(data.email) || 'Utilizator',
    role: toSafeString(data.role),
    companyIds: [companyId],
    primaryCompanyId: companyId,
    active: data.active === true && toSafeString(data.accessStatus) === 'active',
    themeKey: data.themeKey || null,
  };
}

async function getNotificationUsersForCompany(companyId) {
  const safeCompanyId = toSafeString(companyId);
  if (!safeCompanyId) return [];
  const usersSnap = await db.collection('userOperationalViews')
    .where('companyId', '==', safeCompanyId)
    .limit(250)
    .get();
  return usersSnap.docs.map((doc) => mapOperationalNotificationUser(doc, safeCompanyId));
}

async function dispatchNotificationEvent(input, context) {
  const companyId = toSafeString(input.companyId);
  const idempotencyKey = toSafeString(input.idempotencyKey);
  if (!companyId) {
    logger.warn('[dispatchNotificationEvent] Eveniment ignorat fara companyId', {
      module: toSafeString(input.module),
      eventType: toSafeString(input.eventType),
    });
    return 0;
  }
  const eventAuditInput = {
    companyId,
    category: input.module,
    action: input.eventType,
    title: input.title,
    message: input.message,
    actorUserId: input.actorUserId || '',
    actorUserName: input.actorUserName || 'WorkControl',
    actorUserThemeKey: input.actorUserThemeKey || null,
    targetUserId: input.directUserId || input.ownerUserId || '',
    entityId: input.entityId || '',
    entityLabel: input.title,
    path: input.notificationPath || buildPathFromNotification(input),
    pageTitle: input.module,
    metadata: {
      directUserId: input.directUserId || '',
      ownerUserId: input.ownerUserId || '',
      module: input.module,
      eventType: input.eventType,
      idempotencyKey,
    },
  };
  const eventAuditPayload = buildAuditPayload(eventAuditInput);
  if (!idempotencyKey) {
    await createAuditLog(eventAuditInput).catch((error) => logger.warn('[audit][event]', error));
  }

  const rules = context.rules.filter((rule) =>
    rule.companyId === companyId && ruleMatches(rule, input.module, input.eventType, input.entityId)
  );
  if (rules.length === 0) return 0;

  const users = context.users.filter((user) =>
    user.primaryCompanyId === companyId || user.companyIds.includes(companyId)
  );
  const recipientsSet = new Set();
  const soundEnabled = input.soundEnabled ?? rules.some((rule) => rule.soundEnabled !== false);

  for (const rule of rules) {
    if (rule.recipients.notifyDirectUser && input.directUserId) recipientsSet.add(input.directUserId);
    if (rule.recipients.notifyOwner && input.ownerUserId) recipientsSet.add(input.ownerUserId);

    if (rule.recipients.notifyAdmins) {
      users
        .filter((user) => user.active !== false && user.role === 'admin')
        .forEach((user) => recipientsSet.add(user.id));
    }

    if (rule.recipients.notifyManagers) {
      users
        .filter((user) => user.active !== false && user.role === 'manager')
        .forEach((user) => recipientsSet.add(user.id));
    }

    rule.recipients.specificUserIds.forEach((userId) => {
      const safeUserId = toSafeString(userId);
      if (safeUserId) recipientsSet.add(safeUserId);
    });
  }

  const userIds = Array.from(recipientsSet);
  if (userIds.length === 0) return 0;

  const now = Date.now();

  if (idempotencyKey) {
    const limitedUserIds = userIds.slice(0, 100);
    if (limitedUserIds.length < userIds.length) {
      logger.warn('[dispatchNotificationEvent] Recipientii au fost limitati.', {
        companyId,
        requested: userIds.length,
        accepted: limitedUserIds.length,
      });
    }
    const deliveryId = stableHash(`${companyId}:${idempotencyKey}`, 40);
    const deliveryRef = db.collection('notificationDeliveries').doc(deliveryId);
    return db.runTransaction(async (transaction) => {
      const existingDelivery = await transaction.get(deliveryRef);
      if (existingDelivery.exists) {
        return toSafeNumber(existingDelivery.get('recipientCount'), 0);
      }

      if (!shouldSkipAuditLog(eventAuditInput)) {
        transaction.set(
          db.collection('auditLogs').doc(`notification_event_${deliveryId}`),
          eventAuditPayload,
          { merge: false }
        );
      }
      limitedUserIds.forEach((userId) => {
        const targetUser = users.find((user) => user.id === userId);
        const targetUserName = targetUser?.name || userId;
        const recipientKey = stableHash(`${deliveryId}:${userId}`, 40);
        transaction.set(db.collection('notifications').doc(`notification_${recipientKey}`), {
          companyId,
          userId,
          targetUserThemeKey: targetUser?.themeKey || null,
          actorUserId: input.actorUserId || '',
          actorUserName: input.actorUserName || 'WorkControl',
          actorUserThemeKey: input.actorUserThemeKey || null,
          title: input.title,
          message: input.message,
          module: input.module,
          eventType: input.eventType,
          entityId: input.entityId || '',
          notificationPath: input.notificationPath || '',
          soundEnabled,
          read: false,
          createdAt: now,
          createdAtServer: FieldValue.serverTimestamp(),
        }, { merge: false });
        transaction.set(
          db.collection('auditLogs').doc(`notification_delivery_${recipientKey}`),
          buildAuditPayload({
            companyId,
            category: 'notifications',
            action: 'notification_delivered',
            title: 'Notificare primita',
            message: `${targetUserName} a primit notificarea: ${input.title}.`,
            actorUserId: input.actorUserId || '',
            actorUserName: input.actorUserName || 'WorkControl',
            actorUserThemeKey: input.actorUserThemeKey || null,
            targetUserId: userId,
            targetUserName,
            targetUserThemeKey: targetUser?.themeKey || null,
            entityId: input.entityId || '',
            entityLabel: input.title,
            path: input.notificationPath || buildPathFromNotification(input),
            pageTitle: 'Notificari',
            metadata: {
              module: input.module,
              eventType: input.eventType,
              soundEnabled,
              deliveryId,
            },
          }),
          { merge: false }
        );
      });
      transaction.set(deliveryRef, {
        companyId,
        idempotencyHash: deliveryId,
        module: toSafeString(input.module),
        eventType: toSafeString(input.eventType),
        entityId: toSafeString(input.entityId),
        recipientCount: limitedUserIds.length,
        createdAt: now,
        createdAtServer: FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(now + 180 * 24 * 60 * 60 * 1000),
      }, { merge: false });
      return limitedUserIds.length;
    });
  }

  const batch = db.batch();

    userIds.forEach((userId) => {
      const targetUser = users.find((user) => user.id === userId);
      const notificationRef = db.collection('notifications').doc();
      const targetUserName = targetUser?.name || userId;

      batch.set(notificationRef, {
        companyId,
        userId,
      targetUserThemeKey: targetUser?.themeKey || null,
      actorUserId: input.actorUserId || '',
      actorUserName: input.actorUserName || 'WorkControl',
      actorUserThemeKey: input.actorUserThemeKey || null,
      title: input.title,
      message: input.message,
      module: input.module,
      eventType: input.eventType,
      entityId: input.entityId || '',
      notificationPath: input.notificationPath || '',
      soundEnabled,
      read: false,
      createdAt: now,
      createdAtServer: FieldValue.serverTimestamp(),
    });

    batch.set(db.collection('auditLogs').doc(), buildAuditPayload({
      companyId,
      category: 'notifications',
      action: 'notification_delivered',
      title: 'Notificare primita',
      message: `${targetUserName} a primit notificarea: ${input.title}.`,
      actorUserId: input.actorUserId || '',
      actorUserName: input.actorUserName || 'WorkControl',
      actorUserThemeKey: input.actorUserThemeKey || null,
      targetUserId: userId,
      targetUserName,
      targetUserThemeKey: targetUser?.themeKey || null,
      entityId: input.entityId || '',
      entityLabel: input.title,
      path: input.notificationPath || buildPathFromNotification(input),
      pageTitle: 'Notificari',
      metadata: {
        module: input.module,
        eventType: input.eventType,
        soundEnabled,
      },
    }));
  });

  await batch.commit();
  return userIds.length;
}

function collectStartReminderUsers(rules, users) {
  const userMap = new Map(users.filter((user) => user.active !== false).map((user) => [user.id, user]));
  const recipientIds = new Set();

  rules.forEach((rule) => {
    const specificUserIds = (rule.recipients.specificUserIds || [])
      .map((userId) => toSafeString(userId))
      .filter((userId) => userMap.has(userId));
    const entityUserId = toSafeString(rule.entityId);

    if (specificUserIds.length > 0) {
      specificUserIds.forEach((userId) => recipientIds.add(userId));
      return;
    }

    if (entityUserId && userMap.has(entityUserId)) {
      recipientIds.add(entityUserId);
      return;
    }

    if (rule.recipients.notifyDirectUser) {
      userMap.forEach((user) => recipientIds.add(user.id));
    }
  });

  return Array.from(recipientIds)
    .map((userId) => userMap.get(userId))
    .filter(Boolean);
}

function ruleAppliesToTimesheet(rule, timesheetId, timesheetData) {
  const entityId = toSafeString(rule.entityId);
  if (!entityId) return true;
  return (
    entityId === timesheetId ||
    entityId === toSafeString(timesheetData.projectId) ||
    entityId === toSafeString(timesheetData.userId)
  );
}

function collectStopReminderRecipients(rules, users, timesheetUserId) {
  const userMap = new Map(users.filter((user) => user.active !== false).map((user) => [user.id, user]));
  const recipients = new Set();

  rules.forEach((rule) => {
    const specificUserIds = (rule.recipients.specificUserIds || []).map((userId) => toSafeString(userId)).filter(Boolean);
    const entityUserId = toSafeString(rule.entityId);
    const explicitlyTargetsUser =
      specificUserIds.includes(timesheetUserId) ||
      entityUserId === timesheetUserId ||
      rule.recipients.notifyDirectUser;

    if (explicitlyTargetsUser && userMap.has(timesheetUserId)) recipients.add(timesheetUserId);
  });

  return Array.from(recipients)
    .map((userId) => userMap.get(userId))
    .filter(Boolean);
}

async function createTimesheetReminderNotificationsOnce(params) {
  const companyId = toSafeString(params.companyId);
  if (!companyId) return false;
  const recipients = params.recipients.filter(Boolean);
  if (recipients.length === 0) return false;

  const markerRef = db.collection('timesheetReminderMarkers').doc(params.markerId);

  return db.runTransaction(async (tx) => {
    const marker = await tx.get(markerRef);
    if (marker.exists) return false;

    const now = Date.now();

    recipients.forEach((user) => {
      const notificationRef = db.collection('notifications').doc();
      tx.set(notificationRef, {
        companyId,
        userId: user.id,
        targetUserThemeKey: user.themeKey || null,
        actorUserId: '',
        actorUserName: 'WorkControl',
        actorUserThemeKey: null,
        title: params.title,
        message: params.message,
        module: 'timesheets',
        eventType: params.eventType,
        entityId: params.entityId || '',
        notificationPath: params.notificationPath || '/my-timesheets',
        soundEnabled: params.soundEnabled !== false,
        read: false,
        createdAt: now,
        createdAtServer: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('auditLogs').doc(), buildAuditPayload({
        companyId,
        category: 'notifications',
        action: 'notification_delivered',
        title: 'Notificare primita',
        message: `${user.name || user.id} a primit notificarea: ${params.title}.`,
        actorUserId: '',
        actorUserName: 'WorkControl',
        actorUserThemeKey: null,
        targetUserId: user.id,
        targetUserName: user.name || user.id,
        targetUserThemeKey: user.themeKey || null,
        entityId: params.entityId || '',
        entityLabel: params.title,
        path: params.notificationPath || '/my-timesheets',
        pageTitle: 'Notificari',
        metadata: {
          module: 'timesheets',
          eventType: params.eventType,
          soundEnabled: params.soundEnabled !== false,
          ruleId: params.ruleId || '',
          reminderSlot: Number.isFinite(params.reminderSlot) ? params.reminderSlot : null,
          repeatMinutes: Number.isFinite(params.repeatMinutes) ? params.repeatMinutes : null,
        },
      }));
    });

    tx.set(markerRef, {
      companyId,
      type: params.type,
      dateKey: params.dateKey || '',
      entityId: params.entityId || '',
      ruleId: params.ruleId || '',
      reminderSlot: Number.isFinite(params.reminderSlot) ? params.reminderSlot : null,
      repeatMinutes: Number.isFinite(params.repeatMinutes) ? params.repeatMinutes : null,
      recipientCount: recipients.length,
      createdAt: now,
      createdAtServer: FieldValue.serverTimestamp(),
    });

    return true;
  });
}

async function loadTimesheetReminderCompanyState(companyId, dayKey) {
  const [activeTimesheetsSnap, todayTimesheetsSnap, leaveSnap] = await Promise.all([
    db.collection('timesheets')
      .where('companyId', '==', companyId)
      .where('status', '==', 'activ')
      .limit(250)
      .get(),
    db.collection('timesheets')
      .where('companyId', '==', companyId)
      .where('workDate', '==', dayKey)
      .limit(250)
      .get(),
    db.collection('leaveRequests')
      .where('companyId', '==', companyId)
      .where('periodEnd', '>=', dayKey)
      .limit(250)
      .get(),
  ]);
  const activeTimesheets = activeTimesheetsSnap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() || {},
  }));
  return {
    activeTimesheets,
    activeTimesheetUserIds: new Set(
      activeTimesheets.map((item) => toSafeString(item.data.userId)).filter(Boolean)
    ),
    startedTodayUserIds: new Set(
      todayTimesheetsSnap.docs.map((doc) => toSafeString(doc.get('userId'))).filter(Boolean)
    ),
    approvedLeaveUserIds: new Set(
      leaveSnap.docs
        .filter((doc) => {
          const data = doc.data() || {};
          return (
            toSafeString(data.status) === 'aprobat' &&
            toSafeString(data.periodStart) <= dayKey &&
            dayKey <= toSafeString(data.periodEnd)
          );
        })
        .map((doc) => toSafeString(doc.get('userId')))
        .filter(Boolean)
    ),
  };
}

async function runTimesheetReminderAlertsJob() {
  const now = Date.now();
  const workerId = `timesheet-reminder-${now}-${stableHash(String(Math.random()), 8)}`;
  const dueSchedules = await db.collection('notificationSchedules')
    .where('workerType', '==', TIMESHEET_REMINDER_WORKER)
    .where('status', '==', 'scheduled')
    .where('nextRunAt', '<=', now)
    .orderBy('nextRunAt', 'asc')
    .limit(40)
    .get();
  const companyUsers = new Map();
  const companyStates = new Map();
  let createdCount = 0;
  let claimedCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let staleSkippedCount = 0;
  let activeTimesheetsChecked = 0;

  for (const scheduleDoc of dueSchedules.docs) {
    const scheduleRef = scheduleDoc.ref;
    let claimed = null;
    try {
      claimed = await claimVehicleAlertSchedule(scheduleRef, workerId, now);
      if (!claimed) continue;
      claimedCount += 1;
      const rule = scheduleToRule(claimed);
      const companyId = toSafeString(claimed.companyId);
      const dayKey = toSafeString(claimed.deliveryDateKey);
      const nextPatch = getNextTimesheetSchedulePatch(claimed, now);
      if (!companyId || !dayKey || !rule.enabled || rule.module !== 'timesheets') {
        await completeVehicleAlertSchedule(
          scheduleRef,
          claimed,
          workerId,
          { ...nextPatch, status: 'invalid', nextRunAt: null, lastErrorCode: 'invalid_schedule' },
          0,
          now
        );
        continue;
      }
      if (isStaleTimesheetSchedule(claimed, now)) {
        staleSkippedCount += 1;
        await completeVehicleAlertSchedule(scheduleRef, claimed, workerId, nextPatch, 0, now);
        completedCount += 1;
        continue;
      }

      if (!companyUsers.has(companyId)) {
        companyUsers.set(companyId, await getNotificationUsersForCompany(companyId));
      }
      const notificationUsers = companyUsers.get(companyId);
      const stateKey = `${companyId}:${dayKey}`;
      if (!companyStates.has(stateKey)) {
        companyStates.set(stateKey, await loadTimesheetReminderCompanyState(companyId, dayKey));
      }
      const state = companyStates.get(stateKey);
      const reminderSlot = Math.max(0, Math.round(toSafeNumber(claimed.reminderSlot, 0)));
      let scheduleCreatedCount = 0;

      if (toSafeString(claimed.scheduleKind) === 'timesheet_start_reminder') {
        const usersToRemind = collectStartReminderUsers([rule], notificationUsers).filter(
          (user) =>
            !state.startedTodayUserIds.has(user.id) &&
            !state.activeTimesheetUserIds.has(user.id) &&
            !state.approvedLeaveUserIds.has(user.id)
        );
        for (const user of usersToRemind) {
          const created = await createTimesheetReminderNotificationsOnce({
            companyId,
            markerId: `timesheet_start_${dayKey}_${user.id}_${rule.id}_${reminderSlot}`,
            type: 'timesheet_start_daily_reminder',
            dateKey: dayKey,
            ruleId: rule.id,
            reminderSlot,
            repeatMinutes: rule.reminderRepeatMinutes,
            recipients: [user],
            title: 'Porneste pontajul',
            message: `Nu ai pontaj pornit astazi. Reminder setat de la ora ${rule.scheduleTime || '08:30'}, repetare la ${rule.reminderRepeatMinutes} min, maximum ${rule.reminderActiveMinutes} min.`,
            eventType: 'timesheet_start_daily_reminder',
            notificationPath: '/my-timesheets',
            soundEnabled: rule.soundEnabled !== false,
          });
          if (created) scheduleCreatedCount += 1;
        }
      } else {
        activeTimesheetsChecked += state.activeTimesheets.length;
        for (const timesheetDoc of state.activeTimesheets) {
          const timesheet = timesheetDoc.data;
          const timesheetUserId = toSafeString(timesheet.userId);
          if (!timesheetUserId || state.approvedLeaveUserIds.has(timesheetUserId)) continue;
          if (!ruleAppliesToTimesheet(rule, timesheetDoc.id, timesheet)) continue;
          const recipients = collectStopReminderRecipients([rule], notificationUsers, timesheetUserId);
          const created = await createTimesheetReminderNotificationsOnce({
            companyId,
            markerId: `timesheet_stop_${dayKey}_${timesheetDoc.id}_${rule.id}_${reminderSlot}`,
            type: 'timesheet_stop_after_8h_reminder',
            dateKey: dayKey,
            entityId: timesheetDoc.id,
            ruleId: rule.id,
            reminderSlot,
            repeatMinutes: rule.reminderRepeatMinutes,
            recipients,
            title: 'Opreste pontajul',
            message: `Ai pontaj activ dupa ora ${rule.stopTime || '17:00'}. Reminderul se repeta la ${rule.reminderRepeatMinutes} min, maximum ${rule.reminderActiveMinutes} min.`,
            eventType: 'timesheet_stop_after_8h_reminder',
            notificationPath: '/my-timesheets',
            soundEnabled: rule.soundEnabled !== false,
          });
          if (created) scheduleCreatedCount += 1;
        }
      }

      createdCount += scheduleCreatedCount;
      await completeVehicleAlertSchedule(
        scheduleRef,
        claimed,
        workerId,
        { ...nextPatch, lastDeliveredAt: now },
        scheduleCreatedCount,
        now
      );
      completedCount += 1;
    } catch (error) {
      failedCount += 1;
      logger.error('[checkTimesheetReminderAlerts][schedule]', {
        scheduleId: scheduleRef.id,
        error,
      });
      if (claimed) {
        await failVehicleAlertSchedule(scheduleRef, claimed, workerId, now, error)
          .catch((releaseError) => logger.error('[checkTimesheetReminderAlerts][release]', {
            scheduleId: scheduleRef.id,
            error: releaseError,
          }));
      }
    }
  }

  return {
    dueCount: dueSchedules.size,
    claimedCount,
    completedCount,
    failedCount,
    staleSkippedCount,
    createdCount,
    companyUserSetsLoaded: companyUsers.size,
    companyStatesLoaded: companyStates.size,
    activeTimesheetsChecked,
    fullRuleScans: 0,
    fullUserScans: 0,
    fullTimesheetScans: 0,
    fullLeaveScans: 0,
  };
}

function buildWorkControlAssistantExamples() {
  return [
    '1. "du-ma la dashboard" => navigation/open_page /dashboard.',
    '2. "deschide masina mea" => navigation/open_my_vehicle /my-vehicle.',
    '3. "du-ma la pontajul meu" => navigation/open_my_timesheets /my-timesheets, fara start pontaj.',
    '4. "arata pontajele" => navigation/open_page /timesheets.',
    '5. "deschide proiecte" => navigation/open_page /projects.',
    '6. "deschide concedii" => navigation/open_leave /my-leave.',
    '7. "du-ma la bonuri" => navigation/open_expense_scan /expenses/scan?assistant=upload.',
    '8. "deschide facturi" => navigation/open_expense_invoices /expenses/invoices.',
    '9. "du-ma la mentenanta" => navigation/open_page /maintenance.',
    '10. "deschide piese mentenanta" => navigation/open_page /maintenance?tab=parts.',
    '11. "deschide firme mentenanta" => navigation/open_page /maintenance?tab=companies.',
    '12. "arata istoricul rapoartelor" => navigation/open_page /maintenance?tab=history.',
    '13. "verifica reviziile lunare" => navigation/open_page /maintenance?tab=checks.',
    '14. "genereaza raport revizie" => navigation/open_maintenance_report /maintenance?tab=report&assistant=report.',
    '15. "deschide toate gpsurile" => navigation/open_gps_maps /vehicles/gps-map.',
    '16. "harta cu toate gps in dreptul dacia spring" => navigation/open_gps_maps, entityType vehicle, entityQuery "dacia spring".',
    '17. "du-ma la gpsul dubei cu 04" => navigation/open_vehicle_tracker, entityQuery "04".',
    '18. "deschide tracker live la B 33 LGR" => navigation/open_vehicle_tracker, entityQuery "B33LGR".',
    '19. "deschide detalii live Logan" => navigation/open_vehicle_live, entityQuery "Logan".',
    '20. "arata masina condusa de Razvan" => navigation/open_vehicle, entityQuery "Razvan".',
    '21. "schimba kilometrii Loganului la 6200" => entity_update/update_vehicle vehicle "Logan" fields {"kilometri":6200}.',
    '22. "pune km la B 33 LGR 6180" => entity_update/update_vehicle vehicle "B33LGR" fields {"kilometri":6180}.',
    '23. "modifica ITP la Logan pe 20 septembrie 2026" => entity_update/update_vehicle fields {"ITP":"2026-09-20"}.',
    '24. "schimba RCA la B44ABC pe 01.08.2026" => entity_update/update_vehicle fields {"RCA":"2026-08-01"}.',
    '25. "pune rovinieta la Toyota pe 15 august" => entity_update/update_vehicle fields {"rovinieta":"2026-08-15"}.',
    '26. "seteaza casco la dacia pana pe 10 octombrie" => entity_update/update_vehicle fields {"casco":"2026-10-10"}.',
    '27. "schimba soferul la B33LGR pe Mihai" => entity_update/update_vehicle fields {"sofer":"Mihai"}.',
    '28. "pune masina lui Razvan in service" => entity_update/update_vehicle entityQuery "Razvan" fields {"status":"in_service"}.',
    '29. "marcheaza masina B44ABC avariata" => entity_update/update_vehicle fields {"status":"avariata"}.',
    '30. "schimba numarul masinii Toyota in B99XYZ" => entity_update/update_vehicle fields {"numar inmatriculare":"B99XYZ"}.',
    '31. "modifica marca masinii B33LGR in Dacia" => entity_update/update_vehicle fields {"marca":"Dacia"}.',
    '32. "schimba modelul la B33LGR in Logan" => entity_update/update_vehicle fields {"model":"Logan"}.',
    '33. "seteaza VIN la B33LGR UU1..." => entity_update/update_vehicle fields {"vin":"UU1..."}.',
    '34. "pune urmatorul service la 90000 km" => entity_update/update_vehicle, daca entitatea lipseste confidence sub 0.85 si missingFields ["vehicle"].',
    '35. "editeaza km masinii in 6180" => entity_update/update_vehicle numai daca exista masina in context, altfel clarificare.',
    '36. "creeaza masina B55ABC Dacia Logan" => create_entity/create_vehicle fields {"plateNumber":"B55ABC","brand":"Dacia","model":"Logan"}.',
    '37. "adauga masina Toyota Corolla B10ABC" => create_entity/create_vehicle fields plateNumber brand model.',
    '38. "deschide formular masina noua" => navigation/open_page /vehicles/new, nu completa campuri.',
    '39. "deschide scule" => navigation/open_page /tools.',
    '40. "deschide scula Bosch" => navigation/open_tool entityQuery "Bosch".',
    '41. "arata flexul Bosh" => navigation/open_tool entityQuery "Bosh"; fuzzy poate gasi Bosch.',
    '42. "marcheaza flexul Bosch defect" => entity_update/update_tool tool "flex Bosch" fields {"status":"defecta"}.',
    '43. "muta bormasina la Ionut" => entity_update/update_tool fields {"detinator":"Ionut"}.',
    '44. "schimba responsabilul la Hilti pe Mihai" => entity_update/update_tool fields {"responsabil":"Mihai"}.',
    '45. "pune cod intern la flex Bosch F123" => entity_update/update_tool fields {"cod intern":"F123"}.',
    '46. "schimba locatia sculei Hilti in depozit" => entity_update/update_tool fields {"locatie":"depozit"}.',
    '47. "adauga observatii la bormasina verificata" => entity_update/update_tool fields {"observatii":"verificata"}.',
    '48. "seteaza garantia la Hilti pe 01.12.2026" => entity_update/update_tool fields {"garantie":"2026-12-01"}.',
    '49. "creeaza scula flex Bosch cod F123" => create_entity/create_tool fields {"name":"flex Bosch","internalCode":"F123"}.',
    '50. "adauga unealta Bosh mare" => create_entity/create_tool fields {"name":"Bosh mare"}.',
    '51. "deschide pontajul meu" => navigation/open_my_timesheets, fara start.',
    '52. "porneste pontajul" => timesheet_action/start_timesheet, confirmation required.',
    '53. "porneste pontaj pe proiect Vali Mare Boss" => timesheet_action/start_timesheet targetText "Vali Mare Boss".',
    '54. "selecteaza proiectul Vali Mare Boss si dai start pontaj" => timesheet_action/start_timesheet targetText "Vali Mare Boss".',
    '55. "creeaza proiect Service 2 si porneste pontaj" => timesheet_action/start_timesheet fields {"project":"Service 2","createProjectIfMissing":true}.',
    '56. "opreste pontajul" => timesheet_action/stop_timesheet.',
    '57. "inchide pontajul activ" => timesheet_action/stop_timesheet.',
    '58. "arata ultimul pontaj al lui Razvan" => navigation/open_user_activity sau open_latest_timesheet entityQuery "Razvan".',
    '59. "du-ma la pontaje si cauta Mihai" => navigation/open_page /timesheets?assistantSearch=Mihai.',
    '60. "creeaza proiect Revizie Lifturi Sector 3" => create_entity/create_project fields {"name":"Revizie Lifturi Sector 3"}.',
    '61. "schimba proiectul Service Lifturi in finalizat" => entity_update/update_project fields {"status":"finalizat"}.',
    '62. "seteaza proiectul Vali inactiv" => entity_update/update_project fields {"status":"inactiv"}.',
    '63. "schimba numele proiectului Service 2 in Service 2026" => entity_update/update_project fields {"name":"Service 2026"}.',
    '64. "programeaza concediu maine" => form_fill/schedule_leave formSchemaId leave-request fields startDate/endDate maine.',
    '65. "programeaza concediu din 24 august pana pe 30 august" => form_fill/schedule_leave fields {"startDate":"2026-08-24","endDate":"2026-08-30"}.',
    '66. "completeaza concediu motiv medical pe 12 august" => form_fill/fill_leave_form fields {"startDate":"2026-08-12","endDate":"2026-08-12","reason":"medical"}.',
    '67. "trimite cererea de concediu" => submit_current_form, confirmation required, nu apasa fara confirmare.',
    '68. "du-ma la calendar concedii" => navigation/open_leave.',
    '69. "adauga client mentenanta Isomat lift 210869" => create_entity/create_maintenance_client formSchemaId maintenance-client fields {"name":"Isomat","liftNumbers":["210869"]}.',
    '70. "adauga client nou Isomat email office@isomat.ro lift 210869" => create_maintenance_client fields name email liftNumbers.',
    '71. "completeaza client mentenanta Isomat adresa Aurel Vlaicu 91 lift 210869" => fill_maintenance_client_form.',
    '72. "adauga client mentenanta Isomat cu firma ISL Elevator" => create_maintenance_client fields maintenanceCompany.',
    '73. "adauga doua lifturi 123 si 456 la client Isomat" => create_maintenance_client fields {"name":"Isomat","liftNumbers":["123","456"]}.',
    '74. "deschide clientul Isomat" => navigation/open_page sau open_page /maintenance cu entityQuery Isomat.',
    '75. "genereaza raport revizie pentru Isomat" => form_fill/open_maintenance_report cu maintenance.report.send si fields {"clientQuery":"Isomat","reportType":"revizie","observations":"","submitMode":"send","waitForPhotos":false}, confirmationRequired true.',
    '76. "genereaza raport interventie pentru clientul X cu observatia usa nu se inchide si asteapta sa atasez pozele" => form_fill/open_maintenance_report cu maintenance.report.prepare si fields {"clientQuery":"X","reportType":"interventie","observations":"usa nu se inchide","submitMode":"prepare","waitForPhotos":true}, fara trimitere.',
    '76b. "genereaza raport revizie pentru clientul Isomat" => form_fill/open_maintenance_report cu maintenance.report.send, aceleasi campuri cu submitMode "send", confirmationRequired true si risk high. Verbul genereaza implica trimiterea daca utilizatorul nu cere explicit doar pregatirea.',
    '77. "deschide piese la mentenanta" => navigation/open_page /maintenance?tab=parts.',
    '78. "adauga client mentenanta" fara nume => create_entity cu confidence sub 0.85 si missingFields ["name","liftNumbers"].',
    '79. "deschide firme branding" => navigation/open_page /maintenance?tab=companies.',
    '80. "arata verificari lunare" => navigation/open_page /maintenance?tab=checks.',
    '81. "deschide istoric rapoarte" => navigation/open_page /maintenance?tab=history.',
    '82. "incarca poza la bon" => navigation/open_expense_scan /expenses/scan?assistant=upload.',
    '83. "deschide bonuri si scoate in fata butonul de incarcare" => navigation/open_expense_scan.',
    '84. "scaneaza bon" => navigation/open_expense_scan, nu poti alege fisier automat.',
    '85. "deschide rapoarte cheltuieli" => navigation/open_page /expenses/reports.',
    '86. "deschide facturi neplatite" => navigation/open_expense_invoices.',
    '87. "completeaza proiectul bonului cu Service 2" => form_fill doar daca pagina/schema bonuri exista; altfel clarificare.',
    '88. "deschide profilul meu" => navigation/open_page /my-profile.',
    '89. "completeaza functia cu tehnician lifturi" => entity_update/update_user user context current or current user fields {"functie":"tehnician lifturi"}.',
    '90. "schimba functia lui Ionut in tehnician lifturi" => entity_update/update_user entityQuery Ionut fields {"functie":"tehnician lifturi"}.',
    '91. "pune departamentul lui Mihai la interventii" => entity_update/update_user fields {"departament":"interventii"}.',
    '92. "schimba rolul lui Razvan in manager" => entity_update/update_user risk high confirmation required.',
    '93. "salveaza utilizatorul" => submit_current_form confirmation required, nu scrie in input.',
    '94. "arata ultima activitate a lui Ionut" => navigation/open_user_activity entityQuery Ionut.',
    '95. "deschide istoricul lui Mihai" => navigation/open_user_activity entityQuery Mihai.',
    '96. "creeaza notificare pentru Razvan mesaj verifica pontajul" => create_entity/create_manual_notification fields {"target":"Razvan","message":"verifica pontajul"}.',
    '97. "marcheaza toate notificarile citite" => navigation/open_page /notifications; executia reala necesita actiune controlata si confirmare.',
    '98. "deschide notificari" => navigation/open_page /notifications.',
    '99. "du-ma la firme" => navigation/open_page /companies.',
    '100. "deschide panou control" => navigation/open_page /control-panel.',
    '101. "cauta client Isomat in mentenanta" => navigation/open_page /maintenance?tab=clients&assistantSearch=Isomat.',
    '102. "cauta scula bosh" => navigation/open_tool entityQuery bosh.',
    '103. "cauta masina cu 04 in numar" => navigation/open_vehicle entityQuery 04.',
    '104. "duba cu YRA tracker" => navigation/open_vehicle_tracker entityQuery YRA.',
    '105. "schimba si telefonul in 0722" => update numai daca lastEntity este user/client cu camp telefon; altfel missingFields ["entity"].',
    '106. "schimba si departamentul in service" => update_user daca lastEntity user; altfel missingFields ["user"].',
    '107. "pune si ITP pe 10 august" => update_vehicle daca lastEntity vehicle; altfel missingFields ["vehicle"].',
    '108. "deschide unde am ramas" => navigation catre lastPage daca exista context, altfel unknown.',
    '109. "sterge proiectul X" => commandType unknown sau high risk cu confirmation required; daca nu exista intent sigur, intreaba.',
    '110. "adauga client cu numele text lung confuz fara lift" => create_maintenance_client confidence sub 0.85 si missingFields ["liftNumbers"].',
    '111. "deschide pagina mentenanta la formularul de client si adauga Isomat lift 210869" => create_maintenance_client, nu navigation simplu.',
    '112. "du-ma la pagina mentenanta la formularul de client" => navigation/open_page /maintenance?tab=clients&assistant=client, fara fields.',
    '113. "iesi din formularul de concediu si mergi la dashboard" => navigation/open_dashboard cu navigation.open; nu trimite si nu modifica formularul.',
    '114. "pune-l si pana vineri" => form_fill/fill_leave_form cu leave.draft numai daca formularul si comanda anterioara dau contextul; confirmation required.',
    '115. "deschide lista de utilizatori" => navigation/open_page /users.',
    '116. "arata profilul meu" => navigation/open_page /my-profile.',
    '117. "arata ultima activitate a lui Ionut" => navigation/open_user_activity entityQuery Ionut.',
    '118. "deschide utilizatoru Razvan" => navigation/open_user_activity; accepta greseala de dictare utilizatoru.',
    '119. "schimba functia lui Ionut in tehnician lifturi" => entity_update/update_user cu users.update si confirmation required.',
    '120. "pune departamentul lui Mihai la interventii" => entity_update/update_user cu users.update.',
    '121. "schimba rolul lui Razvan in manager" => entity_update/update_user, risk high, users.update si confirmation required.',
    '122. "schimba telefonul meu in 0722000000" => entity_update/update_profile_field cu users.update pentru utilizatorul curent.',
    '123. "schimba departamentul in service" => clarification, confidence sub 0.85, missingInformation ["user"], fara toolCalls.',
    '124. "deschide istoricul lui Ion" cu mai multi utilizatori Ion => clarification si optiuni, fara navigare.',
    '125. "schimba-i si telefonul in 0722111111" => update_user numai daca lastEntity este user; altfel clarification.',
    '126. "schimba rolul lui Razvan in admin" ca angajat => users.update planificat dar blocat permission_denied, fara executie.',
    '127. "pune din nou rolul manager pentru Razvan" cand rolul este deja manager => duplicate, fara executie.',
    '128. "reincearca schimbarea rolului" dupa esec => cere din nou confirmarea; retry nu ocoleste permisiunile sau confirmarea.',
    '129. "deschide scanarea bonurilor" => navigation/open_expense_scan /expenses/scan?assistant=upload.',
    '130. "arata facturile neplatite" => navigation/open_expense_invoices /expenses/invoices.',
    '131. "du-ma la rapoarte de cheltuieli" => navigation/open_page /expenses/reports.',
    '132. "deschide cheltuelile" => navigation/open_expense_scan; accepta greseala cheltuelile.',
    '133. "completeaza categoria bonului cu combustibil" => form_fill/fill_current_page cu expenses.draft numai in formularul de cheltuiala, confirmation required.',
    '134. "pune proiectul Service 2 si nota deplasare la bon" => un singur draft expenses.draft cu ambele campuri, fara salvare automata.',
    '135. "completeaza bonul" => clarification, confidence sub 0.85, missingInformation ["fields"], fara toolCalls.',
    '136. "pune si proiectul Service 3" => expenses.draft numai daca openForm este expense; altfel clarification.',
    '137. "completeaza firma bonului cu OMV" fara permisiune => expenses.draft blocat permission_denied.',
    '138. "scaneaza din nou acelasi bon" cand bonul este duplicat => no-execution duplicate; nu incarca sau salveaza automat.',
    '139. "reincearca completarea bonului" dupa esec => cere reconfirmare inainte de expenses.draft.',
    '140. "iesi din formularul bonului si du-ma la mentenanta" => navigation/open_page /maintenance, fara form_fill.',
    '141. "deschide notificarile" => navigation/open_page /notifications.',
    '142. "arata alertele mele" => navigation/open_page /notifications; alerte este sinonim pentru notificari.',
    '143. "cauta notificarile despre pontaj" => navigation/open_page /notifications cu assistantSearch pontaj.',
    '144. "creeaza notificare pentru Razvan: verifica pontajul" => create_manual_notification dar no-execution daca nu exista tool controlat de notificari.',
    '145. "trimite notificarea verifica pontajul" => clarification, confidence sub 0.85, missingInformation ["targetUser"].',
    '146. "marcheaza toate notificarile citite" => no-execution daca registry-ul nu are tool controlat; nu trata drept simpla navigare executabila.',
    '147. "sterge notificarea de ieri" => unknown/no-execution, risk high; intentul de stergere nu este suportat.',
    '148. "trimite o notificare tuturor utilizatorilor" fara rol permis => permission_denied si no-execution.',
    '149. "reincearca trimiterea notificarii pentru Razvan" => retry necesita tool suportat si confirmare noua; altfel no-execution.',
    '150. "trimite din nou notificarea care a plecat" => duplicate/no-execution; nu repeta efectul deja reusit.',
    '151. "dute la masni" => navigation/open_page /vehicles; intelege greselile mici fara sa schimbe modulul.',
    '152. "ia vezi notificrile" => navigation/open_page /notifications.',
    '153. "unde gasesc bonurile" => navigation/open_expense_scan /expenses/scan?assistant=upload.',
    '154. "ponteaza-ma pe Hotel Balada" => timesheet_action/start_timesheet targetText "Hotel Balada".',
    '155. "am plecat" => timesheet_action/stop_timesheet numai daca exista pontaj activ.',
    '156. "gata inchide ziua" => timesheet_action/stop_timesheet.',
    '157. "itp 20 august" pe pagina masinii => entity_update/update_vehicle pentru selectedEntity, fields {"ITP":"2026-08-20"}.',
    '158. "departament interventii" pe profilul unui utilizator => entity_update/update_user pentru selectedEntity.',
    '159. "stare defecta" pe pagina unei scule => entity_update/update_tool pentru selectedEntity.',
    '160. "schimba-i si functia in electrician" dupa selectarea unui user => entity_update/update_user pentru lastEntity.',
    '161. "raport interventie Vali, la observatii pune liftul merge normal" => observations este doar "Liftul merge normal".',
    '162. "fa ce trebuie la Vali pentru revizie" => clarification; nu inventa actiunea daca raportul nu este spus clar.',
    '163. "du-ma acolo la Toyota" dupa o referinta GPS anterioara => foloseste lastEntity si lastPage numai daca referinta este unica.',
    '164. "fa si la celalalt" cu doua entitati posibile => clarification, fara toolCalls.',
    '165. "schimba data" fara camp sau context unic => clarification, confidence sub 0.85.',
    '166. "as vrea sa vad masinile" => navigation/open_page /vehicles; formulele politicoase nu schimba intentia.',
    '167. "poti sa imi deschizi pontajul meu" => navigation/open_my_timesheets, fara pornirea pontajului.',
    '168. "vreau sa ma uit la cheltuieli" => navigation/open_expense_scan /expenses/scan.',
    '169. "raport interventie la Vali si scrie usa se blocheaza" => maintenance.report.send cu clientQuery Vali si observations doar "Usa se blocheaza.".',
    '170. "genereaza interventia la Vali iar pune liftul functioneaza normal" => maintenance.report.send, observations doar "Liftul functioneaza normal.".',
    '171. "schimba ITP la Toyota pe 20 august 2026" => vehicles.update entityQuery Toyota, nextItpDate 2026-08-20, confirmation required.',
    '172. "pune garantia la Bosch pe 1 decembrie 2026" => tools.update entityQuery Bosch, warrantyUntil 2026-12-01, confirmation required.',
    '173. "modifica functia lui Ionut in tehnician lifturi" => users.update entityQuery Ionut, roleTitle tehnician lifturi.',
    '174. "arata Toyota pe GPS" => vehicles.open destination tracker, entityQuery Toyota.',
    '175. "deschide masina Toyota la tracker live" => vehicles.open destination tracker, entityQuery Toyota.',
    '176. "fami un raport revisie pentru Vali" => maintenance.report.send pentru Vali; corecteaza numai instructiunea, nu numele.',
    '177. "gata am terminat treaba" => timesheet_action/stop_timesheet numai daca exista pontaj activ.',
    '178. "da-mi exemple cu ce poti face" => question/assistant_help, fara navigare sau modificari.',
    '179. "schimba aia la 7200" fara entitate si camp unic => clarification, nu folosi primul input vizibil.',
    '180. "pune si asta la Mihai" cu referinta ambigua => clarification, fara executie.',
    '181. "du-ma pe pagina masina mea si arata-mi cati kilometri curenti am" => navigation/open_my_vehicle /my-vehicle; "masina mea" inseamna vehiculul asignat utilizatorului, fara cautare in flota.',
    '182. "pune-mi functia electrician" => entity_update/update_user pentru utilizatorul autentificat, users.update, confirmation required.',
    '183. "vreau ca departamentul meu sa fie service" => entity_update/update_user pentru utilizatorul autentificat, department service.',
    '184. "opreste regula Pontaj dimineata" => entity_update/update_notification_rule, notifications.rules.update, fields {"enabled":false}.',
    '185. "da drumul la sunet pentru regula Pontaj start" => entity_update/update_notification_rule, fields {"soundEnabled":true}.',
    '186. "pune ora regulii Pontaj dimineata la 7" => entity_update/update_notification_rule, fields {"scheduleTime":"07:00"}.',
    '187. "schimba intervalul regulii Pontaj start la 30 minute" => entity_update/update_notification_rule, fields {"reminderRepeatMinutes":30}.',
    '188. "deschide setarile mele" => navigation/open_page /my-profile.',
    '189. "deschide setarile notificarilor" => navigation/open_page /notification-rules daca rolul permite; altfel clarificare.',
    '190. "fa masina asta indisponibila" pe pagina unei masini => entity_update/update_vehicle pentru selectedEntity, fields {"status":"indisponibila"}.',
    '191. "fa interfata compacta" => entity_update/update_site_settings, settings.update, fields {"uiDensity":"compact"}, confirmation required.',
    '192. "pune tema siteului pe mov" => entity_update/update_site_settings, settings.update, fields {"uiPalette":"violet"}, confirmation required.',
    '193. "opreste animatiile in aplicatie" => entity_update/update_site_settings, settings.update, fields {"uiAnimations":"none"}, confirmation required.',
    '194. "mareste fontul" => entity_update/update_site_settings, settings.update, fields {"uiFontScale":"mai mare"}, confirmation required.',
  ];
}

function buildAssistantPrompt(today, context) {
  const safeContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
  const memory = safeContext.memory && typeof safeContext.memory === 'object' && !Array.isArray(safeContext.memory) ? safeContext.memory : {};
  const contextText = JSON.stringify({
    route: toSafeString(safeContext.route || safeContext.currentPathname),
    page: toSafeString(safeContext.page),
    selectedEntity:
      safeContext.selectedEntity && typeof safeContext.selectedEntity === 'object' && !Array.isArray(safeContext.selectedEntity)
        ? {
            type: toSafeString(safeContext.selectedEntity.type),
            id: toSafeString(safeContext.selectedEntity.id),
            label: toSafeString(safeContext.selectedEntity.label),
          }
        : null,
    openForm:
      safeContext.openForm && typeof safeContext.openForm === 'object' && !Array.isArray(safeContext.openForm)
        ? { id: toSafeString(safeContext.openForm.id), mode: toSafeString(safeContext.openForm.mode) }
        : null,
    availableActions: Array.isArray(safeContext.availableActions)
      ? safeContext.availableActions.slice(0, 50).map((item) => toSafeString(item)).filter(Boolean)
      : [],
    allowedFields: Array.isArray(safeContext.allowedFields)
      ? safeContext.allowedFields.slice(0, 100).map((item) => toSafeString(item)).filter(Boolean)
      : [],
    role: toSafeString(safeContext.role || safeContext.userRole),
    memory: {
      lastEntity:
        memory.lastEntity && typeof memory.lastEntity === 'object' && !Array.isArray(memory.lastEntity)
          ? {
              type: toSafeString(memory.lastEntity.type || memory.lastEntity.entityType),
              id: toSafeString(memory.lastEntity.id || memory.lastEntity.entityId),
              label: toSafeString(memory.lastEntity.label),
            }
          : null,
      lastPage: toSafeString(memory.lastPage),
      previousPage: toSafeString(memory.previousPage),
      lastCommand: toSafeString(memory.lastCommand),
    },
  });

  return [
    'Esti interpretul AI pentru WorkControl. Functionezi ca agent, nu ca autocomplete, script sau clicker.',
    'FAZA 1: primesti transcriptul. Nu executi nimic.',
    'FAZA 2: intelegi intentia si intorci STRICT JSON conform schemei. Nu adauga explicatii in afara JSON.',
    'Contractul este Assistant V3: version este mereu "3"; toolCalls contine doar tool-uri controlate; entityReferences si missingInformation sunt explicite.',
    'FAZA 3: pregatesti date pentru validare: modul, entitate, campuri, navigare, confirmare, confidence, reasoning si executionPlan.',
    'FAZA 4: daca nu esti sigur, NU ghici. Pune confidence sub 0.85, missingFields potrivite si intent unknown sau intentul sigur incomplet.',
    'FAZA 5: executia se face doar in frontend dupa validare si confirmare. Tu nu executi.',
    `Data curenta este ${today}. Converteste azi/maine/poimaine si datele relative in YYYY-MM-DD.`,
    `Context pagina si memorie: ${contextText}. Foloseste contextul doar cand comanda se refera clar la "asta", "acesta", "si", "tot aici".`,
    'Returneaza doar JSON. Campurile fields si fieldsToUpdate trebuie sa fie identice pentru modificari/completari.',
    'Tool id-uri permise: navigation.open, vehicles.update, vehicles.draft, tools.update, tools.draft, timesheets.projects.update, timesheets.projects.create, timesheets.projects.draft, users.update, users.draft, timesheets.start, timesheets.stop, maintenance.draft, maintenance.report.prepare, maintenance.report.send, leave.draft, expenses.draft, notifications.rules.update, settings.update.',
    'Pentru fiecare toolCall completeaza toate cheile input; foloseste string gol, false si obiect gol pentru cheile nefolosite.',
    'response este mesajul scurt pentru utilizator; confirmationRequired reflecta riscul intregului plan.',
    'commandType valori: navigation, form_fill, entity_update, create_entity, timesheet_action, question, unknown.',
    'intent valori permise sunt exact cele din schema. Nu inventa intentii.',
    'targetModule valori recomandate: navigation, vehicles, tools, timesheets, leave, maintenance, expenses, users, notifications, settings, projects, assistant.',
    'entityType valori: vehicle, tool, project, user, maintenanceClient, page, currentPage, none.',
    'formSchemaId valori: maintenance-client, leave-request, expense, vehicle, tool, user, project, timesheet sau string gol.',
    'Nu transforma navigarea in completare. "du-ma la pontajul meu" nu porneste pontajul.',
    'Nu transforma textul comenzii in valoare de input. Nu exista regula "daca gasesc input scriu acolo".',
    'Intelege romana colocviala, regionala, agramaticala si dictarea fonetica: articole lipsa, cuvinte lipite, acorduri gresite si expresii precum "baga", "da-i drumul", "gata pe azi" sau "du-ma". Nu cere o formulare rigida.',
    'Ignora formulele de politete si introducerile conversationale precum "te rog", "as vrea", "poti sa", "vreau sa ma uit", "fa-mi" sau "ajuta-ma sa", dar pastreaza integral numele, datele, identificatorii si valorile dictate.',
    'Accepta ordinea naturala a cuvintelor: entitatea poate aparea inainte sau dupa destinatie, de exemplu "Toyota pe GPS" si "GPS-ul Toyota" au acelasi sens cand exista un rezultat unic.',
    'Repara semantic greselile mici de dictare si formele populare inainte de clasificare: "dute", "duma", "bagama", "masni", "notficari", "pontaju". Nu modifica nume, numere auto, date, coduri sau textul dictat ca valoare.',
    'Identifica mai intai actiunea principala, apoi entitatea si abia apoi valorile. Cuvinte de legatura ca "ala", "asta", "acolo", "cum am zis", "si dupa" nu sunt valori de formular.',
    'Daca utilizatorul este deja pe pagina unei entitati, accepta formulari scurte de tip camp plus valoare, de exemplu "ITP 20 august", "departament interventii" sau "stare defecta". Foloseste selectedEntity; nu cauta alta entitate.',
    'La propozitii lungi, imparte mental in clauze dupa "si", "apoi", "dupa aia" si "iar". Pastreaza ordinea, dar nu taia aceste cuvinte din textul unei observatii dupa ce ai identificat markerul de camp.',
    'Daca lipseste verbul dar intentia rezulta unic din pagina si schema curenta, construieste actiunea controlata cu confirmare. Daca sunt doua interpretari plauzibile, cere clarificare in loc sa alegi.',
    'Pastreaza numele proprii, numerele, datele si identificatorii. Corecteaza numai forma instructiunii, nu inventa valori.',
    'Separa strict instructiunea de valoare: in "la observatii baga liftul merge normal", valoarea observatiei este doar "Liftul merge normal", nu restul comenzii.',
    'Foloseste pagina curenta, selectedEntity si lastEntity pentru pronume precum "asta", "aici", "al meu" sau "schimba si...". Daca exista doua entitati posibile, cere alegerea.',
    'Foloseste previousPage numai pentru cereri explicite precum "revino unde eram" sau "inapoi acolo". Nu repeta automat actiunea ori modificarea din pagina anterioara.',
    'Cand indiciile spun isContinuation, leaga noua clauza de lastCommand si lastEntity numai daca tipul entitatii si campul sunt compatibile. Nu copia valoarea veche si nu repeta o scriere fara confirmare.',
    'Comenzile cu mai multi pasi se pastreaza in ordinea rostita. Nu executa pasul urmator daca primul necesita clarificare.',
    'DOM fallback este interzis. Daca nu exista schema sau executor, cere clarificare.',
    'entity_update inseamna update prin servicii Firestore dupa resolve entity, nu prin formular si nu prin DOM.',
    'form_fill inseamna trimitere de obiect catre schema formularului, fara salvare automata.',
    'Pentru raport de mentenanta, genereaza/creeaza/fa raport inseamna generare si trimitere cu maintenance.report.send si confirmationRequired true. Foloseste maintenance.report.prepare numai cand utilizatorul cere explicit pregatire, completare, fara trimitere sau asteptarea pozelor.',
    'create_entity inseamna creare dupa confirmare sau completare formular controlat, nu click arbitrar.',
    'timesheet_action porneste/opreste pontaj doar daca exista verb explicit: porneste, start, incepe, opreste, stop, inchide.',
    'Pentru rezultate multiple sau entitati slabe, confidence sub 0.85 si missingFields ["entity"].',
    'Pentru stergeri, roluri si valori sensibile, risk high si confirmation.required true; daca nu exista intent sigur, unknown.',
    'navigation.ruta trebuie completata in navigation.path si targetPage. Daca nu navigheaza, path gol.',
    'confirmation.required este true pentru orice create/entity_update/timesheet_action/submit_current_form si pentru orice risc medium/high.',
    'executionPlan trebuie sa contina pasi concreti: understand, navigate, resolve_entity, validate_fields, service_update/form_event, highlight, confirm, audit.',
    'Exemple reale WorkControl:',
    ...buildWorkControlAssistantExamples(),
  ].join('\n');
}

async function persistAssistantInterpretationTrace(params) {
  try {
    const ownerSnap = await db.collection('users').doc(toSafeString(params.ownerUserId)).get();
    const owner = ownerSnap.data() || {};
    const companyId = toSafeString(owner.primaryCompanyId) ||
      (Array.isArray(owner.companyIds) ? toSafeString(owner.companyIds[0]) : '');
    if (
      !ownerSnap.exists || owner.active !== true ||
      toSafeString(owner.accessStatus) !== 'active' || !companyId
    ) return '';
    const trace = buildAssistantTraceDocument(params);
    const traceRef = await db.collection('aiCommandLogs').add({
      ...trace,
      companyId,
      createdAtServer: FieldValue.serverTimestamp(),
      updatedAtServer: FieldValue.serverTimestamp(),
    });
    return traceRef.id;
  } catch (error) {
    logger.error('[assistantObservability][trace write]', {
      code: toSafeString(error?.code).slice(0, 80) || 'unknown',
    });
    return '';
  }
}

exports.interpretAssistantCommand = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 30,
    memory: '512MiB',
    secrets: [openaiApiKey],
  },
  async (request) => {
    const context = await assertActiveInternalRequest(request);

    const startedAtMs = Date.now();
    const command = toSafeString(request.data?.command).slice(0, 600);
    const originalCommand = toSafeString(request.data?.originalCommand || command).slice(0, 600);
    const rawLanguageHints =
      request.data?.languageHints && typeof request.data.languageHints === 'object' &&
      !Array.isArray(request.data.languageHints)
        ? request.data.languageHints
        : {};
    const languageHints = {
      action: toSafeString(rawLanguageHints.action).slice(0, 30),
      modules: Array.isArray(rawLanguageHints.modules)
        ? rawLanguageHints.modules.slice(0, 10).map((item) => toSafeString(item).slice(0, 40)).filter(Boolean)
        : [],
      usesCurrentContext: rawLanguageHints.usesCurrentContext === true,
      hasMultipleSteps: rawLanguageHints.hasMultipleSteps === true,
      isMutation: rawLanguageHints.isMutation === true,
      fieldWords: Array.isArray(rawLanguageHints.fieldWords)
        ? rawLanguageHints.fieldWords.slice(0, 20).map((item) => toSafeString(item).slice(0, 50)).filter(Boolean)
        : [],
      actionSequence: Array.isArray(rawLanguageHints.actionSequence)
        ? rawLanguageHints.actionSequence.slice(0, 8).map((item) => toSafeString(item).slice(0, 30)).filter(Boolean)
        : [],
      clauses: Array.isArray(rawLanguageHints.clauses)
        ? rawLanguageHints.clauses.slice(0, 8).map((item) => toSafeString(item).slice(0, 160)).filter(Boolean)
        : [],
      contextReferences: Array.isArray(rawLanguageHints.contextReferences)
        ? rawLanguageHints.contextReferences.slice(0, 12).map((item) => toSafeString(item).slice(0, 40)).filter(Boolean)
        : [],
      possibleEntityTypes: Array.isArray(rawLanguageHints.possibleEntityTypes)
        ? rawLanguageHints.possibleEntityTypes.slice(0, 8).map((item) => toSafeString(item).slice(0, 40)).filter(Boolean)
        : [],
      isContinuation: rawLanguageHints.isContinuation === true,
      hasPreviousCommand: rawLanguageHints.hasPreviousCommand === true,
      previousAction: toSafeString(rawLanguageHints.previousAction).slice(0, 30),
      previousModules: Array.isArray(rawLanguageHints.previousModules)
        ? rawLanguageHints.previousModules.slice(0, 10).map((item) => toSafeString(item).slice(0, 40)).filter(Boolean)
        : [],
    };
    const apiKey = openaiApiKey.value() || process.env.OPENAI_API_KEY;
    const model = toSafeString(process.env.OPENAI_ASSISTANT_MODEL) || 'gpt-4.1-mini';

    if (!command) {
      throw new HttpsError('invalid-argument', 'Comanda este goala.');
    }

    if (!apiKey) {
      await persistAssistantInterpretationTrace({
        ownerUserId: request.auth.uid,
        transcript: originalCommand,
        interpreted: null,
        model,
        openAiResponse: null,
        latencyMs: Date.now() - startedAtMs,
        nowMs: startedAtMs,
        failureCategory: 'configuration_missing',
      });
      throw new HttpsError('failed-precondition', 'OPENAI_API_KEY nu este configurat in Firebase Functions.');
    }

    const today = new Date().toISOString().slice(0, 10);
    const prompt = buildAssistantPrompt(today, request.data?.context);

    let openaiResponse;
    try {
      openaiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: 'system',
              content: [{ type: 'input_text', text: prompt }],
            },
            {
              role: 'user',
              content: [{
                type: 'input_text',
                text: [
                  `Transcript original: ${originalCommand}`,
                  `Forma normalizata: ${command}`,
                  `Indicii semantice locale (orientative, nu inlocuiesc validarea): ${JSON.stringify(languageHints)}`,
                ].join('\n'),
              }],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'workcontrol_assistant_command',
              strict: true,
              schema: ASSISTANT_COMMAND_SCHEMA,
            },
          },
        }),
      });
    } catch {
      logger.error('[interpretAssistantCommand][openai]', { category: 'network_error' });
      await persistAssistantInterpretationTrace({
        ownerUserId: request.auth.uid,
        transcript: originalCommand,
        interpreted: null,
        model,
        openAiResponse: null,
        latencyMs: Date.now() - startedAtMs,
        nowMs: startedAtMs,
        failureCategory: 'network_error',
      });
      throw new HttpsError('internal', 'OpenAI nu a putut interpreta comanda.');
    }

    const responseText = await openaiResponse.text();
    if (!openaiResponse.ok) {
      logger.error('[interpretAssistantCommand][openai]', {
        category: 'http_error',
        status: openaiResponse.status,
      });
      await persistAssistantInterpretationTrace({
        ownerUserId: request.auth.uid,
        transcript: originalCommand,
        interpreted: null,
        model,
        openAiResponse: null,
        latencyMs: Date.now() - startedAtMs,
        nowMs: startedAtMs,
        failureCategory: `openai_http_${openaiResponse.status}`,
      });
      throw new HttpsError('internal', 'OpenAI nu a putut interpreta comanda.');
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (error) {
      logger.error('[interpretAssistantCommand][parse response]', {
        category: 'invalid_json',
        code: toSafeString(error?.code).slice(0, 80) || 'parse_error',
      });
      await persistAssistantInterpretationTrace({
        ownerUserId: request.auth.uid,
        transcript: originalCommand,
        interpreted: null,
        model,
        openAiResponse: null,
        latencyMs: Date.now() - startedAtMs,
        nowMs: startedAtMs,
        failureCategory: 'invalid_openai_response',
      });
      throw new HttpsError('internal', 'Raspuns invalid de la OpenAI.');
    }

    const outputText = extractResponseText(parsedResponse);
    try {
      const interpreted = JSON.parse(outputText);
      const fields =
        interpreted.fields && typeof interpreted.fields === 'object' && !Array.isArray(interpreted.fields)
          ? interpreted.fields
          : {};
      const fieldsToUpdate =
        interpreted.fieldsToUpdate && typeof interpreted.fieldsToUpdate === 'object' && !Array.isArray(interpreted.fieldsToUpdate)
          ? interpreted.fieldsToUpdate
          : fields;
      const missingFields = Array.isArray(interpreted.missingFields)
        ? interpreted.missingFields.map((item) => toSafeString(item)).filter(Boolean)
        : [];
      const risk = ['low', 'medium', 'high'].includes(toSafeString(interpreted.risk))
        ? toSafeString(interpreted.risk)
        : 'low';
      const commandType = ['navigation', 'form_fill', 'entity_update', 'create_entity', 'timesheet_action', 'question', 'unknown'].includes(toSafeString(interpreted.commandType))
        ? toSafeString(interpreted.commandType)
        : 'unknown';
      const dateRange =
        interpreted.dateRange && typeof interpreted.dateRange === 'object' && !Array.isArray(interpreted.dateRange)
          ? {
              startDate: toSafeString(interpreted.dateRange.startDate),
              endDate: toSafeString(interpreted.dateRange.endDate),
            }
          : { startDate: '', endDate: '' };
      const toolCalls = Array.isArray(interpreted.toolCalls)
        ? interpreted.toolCalls.slice(0, 8).map((toolCall) => {
            const input = toolCall && typeof toolCall.input === 'object' && !Array.isArray(toolCall.input)
              ? toolCall.input
              : {};
            return {
              id: toSafeString(toolCall?.id),
              input: {
                path: toSafeString(input.path),
                query: toSafeString(input.query),
                entityQuery: toSafeString(input.entityQuery),
                ruleQuery: toSafeString(input.ruleQuery),
                fields: input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields : {},
                projectId: toSafeString(input.projectId),
                projectQuery: toSafeString(input.projectQuery),
                createProjectIfMissing: Boolean(input.createProjectIfMissing),
                explanation: toSafeString(input.explanation),
                name: toSafeString(input.name),
              },
            };
          }).filter((toolCall) => toolCall.id)
        : [];
      const entityReferences = Array.isArray(interpreted.entityReferences)
        ? interpreted.entityReferences.slice(0, 8).map((reference) => ({
            type: toSafeString(reference?.type) || 'none',
            query: toSafeString(reference?.query),
            id: toSafeString(reference?.id),
          }))
        : [];
      const missingInformation = Array.isArray(interpreted.missingInformation)
        ? interpreted.missingInformation.map((item) => toSafeString(item)).filter(Boolean)
        : missingFields;
      const confirmationRequired = Boolean(interpreted.confirmationRequired ?? interpreted.needsConfirmation);
      const normalizedInterpretation = {
        version: '3',
        commandType,
        intent: toSafeString(interpreted.intent) || 'unknown',
        toolCalls,
        entityReferences,
        missingInformation,
        confirmationRequired,
        response: toSafeString(interpreted.response || interpreted.spokenSummary),
        targetModule: toSafeString(interpreted.targetModule),
        entityType: toSafeString(interpreted.entityType) || 'none',
        entityQuery: toSafeString(interpreted.entityQuery),
        formSchemaId: toSafeString(interpreted.formSchemaId),
        fields,
        fieldsToUpdate,
        dateRange,
        shouldNavigate: Boolean(interpreted.shouldNavigate),
        shouldFillForm: Boolean(interpreted.shouldFillForm),
        shouldUpdateFirestore: Boolean(interpreted.shouldUpdateFirestore),
        navigation:
          interpreted.navigation && typeof interpreted.navigation === 'object' && !Array.isArray(interpreted.navigation)
            ? {
                shouldNavigate: Boolean(interpreted.navigation.shouldNavigate),
                path: toSafeString(interpreted.navigation.path),
                section: toSafeString(interpreted.navigation.section),
                params:
                  interpreted.navigation.params && typeof interpreted.navigation.params === 'object' && !Array.isArray(interpreted.navigation.params)
                    ? interpreted.navigation.params
                    : {},
              }
            : { shouldNavigate: Boolean(interpreted.shouldNavigate), path: toSafeString(interpreted.targetPage), section: '', params: {} },
        targetText: toSafeString(interpreted.targetText),
        targetPage: toSafeString(interpreted.targetPage),
        pageHint: toSafeString(interpreted.pageHint),
        buttonHint: toSafeString(interpreted.buttonHint),
        missingFields,
        confidence:
          typeof interpreted.confidence === 'number' && Number.isFinite(interpreted.confidence)
            ? Math.max(0, Math.min(1, interpreted.confidence))
            : 0,
        risk,
        confirmation:
          interpreted.confirmation && typeof interpreted.confirmation === 'object' && !Array.isArray(interpreted.confirmation)
            ? {
                required: Boolean(interpreted.confirmation.required),
                reason: toSafeString(interpreted.confirmation.reason),
                risk: ['low', 'medium', 'high'].includes(toSafeString(interpreted.confirmation.risk))
                  ? toSafeString(interpreted.confirmation.risk)
                  : risk,
              }
            : { required: Boolean(interpreted.needsConfirmation), reason: '', risk },
        needsConfirmation: Boolean(interpreted.needsConfirmation),
        spokenSummary: toSafeString(interpreted.spokenSummary),
        reasoning: toSafeString(interpreted.reasoning),
        executionPlan: Array.isArray(interpreted.executionPlan)
          ? interpreted.executionPlan.slice(0, 8).map((step, index) => ({
              id: toSafeString(step.id) || `step-${index + 1}`,
              type: toSafeString(step.type),
              label: toSafeString(step.label),
              target: toSafeString(step.target),
              fields: Array.isArray(step.fields) ? step.fields.map((field) => toSafeString(field)).filter(Boolean) : [],
              requiresConfirmation: Boolean(step.requiresConfirmation),
            }))
          : [],
      };
      const traceId = await persistAssistantInterpretationTrace({
        ownerUserId: request.auth.uid,
        transcript: originalCommand,
        interpreted: normalizedInterpretation,
        model,
        openAiResponse: parsedResponse,
        latencyMs: Date.now() - startedAtMs,
        nowMs: startedAtMs,
      });
      return { ...normalizedInterpretation, traceId };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('[interpretAssistantCommand][parse output]', {
        category: 'invalid_output',
        code: toSafeString(error?.code).slice(0, 80) || 'parse_error',
      });
      await persistAssistantInterpretationTrace({
        ownerUserId: request.auth.uid,
        transcript: originalCommand,
        interpreted: null,
        model,
        openAiResponse: parsedResponse,
        latencyMs: Date.now() - startedAtMs,
        nowMs: startedAtMs,
        failureCategory: 'invalid_assistant_output',
      });
      throw new HttpsError('internal', 'Nu am putut interpreta comanda.');
    }
  }
);

exports.recordAssistantTraceOutcome = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (request) => {
    await assertActiveInternalRequest(request);

    let payload;
    try {
      payload = normalizeAssistantOutcomePayload(request.data);
    } catch {
      throw new HttpsError('invalid-argument', 'Rezultat de audit invalid.');
    }

    let traceRef;
    if (payload.traceId) {
      traceRef = db.collection('aiCommandLogs').doc(payload.traceId);
    } else {
      const fingerprint = fingerprintAssistantTranscript(payload.transcript, request.auth.uid);
      const matchingTraces = await db
        .collection('aiCommandLogs')
        .where('ownerUserId', '==', request.auth.uid)
        .where('transcriptFingerprint', '==', fingerprint)
        .orderBy('createdAtServer', 'desc')
        .limit(1)
        .get();
      traceRef = matchingTraces.empty ? null : matchingTraces.docs[0].ref;
    }

    if (!traceRef) {
      if (!context.companyId) {
        return { status: 'skipped', reason: 'company_missing' };
      }
      traceRef = db.collection('aiCommandLogs').doc();
      const localTrace = buildAssistantTraceDocument({
        ownerUserId: request.auth.uid,
        transcript: payload.transcript,
        interpreted: buildLocalAssistantTraceInterpretation(payload.details),
        model: 'local-deterministic',
        openAiResponse: null,
        latencyMs: 0,
      });
      await traceRef.set({
        ...localTrace,
        companyId: context.companyId,
        createdAtServer: FieldValue.serverTimestamp(),
        updatedAtServer: FieldValue.serverTimestamp(),
      });
    }

    await db.runTransaction(async (transaction) => {
      const trace = await transaction.get(traceRef);
      if (!trace.exists) {
        throw new HttpsError('not-found', 'Urma asistentului nu a fost gasita.');
      }
      if (trace.get('ownerUserId') !== request.auth.uid) {
        throw new HttpsError('permission-denied', 'Nu poti actualiza aceasta urma.');
      }

      const currentStatus = toSafeString(trace.get('outcome.status'));
      if (!isAssistantOutcomeTransitionAllowed(currentStatus, payload.status)) {
        throw new HttpsError('failed-precondition', 'Statusul urmei nu permite aceasta actualizare.');
      }

      transaction.update(traceRef, {
        outcome: {
          status: payload.status,
          source: 'client_callable',
          failureCategory: payload.status === 'failed' ? 'client_execution_failed' : '',
          details: payload.details,
        },
        updatedAtServer: FieldValue.serverTimestamp(),
      });
    });

    return { status: 'recorded', traceId: traceRef.id };
  }
);

exports.transcribeAssistantAudio = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [openaiApiKey],
  },
  async (request) => {
    await assertActiveInternalRequest(request);

    let audio;
    try {
      audio = decodeAssistantAudioPayload(request.data);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_audio';
      if (code === 'consent_required') {
        throw new HttpsError('failed-precondition', 'Este necesar acordul explicit pentru trimiterea audio.');
      }
      throw new HttpsError('invalid-argument', 'Inregistrarea audio este invalida sau prea mare.');
    }

    const apiKey = openaiApiKey.value() || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'OPENAI_API_KEY nu este configurat in Firebase Functions.');
    }

    try {
      const transcript = await requestAssistantTranscription({
        ...audio,
        apiKey,
        model: toSafeString(process.env.OPENAI_TRANSCRIPTION_MODEL) || 'gpt-4o-mini-transcribe',
      });
      return { transcript };
    } catch (error) {
      logger.error('[transcribeAssistantAudio]', {
        category: 'transcription_failed',
        status: Number(error?.status) || 0,
      });
      throw new HttpsError('internal', 'Transcrierea audio nu a reusit.');
    }
  }
);

exports.analyzeVehicleDocument = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '1GiB',
    secrets: [openaiApiKey],
  },
  async (request) => {
    const actor = await assertActiveInternalRequest(request);

    const storagePath = toSafeString(request.data?.storagePath);
    const fileName = toSafeString(request.data?.fileName) || 'document';
    const contentType = inferContentType(fileName, request.data?.contentType);
    const model = toSafeString(process.env.OPENAI_DOCUMENT_MODEL) || 'gpt-4.1-mini';
    const apiKey = openaiApiKey.value() || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'OPENAI_API_KEY nu este configurat in Firebase Functions.');
    }

    if (!storagePath || !storagePath.startsWith('vehicles/')) {
      throw new HttpsError('invalid-argument', 'Cale document invalida.');
    }
    const vehicleId = storagePath.split('/')[1] || '';
    const vehicleSnap = vehicleId ? await db.collection('vehicles').doc(vehicleId).get() : null;
    const vehicle = vehicleSnap?.data() || {};
    const vehicleCompanyId = toSafeString(vehicle.companyId);
    const assigned = request.auth.uid === toSafeString(vehicle.ownerUserId) ||
      request.auth.uid === toSafeString(vehicle.currentDriverUserId);
    const manages = ['admin', 'manager'].includes(actor.role);
    if (
      !vehicleSnap?.exists ||
      !internalContextCanAccessCompany(actor, vehicleCompanyId) ||
      (!assigned && !manages)
    ) {
      throw new HttpsError('permission-denied', 'Documentul vehiculului nu este permis.');
    }

    if (!isSupportedDocumentMime(contentType)) {
      return {
        documentType: 'other',
        expiryDate: '',
        issueDate: '',
        policyNumber: '',
        providerName: '',
        vehiclePlateNumber: '',
        confidence: 0,
        notes: `Tip fisier neanalizat automat: ${contentType}`,
      };
    }

    const [buffer] = await admin.storage().bucket().file(storagePath).download();
    if (!buffer?.length) {
      throw new HttpsError('not-found', 'Documentul nu a putut fi citit din Storage.');
    }

    if (buffer.length > 18 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Documentul este prea mare pentru analiza automata.');
    }

    const base64 = buffer.toString('base64');
    const fileInput = contentType.startsWith('image/')
      ? {
          type: 'input_image',
          image_url: `data:${contentType};base64,${base64}`,
        }
      : {
          type: 'input_file',
          filename: fileName,
          file_data: `data:${contentType};base64,${base64}`,
        };

    const prompt = [
      'Citeste documentul pentru o masina din Romania.',
      'Extrage doar informatii sigure pentru RCA, ITP, CASCO, rovinieta, service, leasing sau amenda.',
      'Data expirarii trebuie sa fie data pana la care documentul este valabil.',
      'Pentru rovinieta, cauta valabil pana la / sfarsit valabilitate.',
      'Pentru RCA/CASCO, cauta valabilitate pana la.',
      'Pentru ITP, cauta data urmatoarei inspectii sau valabil pana la.',
      'Daca nu esti sigur, lasa campul gol si scade confidence.',
    ].join(' ');

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: [
              fileInput,
              {
                type: 'input_text',
                text: prompt,
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'vehicle_document_extraction',
            strict: true,
            schema: VEHICLE_DOC_SCHEMA,
          },
        },
      }),
    });

    const responseText = await openaiResponse.text();
    if (!openaiResponse.ok) {
      logger.error('[analyzeVehicleDocument][openai]', responseText);
      throw new HttpsError('internal', 'OpenAI nu a putut analiza documentul.');
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (error) {
      logger.error('[analyzeVehicleDocument][parse response]', error, responseText);
      throw new HttpsError('internal', 'Raspuns invalid de la OpenAI.');
    }

    const outputText = extractResponseText(parsedResponse);
    let extracted;
    try {
      extracted = JSON.parse(outputText);
    } catch (error) {
      logger.error('[analyzeVehicleDocument][parse output]', error, outputText);
      throw new HttpsError('internal', 'Nu am putut interpreta analiza documentului.');
    }

    return {
      documentType: normalizeAiDocumentType(extracted.documentType),
      expiryDate: toSafeString(extracted.expiryDate),
      issueDate: toSafeString(extracted.issueDate),
      policyNumber: toSafeString(extracted.policyNumber),
      providerName: toSafeString(extracted.providerName),
      vehiclePlateNumber: toSafeString(extracted.vehiclePlateNumber).toUpperCase(),
      confidence: Math.max(0, Math.min(1, toSafeNumber(extracted.confidence, 0))),
      notes: toSafeString(extracted.notes),
    };
  }
);

exports.analyzeExpenseDocument = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '1GiB',
    secrets: [openaiApiKey],
  },
  async (request) => {
    await assertActiveInternalRequest(request);

    const storagePath = toSafeString(request.data?.storagePath);
    const fileName = toSafeString(request.data?.fileName) || 'document';
    const contentType = inferContentType(fileName, request.data?.contentType);
    const scanMode = normalizeExpenseScanMode(request.data?.scanMode);
    const fastScan = scanMode === 'fast';
    const model = toSafeString(process.env.OPENAI_DOCUMENT_MODEL) || 'gpt-4.1-mini';
    const apiKey = openaiApiKey.value() || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'OPENAI_API_KEY nu este configurat in Firebase Functions.');
    }

    if (!storagePath || !storagePath.startsWith('expenses/')) {
      throw new HttpsError('invalid-argument', 'Cale document invalida.');
    }
    if (!storagePath.startsWith(`expenses/${request.auth.uid}/`)) {
      throw new HttpsError('permission-denied', 'Poti analiza numai documentele proprii.');
    }

    if (!isSupportedDocumentMime(contentType)) {
      return {
        documentKind: 'other',
        supplierName: '',
        supplierTaxId: '',
        buyerCompanyName: '',
        buyerTaxId: '',
        documentNumber: '',
        documentDate: '',
        dueDate: '',
        currency: 'RON',
        subtotalAmount: 0,
        vatAmount: 0,
        totalAmount: 0,
        paymentMethod: '',
        expenseCategory: '',
        projectHint: '',
        userHint: '',
        companyHint: '',
        lineItems: [],
        confidence: 0,
        notes: `Tip fisier neanalizat automat: ${contentType}`,
      };
    }

    const [buffer] = await admin.storage().bucket().file(storagePath).download();
    if (!buffer?.length) {
      throw new HttpsError('not-found', 'Documentul nu a putut fi citit din Storage.');
    }

    if (buffer.length > 18 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Documentul este prea mare pentru analiza automata.');
    }

    const base64 = buffer.toString('base64');
    const fileInput = contentType.startsWith('image/')
      ? {
          type: 'input_image',
          image_url: `data:${contentType};base64,${base64}`,
          detail: 'high',
        }
      : {
          type: 'input_file',
          filename: fileName,
          file_data: `data:${contentType};base64,${base64}`,
        };

    const prompt = fastScan
      ? [
          'Citeste bonul, factura sau chitanta pentru evidenta cheltuielilor.',
          'Extrage obligatoriu ce se vede clar: furnizor, CUI, cumparator/firma, numar document, data, total, TVA si metoda plata.',
          `Pentru produse, include maximum ${EXPENSE_FAST_MAX_LINE_ITEMS} linii clare. Daca exista total/TVA/date vizibile, nu le lasa 0.`,
          'Valorile numerice trebuie sa fie numere. Daca moneda lipseste si documentul este romanesc, foloseste RON.',
          'Pentru documentDate foloseste data emiterii/bonului in format YYYY-MM-DD.',
          'Lasa string gol sau 0 doar pentru campurile care chiar nu se vad in document.',
        ].join(' ')
      : [
          'Citeste bonul, factura sau chitanta pentru evidenta cheltuielilor.',
          'Extrage cat mai multe date clare: furnizor, CUI, cumparator/firma, numar document, data, total, TVA, metoda plata si produse.',
          'Valorile numerice trebuie sa fie numere, nu text. Daca moneda lipseste si documentul este romanesc, foloseste RON.',
          'Pentru documentDate foloseste data emiterii/bonului in format YYYY-MM-DD.',
          'Daca totalul, TVA-ul, data sau furnizorul se vad in document, nu le lasa goale sau 0.',
          'Daca un camp nu este sigur, lasa string gol sau 0 si scade confidence.',
        ].join(' ');

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: [
              fileInput,
              {
                type: 'input_text',
                text: prompt,
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'expense_document_extraction',
            strict: true,
            schema: EXPENSE_DOC_SCHEMA,
          },
        },
      }),
    });

    const responseText = await openaiResponse.text();
    if (!openaiResponse.ok) {
      logger.error('[analyzeExpenseDocument][openai]', responseText);
      throw new HttpsError('internal', 'OpenAI nu a putut analiza documentul.');
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (error) {
      logger.error('[analyzeExpenseDocument][parse response]', error, responseText);
      throw new HttpsError('internal', 'Raspuns invalid de la OpenAI.');
    }

    const outputText = extractResponseText(parsedResponse);
    let extracted;
    try {
      extracted = JSON.parse(outputText);
    } catch (error) {
      logger.error('[analyzeExpenseDocument][parse output]', error, outputText);
      throw new HttpsError('internal', 'Nu am putut interpreta analiza documentului.');
    }

    const lineItemLimit = fastScan ? EXPENSE_FAST_MAX_LINE_ITEMS : EXPENSE_FULL_MAX_LINE_ITEMS;
    const lineItems = Array.isArray(extracted.lineItems)
      ? extracted.lineItems.slice(0, lineItemLimit).map((item) => ({
          name: toSafeString(item?.name),
          quantity: toSafeNumber(item?.quantity, 0),
          unitPrice: toSafeNumber(item?.unitPrice, 0),
          total: toSafeNumber(item?.total, 0),
        }))
      : [];

    return {
      documentKind: normalizeExpenseDocumentKind(extracted.documentKind),
      supplierName: toSafeString(extracted.supplierName),
      supplierTaxId: toSafeString(extracted.supplierTaxId).toUpperCase(),
      buyerCompanyName: toSafeString(extracted.buyerCompanyName),
      buyerTaxId: toSafeString(extracted.buyerTaxId).toUpperCase(),
      documentNumber: toSafeString(extracted.documentNumber),
      documentDate: toSafeString(extracted.documentDate),
      dueDate: toSafeString(extracted.dueDate),
      currency: toSafeString(extracted.currency).toUpperCase() || 'RON',
      subtotalAmount: toSafeNumber(extracted.subtotalAmount, 0),
      vatAmount: toSafeNumber(extracted.vatAmount, 0),
      totalAmount: toSafeNumber(extracted.totalAmount, 0),
      paymentMethod: toSafeString(extracted.paymentMethod),
      expenseCategory: toSafeString(extracted.expenseCategory),
      projectHint: toSafeString(extracted.projectHint),
      userHint: toSafeString(extracted.userHint),
      companyHint: toSafeString(extracted.companyHint),
      lineItems,
      confidence: Math.max(0, Math.min(1, toSafeNumber(extracted.confidence, 0))),
      notes: toSafeString(extracted.notes),
    };
  }
);

exports.processExpenseScanJob = onDocumentCreated(
  {
    document: 'expenseScanJobs/{jobId}',
    region: 'europe-west1',
    timeoutSeconds: 180,
    memory: '1GiB',
    secrets: [openaiApiKey],
    retry: false,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const jobId = event.params.jobId;
    const jobData = snapshot.data() || {};

    if (toSafeString(jobData.status) !== 'queued') return;

    const apiKey = openaiApiKey.value() || process.env.OPENAI_API_KEY;
    const model = toSafeString(process.env.OPENAI_DOCUMENT_MODEL) || 'gpt-4.1-mini';
    const storagePath = toSafeString(jobData.filePath);

    try {
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY nu este configurat in Firebase Functions.');
      }

      if (!storagePath || !storagePath.startsWith('expenses/')) {
        throw new Error('Cale document invalida.');
      }
      const uploadedByUserId = toSafeString(jobData.uploadedByUserId);
      const companyId = toSafeString(jobData.companyId);
      if (!uploadedByUserId || !companyId || !storagePath.startsWith(`expenses/${uploadedByUserId}/`)) {
        throw new Error('Job OCR fara ownership sau companyId valid.');
      }
      const uploaderSnap = await db.collection('users').doc(uploadedByUserId).get();
      const uploader = uploaderSnap.data() || {};
      const uploaderCompanyIds = Array.isArray(uploader.companyIds) ? uploader.companyIds : [];
      if (
        !uploaderSnap.exists ||
        uploader.active !== true ||
        toSafeString(uploader.accessStatus) !== 'active' ||
        (!uploaderCompanyIds.includes(companyId) && toSafeString(uploader.primaryCompanyId) !== companyId)
      ) {
        throw new Error('Autorul jobului OCR nu apartine firmei declarate.');
      }

      await snapshot.ref.set(
        {
          status: 'processing',
          processingStartedAt: Date.now(),
          updatedAt: Date.now(),
          updatedAtServer: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const [fileBuffer] = await admin.storage().bucket().file(storagePath).download();
      if (!fileBuffer?.length) {
        throw new Error('Documentul nu a putut fi citit din Storage.');
      }
      if (fileBuffer.length > 18 * 1024 * 1024) {
        throw new Error('Documentul este prea mare pentru analiza automata.');
      }
      const fileHash = sha256Buffer(fileBuffer);
      const scanMode = toSafeString(jobData.scanMode) || 'full';
      const analysisCacheId = buildExpenseDocumentCacheId(companyId, fileHash, scanMode);
      const analysisCacheRef = db.collection('expenseDocumentAnalysisCache').doc(analysisCacheId);
      const analysisCacheSnap = await analysisCacheRef.get();
      let analysis;
      let analysisCacheHit = false;

      if (analysisCacheSnap.exists && analysisCacheSnap.data()?.analysis) {
        analysis = analysisCacheSnap.data().analysis;
        analysisCacheHit = true;
      } else {
        analysis = await analyzeExpenseStorageFile({
          storagePath,
          fileName: toSafeString(jobData.fileName) || 'document',
          contentType: inferContentType(jobData.fileName, jobData.contentType),
          scanMode,
          extractionMode: 'core',
          publicUrl: toSafeString(jobData.fileUrl),
          fileBuffer,
          apiKey,
          model,
        });

        await analysisCacheRef.set({
          schemaVersion: EXPENSE_DOCUMENT_CACHE_SCHEMA_VERSION,
          extractionVersion: EXPENSE_DOCUMENT_EXTRACTION_VERSION,
          companyId,
          sha256: fileHash,
          scanMode,
          model,
          analysis,
          createdAt: Date.now(),
          createdAtServer: FieldValue.serverTimestamp(),
          updatedAt: Date.now(),
          updatedAtServer: FieldValue.serverTimestamp(),
          expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        }, { merge: false });
      }

      if (!hasMeaningfulExpenseExtraction(analysis)) {
        throw new Error('AI nu a putut citi valori clare din document.');
      }

      const expenseDocumentId = await saveExpenseDocumentFromScanJob({
        ...jobData,
        sha256: fileHash,
        analysisCacheId,
        analysisCacheHit,
      }, analysis);

      await snapshot.ref.set(
        {
          status: 'completed',
          expenseDocumentId,
          sha256: fileHash,
          analysisCacheId,
          analysisCacheHit,
          completedAt: Date.now(),
          updatedAt: Date.now(),
          updatedAtServer: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      logger.info('[processExpenseScanJob][completed]', { jobId, expenseDocumentId });
    } catch (error) {
      logger.error('[processExpenseScanJob][failed]', { jobId, error });
      await snapshot.ref.set(
        {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          failedAt: Date.now(),
          updatedAt: Date.now(),
          updatedAtServer: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }
);

exports.checkTimesheetReminderAlerts = onSchedule(
  {
    schedule: '*/5 5-21 * * *',
    timeZone: 'Europe/Bucharest',
    region: 'europe-west1',
  },
  async () => {
    const result = await runTimesheetReminderAlertsJob();
    logger.info('Verificare remindere pontaj finalizata.', result);
  }
);

const VEHICLE_ALERT_WORKER_BATCH_SIZE = 40;
const VEHICLE_ALERT_LEASE_MS = 2 * 60 * 1000;
const VEHICLE_ALERT_RETRY_MS = 15 * 60 * 1000;
const PART_ORDER_REMINDER_BATCH_SIZE = 40;
const PART_ORDER_REMINDER_LEGACY_FALLBACK_SIZE = 20;

async function claimVehicleAlertSchedule(scheduleRef, workerId, now) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(scheduleRef);
    if (!snapshot.exists) return null;
    const schedule = snapshot.data() || {};
    if (!canClaimSchedule(schedule, now)) {
      return null;
    }
    transaction.update(scheduleRef, {
      ...buildScheduleLeasePatch(workerId, now, VEHICLE_ALERT_LEASE_MS),
      updatedAtServer: FieldValue.serverTimestamp(),
    });
    return { ...schedule, id: scheduleRef.id };
  });
}

async function completeVehicleAlertSchedule(scheduleRef, claimed, workerId, patch, recipientCount, now) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(scheduleRef);
    if (!snapshot.exists) return;
    const current = snapshot.data() || {};
    if (
      toSafeString(current.leaseOwner) !== workerId ||
      toSafeString(current.sourceRevision) !== toSafeString(claimed.sourceRevision)
    ) {
      return;
    }
    transaction.update(scheduleRef, {
      ...patch,
      lastRecipientCount: recipientCount,
      updatedAt: now,
      updatedAtServer: FieldValue.serverTimestamp(),
    });
  });
}

async function failVehicleAlertSchedule(scheduleRef, claimed, workerId, now, error) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(scheduleRef);
    if (!snapshot.exists) return;
    const current = snapshot.data() || {};
    if (
      toSafeString(current.leaseOwner) !== workerId ||
      toSafeString(current.sourceRevision) !== toSafeString(claimed.sourceRevision)
    ) {
      return;
    }
    transaction.update(scheduleRef, {
      status: 'scheduled',
      nextRunAt: now + VEHICLE_ALERT_RETRY_MS,
      leaseUntil: 0,
      leaseOwner: '',
      failureCount: Math.min(toSafeNumber(current.failureCount, 0) + 1, 20),
      lastErrorCode: toSafeString(error?.code) || 'worker_error',
      updatedAt: now,
      updatedAtServer: FieldValue.serverTimestamp(),
    });
  });
}

exports.checkVehicleMaintenanceAlerts = onSchedule(
  {
    schedule: '*/15 5-21 * * *',
    timeZone: 'Europe/Bucharest',
    region: 'europe-west1',
  },
  async () => {
    const now = Date.now();
    const workerId = `vehicle-alert-${now}-${stableHash(String(Math.random()), 8)}`;
    const dueSchedules = await db.collection('notificationSchedules')
      .where('workerType', '==', 'vehicle_alerts_v1')
      .where('status', '==', 'scheduled')
      .where('nextRunAt', '<=', now)
      .orderBy('nextRunAt', 'asc')
      .limit(VEHICLE_ALERT_WORKER_BATCH_SIZE)
      .get();
    const companyContexts = new Map();
    let claimedCount = 0;
    let deliveredCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    for (const scheduleDoc of dueSchedules.docs) {
      const scheduleRef = scheduleDoc.ref;
      let claimed = null;
      try {
        claimed = await claimVehicleAlertSchedule(scheduleRef, workerId, now);
        if (!claimed) continue;
        claimedCount += 1;
        const delivery = buildNotificationForSchedule(claimed, now);
        if (!delivery) {
          await completeVehicleAlertSchedule(
            scheduleRef,
            claimed,
            workerId,
            {
              status: 'invalid',
              nextMilestone: '',
              nextRunAt: null,
              leaseUntil: 0,
              leaseOwner: '',
              lastErrorCode: 'invalid_schedule',
            },
            0,
            now
          );
          continue;
        }
        const companyId = toSafeString(claimed.companyId);
        if (!companyContexts.has(companyId)) {
          companyContexts.set(companyId, await getNotificationContextForCompany(companyId));
        }
        const deliveryKey = buildDeliveryKey(claimed, delivery.milestone);
        const recipientCount = await dispatchNotificationEvent(
          { ...delivery.notification, idempotencyKey: deliveryKey },
          companyContexts.get(companyId)
        );
        deliveredCount += recipientCount;
        const advancePatch = getScheduleAdvancePatch(claimed, delivery.milestone, now);
        await completeVehicleAlertSchedule(
          scheduleRef,
          claimed,
          workerId,
          advancePatch,
          recipientCount,
          now
        );
        completedCount += 1;
      } catch (error) {
        failedCount += 1;
        logger.error('[checkVehicleMaintenanceAlerts][schedule]', {
          scheduleId: scheduleRef.id,
          error,
        });
        if (claimed) {
          await failVehicleAlertSchedule(scheduleRef, claimed, workerId, now, error)
            .catch((releaseError) => logger.error('[checkVehicleMaintenanceAlerts][release]', {
              scheduleId: scheduleRef.id,
              error: releaseError,
            }));
        }
      }
    }

    logger.info('Worker alerte vehicule finalizat.', {
      dueCount: dueSchedules.size,
      claimedCount,
      completedCount,
      deliveredCount,
      failedCount,
      fullVehicleScans: 0,
    });
  }
);

function getPartOrderLabel(order, orderId) {
  return (
    toSafeString(order.title) ||
    [toSafeString(order.clientName), toSafeString(order.liftSerialNumber)].filter(Boolean).join(' - ') ||
    orderId
  );
}

function userCanReceivePartOrderReminder(user, companyId) {
  const userCompanyIds = Array.isArray(user?.companyIds) ? user.companyIds : [];
  return userCompanyIds.includes(companyId) || toSafeString(user?.primaryCompanyId) === companyId;
}

async function deliverPartOrderReminderTransaction(orderRef, orderId, now, scheduleContext = null) {
  let outcome = { status: 'skipped', recipientCount: 0, nextRunAt: null, intervalMinutes: 0 };

  await db.runTransaction(async (tx) => {
    let scheduleDoc = null;
    if (scheduleContext?.scheduleRef) {
      scheduleDoc = await tx.get(scheduleContext.scheduleRef);
      const currentSchedule = scheduleDoc.exists ? scheduleDoc.data() || {} : {};
      if (
        !scheduleDoc.exists ||
        toSafeString(currentSchedule.leaseOwner) !== scheduleContext.workerId ||
        toSafeString(currentSchedule.sourceRevision) !== toSafeString(scheduleContext.claimed?.sourceRevision)
      ) {
        outcome = { status: 'schedule_lost', recipientCount: 0, nextRunAt: null, intervalMinutes: 0 };
        return;
      }
    }

    const freshOrderDoc = await tx.get(orderRef);
    if (!freshOrderDoc.exists) {
      outcome = { status: 'invalid', recipientCount: 0, nextRunAt: null, intervalMinutes: 0, errorCode: 'missing_order' };
      if (scheduleContext?.scheduleRef) {
        tx.update(scheduleContext.scheduleRef, {
          ...buildPartOrderScheduleTerminalPatch('missing_order'),
          updatedAt: now,
          updatedAtServer: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    const order = normalizePartOrder(orderId, freshOrderDoc.data() || {});
    if (
      !order.companyId ||
      !order.notifyUserId ||
      order.notificationSeenAt > 0 ||
      ['installed', 'cancelled'].includes(order.status) ||
      order.nextReminderAt <= 0
    ) {
      outcome = { status: 'completed', recipientCount: 0, nextRunAt: null, intervalMinutes: 0 };
      if (scheduleContext?.scheduleRef) {
        tx.update(scheduleContext.scheduleRef, {
          ...buildPartOrderScheduleTerminalPatch(),
          updatedAt: now,
          updatedAtServer: FieldValue.serverTimestamp(),
        });
      }
      return;
    }
    if (order.nextReminderAt > now) {
      outcome = {
        status: 'rescheduled',
        recipientCount: 0,
        nextRunAt: order.nextReminderAt,
        intervalMinutes: order.reminderIntervalMinutes,
      };
      if (scheduleContext?.scheduleRef) {
        tx.update(scheduleContext.scheduleRef, {
          status: 'scheduled',
          nextRunAt: order.nextReminderAt,
          leaseUntil: 0,
          leaseOwner: '',
          lastErrorCode: '',
          updatedAt: now,
          updatedAtServer: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    const userDoc = await tx.get(db.collection('users').doc(order.notifyUserId));
    const user = userDoc.exists ? userDoc.data() || {} : {};
    if (!userDoc.exists || !userCanReceivePartOrderReminder(user, order.companyId)) {
      outcome = { status: 'invalid', recipientCount: 0, nextRunAt: null, intervalMinutes: 0, errorCode: 'invalid_recipient' };
      if (scheduleContext?.scheduleRef) {
        tx.update(scheduleContext.scheduleRef, {
          ...buildPartOrderScheduleTerminalPatch('invalid_recipient'),
          updatedAt: now,
          updatedAtServer: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    const title = 'Comanda piese asteapta confirmare';
    const label = getPartOrderLabel(order, orderId);
    const message = `${order.requestedByUserName || 'Un utilizator'} a creat comanda ${label}. Bifeaza Am vazut dupa ce o verifici.`;
    const nextRunAt = getPartOrderReminderNextRunAt(order, now);
    const notificationRef = db.collection('notifications').doc();

    tx.set(notificationRef, {
      companyId: order.companyId,
      userId: order.notifyUserId,
      targetUserThemeKey: user.themeKey || null,
      actorUserId: order.requestedByUserId,
      actorUserName: order.requestedByUserName || 'WorkControl',
      actorUserThemeKey: null,
      title,
      message,
      module: 'maintenance',
      eventType: 'maintenance_part_order_created',
      entityId: orderId,
      notificationPath: '/maintenance/orders',
      soundEnabled: true,
      read: false,
      createdAt: now,
      createdAtServer: FieldValue.serverTimestamp(),
    });

    tx.update(orderRef, {
      lastReminderAt: now,
      nextReminderAt: nextRunAt,
      updatedAt: now,
      updatedAtServer: FieldValue.serverTimestamp(),
    });

    if (scheduleContext?.scheduleRef) {
      tx.update(scheduleContext.scheduleRef, {
        ...buildPartOrderScheduleAdvancePatch(order, now),
        lastRecipientCount: 1,
        updatedAt: now,
        updatedAtServer: FieldValue.serverTimestamp(),
      });
    }

    outcome = {
      status: 'delivered',
      recipientCount: 1,
      nextRunAt,
      intervalMinutes: order.reminderIntervalMinutes,
    };
  });

  return outcome;
}

exports.checkMaintenancePartOrderReminders = onSchedule(
  {
    schedule: '*/5 5-21 * * *',
    timeZone: 'Europe/Bucharest',
    region: 'europe-west1',
  },
  async () => {
    const now = Date.now();
    const workerId = `part-order-reminder-${now}-${stableHash(String(Math.random()), 8)}`;
    const dueSchedules = await db.collection('notificationSchedules')
      .where('workerType', '==', PART_ORDER_REMINDER_WORKER)
      .where('status', '==', 'scheduled')
      .where('nextRunAt', '<=', now)
      .orderBy('nextRunAt', 'asc')
      .limit(PART_ORDER_REMINDER_BATCH_SIZE)
      .get();
    const processedOrderIds = new Set();
    let createdCount = 0;
    let skippedCount = 0;
    let claimedCount = 0;
    let failedCount = 0;
    let legacyFallbackChecked = 0;

    for (const scheduleDoc of dueSchedules.docs) {
      const scheduleRef = scheduleDoc.ref;
      let claimed = null;
      try {
        claimed = await claimVehicleAlertSchedule(scheduleRef, workerId, now);
        if (!claimed) continue;
        claimedCount += 1;
        const orderId = toSafeString(claimed.sourceId) || toSafeString(claimed.entityId);
        if (!orderId) {
          await completeVehicleAlertSchedule(
            scheduleRef,
            claimed,
            workerId,
            { ...buildPartOrderScheduleTerminalPatch('missing_order_id'), updatedAt: now },
            0,
            now
          );
          skippedCount += 1;
          continue;
        }
        processedOrderIds.add(orderId);
        const result = await deliverPartOrderReminderTransaction(
          db.collection('maintenancePartOrders').doc(orderId),
          orderId,
          now,
          { scheduleRef, claimed, workerId }
        );
        if (result.status === 'delivered') createdCount += result.recipientCount;
        else skippedCount += 1;
      } catch (error) {
        failedCount += 1;
        logger.error('Nu am putut crea reminder programat pentru comanda piese.', {
          scheduleId: scheduleDoc.id,
          error,
        });
        if (claimed) {
          await failVehicleAlertSchedule(scheduleRef, claimed, workerId, now, error)
            .catch((releaseError) => logger.error('[checkMaintenancePartOrderReminders][release]', {
              scheduleId: scheduleDoc.id,
              error: releaseError,
            }));
        }
      }
    }

    if (dueSchedules.size < PART_ORDER_REMINDER_BATCH_SIZE) {
      const legacyLimit = Math.min(
        PART_ORDER_REMINDER_LEGACY_FALLBACK_SIZE,
        PART_ORDER_REMINDER_BATCH_SIZE - dueSchedules.size
      );
      const legacySnap = await db
        .collection('maintenancePartOrders')
        .where('nextReminderAt', '<=', now)
        .orderBy('nextReminderAt', 'asc')
        .limit(legacyLimit)
        .get();
      legacyFallbackChecked = legacySnap.size;

      for (const orderDoc of legacySnap.docs) {
        if (processedOrderIds.has(orderDoc.id)) continue;
        try {
          const result = await deliverPartOrderReminderTransaction(orderDoc.ref, orderDoc.id, now);
          if (result.status === 'delivered') {
            createdCount += result.recipientCount;
            const schedules = buildPartOrderReminderSchedules(orderDoc.id, {
              ...(orderDoc.data() || {}),
              nextReminderAt: result.nextRunAt,
            });
            await Promise.all(schedules.map((schedule) =>
              db.collection('notificationSchedules').doc(schedule.id).set({
                ...schedule,
                createdAt: now,
                createdAtServer: FieldValue.serverTimestamp(),
                updatedAt: now,
                updatedAtServer: FieldValue.serverTimestamp(),
              }, { merge: false })
            ));
          } else {
            skippedCount += 1;
          }
        } catch (error) {
          failedCount += 1;
          logger.error('Nu am putut crea reminder legacy pentru comanda piese.', {
            orderId: orderDoc.id,
            error,
          });
        }
      }
    }

    logger.info('Verificare remindere comenzi piese finalizata.', {
      dueSchedules: dueSchedules.size,
      claimedCount,
      legacyFallbackChecked,
      createdCount,
      skippedCount,
      failedCount,
      fullPartOrderScans: 0,
    });
  }
);

exports.archiveOldVehiclePositionDaysScheduled = onSchedule(
  {
    schedule: '30 3 * * *',
    timeZone: 'Europe/Bucharest',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    const result = await archiveOldVehiclePositionDaysJob({
      retentionDays: VEHICLE_POSITION_ARCHIVE_RETENTION_DAYS,
      maxDays: VEHICLE_POSITION_ARCHIVE_MAX_DAYS_PER_RUN,
      dryRun: false,
    });

    logger.info('Arhivare trasee GPS finalizata.', result);
  }
);

exports.archiveOldVehiclePositionDays = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (request) => {
    await assertAdminRequest(request);

    const result = await archiveOldVehiclePositionDaysJob({
      retentionDays: toSafeNumber(request.data?.retentionDays, VEHICLE_POSITION_ARCHIVE_RETENTION_DAYS),
      maxDays: toSafeNumber(request.data?.maxDays, VEHICLE_POSITION_ARCHIVE_MAX_DAYS_PER_RUN),
      dryRun: Boolean(request.data?.dryRun),
    });

    logger.info('Arhivare trasee GPS pornita manual.', result);
    return result;
  }
);

async function loadFleetGpsOverview() {
  const now = Date.now();
  if (fleetOverviewCache?.expiresAt > now) return fleetOverviewCache.value;
  if (fleetOverviewRequest) return fleetOverviewRequest;

  fleetOverviewRequest = (async () => {
    const [config, vehiclesSnap] = await Promise.all([
      getFirestoreCostControl(db),
      db
        .collection('vehicles')
        .orderBy('plateNumber', 'asc')
        .limit(250)
        .select(
          'plateNumber',
          'brand',
          'model',
          'status',
          'currentDriverUserId',
          'currentDriverUserName',
          'currentDriverThemeKey',
          'gpsSnapshot',
          'tracker',
          'gpsSim',
          'updatedAt'
        )
        .get(),
    ]);
    const value = {
      config,
      vehicles: vehiclesSnap.docs.map((vehicleDoc) => {
        const data = vehicleDoc.data() || {};
        return {
          id: vehicleDoc.id,
          plateNumber: toSafeString(data.plateNumber),
          brand: toSafeString(data.brand),
          model: toSafeString(data.model),
          status: toSafeString(data.status) || 'activa',
          currentDriverUserId: toSafeString(data.currentDriverUserId),
          currentDriverUserName: toSafeString(data.currentDriverUserName),
          currentDriverThemeKey: data.currentDriverThemeKey || null,
          gpsSnapshot: data.gpsSnapshot || null,
          tracker: data.tracker || null,
          gpsSim: data.gpsSim || null,
        };
      }),
      generatedAtMs: now,
    };
    fleetOverviewCache = { value, expiresAt: Date.now() + FLEET_OVERVIEW_CACHE_MS };
    return value;
  })();

  try {
    return await fleetOverviewRequest;
  } finally {
    fleetOverviewRequest = null;
  }
}

exports.getFleetGpsOverview = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    await assertAdminRequest(request);
    return loadFleetGpsOverview();
  }
);

exports.saveFirestoreCostControl = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    await assertAdminRequest(request);
    const config = await saveFirestoreCostControl(db, admin, request.data, request.auth.uid);
    fleetOverviewCache = null;
    return { status: 'ok', config };
  }
);

exports.refreshBillingMetrics = onSchedule(
  {
    region: 'europe-west1',
    schedule: 'every 3 hours',
    timeZone: 'Europe/Bucharest',
    timeoutSeconds: 180,
    memory: '256MiB',
    retryCount: 1,
  },
  async () =>
    refreshBillingMetricsCache({
      db,
      admin,
      projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'workcontrol-53b1d',
    })
);

exports.refreshBillingMetricsNow = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 180,
    memory: '256MiB',
  },
  async (request) => {
    await assertAdminRequest(request);
    return refreshBillingMetricsCache({
      db,
      admin,
      projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'workcontrol-53b1d',
    });
  }
);

exports.getBillingControlPanelData = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    await assertAdminRequest(request);
    const [metricsSnap, settingsSnap, canarySnap, firestoreCostControl] = await Promise.all([
      db.collection('systemMetrics').doc('billing').get(),
      db.collection('systemCostSettings').doc('billing').get(),
      db.collection('systemPrivateSettings').doc('gpsCostOptimization').get(),
      getFirestoreCostControl(db),
    ]);
    const metrics = metricsSnap.exists ? metricsSnap.data() || {} : {};
    const settings = settingsSnap.exists ? settingsSnap.data() || {} : {};
    const canary = canarySnap.exists ? canarySnap.data() || {} : {};
    const serializableMetrics = { ...metrics };
    delete serializableMetrics.updatedAt;
    if (serializableMetrics.exchangeRate) {
      serializableMetrics.exchangeRate = {
        source: toSafeString(serializableMetrics.exchangeRate.source) || 'ECB',
        rateDate: toSafeString(serializableMetrics.exchangeRate.rateDate) || null,
      };
    }
    const warningPercent = Math.max(1, Math.min(100, toSafeNumber(settings.warningPercent, 70)));
    const criticalPercent = Math.max(
      warningPercent + 1,
      Math.min(200, toSafeNumber(settings.criticalPercent, 90))
    );

    return {
      metrics: serializableMetrics,
      settings: {
        budgetMonthlyEur: Math.max(0, Math.min(100000, toSafeNumber(settings.budgetMonthlyEur, 50))),
        warningPercent,
        criticalPercent,
      },
      canary: {
        enabled: canary.enabled === true,
        canaryTrackerCount: Array.isArray(canary.canaryTrackerImeis)
          ? canary.canaryTrackerImeis.filter(Boolean).length
          : 0,
        diagnosticFlushSeconds: Math.max(
          30,
          Math.min(60, toSafeNumber(canary.diagnosticFlushSeconds, 45))
        ),
        updatedAt: toSafeNumber(canary.updatedAtMs, 0) || null,
      },
      firestoreCostControl: normalizeFirestoreCostControl(firestoreCostControl),
    };
  }
);

exports.getLiveFirebaseCostEstimate = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    await assertAdminRequest(request);
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'workcontrol-53b1d';
    if (projectId.startsWith('demo-')) {
      return {
        status: 'unavailable',
        currency: 'EUR',
        source: 'firebase_emulator',
        sampledWindowMinutes: 5,
        refreshSeconds: 900,
        excludes: ['emulator'],
        exchangeRate: { source: 'ECB', rateDate: null },
      };
    }
    try {
      const rates = await getEcbRates(db);
      return await getLiveFirebaseCostEstimate({
        projectId,
        usdPerEur: rates.rates?.USD,
        rateDate: rates.rateDate,
        force: request.data?.force === true,
      });
    } catch (error) {
      logger.error('[getLiveFirebaseCostEstimate] Nu am putut citi Cloud Monitoring.', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpsError(
        'unavailable',
        'Estimarea aproape live nu este disponibila momentan.'
      );
    }
  }
);

exports.saveBillingCostSettings = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    await assertAdminRequest(request);
    const budgetMonthlyEur = toSafeNumber(request.data?.budgetMonthlyEur, -1);
    const warningPercent = toSafeNumber(request.data?.warningPercent, -1);
    const criticalPercent = toSafeNumber(request.data?.criticalPercent, -1);
    if (budgetMonthlyEur < 0 || budgetMonthlyEur > 100000) {
      throw new HttpsError('invalid-argument', 'Bugetul lunar trebuie sa fie intre 0 si 100000 EUR.');
    }
    if (warningPercent < 1 || warningPercent > 100) {
      throw new HttpsError('invalid-argument', 'Pragul de avertizare trebuie sa fie intre 1 si 100%.');
    }
    if (criticalPercent <= warningPercent || criticalPercent > 200) {
      throw new HttpsError('invalid-argument', 'Pragul critic trebuie sa fie peste avertizare si maximum 200%.');
    }

    await db.collection('systemCostSettings').doc('billing').set(
      {
        budgetMonthlyEur,
        warningPercent,
        criticalPercent,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
        updatedBy: request.auth.uid,
      },
      { merge: true }
    );
    return { status: 'ok' };
  }
);

exports.getWorkControlHealth = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 15,
    memory: '128MiB',
  },
  async (request) => {
    await assertAdminRequest(request);
    return {
      status: 'ok',
      checkedAt: Date.now(),
      region: process.env.FUNCTION_REGION || 'europe-west1',
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      services: {
        firestoreAdmin: Boolean(db),
        messagingAdmin: Boolean(messaging),
      },
    };
  }
);

exports.sendPushOnNotificationCreated = onDocumentCreated(
  {
    document: 'notifications/{notificationId}',
    region: 'europe-west1',
    retry: false,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn('Nu exista snapshot pentru notificare.');
      return;
    }

    const notificationId = snapshot.id;
    const data = snapshot.data() || {};
    const userId = String(data.userId || '').trim();
    const webPushTopic = `wc-${notificationId}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);

    if (!userId) {
      logger.warn('Notificarea nu are userId.', { notificationId });
      await snapshot.ref.set(
        {
          pushDispatchStatus: 'missing_user',
          pushDispatchAt: FieldValue.serverTimestamp(),
          pushDispatchedAt: Date.now(),
        },
        { merge: true }
      );
      return;
    }

    const tokenSnap = await db
      .collection('pushTokens')
      .where('userId', '==', userId)
      .get();

    const { selected: tokenItems, duplicateDocIds } = selectUniquePushTokenDocs(tokenSnap.docs);

    if (duplicateDocIds.length > 0) {
      await Promise.all(duplicateDocIds.map((docId) => db.collection('pushTokens').doc(docId).delete()));
    }

    await sleep(3500);

    const shouldSend = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(snapshot.ref);
      const freshData = freshSnap.data() || {};

      if (freshData.pushDispatchedAt || freshData.pushDispatchStatus === 'sent') {
        return false;
      }

      tx.set(
        snapshot.ref,
        {
          pushDispatchStatus: 'sending',
          pushDispatchClaimedAt: Date.now(),
          pushDispatchClaimedAtServer: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return true;
    });

    if (!shouldSend) {
      logger.info('Push deja trimis de alt dispatcher; functia sare peste trimitere.', {
        notificationId,
        userId,
        removedDuplicateTokens: duplicateDocIds.length,
      });
      return;
    }

    const tokens = tokenItems.map((item) => item.token);

    if (tokens.length === 0) {
      logger.info('Nu exista tokenuri push pentru user.', { notificationId, userId });
      await snapshot.ref.set(
        {
          pushDispatchStatus: 'no_tokens',
          pushDispatchSuccessCount: 0,
          pushDispatchFailureCount: 0,
          pushDispatchAt: FieldValue.serverTimestamp(),
          pushDispatchedAt: Date.now(),
        },
        { merge: true }
      );
      return;
    }

    const title = String(data.title || 'Notificare WorkControl');
    const body = String(data.message || 'Ai o notificare noua.');
    const path = buildPathFromNotification(data);

const response = await messaging.sendEachForMulticast({
  tokens,
  data: {
    title,
    body,
    message: body,
    path,
    notificationId,
    module: String(data.module || ''),
    eventType: String(data.eventType || ''),
    entityId: String(data.entityId || ''),
    soundEnabled: data.soundEnabled === false ? 'false' : 'true',
  },
  webpush: {
    headers: {
      Topic: webPushTopic,
      TTL: '3600',
      Urgency: 'normal',
    },
    fcmOptions: {
      link: path,
    },
  },
});

    const invalidTokenDocIds = [];

    response.responses.forEach((result, index) => {
      if (result.success) return;

      const code = result.error?.code || '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        const failedToken = tokens[index];
        const matchingTokenItem = tokenItems.find((item) => item.token === failedToken);
        if (matchingTokenItem) invalidTokenDocIds.push(matchingTokenItem.id);
      }
    });

    if (invalidTokenDocIds.length > 0) {
      await Promise.all(invalidTokenDocIds.map((docId) => db.collection('pushTokens').doc(docId).delete()));
    }

    await snapshot.ref.set(
      {
        pushDispatchStatus: response.failureCount > 0 && response.successCount === 0 ? 'failed' : 'sent',
        pushDispatchSuccessCount: response.successCount,
        pushDispatchFailureCount: response.failureCount,
        pushDispatchAt: FieldValue.serverTimestamp(),
        pushDispatchedAt: Date.now(),
      },
      { merge: true }
    );

    logger.info('Push dispatch finalizat.', {
      notificationId,
      userId,
      successCount: response.successCount,
      failureCount: response.failureCount,
      tokenCount: tokens.length,
      removedDuplicateTokens: duplicateDocIds.length,
      removedInvalidTokens: invalidTokenDocIds.length,
    });
  }
);
