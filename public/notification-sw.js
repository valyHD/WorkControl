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
