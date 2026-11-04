const CACHE = 'benchflow-shell-v1';
const SHELL = ['./', './index.html', './styles.css', './manifest.webmanifest', './assets/icon.svg', './src/app.js', './src/chart.js', './src/csv.js', './src/demo.js', './src/model.js', './src/stats.js', './src/storage.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('benchflow-shell-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    try { return await fetch(event.request); }
    catch { return await caches.match(event.request) || (event.request.mode === 'navigate' ? await caches.match('./index.html') : Response.error()); }
  })());
});
