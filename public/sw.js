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
    await self.registration.showNotification(data.title || 'Calendar', {
      body: data.body || 'New event added',
      tag: 'calendar-msg',
      renotify: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) if ('focus' in c) return c.focus();
    return self.clients.openWindow('/'); // opens the calendar; PIN is required again
  })());
});
