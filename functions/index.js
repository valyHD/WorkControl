const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const openaiApiKey = defineSecret('OPENAI_API_KEY');
const VEHICLE_POSITION_ARCHIVE_RETENTION_DAYS = 30;
const VEHICLE_POSITION_ARCHIVE_MAX_DAYS_PER_RUN = 80;
const FIRESTORE_DELETE_BATCH_SIZE = 450;

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
        'unknown',
      ],
    },
    entityType: {
      type: 'string',
      enum: ['vehicle', 'tool', 'project', 'user', 'maintenanceClient', 'page', 'currentPage', 'none'],
    },
    entityQuery: {
      type: 'string',
      description: 'Textul folosit pentru cautare: numar masina, marca/model, nume scula, proiect sau user.',
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
      description: 'Incredere intre 0 si 1. Sub 0.65 cand nu esti sigur.',
    },
    risk: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    },
    needsConfirmation: {
      type: 'boolean',
    },
    spokenSummary: {
      type: 'string',
      description: 'Rezumat scurt pentru confirmarea din UI.',
    },
  },
  required: [
    'commandType',
    'intent',
    'entityType',
    'entityQuery',
    'fieldsToUpdate',
    'dateRange',
    'shouldNavigate',
    'shouldFillForm',
    'shouldUpdateFirestore',
    'targetText',
    'targetPage',
    'pageHint',
    'buttonHint',
    'missingFields',
    'confidence',
    'risk',
    'needsConfirmation',
    'spokenSummary',
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
    createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
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
    const [buffer] = await admin.storage().bucket().file(params.storagePath).download();
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
    ...analysis,
    documentDate,
    yearMonth,
    fileName: toSafeString(jobData.fileName),
    fileUrl: toSafeString(jobData.fileUrl),
    filePath: toSafeString(jobData.filePath),
    contentType: toSafeString(jobData.contentType),
    sizeBytes: toSafeNumber(jobData.sizeBytes, 0),
    extension: toSafeString(jobData.extension),
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
    createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
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

function parseDateToStartTs(dateString) {
  const safeDate = toSafeString(dateString);
  if (!safeDate) return null;

  const [year, month, day] = safeDate.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;

  const ts = Date.UTC(year, month - 1, day);
  return Number.isFinite(ts) ? ts : null;
}

function diffDaysFromToday(targetTs) {
  const todayStart = parseDateToStartTs(getTodayKey());
  if (!todayStart) return 0;
  return Math.ceil((targetTs - todayStart) / 86400000);
}

function getTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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
        archivedAtServer: admin.firestore.FieldValue.serverTimestamp(),
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
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Trebuie sa fii autentificat.');
  }

  const userSnap = await db.collection('users').doc(request.auth.uid).get();
  if (toSafeString(userSnap.get('role')) !== 'admin') {
    throw new HttpsError('permission-denied', 'Doar admin poate porni arhivarea.');
  }
}

function normalizeRule(doc) {
  const data = doc.data() || {};
  const recipients = data.recipients || {};

  return {
    id: doc.id,
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
        active: data.active !== false,
        themeKey: data.themeKey || null,
      };
    }),
    rules: rulesSnap.docs.map(normalizeRule),
  };
}

async function dispatchNotificationEvent(input, context) {
  await createAuditLog({
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
    },
  }).catch((error) => logger.warn('[audit][event]', error));

  const rules = context.rules.filter((rule) => ruleMatches(rule, input.module, input.eventType, input.entityId));
  if (rules.length === 0) return 0;

  const users = context.users;
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

  const batch = db.batch();
  const now = Date.now();

    userIds.forEach((userId) => {
      const targetUser = users.find((user) => user.id === userId);
      const notificationRef = db.collection('notifications').doc();
      const targetUserName = targetUser?.name || userId;

      batch.set(notificationRef, {
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
      createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
    });

    batch.set(db.collection('auditLogs').doc(), buildAuditPayload({
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

function getBucharestClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });

  const hour = toSafeNumber(map.hour, 0) % 24;
  const minute = toSafeNumber(map.minute, 0);
  const dayKey = `${map.year}-${map.month}-${map.day}`;
  const jsWeekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();

  return {
    dayKey,
    weekday: jsWeekday === 0 ? 7 : jsWeekday,
    minutes: hour * 60 + minute,
  };
}

function parseReminderScheduleMinutes(scheduleTime) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(toSafeString(scheduleTime));
  if (!match) return 8 * 60 + 30;

  const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return hour * 60 + minute;
}

function getExplicitTimesheetReminderRules(context, eventType) {
  return context.rules.filter((rule) => rule.module === 'timesheets' && rule.eventType === eventType);
}

function getTimesheetStartReminderRules(context) {
  return context.rules.filter(
    (rule) =>
      rule.module === 'timesheets' &&
      (rule.eventType === 'timesheet_start_daily_reminder' || rule.eventType === 'timesheet_work_interval_reminder')
  );
}

function getTimesheetStopReminderRules(context) {
  return context.rules.filter(
    (rule) =>
      rule.module === 'timesheets' &&
      (rule.eventType === 'timesheet_stop_after_8h_reminder' || rule.eventType === 'timesheet_work_interval_reminder')
  );
}

function ruleRunsToday(rule, weekday) {
  const weekdays = Array.isArray(rule.weekdays) && rule.weekdays.length > 0 ? rule.weekdays : [1, 2, 3, 4, 5];
  return weekdays.includes(weekday);
}

function getReminderRepeatMinutes(rule) {
  return Math.max(5, Math.min(720, Math.round(toSafeNumber(rule.reminderRepeatMinutes, 60))));
}

function getReminderActiveMinutes(rule) {
  return Math.max(0, Math.min(1440, Math.round(toSafeNumber(rule.reminderActiveMinutes, 120))));
}

function getReminderSlot(clockMinutes, scheduledMinutes, repeatMinutes, activeMinutes) {
  if (clockMinutes < scheduledMinutes) return null;
  const elapsedMinutes = clockMinutes - scheduledMinutes;
  const safeActiveMinutes = Math.max(0, activeMinutes);
  if (elapsedMinutes > safeActiveMinutes) return null;
  const safeRepeatMinutes = Math.max(5, repeatMinutes);
  return Math.floor(elapsedMinutes / safeRepeatMinutes);
}

function getRuleReminderSlot(rule, clockMinutes, timeField) {
  const scheduledMinutes = parseReminderScheduleMinutes(rule[timeField]);
  const repeatMinutes = getReminderRepeatMinutes(rule);
  const activeMinutes = getReminderActiveMinutes(rule);
  const slot = getReminderSlot(clockMinutes, scheduledMinutes, repeatMinutes, activeMinutes);
  if (slot === null) return null;

  return {
    slot,
    scheduledMinutes,
    repeatMinutes,
    activeMinutes,
    markerTimeKey: toSafeString(rule[timeField]).replace(/[^0-9]/g, '') || 'time',
  };
}

async function getApprovedLeaveUserIdsForDay(dayKey) {
  const snap = await db.collection('leaveRequests').where('status', '==', 'aprobat').get();
  const userIds = new Set();

  snap.docs.forEach((doc) => {
    const periodStart = toSafeString(doc.get('periodStart'));
    const periodEnd = toSafeString(doc.get('periodEnd'));
    const userId = toSafeString(doc.get('userId'));
    if (!userId || !periodStart || !periodEnd) return;
    if (periodStart <= dayKey && dayKey <= periodEnd) {
      userIds.add(userId);
    }
  });

  return userIds;
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
        createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('auditLogs').doc(), buildAuditPayload({
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
      type: params.type,
      dateKey: params.dateKey || '',
      entityId: params.entityId || '',
      ruleId: params.ruleId || '',
      reminderSlot: Number.isFinite(params.reminderSlot) ? params.reminderSlot : null,
      repeatMinutes: Number.isFinite(params.repeatMinutes) ? params.repeatMinutes : null,
      recipientCount: recipients.length,
      createdAt: now,
      createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
    });

    return true;
  });
}

async function runTimesheetReminderAlertsJob() {
  const notificationContext = await getNotificationContext();
  const clock = getBucharestClockParts();
  let createdCount = 0;

  const startRules = getTimesheetStartReminderRules(notificationContext).filter(
    (rule) => ruleRunsToday(rule, clock.weekday) && getRuleReminderSlot(rule, clock.minutes, 'scheduleTime') !== null
  );

  const stopRules = getTimesheetStopReminderRules(notificationContext).filter(
    (rule) => ruleRunsToday(rule, clock.weekday) && getRuleReminderSlot(rule, clock.minutes, 'stopTime') !== null
  );

  const approvedLeaveUserIds =
    startRules.length > 0 || stopRules.length > 0
      ? await getApprovedLeaveUserIdsForDay(clock.dayKey)
      : new Set();
  const activeTimesheetsSnap =
    startRules.length > 0 || stopRules.length > 0
      ? await db.collection('timesheets').where('status', '==', 'activ').get()
      : null;
  const todayTimesheetsSnap =
    startRules.length > 0
      ? await db.collection('timesheets').where('workDate', '==', clock.dayKey).get()
      : null;
  const activeTimesheetUserIds = new Set(
    activeTimesheetsSnap?.docs
      .map((doc) => toSafeString(doc.get('userId')))
      .filter(Boolean) || []
  );
  const startedTodayUserIds = new Set(
    todayTimesheetsSnap?.docs
      .map((doc) => toSafeString(doc.get('userId')))
      .filter(Boolean) || []
  );

  if (startRules.length > 0) {
    for (const rule of startRules) {
      const reminderSlot = getRuleReminderSlot(rule, clock.minutes, 'scheduleTime');
      if (!reminderSlot) continue;

      const usersToRemind = collectStartReminderUsers([rule], notificationContext.users).filter(
        (user) =>
          !startedTodayUserIds.has(user.id) &&
          !activeTimesheetUserIds.has(user.id) &&
          !approvedLeaveUserIds.has(user.id)
      );

      for (const user of usersToRemind) {
        const created = await createTimesheetReminderNotificationsOnce({
          markerId: `timesheet_start_${clock.dayKey}_${user.id}_${reminderSlot.markerTimeKey}_${reminderSlot.slot}`,
          type: 'timesheet_start_daily_reminder',
          dateKey: clock.dayKey,
          ruleId: rule.id,
          reminderSlot: reminderSlot.slot,
          repeatMinutes: reminderSlot.repeatMinutes,
          recipients: [user],
          title: 'Porneste pontajul',
          message: `Nu ai pontaj pornit astazi. Reminder setat de la ora ${rule.scheduleTime || '08:30'}, repetare la ${reminderSlot.repeatMinutes} min, maximum ${reminderSlot.activeMinutes} min.`,
          eventType: 'timesheet_start_daily_reminder',
          notificationPath: '/my-timesheets',
          soundEnabled: rule.soundEnabled !== false,
        });
        if (created) createdCount += 1;
      }
    }
  }

  let activeTimesheetsChecked = 0;

  if (stopRules.length > 0 && activeTimesheetsSnap) {
    activeTimesheetsChecked = activeTimesheetsSnap.size;

    for (const timesheetDoc of activeTimesheetsSnap.docs) {
      const timesheet = timesheetDoc.data() || {};
      const startAt = toSafeNumber(timesheet.startAt, 0);
      const timesheetUserId = toSafeString(timesheet.userId);
      if (!startAt || !timesheetUserId) continue;
      if (approvedLeaveUserIds.has(timesheetUserId)) continue;

      const dueRules = stopRules.filter((rule) => {
        if (!ruleAppliesToTimesheet(rule, timesheetDoc.id, timesheet)) return false;
        return true;
      });

      if (dueRules.length === 0) continue;

      for (const rule of dueRules) {
        const reminderSlot = getRuleReminderSlot(rule, clock.minutes, 'stopTime');
        if (!reminderSlot) continue;

        const recipients = collectStopReminderRecipients([rule], notificationContext.users, timesheetUserId);
        const stopTime = toSafeString(rule.stopTime) || '17:00';

        const created = await createTimesheetReminderNotificationsOnce({
          markerId: `timesheet_stop_${clock.dayKey}_${timesheetDoc.id}_${reminderSlot.markerTimeKey}_${reminderSlot.slot}`,
          type: 'timesheet_stop_after_8h_reminder',
          dateKey: clock.dayKey,
          entityId: timesheetDoc.id,
          ruleId: rule.id,
          reminderSlot: reminderSlot.slot,
          repeatMinutes: reminderSlot.repeatMinutes,
          recipients,
          title: 'Opreste pontajul',
          message: `Ai pontaj activ dupa ora ${stopTime}. Reminderul se repeta la ${reminderSlot.repeatMinutes} min, maximum ${reminderSlot.activeMinutes} min.`,
          eventType: 'timesheet_stop_after_8h_reminder',
          notificationPath: '/my-timesheets',
          soundEnabled: rule.soundEnabled !== false,
        });
        if (created) createdCount += 1;
      }
    }
  }

  return {
    createdCount,
    startRulesChecked: startRules.length,
    stopRulesChecked: stopRules.length,
    activeUsersCount: activeTimesheetUserIds.size,
    startedTodayUsersCount: startedTodayUserIds.size,
    leaveUsersSkipped: approvedLeaveUserIds.size,
    activeTimesheetsChecked,
    dateKey: clock.dayKey,
    weekday: clock.weekday,
    minuteOfDay: clock.minutes,
  };
}

exports.interpretAssistantCommand = onCall(
  {
    region: 'europe-west1',
    timeoutSeconds: 30,
    memory: '512MiB',
    secrets: [openaiApiKey],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Trebuie sa fii autentificat.');
    }

    const command = toSafeString(request.data?.command).slice(0, 600);
    const apiKey = openaiApiKey.value() || process.env.OPENAI_API_KEY;
    const model = toSafeString(process.env.OPENAI_ASSISTANT_MODEL) || 'gpt-4.1-mini';

    if (!command) {
      throw new HttpsError('invalid-argument', 'Comanda este goala.');
    }

    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'OPENAI_API_KEY nu este configurat in Firebase Functions.');
    }

    const today = new Date().toISOString().slice(0, 10);
    const prompt = [
      'Interpreteaza o comanda vocala in romana pentru aplicatia WorkControl.',
      'Nu executa niciodata actiunea. Intoarce doar JSON-ul structurii cerute.',
      `Data curenta este ${today}. Converteste datele relative precum azi/maine in YYYY-MM-DD.`,
      'Clasifica obligatoriu comanda in commandType: navigation, form_fill, entity_update, create_entity, timesheet_action, question sau unknown.',
      'Regula critica: daca utilizatorul cere doar navigare ("du-te/deschide/arata pagina concedii"), commandType navigation, shouldNavigate true, shouldFillForm false, shouldUpdateFirestore false si fieldsToUpdate gol.',
      'Regula critica: navigation nu modifica niciodata campuri. Nu transforma "pagina concedii" in valoare de input.',
      'form_fill completeaza doar formulare explicite si nu salveaza/trimite fara confirmare separata.',
      'entity_update inseamna modificare prin servicii Firestore, nu prin DOM.',
      'create_entity inseamna formular nou sau creare dupa confirmare; pune datele extrase in fieldsToUpdate.',
      'Extrage intentia, tipul entitatii, textul de cautare al entitatii si toate campurile cerute in fieldsToUpdate.',
      'Nu folosi editField/editValue. Pentru editari pune toate campurile in fieldsToUpdate.',
      'Normalizeaza numerele auto fara spatii: "B 33 LGR" devine "B33LGR".',
      'Normalizeaza datele in YYYY-MM-DD. Pentru valori necunoscute pastreaza textul rostit.',
      'Pune intervalul de concediu si in dateRange: {startDate,endDate}. Daca nu exista interval, dateRange are stringuri goale.',
      'Daca lipseste entitatea sau valoarea, adauga numele lipsa in missingFields.',
      'Daca nu esti sigur, pune confidence sub 0.65 si intent unknown sau missingFields potrivit.',
      'Risk: low pentru navigare/cautare, medium pentru editari/pontaj/creare, high pentru stergeri sau roluri.',
      'needsConfirmation este true pentru orice medium/high si false pentru navigare simpla.',
      'shouldNavigate este true doar cand trebuie deschisa o pagina. shouldFillForm este true doar pentru formular. shouldUpdateFirestore este true doar pentru update_vehicle/update_tool/update_project/update_user.',
      'Pentru comenzi care completeaza formulare, pune ruta in targetPage si datele in fieldsToUpdate. Nu te opri la open_page daca utilizatorul a dictat datele formularului.',
      'Intentii disponibile: update_vehicle, update_tool, update_project, update_user, start_timesheet, stop_timesheet, create_project, create_vehicle, create_tool, create_maintenance_client, fill_maintenance_client_form, schedule_leave, fill_leave_form, open_vehicle, open_tool, open_project, open_page, click_button, fill_current_page, update_current_page_field, submit_current_form, unknown.',
      'entityType disponibil: vehicle, tool, project, user, maintenanceClient, page, currentPage, none.',
      'Daca utilizatorul spune doar "du-ma/deschide pontajul meu", foloseste open_page cu pageHint "/my-timesheets", nu start_timesheet.',
      'Foloseste start_timesheet doar pentru verbe clare de pornire: porneste, incepe, start, da start.',
      'Foloseste stop_timesheet doar pentru verbe clare de oprire: opreste, stop, inchide pontajul, termina pontajul.',
      'Exemple:',
      '"Du-te pe pagina concedii" => commandType navigation, intent open_page, entityType page, targetPage "/my-leave", shouldNavigate true, shouldFillForm false, shouldUpdateFirestore false, fieldsToUpdate {}.',
      '"schimba kilometrii la B 33 LGR la 6180" => commandType entity_update, intent update_vehicle, entityType vehicle, entityQuery B33LGR, fieldsToUpdate {"kilometri":6180}, shouldUpdateFirestore true.',
      '"La Logan schimba kilometrii la 6200 si ITP-ul pe 20 septembrie 2026" => update_vehicle, vehicle, entityQuery Logan, fieldsToUpdate {"kilometri":6200,"ITP":"2026-09-20"}.',
      '"seteaza ITP la Logan pe 20 septembrie 2026" => update_vehicle, vehicle, entityQuery Logan, fieldsToUpdate {"ITP":"2026-09-20"}.',
      '"pune masina lui Razvan in service" => update_vehicle, vehicle, entityQuery Razvan, fieldsToUpdate {"status":"in_service"}.',
      '"schimba soferul la B123ABC pe Mihai" => update_vehicle, vehicle, entityQuery B123ABC, fieldsToUpdate {"sofer":"Mihai"}.',
      '"Schimba kilometrii masinii B33LGR la 6180" => update_vehicle, vehicle, entityQuery B33LGR, fieldsToUpdate {"kilometri":6180}.',
      '"La Logan pune km 7000" => update_vehicle, vehicle, entityQuery Logan, fieldsToUpdate {"kilometri":7000}.',
      '"marcheaza flexul Bosch defect" => update_tool, tool, entityQuery flex Bosch, fieldsToUpdate {"status":"defecta"}.',
      '"muta bormasina la Ionut" => update_tool, tool, entityQuery bormasina, fieldsToUpdate {"detinator":"Ionut"}.',
      '"schimba proiectul Service Lifturi in finalizat" => update_project, project, entityQuery Service Lifturi, fieldsToUpdate {"status":"finalizat"}.',
      '"schimba functia lui Ionut in tehnician lifturi" => update_user, user, entityQuery Ionut, fieldsToUpdate {"functie":"tehnician lifturi"}.',
      '"pune departamentul lui Mihai la interventii" => update_user, user, entityQuery Mihai, fieldsToUpdate {"departament":"interventii"}.',
      '"creeaza proiect Revizie Lifturi Sector 3" => create_project, project, entityQuery Revizie Lifturi Sector 3.',
      '"Adauga in mentenanta client nou Isomat cu lift 210869" => commandType create_entity, intent create_maintenance_client, maintenanceClient, entityQuery Isomat, fieldsToUpdate {"name":"Isomat","liftNumber":"210869"}, targetPage "/maintenance?tab=clients&assistant=client", shouldNavigate true, shouldFillForm true.',
      '"Completeaza client nou in mentenanta nume Isomat, email office@isomat.ro, adresa Aurel Vlaicu 91, lift 210869, expira pe 20 august 2026" => create_maintenance_client, maintenanceClient, fieldsToUpdate {"name":"Isomat","email":"office@isomat.ro","address":"Aurel Vlaicu 91","liftNumber":"210869","expiryDate":"2026-08-20"}, targetPage "/maintenance?tab=clients&assistant=client".',
      '"Adauga client mentenanta Isomat cu firma ISL Elevator si doua lifturi 123 si 456" => create_maintenance_client, maintenanceClient, entityQuery Isomat, fieldsToUpdate {"name":"Isomat","maintenanceCompany":"ISL Elevator","liftNumbers":["123","456"]}, targetPage "/maintenance?tab=clients&assistant=client".',
      '"Programeaza concediu ultima saptamana din august" => commandType form_fill, intent schedule_leave, currentPage, fieldsToUpdate {"startDate":"2026-08-24","endDate":"2026-08-30"}, dateRange {"startDate":"2026-08-24","endDate":"2026-08-30"}, targetPage "/my-leave?assistant=leave#leave-form", shouldNavigate true, shouldFillForm true.',
      '"Programeaza concediu din 24 august pana pe 30 august" => schedule_leave, currentPage, fieldsToUpdate {"startDate":"2026-08-24","endDate":"2026-08-30"}, targetPage "/my-leave?assistant=leave#leave-form".',
      '"apasa salveaza" => click_button, currentPage, buttonHint salveaza.',
      '"completeaza telefon cu 0722" => fill_current_page, currentPage, fieldsToUpdate {"telefon":"0722"}.',
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
            role: 'system',
            content: [{ type: 'input_text', text: prompt }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: command }],
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

    const responseText = await openaiResponse.text();
    if (!openaiResponse.ok) {
      logger.error('[interpretAssistantCommand][openai]', responseText);
      throw new HttpsError('internal', 'OpenAI nu a putut interpreta comanda.');
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (error) {
      logger.error('[interpretAssistantCommand][parse response]', error, responseText);
      throw new HttpsError('internal', 'Raspuns invalid de la OpenAI.');
    }

    const outputText = extractResponseText(parsedResponse);
    try {
      const interpreted = JSON.parse(outputText);
      const fieldsToUpdate =
        interpreted.fieldsToUpdate && typeof interpreted.fieldsToUpdate === 'object' && !Array.isArray(interpreted.fieldsToUpdate)
          ? interpreted.fieldsToUpdate
          : {};
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
      return {
        commandType,
        intent: toSafeString(interpreted.intent) || 'unknown',
        entityType: toSafeString(interpreted.entityType) || 'none',
        entityQuery: toSafeString(interpreted.entityQuery),
        fieldsToUpdate,
        dateRange,
        shouldNavigate: Boolean(interpreted.shouldNavigate),
        shouldFillForm: Boolean(interpreted.shouldFillForm),
        shouldUpdateFirestore: Boolean(interpreted.shouldUpdateFirestore),
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
        needsConfirmation: Boolean(interpreted.needsConfirmation),
        spokenSummary: toSafeString(interpreted.spokenSummary),
      };
    } catch (error) {
      logger.error('[interpretAssistantCommand][parse output]', error, outputText);
      throw new HttpsError('internal', 'Nu am putut interpreta comanda.');
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
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Trebuie sa fii autentificat.');
    }

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
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Trebuie sa fii autentificat.');
    }

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

      await snapshot.ref.set(
        {
          status: 'processing',
          processingStartedAt: Date.now(),
          updatedAt: Date.now(),
          updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const analysis = await analyzeExpenseStorageFile({
        storagePath,
        fileName: toSafeString(jobData.fileName) || 'document',
        contentType: inferContentType(jobData.fileName, jobData.contentType),
        scanMode: toSafeString(jobData.scanMode) || 'full',
        extractionMode: 'core',
        publicUrl: toSafeString(jobData.fileUrl),
        apiKey,
        model,
      });

      if (!hasMeaningfulExpenseExtraction(analysis)) {
        throw new Error('AI nu a putut citi valori clare din document.');
      }

      const expenseDocumentId = await saveExpenseDocumentFromScanJob(jobData, analysis);

      await snapshot.ref.set(
        {
          status: 'completed',
          expenseDocumentId,
          completedAt: Date.now(),
          updatedAt: Date.now(),
          updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
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
          updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }
);

exports.checkTimesheetReminderAlerts = onSchedule(
  {
    schedule: '* * * * *',
    timeZone: 'Europe/Bucharest',
    region: 'europe-west1',
  },
  async () => {
    const result = await runTimesheetReminderAlertsJob();
    logger.info('Verificare remindere pontaj finalizata.', result);
  }
);

async function maybeCreateVehicleAlert(params) {
  const markerRef = db.collection('vehicleMaintenanceAlerts').doc(params.markerId);
  const marker = await markerRef.get();

  if (marker.exists) return false;

  const recipientCount = await dispatchNotificationEvent(params.notification, params.notificationContext);

  await markerRef.set({
    createdAt: Date.now(),
    createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
    dateKey: params.todayKey,
    type: params.type,
    vehicleId: params.vehicleId,
    recipientCount,
  });

  return true;
}

exports.checkVehicleMaintenanceAlerts = onSchedule(
  {
    schedule: 'every 1 hours',
    timeZone: 'Europe/Bucharest',
    region: 'europe-west1',
  },
  async () => {
    const [vehiclesSnap, notificationContext] = await Promise.all([
      db.collection('vehicles').get(),
      getNotificationContext(),
    ]);
    const todayKey = getTodayKey();
    let createdCount = 0;

    for (const vehicleDoc of vehiclesSnap.docs) {
      const vehicle = vehicleDoc.data() || {};
      const vehicleId = vehicleDoc.id;
      const plateNumber = toSafeString(vehicle.plateNumber) || 'fara numar';
      const ownerUserId = toSafeString(vehicle.ownerUserId);
      const directUserId = toSafeString(vehicle.currentDriverUserId) || ownerUserId;
      const currentKm = toSafeNumber(vehicle.currentKm, 0);
      const gpsOdometerKm = toSafeNumber(vehicle.gpsSnapshot?.odometerKm, 0);
      const effectiveKm = Math.max(currentKm, gpsOdometerKm);

      const serviceTargets = [
        {
          key: 'service',
          label: 'Revizie',
          value: toSafeNumber(vehicle.nextServiceKm, 0),
          eventType: 'vehicle_service_due_soon',
        },
        {
          key: 'oil',
          label: 'Revizie ulei',
          value: toSafeNumber(vehicle.nextOilServiceKm, 0),
          eventType: 'vehicle_oil_service_due_soon',
        },
      ];

      for (const serviceInfo of serviceTargets) {
        if (serviceInfo.value <= 0) continue;

        const remainingKm = serviceInfo.value - effectiveKm;
        if (remainingKm > 500) continue;

        const created = await maybeCreateVehicleAlert({
          markerId: `${vehicleId}_${serviceInfo.key}_${todayKey}`,
          todayKey,
          type: serviceInfo.key,
          vehicleId,
          notificationContext,
          notification: {
            module: 'vehicles',
            eventType: serviceInfo.eventType,
            entityId: vehicleId,
            notificationPath: `/vehicles/${vehicleId}`,
            title: `${serviceInfo.label} aproape scadenta`,
            message: `Masina ${plateNumber} se apropie de ${serviceInfo.label.toLowerCase()} (mai sunt ${Math.max(
              remainingKm,
              0
            )} km).`,
            directUserId,
            ownerUserId,
            notifyAdminsByDefault: true,
          },
        });

        if (created) createdCount += 1;
      }

      const expiringDocs = [
        { label: 'ITP', value: vehicle.nextItpDate, key: 'itp', eventType: 'vehicle_document_itp_due_soon' },
        { label: 'RCA', value: vehicle.nextRcaDate, key: 'rca', eventType: 'vehicle_document_rca_due_soon' },
        { label: 'CASCO', value: vehicle.nextCascoDate, key: 'casco', eventType: 'vehicle_document_casco_due_soon' },
        {
          label: 'Rovinieta',
          value: vehicle.nextRovinietaDate,
          key: 'rovinieta',
          eventType: 'vehicle_document_rovinieta_due_soon',
        },
      ];

      for (const docInfo of expiringDocs) {
        const expiryTs = parseDateToStartTs(docInfo.value);
        if (!expiryTs) continue;

        const daysLeft = diffDaysFromToday(expiryTs);
        if (daysLeft > 10) continue;

        const created = await maybeCreateVehicleAlert({
          markerId: `${vehicleId}_${docInfo.key}_${todayKey}`,
          todayKey,
          type: docInfo.key,
          vehicleId,
          notificationContext,
          notification: {
            module: 'vehicles',
            eventType: docInfo.eventType,
            entityId: vehicleId,
            notificationPath: `/vehicles/${vehicleId}`,
            title: `${docInfo.label} aproape de expirare`,
            message: `Masina ${plateNumber}: ${docInfo.label} expira in ${Math.max(daysLeft, 0)} zile (${docInfo.value}).`,
            directUserId,
            ownerUserId,
            notifyAdminsByDefault: true,
          },
        });

        if (created) createdCount += 1;
      }
    }

    logger.info('Verificare mentenanta vehicule finalizata.', {
      vehiclesChecked: vehiclesSnap.size,
      alertsCreated: createdCount,
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

exports.checkMaintenancePartOrderReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Europe/Bucharest',
    region: 'europe-west1',
  },
  async () => {
    const now = Date.now();
    const snap = await db
      .collection('maintenancePartOrders')
      .where('nextReminderAt', '<=', now)
      .limit(80)
      .get();

    let createdCount = 0;
    let skippedCount = 0;

    for (const orderDoc of snap.docs) {
      const orderId = orderDoc.id;

      try {
        await db.runTransaction(async (tx) => {
          const freshOrderDoc = await tx.get(orderDoc.ref);
          if (!freshOrderDoc.exists) {
            skippedCount += 1;
            return;
          }

          const order = freshOrderDoc.data() || {};
          const notifyUserId = toSafeString(order.notifyUserId);
          const nextReminderAt = Number(order.nextReminderAt || 0);
          const status = toSafeString(order.status);

          if (
            !notifyUserId ||
            Number(order.notificationSeenAt || 0) > 0 ||
            status === 'installed' ||
            status === 'cancelled' ||
            !Number.isFinite(nextReminderAt) ||
            nextReminderAt > now
          ) {
            skippedCount += 1;
            return;
          }

          const userDoc = await tx.get(db.collection('users').doc(notifyUserId));
          const user = userDoc.exists ? userDoc.data() || {} : {};
          const intervalMinutes = Math.max(5, Math.min(1440, Number(order.reminderIntervalMinutes || 30)));
          const title = 'Comanda piese asteapta confirmare';
          const label = getPartOrderLabel(order, orderId);
          const message = `${toSafeString(order.requestedByUserName) || 'Un utilizator'} a creat comanda ${label}. Bifeaza Am vazut dupa ce o verifici.`;
          const notificationRef = db.collection('notifications').doc();

          tx.set(notificationRef, {
            userId: notifyUserId,
            targetUserThemeKey: user.themeKey || null,
            actorUserId: toSafeString(order.requestedByUserId),
            actorUserName: toSafeString(order.requestedByUserName) || 'WorkControl',
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
            createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
          });

          tx.update(orderDoc.ref, {
            lastReminderAt: now,
            nextReminderAt: now + intervalMinutes * 60 * 1000,
            updatedAt: now,
            updatedAtServer: admin.firestore.FieldValue.serverTimestamp(),
          });

          createdCount += 1;
        });
      } catch (error) {
        skippedCount += 1;
        logger.error('Nu am putut crea reminder pentru comanda piese.', { orderId, error });
      }
    }

    logger.info('Verificare remindere comenzi piese finalizata.', {
      checkedCount: snap.size,
      createdCount,
      skippedCount,
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
          pushDispatchAt: admin.firestore.FieldValue.serverTimestamp(),
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
          pushDispatchClaimedAtServer: admin.firestore.FieldValue.serverTimestamp(),
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
          pushDispatchAt: admin.firestore.FieldValue.serverTimestamp(),
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
        pushDispatchAt: admin.firestore.FieldValue.serverTimestamp(),
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
