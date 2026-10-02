/* StarNet Remote service worker.
   1. Caches the app SHELL only (these few static files) so the app opens instantly and says "station offline"
      honestly when there is no signal. It never caches anything from the station: that all travels sealed over
      the WebSocket, which a service worker does not touch.
   2. Shows the station's push notifications. The station encrypts each one to this phone (RFC 8291); the browser
      decrypts it before it arrives here. A tap opens the app on the right screen. */
'use strict';
const CACHE = 'starnet-remote-%SHELL%';   // the relay writes in a fingerprint of the shell's exact bytes
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'store.js', 'phone-client.js', 'vt323.woff2', 'icon.svg', 'icon-180.png', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
/* CACHE FIRST: the app opens from the phone itself, instantly, with no trip to the relay. A new version still arrives
   at once: the browser re-checks this file on every open, the relay names CACHE after the shell's exact bytes, so a
   changed app is a changed worker, which installs the whole new shell in one piece (never new markup with an old
   script) and takes over; the next open runs it. */
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (!SHELL.some(p => u.pathname.endsWith('/' + p.replace('./', '')) || (p === './' && u.pathname.endsWith('/')))) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then((r) => {
    if (r.ok) c.put(e.request, r.clone());
    return r;
  }))).catch(() => caches.match('index.html')));
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
