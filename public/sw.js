// Service worker: shows a disguised notification for new messages when the chat isn't in view.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Chat is open and visible -> no notification needed
    if (wins.some((c) => c.visibilityState === 'visible' && new URL(c.url).pathname === '/chat')) return;
    // Running count: if a notification is still in the tray, add to its count ("3 new events")
    const existing = await self.registration.getNotifications({ tag: 'calendar-msg' });
    const count = ((existing[0] && existing[0].data && existing[0].data.count) || 0) + 1;
    await self.registration.showNotification(data.title || 'Calendar', {
      body: count > 1 ? count + ' new events' : data.body || 'New event added',
      tag: 'calendar-msg',
      renotify: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: '/', count },
    });
    if (self.navigator && self.navigator.setAppBadge) self.navigator.setAppBadge(count).catch(() => {});
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (self.navigator && self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) if ('focus' in c) return c.focus();
    return self.clients.openWindow('/'); // opens the calendar; PIN is required again
  })());
});
