/* StarNet Remote service worker.
   1. Caches the app SHELL only (these few static files) so the app opens instantly and says "station offline"
      honestly when there is no signal. It never caches anything from the station: that all travels sealed over
      the WebSocket, which a service worker does not touch.
   2. Shows the station's push notifications. The station encrypts each one to this phone (RFC 8291); the browser
      decrypts it before it arrives here. A tap opens the app on the right screen. */
'use strict';
const CACHE = 'starnet-remote-v7';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'store.js', 'phone-client.js', 'vt323.woff2', 'icon.svg', 'icon-180.png', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// network first (a new version reaches the phone as soon as it is online), the cached shell when offline
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && SHELL.some(p => u.pathname.endsWith('/' + p.replace('./', '')) || (p === './' && u.pathname.endsWith('/')))) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

// every push is shown (a push that shows nothing gets the subscription revoked on some phones); the tag makes a
// repeat for the same thing replace the old one instead of stacking
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  const title = String(d.title || 'StarNet');
  e.waitUntil(self.registration.showNotification(title, {
    body: String(d.body || ''), tag: d.tag ? String(d.tag) : undefined, renotify: !!d.tag,
    icon: 'icon-180.png', badge: 'icon-180.png', data: { url: String(d.url || '') }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find(c => new URL(c.url).origin === location.origin);
    if (open) { open.postMessage({ type: 'open', url }); return open.focus(); }
    return self.clients.openWindow('./' + (/^#[A-Za-z0-9=_:-]*$/.test(url) ? url : ''));
  }));
});
