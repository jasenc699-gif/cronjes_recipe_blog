const CACHE = 'cronjes-v11';
const CORE = ['./index.html', './app.js', './manifest.json', './icon.svg'];
const SHARE_CACHE = 'cronjes-share';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      // Keep the share-payload cache across version bumps — only clean up old app-shell caches
      Promise.all(keys.filter(k => k !== CACHE && k !== SHARE_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Web Share Target: another app shared a recipe file TO Cronjes (Android/Chrome).
  // Pull the file out of the POST body, stash it, then hand off to the app via a
  // redirect — app.js checks for ?shared=1 on load and auto-imports it.
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShareTarget(e.request));
    return;
  }

  // Only handle same-origin requests
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok && (e.request.destination === 'document' || e.request.destination === 'script')) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
      return cached || network;
    })
  );
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('sharedfile');
    const text = file ? await file.text() : '';
    const cache = await caches.open(SHARE_CACHE);
    await cache.put('/__shared-recipe', new Response(text, { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) {
    // If anything goes wrong, app.js will show "no shared recipe found" — no crash either way
  }
  return Response.redirect('./index.html?shared=1', 303);
}
