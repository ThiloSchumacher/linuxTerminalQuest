/**
 * `seq` — print a sequence of numbers.
 *
 * ## Signature (POSIX-like)
 *
 *     seq [FIRST [STEP]] LAST
 *
 * - 1 arg `LAST`: 1 .. LAST, step 1.
 * - 2 args `FIRST LAST`: FIRST .. LAST, step 1.
 * - 3 args `FIRST STEP LAST`: FIRST, FIRST+STEP, …, bounded by LAST.
 * - 0 args → `seq: missing operand`, exit 2.
 * - >3 args → `seq: too many arguments`, exit 2.
 *
 * ## Numeric handling
 *
 * - `Number()`-parsed; `NaN` → `seq: invalid number: <arg>`, exit 2.
 * - `STEP = 0` → `seq: invalid step: 0`, exit 2.
 * - Negative STEP iterates backwards (requires FIRST > LAST for any
 *   output).
 *
 * ## Float precision
 *
 * Values are computed as `FIRST + i * STEP` (not iteratively summed),
 * which prevents accumulation drift like `0.30000000000004`. Output
 * formatting rounds to 6 decimals and trims trailing zeros:
 *
 *     Number.isInteger(value) → value.toString()
 *     else                    → value.toFixed(6).replace(/\.?0+$/, '')
 *
 * So `1.5` stays `1.5`, `1.500000` becomes `1.5`, `1.234560` becomes
 * `1.23456`.
 *
 * ## Flags
 *
 * No flags in V1 (no `-s`, `-w`, `-f`). An argument that starts with
 * `-`, has length > 1, and is NOT a valid number (e.g. `-h`, `-a`)
 * → `seq: invalid option -- 'x'`, exit 2. Negative numbers like `-1`,
 * `-0.5` are passed through as numeric values (NOT misread as flags).
 *
 * Does not consume stdin.
 *
 * @module shell/commands/seq
 */

/**
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  if (Number.isInteger(value)) return String(value);
  // Round to 6 decimals and strip trailing zeros. `1.234500` → `1.2345`,
  // `2.000000` would be caught by Number.isInteger above.
  return value.toFixed(6).replace(/\.?0+$/, '');
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const seq = {
  name: 'seq',
  usage: 'seq [FIRST [STEP]] LAST',
  description: 'Gibt eine Zahlenfolge aus.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    if (argv.length === 0) {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 2 };
    }
    if (argv.length > 3) {
      return { stdout: '', stderr: `${name}: too many arguments\n`, exitCode: 2 };
    }

    // Flag check: a leading `-` is a negative number if it parses; only
    // reject if it doesn't. This preserves `seq -1 5` (= FIRST=-1,
    // LAST=5) while still rejecting real flags like `-h`.
    for (const arg of argv) {
      if (arg.length > 1 && arg.startsWith('-') && Number.isNaN(Number(arg))) {
        return {
          stdout: '',
          stderr: `${name}: invalid option -- '${arg[1]}'\n`,
          exitCode: 2,
        };
      }
    }

    let first;
    let step;
    let last;
    if (argv.length === 1) {
      first = 1;
      step = 1;
      last = Number(argv[0]);
    } else if (argv.length === 2) {
      first = Number(argv[0]);
      step = 1;
      last = Number(argv[1]);
    } else {
      first = Number(argv[0]);
      step = Number(argv[1]);
      last = Number(argv[2]);
    }

    if (Number.isNaN(first)) {
      return { stdout: '', stderr: `${name}: invalid number: ${argv[0]}\n`, exitCode: 2 };
    }
    if (Number.isNaN(last)) {
      const lastArg = argv[argv.length - 1];
      return { stdout: '', stderr: `${name}: invalid number: ${lastArg}\n`, exitCode: 2 };
    }
    if (argv.length === 3 && Number.isNaN(step)) {
      return { stdout: '', stderr: `${name}: invalid number: ${argv[1]}\n`, exitCode: 2 };
    }
    if (step === 0) {
      return { stdout: '', stderr: `${name}: invalid step: 0\n`, exitCode: 2 };
    }

    // Number of values: floor of the range / |step|, plus 1. If the
    // range is empty (FIRST > LAST with positive step, or FIRST < LAST
    // with negative step), we get <= 0 → no output.
    //
    // Epsilon tolerance: `(1.3 - 1) / 0.1` in IEEE-754 is
    // `2.9999999999999996`, so a raw `floor` would drop the last value
    // (3 iterations instead of the correct 4). `1e-10` covers this
    // rounding drift with ~5 orders of magnitude headroom for typical
    // `seq` values (drift is ~1e-14); `Number.EPSILON` (~2.2e-16)
    // would be too tight. Rigorous float handling would require
    // rational arithmetic — out of V1 scope.
    //
    // The value passed to `formatNumber` is still `first + i * step`
    // (no accumulation), so no separate fix is needed on the emission
    // side.
    const span = step > 0 ? (last - first) / step : (first - last) / -step;
    const iterations = Math.floor(span + 1e-10) + 1;
    if (iterations <= 0 || !Number.isFinite(iterations)) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    let stdout = '';
    for (let i = 0; i < iterations; i++) {
      // Compute value from first + i*step to avoid float accumulation.
      stdout += formatNumber(first + i * step) + '\n';
    }
    return { stdout, stderr: '', exitCode: 0 };
  },
};