/* StarNet Remote service worker: caches the app SHELL only (these few static files) so the deck opens
   instantly and says "station offline" honestly when there is no signal. It never caches anything from the
   station: that all travels sealed over the WebSocket, which a service worker does not touch. */
'use strict';
const CACHE = 'starnet-remote-v3';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'store.js', 'phone-client.js', 'vt323.woff2', 'icon.svg', 'manifest.webmanifest'];
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
