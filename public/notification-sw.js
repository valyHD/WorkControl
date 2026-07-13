/* eslint-disable no-undef */

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

let messaging = null;

try {
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

  messaging = firebase.messaging();
} catch (error) {
  console.warn('[notification-sw] Firebase Messaging indisponibil. App shell ramane activ.', error);
}

const APP_SHELL_CACHE_NAME = 'workcontrol-app-shell-v8';
const APP_SHELL_URLS = ['/', '/manifest.webmanifest'];
const IMAGE_CACHE_NAME = 'workcontrol-image-cache-v1';
const STATIC_CACHE_NAME = 'workcontrol-static-v2';
const RECENT_NOTIFICATION_TTL_MS = 2 * 60 * 1000;
const recentNotificationTags = new Map();
const IMAGE_CACHEABLE_HOSTS = [
  self.location.host,
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'lh3.googleusercontent.com',
  'images.unsplash.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(APP_SHELL_CACHE_NAME);
      await cache.addAll(APP_SHELL_URLS);
    } catch {
      // Installation must not fail if one optional app-shell request is blocked.
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) =>
          (name.startsWith('workcontrol-app-shell-') && name !== APP_SHELL_CACHE_NAME) ||
          (name.startsWith('workcontrol-static-') && name !== STATIC_CACHE_NAME)
        )
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    if (payload?.notification) {
      return;
    }

    const title = payload?.notification?.title || payload?.data?.title || 'Notificare WorkControl';
    const body = payload?.notification?.body || payload?.data?.body || payload?.data?.message || '';
    const path = payload?.data?.path || '/notifications';
    const notificationId = payload?.data?.notificationId || `${title}|${body}|${path}`;
    const silent = payload?.data?.soundEnabled === 'false';
    const tag = `workcontrol-${notificationId}`;
    const now = Date.now();

    for (const [existingTag, ts] of recentNotificationTags.entries()) {
      if (now - ts > RECENT_NOTIFICATION_TTL_MS) {
        recentNotificationTags.delete(existingTag);
      }
    }

    const previous = recentNotificationTags.get(tag);
    if (previous && now - previous < RECENT_NOTIFICATION_TTL_MS) {
      return;
    }

    recentNotificationTags.set(tag, now);

    self.registration.getNotifications({ tag }).then((existingNotifications) => {
      existingNotifications.forEach((notification) => notification.close());
      return self.registration.showNotification(title, {
        body,
        silent,
        tag,
        renotify: false,
        data: { path, notificationId },
      });
    });
  });
}

function isCacheableImageRequest(requestUrl) {
  try {
    const url = new URL(requestUrl);
    return IMAGE_CACHEABLE_HOSTS.includes(url.host);
  } catch {
    // Ignore malformed URLs.
    return false;
  }
}

function isValidStaticResponse(request, response) {
  if (!response || !response.ok) return false;

  const contentType = response.headers.get('content-type') || '';
  if (request.destination === 'script' || request.destination === 'worker') {
    return /(javascript|ecmascript|wasm)/i.test(contentType);
  }
  if (request.destination === 'style') {
    return /text\/css/i.test(contentType);
  }
  if (request.destination === 'font') {
    return /(font|woff|octet-stream)/i.test(contentType);
  }
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method === 'GET' && request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(APP_SHELL_CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.ok && new URL(request.url).origin === self.location.origin) {
          event.waitUntil(cache.put('/', response.clone()));
        }
        return response;
      } catch {
        const cachedResponse = await cache.match('/') || await cache.match('/index.html');
        if (cachedResponse) return cachedResponse;
        return Response.error();
      }
    })());
    return;
  }

  if (request.method !== 'GET' || request.destination !== 'image') {
    if (
      request.method === 'GET' &&
      ['script', 'style', 'font', 'worker'].includes(request.destination) &&
      new URL(request.url).origin === self.location.origin
    ) {
      event.respondWith((async () => {
        const cache = await caches.open(STATIC_CACHE_NAME);
        const cachedResponse = await cache.match(request);
        if (cachedResponse && isValidStaticResponse(request, cachedResponse)) {
          return cachedResponse;
        }
        if (cachedResponse) {
          await cache.delete(request);
        }
        const networkResponse = await fetch(request);
        if (isValidStaticResponse(request, networkResponse)) {
          await cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      })());
    }
    return;
  }

  if (!isCacheableImageRequest(request.url)) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      event.waitUntil((async () => {
        try {
          const freshResponse = await fetch(request);
          if (freshResponse && freshResponse.ok) {
            await cache.put(request, freshResponse.clone());
          }
        } catch {
          // Ignore background refresh errors; keep serving cached image.
        }
      })());

      return cachedResponse;
    }

    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  })());
});
