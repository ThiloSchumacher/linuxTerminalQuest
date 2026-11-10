/**
 * `tr` — translate characters from stdin.
 *
 * ## V1 scope
 *
 * Two sets required (`tr SET1 SET2`). Translation only — `-d`, `-s`,
 * `-c` are NOT supported.
 *
 * ## Flag-shaped arguments
 *
 * `tr` does NOT use `_helpers.parseFlags`, because the sets themselves
 * may contain `-` (e.g. `tr a-z A-Z` — the range `a-z` contains a
 * hyphen; `parseFlags` would mis-classify it as a flag). Instead, the
 * command rejects any argument of length > 1 that starts with `-`
 * before parsing sets:
 *
 *     tr -d abc  → `tr: invalid option -- 'd'`, exit 2
 *     tr -- …    → `tr: invalid option -- '-'`, exit 2
 *
 * **`--` is NOT a terminator** in V1 (unlike `head`/`tail`/`sort`,
 * which parse flags with `parseFlags`). A bare `-` (single char) IS
 * allowed as a literal set of one character.
 *
 * The flag-check runs BEFORE the `argv.length < 2` check, so
 * `tr -d` (one flag-shaped arg) reports `invalid option -- 'd'`
 * rather than the less specific `V1 requires two sets`. Pinned by the
 * test `['-d'] (single flag, no set) reports invalid option (not
 * 'V1 requires two sets')`.
 *
 * A single NON-flag set (no SET2) → `tr: V1 requires two sets
 * (translation only)`, exit 2 (V1 error, not silent).
 *
 * If SET2 is shorter than SET1, its last character is reused for all
 * remaining SET1 characters (POSIX behaviour). If SET2 is EMPTY, all
 * characters from SET1 are DELETED — a sensible fallback that preserves
 * the "shorter set2" rule.
 *
 * No FILE argument in V1 — input comes from stdin only. Without stdin:
 * `tr: missing input (use with pipe)`, exit 2.
 *
 * ## Set syntax
 *
 * - Literal characters: `'abc'` → `['a', 'b', 'c']`.
 * - Ranges: `'a-z'` → a, b, …, z. Descending ranges (`'z-a'`) are
 *   rejected: `tr: invalid range: z-a`, exit 2.
 * - Backslash escapes: `\n` (newline), `\t` (tab), `\\` (backslash).
 *   Other `\x` sequences are kept literally (`\x` = `\` + `x`).
 *
 * Sets are `Array.from(str)` — UTF-8 safe (each codepoint is one
 * element). Multi-codepoint graphemes are NOT collapsed in V1.
 *
 * ## Warning — SIGPIPE
 *
 * V1 has no SIGPIPE (spec007c §2.5). Piping unbounded output into
 * `tr` (e.g. `yes | tr a b`) will not terminate — the producer runs
 * forever. Terminate with Ctrl+C.
 *
 * @module shell/commands/tr
 */

/**
 * Parse a set string into an array of characters (with ranges and
 * escapes expanded).
 *
 * @param {string} str
 * @returns {{chars: string[], error?: string}}
 */
function parseSet(str) {
  const result = [];
  const chars = Array.from(str);
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === '\\' && i + 1 < chars.length) {
      const next = chars[i + 1];
      if (next === 'n') { result.push('\n'); i += 2; continue; }
      if (next === 't') { result.push('\t'); i += 2; continue; }
      if (next === '\\') { result.push('\\'); i += 2; continue; }
      // Unknown escape: keep both chars as literals.
      result.push('\\');
      i += 1;
      continue;
    }
    if (i + 2 < chars.length && chars[i + 1] === '-') {
      const start = chars[i];
      const end = chars[i + 2];
      const startCode = start.codePointAt(0);
      const endCode = end.codePointAt(0);
      if (startCode > endCode) {
        return { chars: [], error: `invalid range: ${start}-${end}` };
      }
      for (let code = startCode; code <= endCode; code++) {
        result.push(String.fromCodePoint(code));
      }
      i += 3;
      continue;
    }
    result.push(c);
    i += 1;
  }
  return { chars: result };
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const tr = {
  name: 'tr',
  usage: 'tr SET1 SET2',
  description: 'Ersetzt Zeichen aus stdin.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, stdin }) {
    // Step 1: no args at all.
    if (argv.length === 0) {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 2 };
    }

    // Step 2: reject flag-shaped args BEFORE the count-check. See the
    // module JSDoc "Flag-shaped arguments" for the ordering rationale.
    // A bare `-` (single char) is allowed as a literal set.
    for (const arg of argv) {
      if (arg.length > 1 && arg.startsWith('-')) {
        return {
          stdout: '',
          stderr: `${name}: invalid option -- '${arg[1]}'\n`,
          exitCode: 2,
        };
      }
    }

    // Step 3: count check (a single non-flag set → V1 requires two).
    if (argv.length < 2) {
      return {
        stdout: '',
        stderr: `${name}: V1 requires two sets (translation only)\n`,
        exitCode: 2,
      };
    }

    const set1 = parseSet(argv[0]);
    if (set1.error) {
      return { stdout: '', stderr: `${name}: ${set1.error}\n`, exitCode: 2 };
    }
    const set2 = parseSet(argv[1]);
    if (set2.error) {
      return { stdout: '', stderr: `${name}: ${set2.error}\n`, exitCode: 2 };
    }

    if (typeof stdin !== 'string') {
      return {
        stdout: '',
        stderr: `${name}: missing input (use with pipe)\n`,
        exitCode: 2,
      };
    }

    // Build a translation map: set1[i] → set2[min(i, len(set2)-1)].
    // If set2 is empty, all set1 characters map to '' (deletion).
    /** @type {Map<string, string>} */
    const map = new Map();
    for (let i = 0; i < set1.chars.length; i++) {
      const from = set1.chars[i];
      const to = set2.chars.length === 0
        ? ''
        : set2.chars[Math.min(i, set2.chars.length - 1)];
      map.set(from, to);
    }

    let out = '';
    for (const ch of Array.from(stdin)) {
      out += map.has(ch) ? map.get(ch) : ch;
    }
    return { stdout: out, stderr: '', exitCode: 0 };
  },
};