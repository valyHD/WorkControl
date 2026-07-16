const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');

const SHARED_GMAIL_SENDER = 'liftultau@gmail.com';
const SHARED_GMAIL_DISPLAY_NAME = 'Service si Mentenanta Lift';
const DISPATCH_LEASE_MS = 2 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const MAX_TEXT_LENGTH = 12_000;

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function assertEmail(value, HttpsError, label) {
  const email = cleanText(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('failed-precondition', `${label} nu are o adresa de email valida.`);
  }
  return email;
}

function sanitizeHeader(value) {
  return cleanText(value).replace(/[\r\n]+/g, ' ');
}

function encodeHeader(value) {
  const safe = sanitizeHeader(value);
  return /^[\x20-\x7E]*$/.test(safe)
    ? safe
    : `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

function wrapBase64(value) {
  return value.match(/.{1,76}/g)?.join('\r\n') || '';
}

function encodeRawMessage(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildRawMimeMessage(input) {
  const boundary = `workcontrol_${crypto.randomBytes(12).toString('hex')}`;
  const messageId = `<${input.dispatchId}@workcontrol-53b1d.firebaseapp.com>`;
  const lines = [
    `From: ${SHARED_GMAIL_DISPLAY_NAME} <${SHARED_GMAIL_SENDER}>`,
    `To: ${sanitizeHeader(input.to)}`,
    `Subject: ${encodeHeader(input.subject)}`,
    `Date: ${new Date(input.sentAt).toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(input.body, 'utf8').toString('base64')),
  ];

  for (const attachment of input.attachments || []) {
    const fileName = cleanText(attachment.fileName, 180).replace(/[^a-zA-Z0-9_.-]+/g, '-') || 'document';
    lines.push(
      `--${boundary}`,
      `Content-Type: ${sanitizeHeader(attachment.contentType || 'application/octet-stream')}; name="${fileName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${fileName}"`,
      '',
      wrapBase64(Buffer.from(attachment.content).toString('base64'))
    );
  }

  lines.push(`--${boundary}--`, '');
  return {
    raw: encodeRawMessage(lines.join('\r\n')),
    messageId,
  };
}

function normalizeLines(rawLines) {
  if (!Array.isArray(rawLines)) return [];
  return rawLines.slice(0, 100).map((line) => ({
    name: cleanText(line?.name, 240) || 'Piesa',
    code: cleanText(line?.code, 120),
    quantity: Math.max(1, Number(line?.quantity) || 1),
    unit: cleanText(line?.unit, 40) || 'buc',
    notes: cleanText(line?.notes, 500),
  }));
}

function buildPartsText(order) {
  return normalizeLines(order.lines)
    .map((line, index) => `${index + 1}. ${line.name}${line.code ? `, cod ${line.code}` : ''}, cantitate ${line.quantity} ${line.unit}${line.notes ? `, observatii: ${line.notes}` : ''}`)
    .join('\n');
}

function formatMoney(value) {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: 'RON',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function getOrderTitle(order) {
  return cleanText(order.title, 240) || [cleanText(order.clientName, 160), cleanText(order.liftSerialNumber, 100)].filter(Boolean).join(' - ') || 'Comanda piese';
}

function buildPartOrderEmail(order, target, HttpsError) {
  const title = getOrderTitle(order);
  if (target === 'supplier') {
    const recipient = assertEmail(order.supplierEmail || order.supplierContact, HttpsError, 'Furnizorul');
    return {
      recipient,
      subject: `Cerere oferta piese - ${title}`,
      body: [
        'Buna ziua,',
        '',
        'Va rog sa ne trimiteti oferta pentru urmatoarele piese:',
        '',
        buildPartsText(order),
        '',
        `Client/locatie: ${cleanText(order.clientName) || '-'}${cleanText(order.addressLabel) ? `, ${cleanText(order.addressLabel)}` : ''}`,
        `Lift/echipament: ${cleanText(order.liftSerialNumber) || '-'}`,
        cleanText(order.neededByDate) ? `Necesar pana la: ${cleanText(order.neededByDate)}` : '',
        cleanText(order.notes) ? `Observatii: ${cleanText(order.notes)}` : '',
        '',
        'Va multumesc.',
      ].filter(Boolean).join('\n'),
    };
  }

  if (target !== 'client') {
    throw new HttpsError('invalid-argument', 'Tipul emailului de piese nu este valid.');
  }

  const recipient = assertEmail(order.clientEmail, HttpsError, 'Clientul');
  const amount = Number(order.clientOfferAmount || order.supplierOfferAmount || order.totalEstimated || 0);
  return {
    recipient,
    subject: `Oferta piese - ${title}`,
    body: [
      'Buna ziua,',
      '',
      `Va transmitem oferta pentru piesele necesare la ${cleanText(order.liftSerialNumber) || 'echipamentul mentionat'}.`,
      '',
      buildPartsText(order),
      '',
      amount ? `Valoare oferta: ${formatMoney(amount)}` : '',
      cleanText(order.clientOfferNotes) ? `Observatii: ${cleanText(order.clientOfferNotes)}` : '',
      cleanText(order.addressLabel) ? `Locatie: ${cleanText(order.addressLabel)}` : '',
      '',
      'Va rugam sa ne confirmati daca aprobati oferta.',
      '',
      'Multumim.',
    ].filter(Boolean).join('\n'),
  };
}

function buildReportEmail(client, report, HttpsError) {
  const recipients = [
    ...(Array.isArray(client.emails) ? client.emails : []),
    client.email,
  ].map((value) => cleanText(value, 320).toLowerCase()).filter(Boolean);
  const recipientCandidate = recipients.find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  const recipient = assertEmail(recipientCandidate, HttpsError, 'Clientul');
  const label = cleanText(report.reportType) === 'interventie' ? 'interventie' : 'revizie';
  const dateText = cleanText(report.dateText, 80) || new Date(Number(report.createdAt) || Date.now()).toLocaleDateString('ro-RO');
  return {
    recipient,
    subject: `Raport ${label} ${dateText}${cleanText(report.timeText, 40) ? ` ${cleanText(report.timeText, 40)}` : ''}`,
    body: [
      'Buna ziua,',
      '',
      `Aveti atasat raportul de ${label} din data de ${dateText}.`,
      '',
      `Cu drag, echipa ${cleanText(client.maintenanceCompany, 160) || 'mentenanta'}`,
      '0314337006',
    ].join('\n'),
  };
}

function buildDispatchId(requestId) {
  return crypto.createHash('sha256').update(requestId).digest('hex');
}

async function getGmailAccessToken(credentials, HttpsError) {
  const clientId = cleanText(credentials.clientId, 400);
  const clientSecret = cleanText(credentials.clientSecret, 400);
  const refreshToken = cleanText(credentials.refreshToken, 2000);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new HttpsError('failed-precondition', 'Expeditorul Gmail comun nu este configurat complet.');
  }
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;
  if (!token) throw new HttpsError('unavailable', 'Gmail nu a returnat un token de acces.');
  return token;
}

async function defaultSendGmail({ credentials, raw, HttpsError }) {
  const accessToken = await getGmailAccessToken(credentials, HttpsError);
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok || !cleanText(responseBody.id, 240)) {
    throw new HttpsError('unavailable', 'Gmail nu a confirmat trimiterea mesajului.');
  }
  return { id: cleanText(responseBody.id, 240), threadId: cleanText(responseBody.threadId, 240) };
}

function createSharedGmailHandlers(dependencies) {
  const {
    db,
    bucket,
    FieldValue,
    HttpsError,
    logger,
    assertActiveInternalRequest,
    canAccessCompany,
    buildAuditPayload,
    getCredentials,
    sendGmail = defaultSendGmail,
  } = dependencies;

  async function loadAttachment(path, expectedPrefix, fileName, contentType) {
    const safePath = cleanText(path, 1000);
    if (!safePath || !safePath.startsWith(expectedPrefix)) {
      throw new HttpsError('failed-precondition', 'Fisierul raportului nu are o cale valida.');
    }
    const [content] = await bucket.file(safePath).download();
    return { content, fileName, contentType };
  }

  async function claimDispatch(dispatchRef, data) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(dispatchRef);
      const current = snap.exists ? snap.data() || {} : {};
      if (current.status === 'sent') {
        return { alreadySent: true, messageId: cleanText(current.gmailMessageId, 240) };
      }
      if (current.status === 'sending' && Number(current.leaseUntil || 0) > Date.now()) {
        throw new HttpsError('aborted', 'Emailul este deja in curs de trimitere.');
      }
      const now = Date.now();
      tx.set(dispatchRef, {
        ...data,
        status: 'sending',
        senderEmail: SHARED_GMAIL_SENDER,
        attempts: Number(current.attempts || 0) + 1,
        leaseUntil: now + DISPATCH_LEASE_MS,
        updatedAt: now,
        updatedAtServer: FieldValue.serverTimestamp(),
        ...(snap.exists ? {} : { createdAt: now, createdAtServer: FieldValue.serverTimestamp() }),
      }, { merge: true });
      return { alreadySent: false, messageId: '' };
    });
  }

  async function sendSharedMaintenanceEmail(request) {
    const actor = await assertActiveInternalRequest(request);
    const data = request.data || {};
    const kind = cleanText(data.kind, 80);
    const requestId = cleanText(data.requestId, 300);
    if (!requestId || !/^[a-zA-Z0-9:_.-]{8,300}$/.test(requestId)) {
      throw new HttpsError('invalid-argument', 'Identificatorul cererii de email nu este valid.');
    }

    const dispatchId = buildDispatchId(requestId);
    const dispatchRef = db.collection('sharedGmailDispatches').doc(dispatchId);
    let companyId = '';
    let entityId = '';
    let recipient = '';
    let subject = '';
    let body = '';
    let attachments = [];
    let sourceRef = null;
    let sourcePatch = {};
    let auditAction = '';
    let auditTitle = '';
    let auditPath = '';

    if (kind === 'maintenance_report') {
      const clientId = cleanText(data.clientId, 240);
      const reportId = cleanText(data.reportId, 240);
      if (!clientId || !reportId) throw new HttpsError('invalid-argument', 'Clientul si raportul sunt obligatorii.');
      const clientRef = db.collection('maintenanceClients').doc(clientId);
      const reportRef = clientRef.collection('rapoarte').doc(reportId);
      const [clientSnap, reportSnap] = await Promise.all([clientRef.get(), reportRef.get()]);
      if (!clientSnap.exists || !reportSnap.exists) throw new HttpsError('not-found', 'Raportul de mentenanta nu exista.');
      const client = clientSnap.data() || {};
      const report = reportSnap.data() || {};
      companyId = cleanText(report.companyId || client.companyId, 240);
      if (!companyId || !canAccessCompany(actor, companyId)) throw new HttpsError('permission-denied', 'Raportul nu apartine firmei utilizatorului.');
      const email = buildReportEmail(client, report, HttpsError);
      recipient = email.recipient;
      subject = email.subject;
      body = email.body;
      const prefix = `maintenance-reports/${clientId}/`;
      attachments.push(await loadAttachment(
        report.pdfPath,
        prefix,
        cleanText(report.fileName, 180) || `raport-${reportId}.pdf`,
        'application/pdf'
      ));
      const reportImages = Array.isArray(report.images) ? report.images.slice(0, 10) : [];
      for (const [index, image] of reportImages.entries()) {
        attachments.push(await loadAttachment(
          image?.path,
          prefix,
          cleanText(image?.name, 180) || `poza-${index + 1}.jpg`,
          cleanText(image?.contentType, 120) || 'image/jpeg'
        ));
      }
      sourceRef = reportRef;
      sourcePatch = {
        emailStatus: 'sent',
        emailSender: SHARED_GMAIL_SENDER,
        emailRecipient: recipient,
        emailSentAt: Date.now(),
        emailSentAtServer: FieldValue.serverTimestamp(),
        emailSentByUserId: actor.userSnap.id,
        emailSentByUserName: cleanText(actor.user.fullName || actor.user.displayName || actor.user.email, 240) || 'Utilizator',
      };
      entityId = `${clientId}/${reportId}`;
      auditAction = 'maintenance_report_email_sent';
      auditTitle = 'Raport mentenanta trimis prin Gmail';
      auditPath = `/maintenance/${clientId}`;
    } else if (kind === 'maintenance_part_supplier' || kind === 'maintenance_part_client') {
      const orderId = cleanText(data.orderId, 240);
      if (!orderId) throw new HttpsError('invalid-argument', 'Comanda de piese este obligatorie.');
      const orderRef = db.collection('maintenancePartOrders').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) throw new HttpsError('not-found', 'Comanda de piese nu exista.');
      const order = orderSnap.data() || {};
      companyId = cleanText(order.companyId, 240);
      if (!companyId || !canAccessCompany(actor, companyId)) throw new HttpsError('permission-denied', 'Comanda nu apartine firmei utilizatorului.');
      const target = kind === 'maintenance_part_supplier' ? 'supplier' : 'client';
      const email = buildPartOrderEmail(order, target, HttpsError);
      recipient = email.recipient;
      subject = email.subject;
      body = email.body;
      sourceRef = orderRef;
      const actorName = cleanText(actor.user.fullName || actor.user.displayName || actor.user.email, 240) || 'Utilizator';
      sourcePatch = target === 'supplier'
        ? {
            status: 'quote_requested',
            supplierEmailSentAt: Date.now(),
            supplierEmailSentAtServer: FieldValue.serverTimestamp(),
            supplierEmailSentByUserId: actor.userSnap.id,
            supplierEmailSentByUserName: actorName,
          }
        : {
            clientOfferEmailSentAt: Date.now(),
            clientOfferEmailSentAtServer: FieldValue.serverTimestamp(),
            clientOfferEmailSentByUserId: actor.userSnap.id,
            clientOfferEmailSentByUserName: actorName,
          };
      sourcePatch.emailSender = SHARED_GMAIL_SENDER;
      sourcePatch.updatedAt = Date.now();
      sourcePatch.updatedAtServer = FieldValue.serverTimestamp();
      entityId = orderId;
      auditAction = target === 'supplier' ? 'maintenance_part_supplier_email_sent' : 'maintenance_part_client_email_sent';
      auditTitle = target === 'supplier' ? 'Cerere oferta piese trimisa' : 'Oferta piese trimisa clientului';
      auditPath = '/maintenance/orders';
    } else {
      throw new HttpsError('invalid-argument', 'Tipul emailului WorkControl nu este permis.');
    }

    const totalAttachmentBytes = attachments.reduce((total, item) => total + item.content.length, 0);
    if (totalAttachmentBytes > MAX_ATTACHMENT_BYTES) {
      throw new HttpsError('resource-exhausted', 'Atasamentele depasesc limita de 18 MB.');
    }

    const claim = await claimDispatch(dispatchRef, {
      requestId,
      kind,
      companyId,
      entityId,
      actorUserId: actor.userSnap.id,
      recipient,
    });
    if (claim.alreadySent) {
      return { status: 'already_sent', senderEmail: SHARED_GMAIL_SENDER, messageId: claim.messageId };
    }

    try {
      const mime = buildRawMimeMessage({
        dispatchId,
        to: recipient,
        subject,
        body,
        attachments,
        sentAt: Date.now(),
      });
      const gmailResult = await sendGmail({
        credentials: getCredentials(),
        raw: mime.raw,
        HttpsError,
      });
      const batch = db.batch();
      batch.set(sourceRef, { ...sourcePatch, gmailMessageId: gmailResult.id }, { merge: true });
      batch.set(dispatchRef, {
        status: 'sent',
        gmailMessageId: gmailResult.id,
        gmailThreadId: gmailResult.threadId || '',
        leaseUntil: 0,
        sentAt: Date.now(),
        updatedAt: Date.now(),
        updatedAtServer: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(db.collection('auditLogs').doc(), buildAuditPayload({
        companyId,
        category: 'maintenance',
        action: auditAction,
        title: auditTitle,
        message: `${auditTitle} din ${SHARED_GMAIL_SENDER}.`,
        actorUserId: actor.userSnap.id,
        actorUserName: cleanText(actor.user.fullName || actor.user.displayName || actor.user.email, 240) || 'Utilizator',
        entityId,
        path: auditPath,
        pageTitle: 'Mentenanta',
        metadata: { senderEmail: SHARED_GMAIL_SENDER, recipient, kind },
      }));
      await batch.commit();
      return { status: 'sent', senderEmail: SHARED_GMAIL_SENDER, messageId: gmailResult.id };
    } catch (error) {
      logger.error('Shared Gmail send failed', {
        kind,
        entityId,
        actorUserId: actor.userSnap.id,
        errorCode: cleanText(error?.code, 120),
      });
      await dispatchRef.set({
        status: 'failed',
        leaseUntil: 0,
        updatedAt: Date.now(),
        updatedAtServer: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'Emailul nu a putut fi trimis prin Gmail.');
    }
  }

  return { sendSharedMaintenanceEmail };
}

module.exports = {
  SHARED_GMAIL_DISPLAY_NAME,
  SHARED_GMAIL_SENDER,
  buildPartOrderEmail,
  buildRawMimeMessage,
  buildReportEmail,
  createSharedGmailHandlers,
};
