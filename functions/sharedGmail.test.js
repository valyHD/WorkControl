const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SHARED_GMAIL_DISPLAY_NAME,
  SHARED_GMAIL_SENDER,
  buildPartOrderEmail,
  buildRawMimeMessage,
  buildReportEmail,
  createSharedGmailHandlers,
} = require('./sharedGmail');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function createFakeFirestore(initialDocuments) {
  const documents = new Map(Object.entries(initialDocuments));
  const writes = [];

  function snapshot(path) {
    return {
      exists: documents.has(path),
      data: () => documents.get(path),
    };
  }

  function doc(path) {
    return {
      id: path.split('/').at(-1),
      path,
      get: async () => snapshot(path),
      set: async (data, options) => {
        documents.set(path, options?.merge ? { ...(documents.get(path) || {}), ...data } : data);
        writes.push({ path, data });
      },
      collection: (name) => collection(`${path}/${name}`),
    };
  }

  function collection(path) {
    return {
      path,
      doc: (id = `auto-${writes.length + 1}`) => doc(`${path}/${id}`),
    };
  }

  return {
    documents,
    writes,
    collection,
    runTransaction: async (callback) => callback({
      get: async (ref) => snapshot(ref.path),
      set: (ref, data, options) => {
        documents.set(ref.path, options?.merge ? { ...(documents.get(ref.path) || {}), ...data } : data);
        writes.push({ path: ref.path, data });
      },
    }),
    batch: () => {
      const operations = [];
      return {
        set: (ref, data) => operations.push({ ref, data }),
        commit: async () => {
          for (const operation of operations) {
            documents.set(operation.ref.path, { ...(documents.get(operation.ref.path) || {}), ...operation.data });
            writes.push({ path: operation.ref.path, data: operation.data });
          }
        },
      };
    },
  };
}

test('builds a Gmail MIME message with the fixed sender and a real PDF attachment', () => {
  const result = buildRawMimeMessage({
    dispatchId: 'dispatch-test',
    to: 'client@example.test',
    subject: 'Raport revizie',
    body: 'Buna ziua',
    sentAt: Date.UTC(2026, 6, 16, 8, 0, 0),
    attachments: [{
      content: Buffer.from('%PDF-test'),
      fileName: 'raport.pdf',
      contentType: 'application/pdf',
    }],
  });

  const decoded = Buffer.from(result.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(decoded, new RegExp(`From: ${SHARED_GMAIL_DISPLAY_NAME} <${SHARED_GMAIL_SENDER}>`));
  assert.match(decoded, /Content-Disposition: attachment; filename="raport.pdf"/);
  assert.match(decoded, /Content-Type: application\/pdf/);
});

test('builds supplier and client messages only from stored order data', () => {
  const order = {
    title: 'Role usa',
    clientName: 'Client Test',
    addressLabel: 'Strada Test 1',
    liftSerialNumber: 'L-10',
    supplierEmail: 'supplier@example.test',
    clientEmail: 'client@example.test',
    clientOfferAmount: 1200,
    lines: [{ name: 'Rola', code: 'R-1', quantity: 2, unit: 'buc' }],
  };
  const supplier = buildPartOrderEmail(order, 'supplier', TestHttpsError);
  const client = buildPartOrderEmail(order, 'client', TestHttpsError);

  assert.equal(supplier.recipient, 'supplier@example.test');
  assert.match(supplier.body, /Rola, cod R-1, cantitate 2 buc/);
  assert.equal(client.recipient, 'client@example.test');
  assert.match(client.body, /1\.200,00/);
});

test('sends a stored maintenance report for an active employee in the same company', async () => {
  const db = createFakeFirestore({
    'maintenanceClients/client-1': {
      companyId: 'company-1',
      name: 'Client Test',
      email: 'client@example.test',
      maintenanceCompany: 'Liftul Tau',
    },
    'maintenanceClients/client-1/rapoarte/report-1': {
      companyId: 'company-1',
      reportType: 'revizie',
      dateText: '16.07.2026',
      timeText: '10:00',
      pdfPath: 'maintenance-reports/client-1/report.pdf',
      fileName: 'report.pdf',
      images: [],
    },
  });
  const sent = [];
  const handlers = createSharedGmailHandlers({
    db,
    bucket: { file: () => ({ download: async () => [Buffer.from('%PDF-test')] }) },
    FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
    HttpsError: TestHttpsError,
    logger: { error: () => undefined },
    assertActiveInternalRequest: async () => ({
      userSnap: { id: 'employee-1' },
      user: { fullName: 'Tehnician Test', role: 'angajat' },
      companyId: 'company-1',
      companyIds: ['company-1'],
      role: 'angajat',
      globalAdmin: false,
    }),
    canAccessCompany: (context, companyId) => context.companyIds.includes(companyId),
    buildAuditPayload: (value) => value,
    getCredentials: () => ({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' }),
    sendGmail: async (input) => {
      sent.push(input);
      return { id: 'gmail-message-1', threadId: 'gmail-thread-1' };
    },
  });

  const result = await handlers.sendSharedMaintenanceEmail({
    auth: { uid: 'employee-1' },
    data: {
      kind: 'maintenance_report',
      clientId: 'client-1',
      reportId: 'report-1',
      requestId: 'maintenance-report:client-1:report-1',
    },
  });

  assert.equal(result.status, 'sent');
  assert.equal(result.senderEmail, SHARED_GMAIL_SENDER);
  assert.equal(sent.length, 1);
  assert.equal(db.documents.get('maintenanceClients/client-1/rapoarte/report-1').emailSender, SHARED_GMAIL_SENDER);
  assert.equal(db.documents.get('maintenanceClients/client-1/rapoarte/report-1').gmailMessageId, 'gmail-message-1');
});

test('rejects a report from another company before contacting Gmail', async () => {
  const db = createFakeFirestore({
    'maintenanceClients/client-2': { companyId: 'company-2', email: 'client@example.test' },
    'maintenanceClients/client-2/rapoarte/report-2': {
      companyId: 'company-2',
      pdfPath: 'maintenance-reports/client-2/report.pdf',
      fileName: 'report.pdf',
    },
  });
  let sendCalls = 0;
  const handlers = createSharedGmailHandlers({
    db,
    bucket: { file: () => ({ download: async () => [Buffer.from('%PDF-test')] }) },
    FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
    HttpsError: TestHttpsError,
    logger: { error: () => undefined },
    assertActiveInternalRequest: async () => ({
      userSnap: { id: 'employee-1' },
      user: { fullName: 'Employee' },
      companyIds: ['company-1'],
      globalAdmin: false,
    }),
    canAccessCompany: (context, companyId) => context.companyIds.includes(companyId),
    buildAuditPayload: (value) => value,
    getCredentials: () => ({}),
    sendGmail: async () => { sendCalls += 1; return { id: 'never' }; },
  });

  await assert.rejects(
    handlers.sendSharedMaintenanceEmail({
      auth: { uid: 'employee-1' },
      data: {
        kind: 'maintenance_report',
        clientId: 'client-2',
        reportId: 'report-2',
        requestId: 'maintenance-report:client-2:report-2',
      },
    }),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(sendCalls, 0);
});

test('report recipient is read from the stored client record', () => {
  const email = buildReportEmail(
    { emails: ['adresa-invalida', 'client@example.test'], maintenanceCompany: 'Liftul Tau' },
    { reportType: 'interventie', dateText: '16.07.2026' },
    TestHttpsError
  );
  assert.equal(email.recipient, 'client@example.test');
  assert.match(email.subject, /interventie/);
});

test('repeating the same report request does not send a second Gmail message', async () => {
  const db = createFakeFirestore({
    'maintenanceClients/client-3': {
      companyId: 'company-1',
      email: 'client@example.test',
    },
    'maintenanceClients/client-3/rapoarte/report-3': {
      companyId: 'company-1',
      reportType: 'revizie',
      pdfPath: 'maintenance-reports/client-3/report.pdf',
      fileName: 'report.pdf',
      images: [],
    },
  });
  let sendCalls = 0;
  const handlers = createSharedGmailHandlers({
    db,
    bucket: { file: () => ({ download: async () => [Buffer.from('%PDF-test')] }) },
    FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
    HttpsError: TestHttpsError,
    logger: { error: () => undefined },
    assertActiveInternalRequest: async () => ({
      userSnap: { id: 'employee-1' },
      user: { fullName: 'Employee' },
      companyIds: ['company-1'],
      globalAdmin: false,
    }),
    canAccessCompany: (context, companyId) => context.companyIds.includes(companyId),
    buildAuditPayload: (value) => value,
    getCredentials: () => ({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' }),
    sendGmail: async () => {
      sendCalls += 1;
      return { id: 'gmail-message-3', threadId: 'gmail-thread-3' };
    },
  });
  const request = {
    auth: { uid: 'employee-1' },
    data: {
      kind: 'maintenance_report',
      clientId: 'client-3',
      reportId: 'report-3',
      requestId: 'maintenance-report:client-3:report-3',
    },
  };

  const first = await handlers.sendSharedMaintenanceEmail(request);
  const second = await handlers.sendSharedMaintenanceEmail(request);

  assert.equal(first.status, 'sent');
  assert.equal(second.status, 'already_sent');
  assert.equal(sendCalls, 1);
});
