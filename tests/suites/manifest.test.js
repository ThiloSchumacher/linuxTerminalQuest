import { describe, it, expect } from '../runner.js';

/**
 * Structural tests for `manifest.webmanifest` and for the SW
 * precache covering the icons it references.
 *
 * ## Path resolution (spec013b §4, corrected)
 *
 * `fetch` resolves relative URLs against the **document base URL**
 * (the URL of `tests/index.html`), NOT the module URL of this file
 * (`tests/suites/`). From `tests/`:
 *
 *   - `'../manifest.webmanifest'` → `/<repo>/manifest.webmanifest` ✓
 *   - `'../../manifest.webmanifest'` → walks above `/<repo>/` ✗
 *
 * spec013b §4 specified `'../../manifest.webmanifest'` and claimed
 * it was correct — that was a spec error, identical to the one in
 * spec013a §4 (already corrected there to `'../sw.js'`). We follow
 * the correction so the suite passes both locally and under GitHub
 * Pages project paths.
 *
 * ## Manifest `id` (spec013b §2.1, review fix)
 *
 * Spec §2.1 specified a hard-coded absolute path,
 * `"id": "/linuxTerminalQuest/"`. The review flagged this as a
 * spec error: the project hard-constraint is "all paths relative",
 * and an absolute `id` breaks on repo rename, custom domain, or a
 * deploy under a different path. The manifest now uses
 * `"id": "./"`, consistent with `start_url`/`scope`. The browser
 * treats `./` as the same app across deploys, which is what the
 * W3C manifest spec prescribes when `id` is omitted — an explicit
 * `"./"` is equivalent and more visible than leaving the field out.
 *
 * ## Manifest `icons[].src` (spec013b §2.1, kept as-specified)
 *
 * The three `src` values use the form `icons/icon-192.png` —
 * WITHOUT a `./` prefix — exactly as spec §2.1 specifies. The
 * manifest spec resolves `src` against the manifest's own URL, so
 * `icons/...` and `./icons/...` are functionally identical here.
 * Kept consistent with the spec pin; the SW precache uses its own
 * `./icons/...` form per `sw.js` module JSDoc. A future spec
 * revision may unify the two forms; until then, both are correct.
 *
 * @module tests/suites/manifest.test
 */

/**
 * Fetch a resource as text, asserting the response is OK.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function loadText(url) {
  const res = await fetch(url);
  expect(res.ok).toBe(true);
  return res.text();
}

/**
 * Fetch and JSON-parse the manifest.
 *
 * @returns {Promise<object>}
 */
async function loadManifest() {
  const text = await loadText('../manifest.webmanifest');
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// manifest.webmanifest — Struktur
// ---------------------------------------------------------------------------

describe('manifest.webmanifest — Struktur', () => {
  it('is fetchable and parses as JSON', async () => {
    // The `loadManifest` helper throws inside `JSON.parse` on invalid
    // JSON — the assertion below is a belt-and-braces "is object"
    // after parsing succeeded.
    const json = await loadManifest();
    expect(json && typeof json === 'object').toBe(true);
  });

  it('name and short_name are non-empty strings', async () => {
    const json = await loadManifest();
    expect(typeof json.name).toBe('string');
    expect(json.name.length > 0).toBe(true);
    expect(typeof json.short_name).toBe('string');
    expect(json.short_name.length > 0).toBe(true);
  });

  it('short_name is at most 15 characters (fits under home-screen icon)', async () => {
    // Chrome truncates the home-screen label at roughly 12–15
    // characters depending on locale/device; the spec allows up to
    // 15. `TerminalQuest` is 13.
    const json = await loadManifest();
    expect(json.short_name.length <= 15).toBe(true);
  });

  it('description is a non-empty string', async () => {
    const json = await loadManifest();
    expect(typeof json.description).toBe('string');
    expect(json.description.length > 0).toBe(true);
  });

  it('lang, display, start_url, scope are as specified', async () => {
    const json = await loadManifest();
    expect(json.lang).toBe('de');
    expect(json.display).toBe('standalone');
    // Both URLs relative so GitHub-Pages project paths work under
    // `/<repo>/` without a manifest rewrite.
    expect(json.start_url).toBe('./');
    expect(json.scope).toBe('./');
  });

  it('id is a relative URL, not an absolute path (spec013b §2.1 review fix)', async () => {
    // Pinned so a future contributor who re-reads spec §2.1
    // literally (which says `"/linuxTerminalQuest/"`) and "restores"
    // the absolute path breaks this test, not production. Rationale
    // is in the module JSDoc above.
    const json = await loadManifest();
    expect(json.id).toBe('./');
  });

  it('theme_color and background_color match the dark theme', async () => {
    // Must match theme.js / css/main.css --bg. A mismatch would show
    // a flash of a different colour during splash → first paint.
    const json = await loadManifest();
    expect(json.theme_color).toBe('#0f172a');
    expect(json.background_color).toBe('#0f172a');
  });

  it('categories includes "education"', async () => {
    const json = await loadManifest();
    expect(Array.isArray(json.categories)).toBe(true);
    expect(json.categories.includes('education')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// manifest.webmanifest — Icons
// ---------------------------------------------------------------------------

describe('manifest.webmanifest — Icons', () => {
  it('has exactly three icons (192/512/maskable-512)', async () => {
    const json = await loadManifest();
    expect(Array.isArray(json.icons)).toBe(true);
    expect(json.icons.length).toBe(3);
  });

  it('has an "any" 192x192 icon', async () => {
    const json = await loadManifest();
    const icon = json.icons.find(
      (i) => i.sizes === '192x192' && i.purpose === 'any',
    );
    expect(icon !== undefined).toBe(true);
  });

  it('has an "any" 512x512 icon', async () => {
    const json = await loadManifest();
    const icon = json.icons.find(
      (i) => i.sizes === '512x512' && i.purpose === 'any',
    );
    expect(icon !== undefined).toBe(true);
  });

  it('has a "maskable" 512x512 icon', async () => {
    const json = await loadManifest();
    const icon = json.icons.find(
      (i) => i.sizes === '512x512' && i.purpose === 'maskable',
    );
    expect(icon !== undefined).toBe(true);
  });

  it('every icon src starts with "icons/" and ends with ".png"', async () => {
    // `src` values intentionally omit the `./` prefix — spec013b
    // §2.1 specifies them as `icons/icon-192.png` etc. The manifest
    // spec resolves `src` against the manifest's own URL, so
    // `icons/...` and `./icons/...` are functionally identical here.
    // This is a spec pin, not an oversight; see module JSDoc.
    const json = await loadManifest();
    for (const icon of json.icons) {
      expect(icon.src.startsWith('icons/')).toBe(true);
      expect(icon.src.endsWith('.png')).toBe(true);
    }
  });

  it('every icon has type "image/png"', async () => {
    const json = await loadManifest();
    for (const icon of json.icons) {
      expect(icon.type).toBe('image/png');
    }
  });
});

// ---------------------------------------------------------------------------
// sw.js — Icons im Precache
// ---------------------------------------------------------------------------

describe('sw.js — Icons im Precache', () => {
  it('precaches all three manifest icons', async () => {
    // The icons are referenced by the manifest, but the SW must cache
    // them explicitly — otherwise an offline install would show a
    // broken image in the tab / splash. `PRECACHE_URLS` is the single
    // source of truth for "what the app needs offline".
    const text = await loadText('../sw.js');
    expect(text.includes("'./icons/icon-192.png'")).toBe(true);
    expect(text.includes("'./icons/icon-512.png'")).toBe(true);
    expect(text.includes("'./icons/icon-maskable-512.png'")).toBe(true);
  });
});