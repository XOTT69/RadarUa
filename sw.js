const CACHE = 'radarua-telegram-shell-2.2';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./config.js','./data/feed.js','./manifest.webmanifest','./assets/icons/icon-192.png','./assets/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))));
});
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'RadarUa', {
    body: data.body || 'Нова Telegram-подія для вашої зони.',
    icon: './assets/icons/icon-192.png', badge: './assets/icons/icon-192.png',
    tag: data.tag || 'radarua-monitoring', renotify: true, data: { url: data.url || './' }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || './';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    for (const client of clients) { if ('focus' in client) { await client.focus(); return; } }
    return self.clients.openWindow(target);
  }));
});
