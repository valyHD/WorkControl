const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

function buildPathFromNotification(data) {
  const moduleName = String(data.module || '').trim();
  const entityId = String(data.entityId || '').trim();

  if (moduleName === 'tools' && entityId) return `/tools/${entityId}`;
  if (moduleName === 'vehicles' && entityId) return `/vehicles/${entityId}`;
  if (moduleName === 'timesheets') return '/timesheets';
  if (moduleName === 'leave') return '/my-leave';
  if (moduleName === 'projects') return '/projects';
  if (moduleName === 'users') return '/users';
  if (moduleName === 'backup' || moduleName === 'web' || moduleName === 'server' || moduleName === 'system') return '/control-panel';
  if (moduleName === 'notifications') return '/notifications';

  return '/notifications';
}

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

    if (!userId) {
      logger.warn('Notificarea nu are userId.', { notificationId });
      await snapshot.ref.set(
        {
          pushDispatchStatus: 'missing_user',
          pushDispatchAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    const tokenSnap = await db
      .collection('pushTokens')
      .where('userId', '==', userId)
      .get();

    const tokens = tokenSnap.docs
      .map((doc) => ({ id: doc.id, token: String(doc.get('token') || '').trim() }))
      .filter((item) => item.token)
      .map((item) => item.token);

    if (tokens.length === 0) {
      logger.info('Nu exista tokenuri push pentru user.', { notificationId, userId });
      await snapshot.ref.set(
        {
          pushDispatchStatus: 'no_tokens',
          pushDispatchSuccessCount: 0,
          pushDispatchFailureCount: 0,
          pushDispatchAt: admin.firestore.FieldValue.serverTimestamp(),
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
  },
  webpush: {
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
        const matchingDoc = tokenSnap.docs.find((doc) => String(doc.get('token') || '').trim() === failedToken);
        if (matchingDoc) invalidTokenDocIds.push(matchingDoc.id);
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
      },
      { merge: true }
    );

    logger.info('Push dispatch finalizat.', {
      notificationId,
      userId,
      successCount: response.successCount,
      failureCount: response.failureCount,
      removedInvalidTokens: invalidTokenDocIds.length,
    });
  }
);
