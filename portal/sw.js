/* ============================================================
   Service worker — the portal's app shell, and NOTHING ELSE.

   ⚠️ THIS FILE MUST NEVER CACHE A SUPABASE RESPONSE.

   Everything this portal shows is gated in Postgres by row-level
   security: a brand sees one brand, a contractor sees no money but
   their own, and every one of those decisions is made per request
   against the caller's identity. A cached response has no identity.
   Storing one puts brand revenue, contractor pay and internal notes
   on a phone at rest, readable offline by whoever picks it up, and
   outside every policy in this project — and it would survive a sign
   out, because signing out clears a token, not a cache.

   So the rule here is not "cache carefully". It is: the shell is
   cacheable because it is the same for everyone and is already public
   (this repo root IS the Netlify publish directory). Data is
   network-only, always, with no fallback. Offline, the portal opens
   and says it needs a connection — which is honest — rather than
   showing figures of unknown age.

   SCOPE. A service worker's scope is the directory it is served from,
   so this one covers /portal/ and cannot touch the marketing site.
   That is why it lives here and not at the repo root.
   ============================================================ */

const VERSION = 'ih-portal-v1';

/* The shell only: markup, styles, the client, the icons. No page here
   contains data — every one of them fetches it at runtime. */
const SHELL = [
  'index.html',
  'login.html',
  'reset.html',
  'my-venues.html',
  'my-pay.html',
  'venues.html',
  'venue.html',
  'activity.html',
  'photos.html',
  'brands-info.html',
  'training.html',
  'portal.css',
  'portal.js',
  '../css/site.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One at a time, ignoring failures. addAll() rejects the whole install if
    // ANY single file 404s, which would silently leave the portal with no
    // worker at all — and the page would look completely fine.
    await Promise.all(SHELL.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** Anything that is not our own shell file. Data, auth, fonts, the CDN. */
function isShellRequest(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (!url.pathname.includes('/portal/') && !url.pathname.endsWith('/css/site.css')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // NETWORK ONLY, NO FALLBACK, NO CACHE WRITE. Supabase carries the data and
  // the session; the CDN carries the client library. None of it is ours to
  // keep. Left to the browser entirely rather than handled here, so there is
  // no code path in this file that could ever put one in a cache.
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('jsdelivr.net')) {
    return;
  }

  if (!isShellRequest(request)) return;

  // Network first, so a deploy is picked up on the next load rather than
  // whenever the worker happens to update. The cache is the offline floor.
  // THE QUERY STRING IS NOT PART OF THE SHELL. `login.html?next=venues.html`
  // and `venue.html?id=<uuid>` are the same two files whatever they carry, and
  // caching per query string stored a fresh copy of the identical page for
  // every id anyone opened -- a cache that grows with browsing and never
  // repeats a hit. Stripped for both the write and the read so the two agree.
  const shellKey = new Request(url.origin + url.pathname, { headers: request.headers });

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(VERSION);
        cache.put(shellKey, fresh.clone());
      }
      return fresh;
    } catch {
      const hit = await caches.match(shellKey);
      if (hit) return hit;
      throw new Error('offline and not cached');
    }
  })());
});
