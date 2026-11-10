import { describe, it, expect } from '../runner.js';
import { Storage } from '../../js/storage/storage.js';

/**
 * Unique prefix per test — avoids cross-test localStorage pollution.
 *
 * @returns {string}
 */
function uniquePrefix() {
  return 'test-' + Math.random().toString(36).slice(2);
}

/**
 * Compute the full localStorage key for a `Storage` instance without
 * accessing its private fields from test code (mirror of the internal
 * format from spec006a §2).
 *
 * @param {string} prefix
 * @param {number} version
 * @param {string} key
 * @returns {string}
 */
function fullKey(prefix, version, key) {
  return `${prefix}-v${version}.${key}`;
}

describe('Storage — roundtrip', () => {
  it('stores and retrieves an object', () => {
    const prefix = uniquePrefix();
    const s = new Storage({ prefix });
    try {
      s.save('k', { a: 1 });
      expect(s.load('k', null)).toEqual({ a: 1 });
    } finally {
      s.clear();
    }
  });

  it('stores and retrieves an array', () => {
    const prefix = uniquePrefix();
    const s = new Storage({ prefix });
    try {
      s.save('k', [1, 2, 3]);
      expect(s.load('k', [])).toEqual([1, 2, 3]);
    } finally {
      s.clear();
    }
  });

  it('stores and retrieves a string', () => {
    const prefix = uniquePrefix();
    const s = new Storage({ prefix });
    try {
      s.save('k', 'string');
      expect(s.load('k', '')).toBe('string');
    } finally {
      s.clear();
    }
  });

  it('stores and retrieves the number 0 (not treated as falsy)', () => {
    const prefix = uniquePrefix();
    const s = new Storage({ prefix });
    try {
      s.save('k', 0);
      expect(s.load('k', -1)).toBe(0);
    } finally {
      s.clear();
    }
  });

  it('stores and retrieves null (returns null, not fallback)', () => {
    const prefix = uniquePrefix();
    const s = new Storage({ prefix });
    try {
      s.save('k', null);
      expect(s.load('k', 'fb')).toBe(null);
    } finally {
      s.clear();
    }
  });

  it('stores and retrieves the empty string (not treated as falsy)', () => {
    const prefix = uniquePrefix();
    const s = new Storage({ prefix });
    try {
      s.save('k', '');
      expect(s.load('k', 'fb')).toBe('');
    } finally {
      s.clear();
    }
  });
});

describe('Storage — Fallback', () => {
  it('load of a missing key returns the fallback', () => {
    const prefix = uniquePrefix();
    const s = new Storage({ prefix });
    try {
      expect(s.load('unknown', 'fb')).toBe('fb');
    } finally {
      s.clear();
    }
  });

  it('load of malformed JSON returns the fallback', () => {
    const prefix = uniquePrefix();
    const version = 1;
    const s = new Storage({ prefix, version });
    try {
      localStorage.setItem(fullKey(prefix, version, 'x'), 'not-json');
      expect(s.load('x', 'fb')).toBe('fb');
    } finally {
      s.clear();
    }
  });
});

describe('Storage — remove/clear', () => {
  it('remove deletes a single key without touching the others', () => {
    const prefix = uniquePrefix();
    const s = new Storage({ prefix });
    try {
      s.save('a', 1);
      s.save('b', 2);
      s.remove('a');
      expect(s.load('a', null)).toBe(null);
      expect(s.load('b', null)).toBe(2);
    } finally {
      s.clear();
    }
  });

  it('clear removes this instance\'s keys but not other prefixes', () => {
    const prefix = uniquePrefix();
    const otherPrefix = uniquePrefix();
    const s = new Storage({ prefix });
    const other = new Storage({ prefix: otherPrefix });
    try {
      s.save('a', 1);
      s.save('b', 2);
      other.save('c', 3);
      s.clear();
      expect(s.load('a', null)).toBe(null);
      expect(s.load('b', null)).toBe(null);
      expect(other.load('c', null)).toBe(3);
    } finally {
      s.clear();
      other.clear();
    }
  });

  it('clear does not touch another version of the same prefix', () => {
    const prefix = uniquePrefix();
    const sV1 = new Storage({ prefix, version: 1 });
    const sV2 = new Storage({ prefix, version: 2 });
    try {
      sV1.save('x', 'one');
      sV2.save('x', 'two');
      sV1.clear();
      expect(sV1.load('x', null)).toBe(null);
      expect(sV2.load('x', null)).toBe('two');
    } finally {
      sV1.clear();
      sV2.clear();
    }
  });
});

describe('Storage — version isolation', () => {
  it('a version bump makes old values invisible', () => {
    const prefix = uniquePrefix();
    const v1 = new Storage({ prefix, version: 1 });
    const v2 = new Storage({ prefix, version: 2 });
    try {
      v1.save('x', 'v1-value');
      expect(v2.load('x', 'fb')).toBe('fb');
    } finally {
      v1.clear();
      v2.clear();
    }
  });
});

describe('Storage — isAvailable', () => {
  it('returns true in a normal browser context', () => {
    // Testing gap (spec006a Review Runde 1, NICE 3): the failure path
    // (Privacy Mode, quota exceeded, disabled storage) is NOT covered
    // by an automated test. Simulating it via
    // `Object.defineProperty(window, 'localStorage', { get() { throw … } })`
    // is fragile across browsers (some refuse to let the property be
    // redefined), and the try/catch structure is simple enough that
    // code review is sufficient in V1. If a future test infra can
    // simulate a blocked localStorage reliably, add a case here for
    // `isAvailable() → false` and a corresponding `load`-with-blocked-
    // storage case.
    const s = new Storage();
    expect(s.isAvailable()).toBe(true);
  });
});