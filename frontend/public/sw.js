// Quarc Draw service worker: offline app shell + runtime caching of built assets.
const VERSION = 'qd-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['/', '/index.html', '/logo.png', '/manifest.webmanifest']).catch(() => undefined))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('/index.html', copy)); return r; }).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok && !(r.headers.get('content-type') || '').startsWith('text/html')) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
