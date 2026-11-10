/**
 * Notifications — transient toast messages stacked in a fixed corner.
 *
 * Each toast is a `<div class="toast toast--<type>">` appended to the
 * container. Non-persistent toasts auto-hide after `duration` ms: the
 * `.toast--removing` class triggers the fade-out animation, then the
 * element is removed from the DOM. `hideAll()` cancels any pending
 * auto-hide timers and removes every toast immediately.
 *
 * XSS-safe: message text is set via `textContent`, never `innerHTML`.
 *
 * For tests: `show(msg, { persistent: true })` creates a toast without
 * scheduling any timers, so tests can assert synchronously and use
 * `hideAll()` to clean up.
 *
 * @module ui/notifications
 */
export class Notifications {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container  Element that hosts the toasts.
   * @param {number} [opts.defaultDuration=3000] Default auto-hide time
   *   in milliseconds when `opts.duration` is not supplied to `show`.
   */
  constructor({ container, defaultDuration = 3000 }) {
    this._container = container;
    this._defaultDuration = defaultDuration;
    /**
     * Maps a toast element to its list of pending timeout handles, so
     * `hideAll()` can cancel both the "start fading" and the "remove
     * after fade" timers. Entries are deleted when the toast's own
     * auto-remove fires, or when `hideAll()` processes it.
     *
     * @type {Map<HTMLElement, number[]>}
     */
    this._timers = new Map();
  }

  /**
   * Show a toast.
   *
   * @param {string} message
   * @param {object} [opts]
   * @param {'info'|'success'|'badge'} [opts.type='info']
   * @param {number} [opts.duration]   Milliseconds; defaults to
   *   `defaultDuration` from the constructor.
   * @param {boolean} [opts.persistent=false] If true, no auto-hide.
   * @returns {void}
   */
  show(message, opts = {}) {
    const {
      type = 'info',
      duration = this._defaultDuration,
      persistent = false,
    } = opts;

    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = message;
    this._container.appendChild(el);

    if (!persistent) {
      const timers = [];
      // Timer 1: after `duration`, add the fade-out class and schedule
      //           the actual DOM removal 200ms later (matching the CSS
      //           `.toast--removing` animation duration).
      timers.push(
        setTimeout(() => {
          el.classList.add('toast--removing');
          timers.push(
            setTimeout(() => {
              if (el.parentNode) el.parentNode.removeChild(el);
              this._timers.delete(el);
            }, 200),
          );
        }, duration),
      );
      this._timers.set(el, timers);
    }
  }

  /**
   * Remove all toasts immediately. Cancels any pending auto-hide timers.
   *
   * @returns {void}
   */
  hideAll() {
    const toasts = Array.from(this._container.querySelectorAll('.toast'));
    for (const el of toasts) {
      const timers = this._timers.get(el);
      if (timers) {
        for (const t of timers) clearTimeout(t);
        this._timers.delete(el);
      }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }

  /**
   * Number of toasts currently attached to the DOM. Reflects what the
   * user can see, not the number of pending timers.
   *
   * @returns {number}
   */
  getActiveCount() {
    return this._container.querySelectorAll('.toast').length;
  }
}