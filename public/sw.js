// sw.js — robuster Service-Worker.
// Wichtig: liefert bei Fehlern NIE die HTML-Seite als CSS/JS aus (das führte zu
// "nur Text, kein Styling"). Cacht nur erfolgreiche Antworten.
const CACHE = 'couillon-v4';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u)))) // toleranter Precache
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }
      // Netzwerk lieferte Fehlerstatus -> lieber die gute gecachte Version
      const cached = await caches.match(req);
      return cached || res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Nur für Seitenaufrufe die HTML-Hülle zurückgeben, NIE für CSS/JS.
      if (req.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
