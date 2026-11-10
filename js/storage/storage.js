/**
 * Storage — thin wrapper around localStorage with prefix + version
 * isolation.
 *
 * Key format: `${prefix}-v${version}.${key}`. A version bump isolates
 * old data automatically (old keys remain in localStorage but are no
 * longer read; they will eventually be reclaimed by the browser's
 * quota eviction).
 *
 * All methods are silent on failure (privacy mode, quota exceeded,
 * disabled storage). No `console.log`, no throws — persistence is
 * best-effort in V1.
 *
 * @module storage/storage
 */

export class Storage {
  /**
   * @param {object} [opts]
   * @param {string} [opts.prefix='bashquest']
   * @param {number} [opts.version=1]
   */
  constructor({ prefix = 'bashquest', version = 1 } = {}) {
    this._prefix = prefix;
    this._version = version;
  }

  /**
   * Full localStorage key for `key`.
   *
   * @param {string} key
   * @returns {string}
   */
  _fullKey(key) {
    return `${this._prefix}-v${this._version}.${key}`;
  }

  /**
   * Serialize and store. Silent on failure.
   *
   * @param {string} key
   * @param {unknown} value
   * @returns {void}
   */
  save(key, value) {
    try {
      localStorage.setItem(this._fullKey(key), JSON.stringify(value));
    } catch {
      // Silent — persistence is best-effort in V1.
    }
  }

  /**
   * Load and deserialize.
   *
   * Returns `fallback` when:
   *  - the key does not exist,
   *  - the stored value is not valid JSON,
   *  - localStorage itself throws (privacy mode).
   *
   * A stored `null` is returned as `null` (not `fallback`) — the caller
   * distinguishes "no value" (fallback) from "explicitly null" (null).
   * Same for `''` and `0`: only `getItem` returning `null` (key missing)
   * triggers the fallback.
   *
   * @param {string} key
   * @param {unknown} fallback
   * @returns {unknown}
   */
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(this._fullKey(key));
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  /**
   * Remove a single key (owned by this Storage instance).
   *
   * @param {string} key
   * @returns {void}
   */
  remove(key) {
    try {
      localStorage.removeItem(this._fullKey(key));
    } catch {
      // Silent.
    }
  }

  /**
   * Remove all keys this Storage instance owns (same prefix + version).
   * Keys from other instances (different prefix or version) are
   * untouched.
   *
   * @returns {void}
   */
  clear() {
    try {
      const prefixWithVersion = `${this._prefix}-v${this._version}.`;
      /** @type {string[]} */
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefixWithVersion)) {
          toRemove.push(k);
        }
      }
      for (const k of toRemove) {
        localStorage.removeItem(k);
      }
    } catch {
      // Silent.
    }
  }

  /**
   * Check whether localStorage is usable in this context.
   *
   * @returns {boolean}
   */
  isAvailable() {
    try {
      localStorage.setItem('__test__', '1');
      localStorage.removeItem('__test__');
      return true;
    } catch {
      return false;
    }
  }
}