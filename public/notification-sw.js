/* eslint-disable no-undef */

importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyA-BrafynGDV7I7IOH5UEb53DErNzWXp5s',
  authDomain: 'workcontrol-53b1d.firebaseapp.com',
  projectId: 'workcontrol-53b1d',
  storageBucket: 'workcontrol-53b1d.firebasestorage.app',
  messagingSenderId: '366357316965',
  appId: '1:366357316965:web:f4bbd6a0395a2b5317cd8c',
  measurementId: 'G-JFB58C8PTV',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || payload?.data?.title || 'Notificare WorkControl';
  const body = payload?.notification?.body || payload?.data?.body || payload?.data?.message || '';
  const path = payload?.data?.path || '/notifications';

  self.registration.showNotification(title, {
    body,
    data: { path },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath = typeof event.notification?.data?.path === 'string'
    ? event.notification.data.path
    : '/notifications';

  const absoluteUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of windows) {
      if ('focus' in client) {
        client.postMessage({ type: 'notification-click', path: targetPath });
        await client.focus();
        if ('navigate' in client) {
          await client.navigate(absoluteUrl);
        }
        return;
      }
    }

    await self.clients.openWindow(absoluteUrl);
  })());
});
