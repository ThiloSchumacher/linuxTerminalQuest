/**
 * Mini test runner for BashQuest.
 *
 * Public API:
 *   describe(name, fn)        — register a test suite
 *   it(name, fn)              — register a test (sync OR async)
 *   expect(value)             — assertion helpers
 *   run(container)            — execute all tests (async)
 *
 * `it` callbacks may be synchronous or async; `run()` awaits each
 * callback in registration order, so Promise-based tests run their
 * assertions before the suite advances. `run()` returns a Promise that
 * callers may either `await` or ignore — fire-and-forget is safe
 * because `run()` catches every per-test failure internally and reports
 * it in the container; it never rejects as long as `container` is a
 * valid element.
 *
 * Supported expect matchers:
 *   toBe(expected)        — strict equality (===)
 *   toEqual(expected)     — deep equality (arrays + plain objects)
 *   toThrow()             — function throws (sync only)
 *   toBeTruthy()          — !!actual === true
 *   toBeFalsy()           — !!actual === false
 *   toBeNull()            — actual === null
 *   toBeUndefined()       — actual === undefined
 *
 * Failure messages use `describeValue`, not `JSON.stringify`: the latter
 * returns `undefined` (not a string) for `undefined`, "null" for `NaN`,
 * and throws on `Symbol`/`BigInt`. `describeValue` produces readable,
 * type-tagged strings for every possible value.
 *
 * UI contract (optional but supported by the current page): if the
 * page provides `#summary` and/or `#meta` elements, they are updated
 * with pass/fail counts. The `.suite`, `.test`, `.pass`, `.fail` and
 * `.detail` classes on rendered elements are part of the styling
 * contract.
 */

const suites = [];
let currentSuite = null;

/**
 * @param {string} name
 * @param {() => void} fn
 * @returns {void}
 */
export function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  const prev = currentSuite;
  currentSuite = suite;
  try {
    fn();
  } finally {
    currentSuite = prev;
  }
}

/**
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 * @returns {void}
 */
export function it(name, fn) {
  if (!currentSuite) {
    throw new Error('it() called outside describe()');
  }
  currentSuite.tests.push({ name, fn });
}

/**
 * Deep equality used by `toEqual`: arrays by element, objects by own
 * enumerable keys, primitives by `===`.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k])) return false;
  }
  return true;
}

/**
 * Render a value for a failure message.
 *
 * Compared to `JSON.stringify`, this helper:
 *  - never throws (Symbol/BigInt safe),
 *  - distinguishes `undefined` from the string "undefined",
 *  - does not misrender `NaN` as `null`,
 *  - escapes control characters in strings (uses `JSON.stringify` for
 *    strings specifically, so `'\n'` renders as `"\n"`).
 *
 * Simple numbers and booleans pass through `String()` without quotes so
 * the message reads naturally for the common case.
 *
 * @param {unknown} value
 * @returns {string}
*/
function describeValue(value) {
  const type = typeof value;
  if (value === null) return 'null';
  if (type === 'undefined') return 'undefined';
  // JSON.stringify is safe for strings (never circular) and escapes
  // control characters (\n, \t, quotes), so a failure message stays
  // single-line and readable.
  if (type === 'string') return JSON.stringify(value);
  if (type === 'number') return Number.isNaN(value) ? 'NaN' : String(value);
  if (type === 'boolean') return String(value);
  if (type === 'bigint') return `${String(value)}n (bigint)`;
  // String(Symbol(…)) already includes the "Symbol(…)" wrapper; a type
  // suffix would duplicate the word "Symbol" in the output.
  if (type === 'symbol') return String(value);
  if (type === 'function') return `[function ${value.name || 'anonymous'}]`;
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * Assertion entry point.
 *
 * @param {unknown} actual
 * @returns {{
 *   toBe: (expected: unknown) => void,
 *   toEqual: (expected: unknown) => void,
 *   toThrow: () => void,
 *   toBeTruthy: () => void,
 *   toBeFalsy: () => void,
 *   toBeNull: () => void,
 *   toBeUndefined: () => void,
 * }}
 */
export function expect(actual) {
  const fail = (msg) => {
    throw new Error(msg);
  };
  return {
    toBe(expected) {
      if (actual !== expected) {
        fail(`expected ${describeValue(expected)}, got ${describeValue(actual)}`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) {
        fail(`expected ${describeValue(expected)}, got ${describeValue(actual)}`);
      }
    },
    toThrow() {
      if (typeof actual !== 'function') {
        fail('toThrow() called on non-function');
      }
      let threw = false;
      try {
        /** @type {Function} */ (actual)();
      } catch {
        threw = true;
      }
      if (!threw) fail('expected function to throw');
    },
    toBeTruthy() {
      if (!actual) {
        fail(`expected truthy value, got ${describeValue(actual)}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        fail(`expected falsy value, got ${describeValue(actual)}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        fail(`expected null, got ${describeValue(actual)}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        fail(`expected undefined, got ${describeValue(actual)}`);
      }
    },
  };
}

/**
 * Run all registered suites and render results into `container`.
 *
 * Returns a Promise that resolves after all tests have run. Callers may
 * `await` it or fire-and-forget — the function never rejects as long as
 * `container` is a valid element (per-test failures are reported, not
 * re-thrown).
 *
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function run(container) {
  const meta = document.getElementById('meta');
  const summary = document.getElementById('summary');

  if (typeof container.replaceChildren === 'function') {
    container.replaceChildren();
  }

  let totalTests = 0;
  let passed = 0;
  let failed = 0;

  for (const suite of suites) {
    const suiteEl = document.createElement('div');
    suiteEl.className = 'suite';
    suiteEl.textContent = suite.name;
    container.appendChild(suiteEl);

    for (const test of suite.tests) {
      totalTests++;
      const testEl = document.createElement('div');
      testEl.className = 'test';
      try {
        await test.fn();
        testEl.classList.add('pass');
        testEl.textContent = `✓ ${test.name}`;
        passed++;
      } catch (err) {
        testEl.classList.add('fail');
        testEl.textContent = `✗ ${test.name}`;
        const detail = document.createElement('span');
        detail.className = 'detail';
        detail.textContent = err && err.stack ? err.stack : String(err);
        testEl.appendChild(detail);
        failed++;
      }
      container.appendChild(testEl);
    }
  }

  if (meta) {
    meta.textContent = `${suites.length} suites, ${totalTests} tests`;
  }
  if (summary) {
    summary.classList.add('visible');
    if (failed === 0) {
      summary.classList.add('ok');
      summary.textContent = `Alle ${totalTests} Tests grün.`;
    } else {
      summary.classList.add('bad');
      summary.textContent = `${failed} von ${totalTests} Tests rot, ${passed} grün.`;
    }
  }
}