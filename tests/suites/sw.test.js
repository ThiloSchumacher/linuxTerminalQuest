import { describe, it, expect } from '../runner.js';

/**
 * Structural tests for the Service Worker.
 *
 * A real SW can only run in its own execution context, which a normal
 * test page cannot spin up. Instead, this suite fetches `sw.js` as
 * TEXT and asserts structural properties. It will not catch logic
 * bugs inside the cache handlers, but it WILL catch the regressions
 * that have actually bitten this project or would silently break
 * offline:
 *
 *  - Re-introducing `cache.addAll` (breaks install on a missing asset)
 *  - A stray `console.log` / `console.error` in production code
 *  - Dropping an entry from `PRECACHE_URLS`, so an offline load 404s
 *  - Switching to absolute paths, which break GitHub-Pages scope
 *
 * Path: `'../sw.js'`. `fetch` resolves relative URLs against the
 * **document base URL** (the URL of `tests/index.html`), NOT the
 * module URL of this test file. From `tests/` the path `../sw.js`
 * lands on the project root both locally and under GitHub Pages
 * project paths (`/<repo>/tests/` → `/<repo>/sw.js`). Note: spec013a
 * §4 originally specified `'../../sw.js'` — that was a spec error
 * (would 404 on GitHub Pages by walking above `/repo/`); the review
 * to spec013a corrected it.
 */

/**
 * Fetch `sw.js` and return its source text.
 *
 * @returns {Promise<string>}
 */
async function loadSwText() {
  const res = await fetch('../sw.js');
  expect(res.ok).toBe(true);
  return res.text();
}

/**
 * Extract the `PRECACHE_URLS = [ ... ]` array's inner text. Used by
 * the precache-list tests to check the actual entries rather than
 * the whole file.
 *
 * @param {string} text
 * @returns {string}
 */
function extractPrecacheList(text) {
  const m = text.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/);
  expect(m).toBeTruthy();
  return m[1];
}

// ---------------------------------------------------------------------------
// sw.js — Struktur
// ---------------------------------------------------------------------------

describe('sw.js — Struktur', () => {
  it('is fetchable and reasonably large', async () => {
    const text = await loadSwText();
    // Sanity floor: the precache list alone is >1 KB. A smaller
    // file almost certainly means a broken build/deploy.
    expect(text.length > 1000).toBe(true);
  });

  it('defines CACHE_NAME and PRECACHE_URLS', async () => {
    const text = await loadSwText();
    expect(text.includes('CACHE_NAME')).toBe(true);
    expect(text.includes('PRECACHE_URLS')).toBe(true);
  });

  it('registers install, activate and fetch listeners', async () => {
    const text = await loadSwText();
    expect(text.includes("addEventListener('install'")).toBe(true);
    expect(text.includes("addEventListener('activate'")).toBe(true);
    expect(text.includes("addEventListener('fetch'")).toBe(true);
  });

  it('uses Promise.allSettled — never cache.addAll', async () => {
    // `addAll` is all-or-nothing: one missing asset (e.g. a not-yet-
    // shipped icon) aborts the whole install. The spec mandates
    // `allSettled` + per-asset `add` so the cache degrades gracefully.
    //
    // The check is a regex on the METHOD CALL (`.addAll(`), not on
    // the bare string `addAll`: `sw.js` documents the anti-pattern in
    // a comment ("not `addAll`"), which would trip a naive
    // `text.includes` check even though there is no actual call.
    const text = await loadSwText();
    expect(text.includes('Promise.allSettled')).toBe(true);
    expect(/\.addAll\s*\(/.test(text)).toBe(false);
  });

  it('contains no console.log or console.error', async () => {
    // Production code: zero `console.*`. DevTools covers debugging.
    // The spec explicitly forbids logging in sw.js — failures are
    // swallowed silently.
    const text = await loadSwText();
    expect(text.includes('console.log')).toBe(false);
    expect(text.includes('console.error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sw.js — Precache-Liste
// ---------------------------------------------------------------------------

describe('sw.js — Precache-Liste', () => {
  it('contains the mandatory entry points', async () => {
    const text = await loadSwText();
    const list = extractPrecacheList(text);
    // Every one of these is load-bearing for offline boot:
    //   - index.html    → shell markup
    //   - app.js        → module entry point (imports everything else)
    //   - quests.json   → quest data (fetch is NOT cached separately)
    //   - main.css      → base styles (imports the other CSS files)
    //   - xterm.js      → terminal UMD bundle
    expect(list.includes("'./index.html'")).toBe(true);
    expect(list.includes("'./js/app.js'")).toBe(true);
    expect(list.includes("'./data/quests.json'")).toBe(true);
    expect(list.includes("'./css/main.css'")).toBe(true);
    expect(list.includes("'./vendor/xterm/xterm.js'")).toBe(true);
  });

  it('contains only relative paths (all start with ./)', async () => {
    const text = await loadSwText();
    const list = extractPrecacheList(text);
    // An absolute path in the list is a quoted string starting with
    // '/'. On a GitHub-Pages project page the app lives under
    // `/<repo>/`, so absolute paths 404 and the precache silently
    // drops them. The regex must NOT match.
    const absoluteMatch = list.match(/'\/[^']+'/);
    expect(absoluteMatch).toBe(null);
  });
});