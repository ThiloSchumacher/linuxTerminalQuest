/**
 * BashQuest Service Worker — offline cache for the whole app shell.
 *
 * ## Strategy (app-shell network-first)
 *
 * - **HTML navigations**: network-first → cache → `index.html`
 *   fallback → 503.
 * - **App shell** (`app.js`, `config.js`, all command modules, all
 *   CSS, `data/quests.json`): network-first → cache → 503. This is
 *   what makes updates work: on every reload while online, the
 *   entry points are pulled fresh from the server, so a new deploy
 *   is visible without any `controllerchange` dance. Offline, the
 *   pre-cached copies are served.
 * - **Immutable assets** (`vendor/xterm/*`, `fonts/*`, `icons/*`):
 *   cache-first. These rarely change, are large, and don't benefit
 *   from per-reload revalidation.
 *
 * ## Update flow
 *
 * Because the app shell is network-first, an ordinary page reload
 * (F5) after a deploy is sufficient to see the new code. No
 * `controllerchange`-triggered reload is needed in `app.js`.
 * `CACHE_VERSION` bumps remain meaningful only for invalidating the
 * *offline* copies (and forcing the install to re-fetch assets), not
 * for online freshness.
 *
 * ## `cache: 'no-store'` on install and cache-first fetches
 *
 * `no-store` bypasses the browser's HTTP cache. Without it, the
 * install step can populate the new SW cache with *old* bytes from
 * the HTTP cache — the page would keep showing the previous
 * deployment even after a version bump. Combined with
 * `updateViaCache: 'none'` on the registration in `app.js`, a
 * version bump reliably pulls current server files.
 *
 * ## Versioning
 *
 * `CACHE_VERSION` is bumped MANUALLY on every deployment that ships
 * changed assets. This is the invalidation mechanism for the
 * offline cache.
 *
 * ## V1 limitations
 *
 * - No background sync.
 * - No push notifications.
 * - No stale-while-revalidate.
 * - Cache-busting for the offline cache only via `CACHE_VERSION`.
 * - Range requests (video, audio) are not supported.
 *
 * ## Logging
 *
 * This file contains no `console.*` calls by design — failures are
 * swallowed silently. Debug via DevTools → Application → Cache
 * Storage / Service Workers when needed.
 *
 * @module sw
 */

const CACHE_VERSION = 'v12';
const CACHE_NAME = 'bashquest-' + CACHE_VERSION;

// Every asset the app loads at runtime. If a file is added to the
// project, it MUST be added here too — otherwise the first offline
// load silently 404s a dependency. Paths are RELATIVE (`./...`);
// absolute paths (`/...`) break GitHub-Pages project pages, where
// the app lives under `/<repo>/`, not `/`.
//
// Both `'./'` and `'./index.html'` are kept on purpose — they are
// DISTINCT cache keys, not duplicates:
//
//   - `'./'`        → `/repo/` (bare URL with trailing slash)
//   - `'./index.html'` → `/repo/index.html`
//
// networkFirst calls `caches.match(request)` with the request's
// ORIGINAL URL. A user who opens the app via the bare URL
// (`https://user.github.io/repo/`) produces a cache lookup for
// `/repo/`, which only hits if `'./'` is cached. Pre-caching both
// keeps the first offline load fast.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/main.css',
  './css/layout.css',
  './css/terminal.css',
  './css/quests.css',
  './css/gamification.css',
  './css/sidebar.css',
  './js/app.js',
  './js/config.js',
  './js/terminal/terminal.js',
  './js/terminal/theme.js',
  './js/terminal/line-editor.js',
  './js/vfs/node.js',
  './js/vfs/filesystem.js',
  './js/vfs/initial-fs.js',
  './js/vfs/serialize.js',
  './js/shell/parser.js',
  './js/shell/env.js',
  './js/shell/executor.js',
  './js/shell/commands/index.js',
  './js/shell/commands/_helpers.js',
  './js/shell/commands/pwd.js',
  './js/shell/commands/cd.js',
  './js/shell/commands/echo.js',
  './js/shell/commands/ls.js',
  './js/shell/commands/cat.js',
  './js/shell/commands/mkdir.js',
  './js/shell/commands/touch.js',
  './js/shell/commands/rm.js',
  './js/shell/commands/cp.js',
  './js/shell/commands/mv.js',
  './js/shell/commands/chmod.js',
  './js/shell/commands/chown.js',
  './js/shell/commands/grep.js',
  './js/shell/commands/head.js',
  './js/shell/commands/tail.js',
  './js/shell/commands/wc.js',
  './js/shell/commands/sort.js',
  './js/shell/commands/ln.js',
  './js/shell/commands/clear.js',
  './js/shell/commands/history.js',
  './js/shell/commands/whoami.js',
  './js/shell/commands/date.js',
  './js/shell/commands/uname.js',
  './js/shell/commands/which.js',
  './js/shell/commands/stat.js',
  './js/shell/commands/file.js',
  './js/shell/commands/tree.js',
  './js/shell/commands/sed.js',
  './js/shell/commands/cut.js',
  './js/shell/commands/tr.js',
  './js/shell/commands/tee.js',
  './js/shell/commands/seq.js',
  './js/shell/commands/nl.js',
  './js/shell/commands/rev.js',
  './js/shell/commands/basename.js',
  './js/shell/commands/dirname.js',
  './js/shell/commands/find.js',
  './js/shell/commands/help.js',
  './js/quests/loader.js',
  './js/quests/quest-engine.js',
  './js/quests/validator.js',
  './js/gamification/xp.js',
  './js/gamification/badges.js',
  './js/gamification/notifications.js',
  './js/ui/notifications.js',
  './js/ui/quest-panel.js',
  './js/ui/sidebar.js',
  './js/storage/storage.js',
  './js/storage/persistence.js',
  './vendor/xterm/xterm.js',
  './vendor/xterm/xterm.css',
  './vendor/xterm/addons/addon-fit.js',
  './fonts/InterVariable.woff2',
  './fonts/JetBrainsMono-Variable.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './data/quests.json',
];

const HTML_FALLBACK = './index.html';

/**
 * Static assets that are practically never changed by a deploy and
 * are large enough that per-reload revalidation is wasteful. Served
 * cache-first. Everything else goes through network-first so a new
 * deploy is visible on the next reload.
 *
 * `pathname.includes` (not `startsWith`) so the check works both
 * locally (`/vendor/...`) and on GitHub Pages (`/repo/vendor/...`).
 *
 * @param {URL} url
 * @returns {boolean}
 */
function isImmutableAsset(url) {
  const p = url.pathname;
  return (
    p.includes('/vendor/xterm/') ||
    p.includes('/fonts/') ||
    p.includes('/icons/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // Promise.allSettled + per-asset `add` (not `addAll`): a
        // single missing asset must NOT abort the install of the
        // other assets.
        //
        // `cache: 'no-store'` forces the install to pull CURRENT
        // server bytes, bypassing the HTTP cache. Without it, a
        // CACHE_VERSION bump can populate the new cache with stale
        // HTTP-cached files.
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache
              .add(new Request(url, { cache: 'no-store' }))
              .catch(() => {
                // Silent — the install survives a missing asset.
              }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // Delete every previous bashquest cache — the version bump
        // in `CACHE_NAME` is the sole invalidation mechanism.
        Promise.all(
          keys
            .filter((k) => k.startsWith('bashquest-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignore non-GET and cross-origin requests. Letting them hit the
  // network normally keeps the SW out of the way of third-party
  // resources and APIs (there are none in V1, but the guard is cheap
  // and correct).
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  const accept = event.request.headers.get('accept') || '';

  // HTML navigations: network-first.
  if (accept.includes('text/html')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Vendor/fonts/icons: cache-first.
  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // App shell (app.js, config.js, commands, CSS, quests.json):
  // network-first. This is what makes a deploy visible on the next
  // reload without a controllerchange-reload dance.
  event.respondWith(networkFirst(event.request));
});

/**
 * Cache-first strategy for immutable assets: serve from cache if
 * available, otherwise fetch, cache and return.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    // `no-store` bypasses the browser's HTTP cache. The SW cache is
    // the single source of truth for offline assets; letting the
    // HTTP cache intervene would serve stale bytes from a previous
    // deployment after a CACHE_VERSION bump.
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      // Best-effort cache write. The response is returned regardless
      // — a failed put (quota, aborted request) must not break the
      // fetch path. Without `.catch`, the rejection would surface as
      // an unhandled promise rejection.
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/**
 * Network-first strategy: try the network, fall back to cache, then
 * to `index.html` (for navigations) or an inline 503.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
  try {
    // `no-store` makes the update check deterministic: online, the
    // network version is always seen, never shadowed by a stale
    // HTTP-cache response.
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      // Best-effort cache write, see `cacheFirst`.
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Third fallback level. `caches.match` returns `undefined` when
    // nothing matches — returning that to `respondWith` would raise
    // a TypeError and surface as a browser network error instead of
    // a graceful offline page. Render an inline 503 instead.
    const fallback = await caches.match(HTML_FALLBACK);
    if (fallback) return fallback;
    return new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}