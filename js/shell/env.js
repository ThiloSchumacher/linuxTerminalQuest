/**
 * Shell environment variable store.
 *
 * Values are always coerced to strings on `set`, matching POSIX shell
 * semantics (every environment entry is a byte string). No expansion,
 * no defaults — that is the shell's job, not the env's.
 *
 * @module shell/env
 */

/**
 * Mutable environment, backed by a `Map` so that keys like `__proto__`
 * or `constructor` cannot trigger prototype pollution on the internal
 * store.
 */
export class Env {
  /**
   * @param {Object<string, string|number|boolean>} [initial={}]
   */
  constructor(initial = {}) {
    /** @type {Map<string, string>} */
    this._map = new Map();
    for (const [key, value] of Object.entries(initial)) {
      this._map.set(key, String(value));
    }
  }

  /**
   * @param {string} key
   * @returns {string|undefined}
   */
  get(key) {
    return this._map.get(key);
  }

  /**
   * @param {string} key
   * @param {string|number|boolean} value
   * @returns {void}
   */
  set(key, value) {
    this._map.set(key, String(value));
  }

  /**
   * @param {string} key
   * @returns {void}
   */
  delete(key) {
    this._map.delete(key);
  }

  /**
   * Snapshot of the environment as a plain object.
   *
   * The output object has a `null` prototype so that keys such as
   * `__proto__` survive the round-trip as own properties instead of
   * hitting `Object.prototype.__proto__`'s setter.
   *
   * @returns {Object<string, string>}
   */
  toObject() {
    /** @type {Object<string, string>} */
    const out = Object.create(null);
    for (const [key, value] of this._map) {
      out[key] = value;
    }
    return out;
  }
}