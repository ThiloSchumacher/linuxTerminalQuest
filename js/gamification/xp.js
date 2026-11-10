/**
 * XP tracker — accumulating experience points total.
 *
 * No levels, no thresholds, no calculation beyond summation. Level
 * system comes in a later spec.
 *
 * @module gamification/xp
 */
export class XP {
  /**
   * @param {number} [initial=0] Starting total. Not validated against
   *   the integer/positive constraint that `add` enforces — the caller
   *   is expected to pass a sensible seed (normally 0, or a persisted
   *   value once spec006 lands). Negative initial values are accepted
   *   as-is; validation of `add`'s amount is what the spec pins.
   */
  constructor(initial = 0) {
    /** @type {number} */
    this._total = initial;
  }

  /**
   * Add experience points.
   *
   * @param {number} amount  Must be a positive integer.
   * @returns {void}
   * @throws {Error} with `.code = 'EINVAL'` if `amount` is not a
   *   positive integer (0, negative, fractional, NaN, etc.).
   */
  add(amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
      const err = new Error('XP amount must be a positive integer');
      err.code = 'EINVAL';
      throw err;
    }
    this._total += amount;
  }

  /**
   * @returns {number} Current accumulated XP.
   */
  getTotal() {
    return this._total;
  }

  /**
   * Reset the total to 0. Used by the future "Neustart" button and by
   * persistence (spec006) on a clean session.
   *
   * @returns {void}
   */
  reset() {
    this._total = 0;
  }
}