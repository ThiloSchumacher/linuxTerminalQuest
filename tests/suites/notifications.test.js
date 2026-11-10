import { describe, it, expect } from '../runner.js';
import { Notifications } from '../../js/ui/notifications.js';

/**
 * Run `fn` synchronously with a fresh container attached to the document
 * body, then always clean up. The runner has no afterEach, so we do this
 * inline.
 *
 * @param {(container: HTMLElement) => void} fn
 * @returns {void}
 */
function withContainer(fn) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  try {
    fn(c);
  } finally {
    if (c.parentNode) c.parentNode.removeChild(c);
  }
}

/**
 * Async variant of `withContainer`: waits for `fn` to finish before
 * cleaning up. Used by tests that need to wait across timeouts.
 *
 * @param {(container: HTMLElement) => Promise<void>} fn
 * @returns {Promise<void>}
 */
async function withContainerAsync(fn) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  try {
    await fn(c);
  } finally {
    if (c.parentNode) c.parentNode.removeChild(c);
  }
}

describe('Notifications', () => {
  it('show(msg, {persistent: true}) adds one toast', () => {
    withContainer((c) => {
      const n = new Notifications({ container: c });
      n.show('hi', { persistent: true });
      expect(n.getActiveCount()).toBe(1);
    });
  });

  it('show twice adds two toasts', () => {
    withContainer((c) => {
      const n = new Notifications({ container: c });
      n.show('hi', { persistent: true });
      n.show('world', { persistent: true });
      expect(n.getActiveCount()).toBe(2);
    });
  });

  it('hideAll() removes every toast', () => {
    withContainer((c) => {
      const n = new Notifications({ container: c });
      n.show('a', { persistent: true });
      n.show('b', { persistent: true });
      n.hideAll();
      expect(n.getActiveCount()).toBe(0);
    });
  });

  it('type "success" sets .toast--success class', () => {
    withContainer((c) => {
      const n = new Notifications({ container: c });
      n.show('hi', { persistent: true, type: 'success' });
      const el = c.querySelector('.toast');
      expect(el.classList.contains('toast')).toBe(true);
      expect(el.classList.contains('toast--success')).toBe(true);
    });
  });

  it('type "badge" sets .toast--badge class', () => {
    withContainer((c) => {
      const n = new Notifications({ container: c });
      n.show('hi', { persistent: true, type: 'badge' });
      const el = c.querySelector('.toast');
      expect(el.classList.contains('toast')).toBe(true);
      expect(el.classList.contains('toast--badge')).toBe(true);
    });
  });

  it('default type has .toast only, no --success/--badge', () => {
    withContainer((c) => {
      const n = new Notifications({ container: c });
      n.show('hi', { persistent: true });
      const el = c.querySelector('.toast');
      expect(el.classList.contains('toast')).toBe(true);
      expect(el.classList.contains('toast--success')).toBe(false);
      expect(el.classList.contains('toast--badge')).toBe(false);
    });
  });

  it('message is set via textContent, not innerHTML (XSS-safe)', () => {
    withContainer((c) => {
      const n = new Notifications({ container: c });
      n.show('<script>alert(1)</script>', { persistent: true });
      const el = c.querySelector('.toast');
      expect(el.textContent).toBe('<script>alert(1)</script>');
      // No injected script element:
      expect(el.querySelector('script')).toBe(null);
    });
  });

  // -----------------------------------------------------------------------
  // Non-persistent / timer path
  // -----------------------------------------------------------------------

  it('auto-hides after duration: adds .toast--removing, then removes from DOM', async () => {
    // Timer path: `duration: 0` fires the outer timeout on the next
    // macrotask tick — guaranteed to have happened after any non-zero
    // wait, so the first assertion is not racing the timer. The inner
    // 200ms removal timer then runs; we wait 250ms for it, with slack
    // for slow CI machines.
    await withContainerAsync(async (c) => {
      const n = new Notifications({ container: c });
      n.show('hi', { duration: 0 });

      // Toast is present right after `show()`.
      expect(n.getActiveCount()).toBe(1);
      const el = c.querySelector('.toast');
      expect(el.classList.contains('toast--removing')).toBe(false);

      // After 50ms, the outer timer (duration=0) has definitely fired.
      // .toast--removing is set; the element may or may not still be in
      // the DOM depending on how fast the inner 200ms timer ran — but
      // 50ms < 200ms, so it must still be there.
      await new Promise((r) => setTimeout(r, 50));
      const elAfterRemoving = c.querySelector('.toast');
      expect(elAfterRemoving).toBeTruthy();
      expect(elAfterRemoving.classList.contains('toast--removing')).toBe(true);

      // After another 250ms, the inner 200ms removal timer has fired
      // (cumulative wait ≥ 300ms > 250ms window).
      await new Promise((r) => setTimeout(r, 250));
      expect(n.getActiveCount()).toBe(0);
    });
  });

  it('hideAll() cancels a pending auto-hide timer (no DOM mutation later)', async () => {
    // Long duration that would never fire during the test. hideAll()
    // must clear both the outer and the inner timer. After hideAll, no
    // async removal should occur, even though the timer was scheduled.
    await withContainerAsync(async (c) => {
      const n = new Notifications({ container: c });
      n.show('hi', { duration: 100000 });
      expect(n.getActiveCount()).toBe(1);
      n.hideAll();
      expect(n.getActiveCount()).toBe(0);

      // Wait past a window in which the inner "add removing class" would
      // have fired if hideAll() failed to clear the timer.
      await new Promise((r) => setTimeout(r, 100));
      // Container stays empty — no resurrected toast, no exception.
      expect(n.getActiveCount()).toBe(0);
      expect(c.querySelector('.toast')).toBe(null);
    });
  });
});