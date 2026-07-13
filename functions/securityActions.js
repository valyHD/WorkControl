const crypto = require('node:crypto');

const INTERNAL_ROLES = new Set(['admin', 'manager', 'angajat']);
const NOTIFICATION_MODULES = new Set([
  'tools', 'vehicles', 'timesheets', 'leave', 'users', 'projects',
  'notifications', 'maintenance', 'expenses', 'web', 'server', 'system',
  'backup', 'general',
]);
const ALLOWED_NOTIFICATION_EVENTS = new Set([
  'user_site_entered', 'user_updated', 'user_role_changed', 'user_activation_changed',
  'vehicle_created', 'vehicle_updated', 'vehicle_status_changed', 'vehicle_images_updated',
  'vehicle_documents_updated', 'vehicle_document_deleted', 'vehicle_cover_changed',
  'vehicle_image_deleted', 'vehicle_deleted', 'vehicle_driver_changed', 'vehicle_driver_removed',
  'vehicle_started', 'vehicle_block_start_requested', 'vehicle_command_requested',
  'vehicle_service_due_soon', 'vehicle_oil_service_due_soon', 'vehicle_itp_due_soon',
  'vehicle_rca_due_soon', 'vehicle_casco_due_soon', 'vehicle_rovinieta_due_soon',
  'vehicle_document_itp_due_soon', 'vehicle_document_rca_due_soon',
  'vehicle_document_casco_due_soon', 'vehicle_document_rovinieta_due_soon',
  'tool_created', 'tool_updated', 'tool_status_changed', 'tool_images_updated',
  'tool_cover_changed', 'tool_image_deleted', 'tool_deleted', 'tool_holder_changed', 'tool_claimed',
  'project_created', 'project_updated', 'project_status_changed', 'project_deleted',
  'timesheet_started', 'timesheet_stopped', 'timesheet_deleted',
  'leave_request_submitted', 'leave_request_approved', 'leave_request_rejected',
  'leave_request_deleted',
  'expense_document_created', 'expense_document_updated', 'expense_document_deleted',
  'expense_reimbursable_created', 'expense_invoice_created',
  'maintenance_client_created', 'maintenance_client_updated', 'maintenance_client_deleted',
  'maintenance_lift_updated', 'maintenance_branding_updated', 'maintenance_report_created',
  'maintenance_part_order_created', 'maintenance_part_order_updated',
  'maintenance_part_order_status_changed', 'maintenance_part_order_deleted',
  'notification_rule_created', 'notification_rule_updated', 'notification_rule_deleted',
  'control_panel_settings_updated', 'backup_requested', 'backup_completed', 'backup_failed',
  'data_retention_cleanup',
]);
const EMPLOYEE_NOTIFICATION_EVENTS = new Set([
  'user_site_entered',
  'vehicle_updated', 'vehicle_images_updated', 'vehicle_cover_changed',
  'vehicle_image_deleted', 'vehicle_driver_changed', 'vehicle_driver_removed',
  'tool_updated', 'tool_images_updated', 'tool_cover_changed', 'tool_image_deleted',
  'tool_holder_changed', 'tool_claimed',
  'timesheet_started', 'timesheet_stopped',
  'leave_request_submitted', 'leave_request_deleted',
  'expense_document_created', 'expense_reimbursable_created', 'expense_invoice_created',
]);
const GLOBAL_ADMIN_NOTIFICATION_MODULES = new Set(['backup', 'system', 'server', 'web']);
const ENTITY_REQUIRED_NOTIFICATION_PREFIXES = [
  'user_', 'vehicle_', 'tool_', 'project_', 'timesheet_', 'leave_request_',
  'expense_', 'maintenance_client_', 'maintenance_part_order_', 'maintenance_report_',
  'notification_rule_',
];
const NOTIFICATION_EVENT_MODULES = [
  ['user_', 'users'],
  ['vehicle_', 'vehicles'],
  ['tool_', 'tools'],
  ['project_', 'projects'],
  ['timesheet_', 'timesheets'],
  ['leave_request_', 'leave'],
  ['expense_', 'expenses'],
  ['maintenance_', 'maintenance'],
  ['notification_', 'notifications'],
  ['backup_', 'backup'],
  ['control_panel_', 'system'],
  ['data_retention_', 'system'],
];
const AUDIT_CATEGORIES = new Set([
  'auth', 'users', 'vehicles', 'tools', 'timesheets', 'leave', 'projects',
  'maintenance', 'expenses', 'notifications', 'backup', 'system', 'assistant',
  'navigation', 'web', 'server', 'general',
]);
const CLIENT_AUDIT_ACTIONS = new Set([
  'site_entered', 'page_view', 'notification_read',
]);
const MAX_NOTIFICATION_PAYLOAD_BYTES = 8 * 1024;
const NOTIFICATION_WINDOW_MS = 60 * 1000;
const NOTIFICATION_MAX_PER_WINDOW = 20;
const ALLOWED_VEHICLE_COMMANDS = new Set(['pulse_dout1', 'allow_start', 'block_start']);

function cleanText(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function cleanStringList(value, maxItems = 30) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 120)).filter(Boolean))].slice(0, maxItems);
}

function cleanMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).slice(0, 20).forEach(([key, raw]) => {
    const safeKey = cleanText(key, 60);
    if (!safeKey) return;
    if (typeof raw === 'string') result[safeKey] = cleanText(raw, 500);
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[safeKey] = raw;
    else if (typeof raw === 'boolean' || raw === null) result[safeKey] = raw;
    else if (Array.isArray(raw)) {
      result[safeKey] = raw.slice(0, 20).map((item) => cleanText(item, 200));
    }
  });
  return result;
}

function cleanSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).slice(0, 30).forEach(([key, raw]) => {
    const safeKey = cleanText(key, 60);
    if (!safeKey || ['tracker', 'trackerConfig', 'rawIo', 'password', 'token'].includes(safeKey)) return;
    if (typeof raw === 'string') result[safeKey] = cleanText(raw, 500);
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[safeKey] = raw;
    else if (typeof raw === 'boolean' || raw === null) result[safeKey] = raw;
  });
  return result;
}

function normalizeLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { lat: null, lng: null, label: '' };
  }
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  return {
    lat: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
    lng: Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : null,
    label: cleanText(value.label, 240),
  };
}

function getBucharestDateParts(nowMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(new Date(nowMs)).map((part) => [part.type, part.value])
  );
  const workDate = `${parts.year}-${parts.month}-${parts.day}`;
  const date = new Date(`${workDate}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return {
    workDate,
    yearMonth: `${parts.year}-${parts.month}`,
    weekKey: `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
  };
}

function userCompanyIds(data) {
  const primary = cleanText(data.primaryCompanyId, 120);
  const ids = cleanStringList(data.companyIds);
  if (primary && !ids.includes(primary)) ids.unshift(primary);
  return ids;
}

function isGlobalAdmin(actor) {
  return actor.role === 'admin' && actor.globalAdmin === true;
}

function canAccessCompany(actor, companyId) {
  return isGlobalAdmin(actor) || (companyId && actor.companyIds.includes(companyId));
}

function canManageCompany(actor, companyId) {
  return (
    isGlobalAdmin(actor) ||
    ((actor.role === 'admin' || actor.role === 'manager') && canAccessCompany(actor, companyId))
  );
}

async function loadActor(db, uid, HttpsError) {
  if (!uid) throw new HttpsError('unauthenticated', 'Trebuie sa fii autentificat.');
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Profil intern inexistent.');
  const data = snap.data() || {};
  if (data.active !== true || cleanText(data.accessStatus, 32) !== 'active') {
    throw new HttpsError('permission-denied', 'Contul intern nu este activ.');
  }
  const role = cleanText(data.role, 32);
  if (!INTERNAL_ROLES.has(role)) {
    throw new HttpsError('permission-denied', 'Rol intern invalid.');
  }
  return {
    uid,
    role,
    globalAdmin: data.globalAdmin === true,
    companyIds: userCompanyIds(data),
    primaryCompanyId: cleanText(data.primaryCompanyId, 120),
    fullName: cleanText(data.fullName || data.email || uid, 160),
    email: cleanText(data.email, 240),
    themeKey: data.themeKey || null,
    ref: snap.ref,
    data,
  };
}

function requireCompany(actor, requestedCompanyId, HttpsError) {
  const companyId = cleanText(requestedCompanyId || actor.primaryCompanyId, 120);
  if (!companyId || !canAccessCompany(actor, companyId)) {
    throw new HttpsError('permission-denied', 'Firma nu este permisa pentru acest cont.');
  }
  return companyId;
}

function buildAuditPayload(fieldValue, actor, input) {
  const metadata = cleanMetadata(input.metadata);
  const companyId = cleanText(input.companyId || actor.primaryCompanyId, 120);
  return {
    companyId,
    category: AUDIT_CATEGORIES.has(cleanText(input.category, 60))
      ? cleanText(input.category, 60)
      : 'general',
    action: cleanText(input.action, 100),
    title: cleanText(input.title, 160),
    message: cleanText(input.message, 1000),
    actorUserId: actor.uid,
    actorUserName: actor.fullName,
    actorUserThemeKey: actor.themeKey || null,
    targetUserId: cleanText(input.targetUserId, 128),
    targetUserName: cleanText(input.targetUserName, 160),
    entityId: cleanText(input.entityId, 160),
    entityLabel: cleanText(input.entityLabel, 240),
    path: cleanText(input.path, 240),
    pageTitle: cleanText(input.pageTitle, 120),
    metadata,
    before: cleanSnapshot(input.before),
    after: cleanSnapshot(input.after),
    createdAt: Date.now(),
    createdAtServer: fieldValue.serverTimestamp(),
  };
}

async function resolveEntity(db, moduleName, entityId) {
  if (!entityId) return null;
  const collectionByModule = {
    users: 'users',
    vehicles: 'vehicles',
    tools: 'tools',
    timesheets: 'timesheets',
    leave: 'leaveRequests',
    projects: 'projects',
    maintenance: 'maintenanceClients',
    expenses: 'expenseDocuments',
    notifications: 'notifications',
  };
  const collectionName = collectionByModule[moduleName];
  if (!collectionName) return null;
  const snap = await db.collection(collectionName).doc(entityId).get();
  return snap.exists ? { id: snap.id, ref: snap.ref, data: snap.data() || {} } : null;
}

function buildClientAuditPresentation(actor, input, entity) {
  const action = cleanText(input.action, 100);
  if (action === 'site_entered') {
    return {
      category: 'auth',
      title: 'Intrare pe site',
      message: `${actor.fullName} a intrat in WorkControl.`,
      path: '/dashboard',
      pageTitle: 'WorkControl',
    };
  }
  if (action === 'page_view') {
    const path = cleanText(input.path, 240).startsWith('/') ? cleanText(input.path, 240) : '/';
    const pageTitle = cleanText(input.pageTitle, 120) || 'Pagina WorkControl';
    return {
      category: 'navigation',
      title: 'Pagina accesata',
      message: `${actor.fullName} a accesat ${pageTitle}.`,
      path,
      pageTitle,
    };
  }
  const notificationTitle = cleanText(entity?.data?.title, 160) || 'notificarea selectata';
  return {
    category: 'notifications',
    title: 'Notificare citita',
    message: `${actor.fullName} a citit notificarea ${notificationTitle}.`,
    path: '/notifications',
    pageTitle: 'Notificari',
  };
}

function buildControlledNotificationPresentation(actor, eventType, entity) {
  const entityLabel = cleanText(
    entity?.data?.plateNumber || entity?.data?.name || entity?.data?.fullName ||
      entity?.data?.supplierName || entity?.id,
    160
  );
  const eventLabel = cleanText(eventType.replaceAll('_', ' '), 100);
  return {
    title: 'Actualizare WorkControl',
    message: `${actor.fullName} a generat evenimentul ${eventLabel}${entityLabel ? ` pentru ${entityLabel}` : ''}.`,
  };
}

async function resolveNotificationEntity(db, moduleName, eventType, entityId) {
  if (!entityId) return null;
  const eventCollections = [
    eventType.startsWith('maintenance_part_order_') ? 'maintenancePartOrders' : '',
    eventType.startsWith('maintenance_report_') ? 'maintenanceReports' : '',
    eventType.startsWith('notification_rule_') ? 'notificationRules' : '',
  ].filter(Boolean);
  for (const collectionName of eventCollections) {
    const snap = await db.collection(collectionName).doc(entityId).get();
    if (snap.exists) return { id: snap.id, ref: snap.ref, data: snap.data() || {} };
  }
  return resolveEntity(db, moduleName, entityId);
}

function relatedUserIds(entity) {
  if (!entity) return [];
  const data = entity.data || {};
  return cleanStringList([
    data.uid,
    data.userId,
    data.ownerUserId,
    data.currentDriverUserId,
    data.pendingDriverUserId,
    data.currentHolderUserId,
    data.pendingHolderUserId,
    data.uploadedByUserId,
    data.assignedUserId,
    data.requestedByUserId,
    data.notifyUserId,
  ]);
}

async function enforceNotificationRateLimit(db, actor, fieldValue, HttpsError) {
  const ref = db.collection('notificationDispatchLimits').doc(actor.uid);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const windowStartedAt = Number(data.windowStartedAt || 0);
    const count = now - windowStartedAt < NOTIFICATION_WINDOW_MS ? Number(data.count || 0) : 0;
    if (count >= NOTIFICATION_MAX_PER_WINDOW) {
      throw new HttpsError('resource-exhausted', 'Prea multe notificari intr-un interval scurt.');
    }
    tx.set(ref, {
      companyId: actor.primaryCompanyId || '',
      windowStartedAt: count === 0 ? now : windowStartedAt,
      count: count + 1,
      updatedAt: now,
      updatedAtServer: fieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

function notificationPath(input) {
  if (cleanText(input.notificationPath, 240).startsWith('/')) return cleanText(input.notificationPath, 240);
  if (input.module === 'vehicles' && input.entityId) return `/vehicles/${input.entityId}`;
  if (input.module === 'tools' && input.entityId) return `/tools/${input.entityId}`;
  if (input.module === 'timesheets') return '/my-timesheets';
  if (input.module === 'leave') return '/my-leave';
  if (input.module === 'maintenance') return '/maintenance';
  if (input.module === 'expenses') return '/expenses/scan';
  if (input.module === 'projects') return '/projects';
  if (input.module === 'users') return '/users';
  return '/notifications';
}

function createSecurityHandlers({ db, authAdmin, fieldValue, HttpsError, logger }) {
  async function adminCreateUser(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    if (actor.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Doar administratorii pot crea utilizatori.');
    }

    const input = request.data || {};
    const fullName = cleanText(input.fullName, 160);
    const email = cleanText(input.email, 240).toLowerCase();
    const password = String(input.password || '');
    const role = cleanText(input.role || 'angajat', 32);
    const companyId = requireCompany(actor, input.companyId, HttpsError);
    if (!fullName || !/^\S+@\S+\.\S+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'Numele si emailul sunt obligatorii.');
    }
    if (password.length < 8 || password.length > 128) {
      throw new HttpsError('invalid-argument', 'Parola trebuie sa aiba intre 8 si 128 caractere.');
    }
    if (!INTERNAL_ROLES.has(role)) {
      throw new HttpsError('invalid-argument', 'Rol invalid.');
    }
    if ((role === 'admin' || input.globalAdmin === true) && !isGlobalAdmin(actor)) {
      throw new HttpsError('permission-denied', 'Numai adminul global poate crea alti administratori.');
    }

    let createdUser;
    try {
      createdUser = await authAdmin.createUser({ email, password, displayName: fullName, disabled: false });
      await db.runTransaction(async (tx) => {
        const userRef = db.collection('users').doc(createdUser.uid);
        tx.create(userRef, {
          uid: createdUser.uid,
          fullName,
          email,
          role,
          active: true,
          accessStatus: 'active',
          globalAdmin: role === 'admin' && input.globalAdmin === true,
          companyId,
          primaryCompanyId: companyId,
          companyIds: [companyId],
          roleTitle: cleanText(input.roleTitle, 120),
          department: cleanText(input.department, 120),
          themeKey: cleanText(input.themeKey, 60) || null,
          createdByUserId: actor.uid,
          createdAt: Date.now(),
          createdAtServer: fieldValue.serverTimestamp(),
        });
        tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
          companyId,
          category: 'users',
          action: 'user_created',
          title: 'Utilizator creat',
          message: `A fost creat utilizatorul ${fullName}.`,
          targetUserId: createdUser.uid,
          targetUserName: fullName,
          entityId: createdUser.uid,
        }));
      });
    } catch (error) {
      if (createdUser?.uid) await authAdmin.deleteUser(createdUser.uid).catch(() => undefined);
      if (error instanceof HttpsError) throw error;
      logger.error('[adminCreateUser]', { code: cleanText(error?.code, 80) });
      throw new HttpsError('internal', 'Utilizatorul nu a putut fi creat.');
    }
    return { userId: createdUser.uid };
  }

  async function setPrimaryCompany(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const companyId = cleanText(request.data?.companyId, 120);
    if (!companyId || !actor.companyIds.includes(companyId)) {
      throw new HttpsError('permission-denied', 'Firma principala trebuie sa fie deja asignata contului.');
    }
    const companySnap = await db.collection('firmeMentenanta').doc(companyId).get();
    if (!companySnap.exists) throw new HttpsError('not-found', 'Firma nu exista.');
    const companyName = cleanText(
      companySnap.get('companyName') || companySnap.get('name') || companyId,
      160
    );
    const userRef = db.collection('users').doc(actor.uid);
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new HttpsError('not-found', 'Profilul intern nu exista.');
      const before = userSnap.data() || {};
      const after = { primaryCompanyId: companyId, primaryCompanyName: companyName };
      tx.update(userRef, {
        ...after,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'users',
        action: 'user_primary_company_updated',
        title: 'Firma principala actualizata',
        message: `${actor.fullName} a selectat firma principala ${companyName}.`,
        entityId: actor.uid,
        targetUserId: actor.uid,
        before,
        after,
      }));
    });
    return { companyId, companyName };
  }

  async function assignUsersToCompany(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const companyId = cleanText(request.data?.companyId, 120);
    if (actor.role !== 'admin' || !canAccessCompany(actor, companyId)) {
      throw new HttpsError('permission-denied', 'Doar administratorii firmei pot asigna utilizatori.');
    }
    const userIds = cleanStringList(request.data?.userIds, 100);
    const companySnap = await db.collection('firmeMentenanta').doc(companyId).get();
    if (!companySnap.exists) throw new HttpsError('not-found', 'Firma nu exista.');
    const companyName = cleanText(
      companySnap.get('companyName') || companySnap.get('name') || companyId,
      160
    );
    const userSnaps = await Promise.all(userIds.map((uid) => db.collection('users').doc(uid).get()));
    if (userSnaps.some((snap) => !snap.exists)) {
      throw new HttpsError('not-found', 'Unul dintre utilizatori nu exista.');
    }
    if (!actor.globalAdmin && userSnaps.some((snap) => {
      const ids = userCompanyIds(snap.data() || {});
      return ids.length > 0 && !ids.includes(companyId);
    })) {
      throw new HttpsError('permission-denied', 'Un administrator local nu poate importa utilizatori din alta firma.');
    }
    const batch = db.batch();
    userSnaps.forEach((snap) => {
      batch.update(snap.ref, {
        companyIds: fieldValue.arrayUnion(companyId),
        companyNames: fieldValue.arrayUnion(companyName),
        primaryCompanyId: companyId,
        primaryCompanyName: companyName,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
    });
    batch.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
      companyId,
      category: 'users',
      action: 'company_users_assigned',
      title: 'Utilizatori asignati firmei',
      message: `${userIds.length} utilizatori au fost asignati firmei ${companyName}.`,
      entityId: companyId,
      metadata: { userCount: userIds.length },
    }));
    await batch.commit();
    return { companyId, assignedCount: userIds.length };
  }

  async function recordAuditEvent(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const input = request.data || {};
    const category = cleanText(input.category, 60);
    const action = cleanText(input.action, 100);
    if (!AUDIT_CATEGORIES.has(category) || !CLIENT_AUDIT_ACTIONS.has(action)) {
      throw new HttpsError('invalid-argument', 'Eveniment audit invalid.');
    }
    const entity = await resolveEntity(db, category, cleanText(input.entityId, 160));
    if (action === 'notification_read') {
      if (!entity || cleanText(entity.data.userId, 128) !== actor.uid) {
        throw new HttpsError('permission-denied', 'Notificarea nu apartine utilizatorului curent.');
      }
    }
    const companyId = cleanText(entity?.data?.companyId || input.companyId || actor.primaryCompanyId, 120);
    if (!canAccessCompany(actor, companyId)) {
      throw new HttpsError('permission-denied', 'Evenimentul nu apartine firmei curente.');
    }
    const presentation = buildClientAuditPresentation(actor, input, entity);
    const auditRef = db.collection('auditLogs').doc();
    await auditRef.set(buildAuditPayload(fieldValue, actor, {
      ...presentation,
      action,
      companyId,
      entityId: entity?.id || '',
      entityLabel: cleanText(entity?.data?.title, 160),
      before: undefined,
      after: undefined,
    }));
    return { auditId: auditRef.id };
  }

  async function dispatchNotificationEvent(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const input = request.data || {};
    const moduleName = cleanText(input.module, 60);
    const eventType = cleanText(input.eventType, 100);
    if (!NOTIFICATION_MODULES.has(moduleName) || !ALLOWED_NOTIFICATION_EVENTS.has(eventType)) {
      throw new HttpsError('invalid-argument', 'Tipul notificarii nu este permis.');
    }
    const expectedModule = NOTIFICATION_EVENT_MODULES.find(([prefix]) => eventType.startsWith(prefix))?.[1];
    if (expectedModule && expectedModule !== moduleName) {
      throw new HttpsError('invalid-argument', 'Evenimentul nu corespunde modulului selectat.');
    }
    if (GLOBAL_ADMIN_NOTIFICATION_MODULES.has(moduleName) && !isGlobalAdmin(actor)) {
      throw new HttpsError('permission-denied', 'Evenimentele de sistem necesita administrator global.');
    }
    if (actor.role === 'angajat' && !EMPLOYEE_NOTIFICATION_EVENTS.has(eventType)) {
      throw new HttpsError('permission-denied', 'Evenimentul nu este permis angajatului.');
    }
    const payloadSize = Buffer.byteLength(JSON.stringify(input), 'utf8');
    if (payloadSize > MAX_NOTIFICATION_PAYLOAD_BYTES) {
      throw new HttpsError('invalid-argument', 'Payload-ul notificarii este prea mare.');
    }
    const entityId = cleanText(input.entityId, 160);
    const entity = await resolveNotificationEntity(db, moduleName, eventType, entityId);
    const requiresEntity = ENTITY_REQUIRED_NOTIFICATION_PREFIXES.some((prefix) => eventType.startsWith(prefix));
    if (requiresEntity && (!entityId || !entity)) {
      throw new HttpsError('permission-denied', 'Resursa notificarii nu poate fi verificata.');
    }
    const companyId = cleanText(entity?.data?.companyId || input.companyId || actor.primaryCompanyId, 120);
    if (!companyId || !canAccessCompany(actor, companyId)) {
      throw new HttpsError('permission-denied', 'Notificarea nu apartine firmei curente.');
    }
    if (entity && actor.role === 'angajat') {
      const related = relatedUserIds(entity);
      if (!related.includes(actor.uid)) {
        throw new HttpsError('permission-denied', 'Nu poti emite notificari pentru aceasta resursa.');
      }
    }
    const controlledPresentation = requiresEntity || actor.role === 'angajat'
      ? buildControlledNotificationPresentation(actor, eventType, entity)
      : null;
    const title = controlledPresentation?.title || cleanText(input.title, 120);
    const message = controlledPresentation?.message || cleanText(input.message, 600);
    if (!title || !message) throw new HttpsError('invalid-argument', 'Titlul si mesajul sunt obligatorii.');

    await enforceNotificationRateLimit(db, actor, fieldValue, HttpsError);

    const requestedRecipients = cleanStringList([input.directUserId, input.ownerUserId]);
    const rulesSnap = await db.collection('notificationRules')
      .where('companyId', '==', companyId)
      .where('enabled', '==', true)
      .get();
    const usersSnap = await db.collection('users').where('companyIds', 'array-contains', companyId).get();
    const users = new Map(usersSnap.docs.map((snap) => [snap.id, snap.data() || {}]));
    const allowedRelated = new Set([actor.uid, ...relatedUserIds(entity)]);
    const recipients = new Set();

    requestedRecipients.forEach((uid) => {
      if (!users.has(uid)) return;
      if (actor.role === 'angajat' && !allowedRelated.has(uid)) return;
      recipients.add(uid);
    });

    rulesSnap.docs.forEach((ruleDoc) => {
      const rule = ruleDoc.data() || {};
      const ruleCompanyId = cleanText(rule.companyId, 120);
      if (ruleCompanyId && ruleCompanyId !== companyId) return;
      if (![moduleName, 'general', 'system'].includes(cleanText(rule.module, 60))) return;
      if (![eventType, 'any_change'].includes(cleanText(rule.eventType, 100))) return;
      const configured = rule.recipients || {};
      if (configured.notifyDirectUser && input.directUserId) recipients.add(cleanText(input.directUserId, 128));
      if (configured.notifyOwner && input.ownerUserId) recipients.add(cleanText(input.ownerUserId, 128));
      if (configured.notifyAdmins || configured.notifyManagers) {
        users.forEach((user, uid) => {
          if (user.active !== true || cleanText(user.accessStatus, 32) !== 'active') return;
          if (configured.notifyAdmins && user.role === 'admin') recipients.add(uid);
          if (configured.notifyManagers && user.role === 'manager') recipients.add(uid);
        });
      }
      cleanStringList(configured.specificUserIds).forEach((uid) => recipients.add(uid));
    });

    const finalRecipients = [...recipients].filter((uid) => {
      const recipient = users.get(uid);
      if (!recipient || recipient.active !== true || cleanText(recipient.accessStatus, 32) !== 'active') return false;
      if (actor.role !== 'angajat') return true;
      return allowedRelated.has(uid) || recipient.role === 'manager' || recipient.role === 'admin';
    }).slice(0, 50);

    const idempotencyKey = cleanText(input.idempotencyKey, 100) || crypto
      .createHash('sha256')
      .update(`${actor.uid}:${moduleName}:${eventType}:${entityId}:${Math.floor(Date.now() / 15000)}`)
      .digest('hex');
    const markerRef = db.collection('notificationDispatchMarkers').doc(idempotencyKey);
    const duplicate = await db.runTransaction(async (tx) => {
      const marker = await tx.get(markerRef);
      if (marker.exists) return true;
      const now = Date.now();
      finalRecipients.forEach((uid) => {
        const user = users.get(uid) || {};
        tx.create(db.collection('notifications').doc(), {
          companyId,
          userId: uid,
          targetUserThemeKey: user.themeKey || null,
          actorUserId: actor.uid,
          actorUserName: actor.fullName,
          actorUserThemeKey: actor.themeKey || null,
          title,
          message,
          module: moduleName,
          eventType,
          entityId,
          notificationPath: notificationPath(input),
          soundEnabled: input.soundEnabled !== false,
          read: false,
          createdAt: now,
          createdAtServer: fieldValue.serverTimestamp(),
        });
      });
      tx.create(markerRef, {
        companyId,
        actorUserId: actor.uid,
        recipientCount: finalRecipients.length,
        createdAt: now,
        expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        createdAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'notifications',
        action: eventType,
        title,
        message,
        entityId,
        metadata: { recipientCount: finalRecipients.length, module: moduleName },
      }));
      return false;
    });

    return { delivered: duplicate ? 0 : finalRecipients.length, duplicate };
  }

  async function startTimesheet(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const input = request.data || {};
    const companyId = requireCompany(actor, input.companyId, HttpsError);
    const projectId = cleanText(input.projectId, 160);
    if (!projectId) throw new HttpsError('invalid-argument', 'Proiectul este obligatoriu.');
    const projectSnap = await db.collection('projects').doc(projectId).get();
    if (!projectSnap.exists || cleanText(projectSnap.get('companyId'), 120) !== companyId) {
      throw new HttpsError('permission-denied', 'Proiectul nu apartine firmei curente.');
    }

    const preexisting = await db.collection('timesheets')
      .where('userId', '==', actor.uid)
      .where('status', '==', 'activ')
      .limit(1)
      .get();
    const lockRef = db.collection('activeTimesheets').doc(actor.uid);
    const createdRef = db.collection('timesheets').doc();
    const now = Number.isFinite(Number(input.occurredAt))
      ? Math.min(Date.now(), Math.max(Date.now() - 24 * 60 * 60 * 1000, Number(input.occurredAt)))
      : Date.now();
    const parts = getBucharestDateParts(now);
    const project = projectSnap.data() || {};

    return db.runTransaction(async (tx) => {
      const lock = await tx.get(lockRef);
      if (lock.exists) {
        const activeId = cleanText(lock.get('timesheetId'), 160);
        if (activeId) {
          const activeSnap = await tx.get(db.collection('timesheets').doc(activeId));
          if (activeSnap.exists && activeSnap.get('status') === 'activ') {
            return { timesheetId: activeId, duplicate: true };
          }
        }
      }
      if (!preexisting.empty) {
        const activeId = preexisting.docs[0].id;
        tx.set(lockRef, {
          companyId,
          userId: actor.uid,
          timesheetId: activeId,
          updatedAt: Date.now(),
          updatedAtServer: fieldValue.serverTimestamp(),
        });
        return { timesheetId: activeId, duplicate: true };
      }

      const startExplanation = cleanText(input.startExplanation, 1000);
      const startPolicyFlag = cleanText(input.startPolicyFlag, 80);
      const data = {
        companyId,
        userId: actor.uid,
        userName: actor.fullName,
        userThemeKey: actor.themeKey || null,
        projectId,
        projectCode: cleanText(project.code, 80),
        projectName: cleanText(project.name, 160),
        status: 'activ',
        explanation: startExplanation,
        startExplanation,
        stopExplanation: '',
        startPolicyFlag,
        stopPolicyFlag: '',
        startExpectedTime: cleanText(input.startExpectedTime, 20),
        stopExpectedMinutes: null,
        startAt: now,
        stopAt: null,
        workedMinutes: 0,
        startLocation: normalizeLocation(input.startLocation),
        stopLocation: null,
        startSource: cleanText(input.startSource, 20) === 'android' ? 'android' : 'web',
        stopSource: '',
        workDate: parts.workDate,
        yearMonth: parts.yearMonth,
        weekKey: parts.weekKey,
        createdAt: now,
        updatedAt: now,
        createdAtServer: fieldValue.serverTimestamp(),
        updatedAtServer: fieldValue.serverTimestamp(),
      };
      tx.create(createdRef, data);
      tx.set(lockRef, {
        companyId,
        userId: actor.uid,
        timesheetId: createdRef.id,
        updatedAt: now,
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'timesheets',
        action: 'timesheet_started',
        title: 'Pontaj pornit',
        message: `Pontaj pornit pe ${data.projectName || data.projectCode}.`,
        entityId: createdRef.id,
      }));
      return { timesheetId: createdRef.id, duplicate: false };
    });
  }

  async function stopTimesheet(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const input = request.data || {};
    const timesheetId = cleanText(input.timesheetId, 160);
    if (!timesheetId) throw new HttpsError('invalid-argument', 'Pontaj invalid.');
    const ref = db.collection('timesheets').doc(timesheetId);
    const lockRef = db.collection('activeTimesheets').doc(actor.uid);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'Pontajul nu exista.');
      const data = snap.data() || {};
      if (cleanText(data.userId, 160) !== actor.uid) {
        throw new HttpsError('permission-denied', 'Poti opri numai pontajul propriu.');
      }
      const companyId = cleanText(data.companyId, 120);
      if (!canAccessCompany(actor, companyId)) {
        throw new HttpsError('permission-denied', 'Pontajul nu apartine firmei curente.');
      }
      if (data.status !== 'activ') return { timesheetId, duplicate: true };
      const startAt = Number(data.startAt);
      if (!Number.isFinite(startAt) || startAt <= 0) {
        throw new HttpsError('failed-precondition', 'Pontajul nu are o ora valida de start.');
      }
      const occurredAt = Number(input.occurredAt);
      const stopAt = Number.isFinite(occurredAt)
        ? Math.max(startAt, Math.min(Date.now(), occurredAt))
        : Date.now();
      const workedMinutes = Math.max(1, Math.round((stopAt - startAt) / 60000));
      const status = workedMinutes < 8 * 60 || workedMinutes > 9 * 60 ? 'corectat' : 'inchis';
      const stopExplanation = cleanText(input.stopExplanation || input.explanation, 1000);
      tx.update(ref, {
        stopAt,
        workedMinutes,
        stopLocation: normalizeLocation(input.stopLocation),
        stopSource: cleanText(input.stopSource, 20) === 'android' ? 'android' : 'web',
        stopExplanation,
        stopPolicyFlag: cleanText(input.stopPolicyFlag, 80),
        stopExpectedMinutes: Number.isFinite(Number(input.stopExpectedMinutes))
          ? Number(input.stopExpectedMinutes)
          : null,
        explanation: [cleanText(data.startExplanation, 1000), stopExplanation].filter(Boolean).join('\n\n'),
        status,
        updatedAt: stopAt,
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.delete(lockRef);
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'timesheets',
        action: 'timesheet_stopped',
        title: 'Pontaj oprit',
        message: `Pontaj oprit dupa ${workedMinutes} minute.`,
        entityId: timesheetId,
        metadata: { workedMinutes, status },
      }));
      return { timesheetId, duplicate: false, workedMinutes, status };
    });
  }

  async function requestVehicleTransfer(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const vehicleId = cleanText(request.data?.vehicleId, 160);
    const nextDriverUserId = cleanText(request.data?.nextDriverUserId, 160);
    const vehicleRef = db.collection('vehicles').doc(vehicleId);
    const [vehicleSnap, targetSnap] = await Promise.all([
      vehicleRef.get(),
      nextDriverUserId ? db.collection('users').doc(nextDriverUserId).get() : Promise.resolve(null),
    ]);
    if (!vehicleSnap.exists) throw new HttpsError('not-found', 'Vehiculul nu exista.');
    const vehicle = vehicleSnap.data() || {};
    const companyId = cleanText(vehicle.companyId, 120);
    if (!canAccessCompany(actor, companyId)) throw new HttpsError('permission-denied', 'Vehicul cross-company.');
    const actorIsOwner = cleanText(vehicle.ownerUserId, 160) === actor.uid;
    if (!actorIsOwner && !canManageCompany(actor, companyId)) {
      throw new HttpsError('permission-denied', 'Nu poti schimba soferul acestui vehicul.');
    }
    if (nextDriverUserId) {
      const target = targetSnap?.data() || {};
      if (!targetSnap?.exists || target.active !== true || cleanText(target.accessStatus, 32) !== 'active' ||
          !userCompanyIds(target).includes(companyId)) {
        throw new HttpsError('permission-denied', 'Soferul selectat nu apartine firmei vehiculului.');
      }
    }
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(vehicleRef);
      const before = fresh.data() || {};
      const after = nextDriverUserId ? {
        pendingDriverUserId: nextDriverUserId,
        pendingDriverUserName: cleanText(targetSnap.get('fullName') || targetSnap.get('email'), 160),
        pendingDriverThemeKey: targetSnap.get('themeKey') || null,
        pendingDriverRequestedAt: Date.now(),
      } : {
        currentDriverUserId: '',
        currentDriverUserName: '',
        currentDriverThemeKey: null,
        pendingDriverUserId: '',
        pendingDriverUserName: '',
        pendingDriverThemeKey: null,
        pendingDriverRequestedAt: 0,
      };
      tx.update(vehicleRef, {
        ...after,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'vehicles',
        action: 'vehicle_driver_transfer_requested',
        title: 'Schimbare sofer solicitata',
        message: `Schimbare sofer pentru ${cleanText(before.plateNumber, 40)}.`,
        entityId: vehicleId,
        targetUserId: nextDriverUserId,
        before,
        after,
      }));
    });
    return { vehicleId, pendingDriverUserId: nextDriverUserId };
  }

  async function setVehicleAssignments(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const vehicleId = cleanText(request.data?.vehicleId, 160);
    const ownerUserId = cleanText(request.data?.ownerUserId, 160);
    const currentDriverUserId = cleanText(request.data?.currentDriverUserId, 160);
    const vehicleRef = db.collection('vehicles').doc(vehicleId);
    const vehicleSnap = await vehicleRef.get();
    if (!vehicleSnap.exists) throw new HttpsError('not-found', 'Vehiculul nu exista.');
    const vehicle = vehicleSnap.data() || {};
    const companyId = cleanText(vehicle.companyId, 120);
    if (!canManageCompany(actor, companyId)) {
      throw new HttpsError('permission-denied', 'Doar managerii firmei pot schimba asignarile.');
    }

    const requestedUserIds = [...new Set([ownerUserId, currentDriverUserId].filter(Boolean))];
    const userEntries = await Promise.all(requestedUserIds.map(async (uid) => {
      const snap = await db.collection('users').doc(uid).get();
      const data = snap.data() || {};
      if (!snap.exists || data.active !== true || cleanText(data.accessStatus, 32) !== 'active' ||
          !userCompanyIds(data).includes(companyId)) {
        throw new HttpsError('permission-denied', 'Utilizatorul asignat nu apartine firmei vehiculului.');
      }
      return [uid, data];
    }));
    const users = new Map(userEntries);
    const owner = users.get(ownerUserId) || {};
    const driver = users.get(currentDriverUserId) || {};

    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(vehicleRef);
      if (!fresh.exists) throw new HttpsError('not-found', 'Vehiculul nu exista.');
      const before = fresh.data() || {};
      if (cleanText(before.companyId, 120) !== companyId) {
        throw new HttpsError('failed-precondition', 'Firma vehiculului s-a schimbat.');
      }
      const after = {
        ownerUserId,
        ownerUserName: cleanText(owner.fullName || owner.email, 160),
        ownerThemeKey: owner.themeKey || null,
        currentDriverUserId,
        currentDriverUserName: cleanText(driver.fullName || driver.email, 160),
        currentDriverThemeKey: driver.themeKey || null,
        pendingDriverUserId: '',
        pendingDriverUserName: '',
        pendingDriverThemeKey: null,
        pendingDriverRequestedAt: 0,
      };
      tx.update(vehicleRef, {
        ...after,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'vehicles',
        action: 'vehicle_assignments_updated',
        title: 'Asignari vehicul actualizate',
        message: `Responsabilul si soferul pentru ${cleanText(before.plateNumber, 40)} au fost actualizati.`,
        entityId: vehicleId,
        targetUserId: currentDriverUserId || ownerUserId,
        before,
        after,
      }));
    });
    return { vehicleId, ownerUserId, currentDriverUserId };
  }

  async function requestToolTransfer(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const toolId = cleanText(request.data?.toolId, 160);
    const nextHolderUserId = cleanText(request.data?.nextHolderUserId, 160);
    const toolRef = db.collection('tools').doc(toolId);
    const [toolSnap, targetSnap] = await Promise.all([
      toolRef.get(),
      nextHolderUserId ? db.collection('users').doc(nextHolderUserId).get() : Promise.resolve(null),
    ]);
    if (!toolSnap.exists) throw new HttpsError('not-found', 'Scula nu exista.');
    const toolData = toolSnap.data() || {};
    const companyId = cleanText(toolData.companyId, 120);
    if (!canAccessCompany(actor, companyId)) throw new HttpsError('permission-denied', 'Scula cross-company.');
    const canTransfer = canManageCompany(actor, companyId) || [
      toolData.ownerUserId,
      toolData.currentHolderUserId,
    ].includes(actor.uid);
    if (!canTransfer) throw new HttpsError('permission-denied', 'Nu poti transfera aceasta scula.');

    let target = null;
    if (nextHolderUserId) {
      target = targetSnap?.data() || {};
      if (!targetSnap?.exists || target.active !== true || cleanText(target.accessStatus, 32) !== 'active' ||
          !userCompanyIds(target).includes(companyId)) {
        throw new HttpsError('permission-denied', 'Detinatorul selectat nu apartine firmei sculei.');
      }
    }

    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(toolRef);
      if (!fresh.exists) throw new HttpsError('not-found', 'Scula nu exista.');
      const before = fresh.data() || {};
      const after = nextHolderUserId ? {
        pendingHolderUserId: nextHolderUserId,
        pendingHolderUserName: cleanText(target.fullName || target.email, 160),
        pendingHolderThemeKey: target.themeKey || null,
        pendingHolderRequestedAt: Date.now(),
      } : {
        currentHolderUserId: '',
        currentHolderUserName: '',
        currentHolderThemeKey: null,
        pendingHolderUserId: '',
        pendingHolderUserName: '',
        pendingHolderThemeKey: null,
        pendingHolderRequestedAt: 0,
        locationType: 'depozit',
        locationLabel: 'Depozit',
        status: 'depozit',
      };
      tx.update(toolRef, {
        ...after,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'tools',
        action: 'tool_holder_transfer_requested',
        title: nextHolderUserId ? 'Transfer scula solicitat' : 'Scula returnata in depozit',
        message: `Detinator actualizat pentru ${cleanText(before.name, 160)}.`,
        entityId: toolId,
        targetUserId: nextHolderUserId,
        before,
        after,
      }));
    });
    return { toolId, pendingHolderUserId: nextHolderUserId };
  }

  async function acceptToolTransfer(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const toolId = cleanText(request.data?.toolId, 160);
    const toolRef = db.collection('tools').doc(toolId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(toolRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Scula nu exista.');
      const before = snap.data() || {};
      const companyId = cleanText(before.companyId, 120);
      if (!canAccessCompany(actor, companyId) || cleanText(before.pendingHolderUserId, 160) !== actor.uid) {
        throw new HttpsError('permission-denied', 'Nu ai o solicitare activa pentru aceasta scula.');
      }
      const after = {
        currentHolderUserId: actor.uid,
        currentHolderUserName: actor.fullName,
        currentHolderThemeKey: actor.themeKey || null,
        pendingHolderUserId: '',
        pendingHolderUserName: '',
        pendingHolderThemeKey: null,
        pendingHolderRequestedAt: 0,
        locationType: 'utilizator',
        locationLabel: actor.fullName,
        status: 'atribuita',
      };
      tx.update(toolRef, {
        ...after,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'tools',
        action: 'tool_holder_transfer_accepted',
        title: 'Transfer scula acceptat',
        message: `${actor.fullName} a acceptat ${cleanText(before.name, 160)}.`,
        entityId: toolId,
        before,
        after,
      }));
    });
    return { toolId };
  }

  async function claimTool(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const toolId = cleanText(request.data?.toolId, 160);
    const toolRef = db.collection('tools').doc(toolId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(toolRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Scula nu exista.');
      const before = snap.data() || {};
      const companyId = cleanText(before.companyId, 120);
      if (!canAccessCompany(actor, companyId)) throw new HttpsError('permission-denied', 'Scula cross-company.');
      if (cleanText(before.ownerUserId, 160) || cleanText(before.currentHolderUserId, 160)) {
        throw new HttpsError('failed-precondition', 'Scula este deja asignata.');
      }
      const after = {
        ownerUserId: actor.uid,
        ownerUserName: actor.fullName,
        ownerThemeKey: actor.themeKey || null,
        currentHolderUserId: actor.uid,
        currentHolderUserName: actor.fullName,
        currentHolderThemeKey: actor.themeKey || null,
        locationType: 'utilizator',
        locationLabel: actor.fullName,
        status: 'atribuita',
      };
      tx.update(toolRef, {
        ...after,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'tools',
        action: 'tool_claimed',
        title: 'Scula preluata',
        message: `${actor.fullName} a preluat ${cleanText(before.name, 160)}.`,
        entityId: toolId,
        before,
        after,
      }));
    });
    return { toolId };
  }

  async function acceptVehicleTransfer(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const vehicleId = cleanText(request.data?.vehicleId, 160);
    const vehicleRef = db.collection('vehicles').doc(vehicleId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(vehicleRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Vehiculul nu exista.');
      const before = snap.data() || {};
      const companyId = cleanText(before.companyId, 120);
      if (!canAccessCompany(actor, companyId) || cleanText(before.pendingDriverUserId, 160) !== actor.uid) {
        throw new HttpsError('permission-denied', 'Nu ai o solicitare activa pentru acest vehicul.');
      }
      const after = {
        currentDriverUserId: actor.uid,
        currentDriverUserName: actor.fullName,
        currentDriverThemeKey: actor.themeKey || null,
        pendingDriverUserId: '',
        pendingDriverUserName: '',
        pendingDriverThemeKey: null,
        pendingDriverRequestedAt: 0,
      };
      tx.update(vehicleRef, {
        ...after,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'vehicles',
        action: 'vehicle_driver_transfer_accepted',
        title: 'Vehicul preluat',
        message: `Solicitarea pentru ${cleanText(before.plateNumber, 40)} a fost acceptata.`,
        entityId: vehicleId,
        before,
        after,
      }));
    });
    return { vehicleId };
  }

  async function claimVehicle(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const vehicleId = cleanText(request.data?.vehicleId, 160);
    const vehicleRef = db.collection('vehicles').doc(vehicleId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(vehicleRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Vehiculul nu exista.');
      const before = snap.data() || {};
      const companyId = cleanText(before.companyId, 120);
      if (!canAccessCompany(actor, companyId)) throw new HttpsError('permission-denied', 'Vehicul cross-company.');
      if (cleanText(before.ownerUserId, 160) || cleanText(before.currentDriverUserId, 160)) {
        throw new HttpsError('failed-precondition', 'Vehiculul este deja asignat.');
      }
      const after = {
        ownerUserId: actor.uid,
        ownerUserName: actor.fullName,
        ownerThemeKey: actor.themeKey || null,
        currentDriverUserId: actor.uid,
        currentDriverUserName: actor.fullName,
        currentDriverThemeKey: actor.themeKey || null,
      };
      tx.update(vehicleRef, {
        ...after,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'vehicles',
        action: 'vehicle_claimed',
        title: 'Vehicul preluat',
        message: `Vehiculul ${cleanText(before.plateNumber, 40)} a fost preluat.`,
        entityId: vehicleId,
        before,
        after,
      }));
    });
    return { vehicleId };
  }

  async function updateVehicleMileage(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    const vehicleId = cleanText(request.data?.vehicleId, 160);
    const currentKm = Number(request.data?.currentKm);
    const requestedInitialKm = request.data?.initialRecordedKm;
    if (!Number.isFinite(currentKm) || currentKm < 0 || currentKm > 10_000_000) {
      throw new HttpsError('invalid-argument', 'Kilometraj invalid.');
    }
    const vehicleRef = db.collection('vehicles').doc(vehicleId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(vehicleRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Vehiculul nu exista.');
      const vehicle = snap.data() || {};
      const companyId = cleanText(vehicle.companyId, 120);
      if (!canAccessCompany(actor, companyId)) throw new HttpsError('permission-denied', 'Vehicul cross-company.');
      const assigned = [vehicle.ownerUserId, vehicle.currentDriverUserId].includes(actor.uid);
      const manages = canManageCompany(actor, companyId);
      const previousKm = Number(vehicle.currentKm || 0);
      const previousInitialKm = Number(vehicle.initialRecordedKm || 0);
      const initialRecordedKm = requestedInitialKm == null
        ? previousInitialKm
        : Number(requestedInitialKm);
      if (!Number.isFinite(initialRecordedKm) || initialRecordedKm < 0 || initialRecordedKm > 10_000_000) {
        throw new HttpsError('invalid-argument', 'Kilometrajul initial este invalid.');
      }
      if (!manages && !assigned) throw new HttpsError('permission-denied', 'Vehicul neasignat.');
      if (!manages && currentKm < previousKm) {
        throw new HttpsError('permission-denied', 'Un angajat nu poate reduce kilometrajul.');
      }
      if (!manages && initialRecordedKm !== previousInitialKm) {
        throw new HttpsError('permission-denied', 'Kilometrajul initial este administrativ.');
      }
      const after = {
        currentKm,
        initialRecordedKm,
      };
      tx.update(vehicleRef, {
        ...after,
        updatedAt: Date.now(),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'vehicles',
        action: 'vehicle_mileage_updated',
        title: 'Kilometraj actualizat',
        message: `Kilometraj actualizat de la ${previousKm} la ${currentKm}.`,
        entityId: vehicleId,
        metadata: { previousKm, currentKm, previousInitialKm, initialRecordedKm },
        before: { currentKm: previousKm, initialRecordedKm: previousInitialKm },
        after,
      }));
    });
    return { vehicleId, currentKm };
  }

  async function requestVehicleCommand(request) {
    const actor = await loadActor(db, request.auth?.uid, HttpsError);
    if (actor.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Doar administratorii pot trimite comenzi trackerului.');
    }
    const vehicleId = cleanText(request.data?.vehicleId, 160);
    const type = cleanText(request.data?.type, 64);
    const requestId = cleanText(request.data?.requestId, 100);
    const durationSec = request.data?.durationSec == null ? null : Number(request.data.durationSec);
    if (!vehicleId || !ALLOWED_VEHICLE_COMMANDS.has(type)) {
      throw new HttpsError('invalid-argument', 'Comanda vehiculului este invalida.');
    }
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
      throw new HttpsError('invalid-argument', 'Cheia de idempotenta este invalida.');
    }
    if (durationSec !== null && (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 300)) {
      throw new HttpsError('invalid-argument', 'Durata comenzii este invalida.');
    }

    const vehicleRef = db.collection('vehicles').doc(vehicleId);
    const vehicleSnap = await vehicleRef.get();
    if (!vehicleSnap.exists) throw new HttpsError('not-found', 'Vehiculul nu exista.');
    const vehicle = vehicleSnap.data() || {};
    const companyId = cleanText(vehicle.companyId, 120);
    if (!canAccessCompany(actor, companyId)) throw new HttpsError('permission-denied', 'Vehicul cross-company.');
    const imei = cleanText(vehicle.tracker?.imei, 32);
    if (!/^\d{10,20}$/.test(imei)) {
      throw new HttpsError('failed-precondition', 'Vehiculul nu are tracker valid.');
    }
    const bindingSnap = await db.collection('trackerBindings').doc(imei).get();
    if (!bindingSnap.exists || cleanText(bindingSnap.get('vehicleId'), 160) !== vehicleId) {
      throw new HttpsError('failed-precondition', 'Asocierea trackerului nu este valida.');
    }

    const commandId = `cmd_${crypto.createHash('sha256').update(`${actor.uid}:${requestId}`).digest('hex').slice(0, 32)}`;
    const commandRef = vehicleRef.collection('commands').doc(commandId);
    const commandLockRef = db.collection('vehicleCommandLocks').doc(`${vehicleId}_${type}`);

    return db.runTransaction(async (tx) => {
      const [existing, commandLock] = await Promise.all([
        tx.get(commandRef),
        tx.get(commandLockRef),
      ]);
      if (existing.exists) {
        return { commandId, duplicate: true, status: cleanText(existing.get('status'), 32) };
      }
      const lockExpiry = commandLock.exists && typeof commandLock.get('expiresAt')?.toMillis === 'function'
        ? commandLock.get('expiresAt').toMillis()
        : Number(commandLock.get('expiresAt') || 0);
      if (
        commandLock.exists &&
        cleanText(commandLock.get('status'), 32) === 'active' &&
        lockExpiry > Date.now()
      ) {
        throw new HttpsError('already-exists', 'Exista deja o comanda activa de acelasi tip.');
      }
      tx.create(commandRef, {
        companyId,
        type,
        status: 'requested',
        requestedBy: actor.fullName,
        requestedAt: Date.now(),
        completedAt: null,
        providerMessage: '',
        result: 'queued',
        durationSec,
        actorUid: actor.uid,
        actorRole: actor.role,
        vehicleId,
        trackerImei: imei,
        requestId,
        createdAtServer: fieldValue.serverTimestamp(),
      });
      tx.set(commandLockRef, {
        companyId,
        vehicleId,
        type,
        commandId,
        status: 'active',
        updatedAt: Date.now(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        updatedAtServer: fieldValue.serverTimestamp(),
      });
      tx.create(db.collection('auditLogs').doc(), buildAuditPayload(fieldValue, actor, {
        companyId,
        category: 'vehicles',
        action: 'vehicle_command_requested',
        title: 'Comanda tracker solicitata',
        message: `Comanda ${type} a fost solicitata pentru ${cleanText(vehicle.plateNumber, 40)}.`,
        entityId: vehicleId,
        metadata: { type, commandId },
      }));
      return { commandId, duplicate: false, status: 'requested' };
    });
  }

  return {
    adminCreateUser,
    setPrimaryCompany,
    assignUsersToCompany,
    recordAuditEvent,
    dispatchNotificationEvent,
    startTimesheet,
    stopTimesheet,
    requestVehicleTransfer,
    setVehicleAssignments,
    acceptVehicleTransfer,
    claimVehicle,
    updateVehicleMileage,
    requestVehicleCommand,
    requestToolTransfer,
    acceptToolTransfer,
    claimTool,
  };
}

module.exports = {
  createSecurityHandlers,
  getBucharestDateParts,
  cleanMetadata,
  userCompanyIds,
  canAccessCompany,
};
