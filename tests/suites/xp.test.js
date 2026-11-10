import { describe, it, expect } from '../runner.js';
import { XP } from '../../js/gamification/xp.js';

/**
 * Assert that `fn` throws with `.code === 'EINVAL'`.
 *
 * @param {() => void} fn
 * @returns {void}
 */
function expectEINVAL(fn) {
  try {
    fn();
  } catch (err) {
    expect(err.code).toBe('EINVAL');
    return;
  }
  throw new Error('expected EINVAL, none was thrown');
}

describe('XP', () => {
  it('starts at 0 by default', () => {
    expect(new XP().getTotal()).toBe(0);
  });

  it('starts at a custom initial value', () => {
    expect(new XP(50).getTotal()).toBe(50);
  });

  it('add() increases the total', () => {
    const xp = new XP(50);
    xp.add(10);
    expect(xp.getTotal()).toBe(60);
  });

  it('add() accumulates across calls', () => {
    const xp = new XP(0);
    xp.add(10);
    xp.add(20);
    expect(xp.getTotal()).toBe(30);
  });

  it('add(0) throws EINVAL', () => {
    expectEINVAL(() => new XP().add(0));
  });

  it('add(-5) throws EINVAL', () => {
    expectEINVAL(() => new XP().add(-5));
  });

  it('add(1.5) throws EINVAL', () => {
    expectEINVAL(() => new XP().add(1.5));
  });

  it('reset() sets the total back to 0', () => {
    const xp = new XP(100);
    xp.add(50);
    xp.reset();
    expect(xp.getTotal()).toBe(0);
  });
});