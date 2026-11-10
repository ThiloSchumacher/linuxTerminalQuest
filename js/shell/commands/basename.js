/**
 * `basename` — last path component (string operation, no VFS lookup).
 *
 * ## Signature
 *
 *     basename PATH [SUFFIX]
 *
 * - 1 arg: strips trailing slashes, returns the last `/`-delimited
 *   component. `'/'` → `'/'`. Empty string → `missing operand`.
 * - 2 args: as above, then removes SUFFIX from the end IF the result
 *   ends with it. `SUFFIX === ''` → no removal.
 * - More than 2 args → `basename: extra operand: <arg>`, exit 1.
 * - 0 args → `basename: missing operand`, exit 1.
 *
 * ## Slash handling (V1)
 *
 * - One or more `/` characters alone (`'/'`, `'//'`, `'///'`, …) →
 *   `'/'`. All-slash paths resolve to the root marker regardless of
 *   run length.
 * - Trailing slashes on non-root paths are stripped: `'/etc/'` →
 *   `'etc'`.
 * - Internal duplicate slashes: `'a//b'` → `'b'` (the last `/` before
 *   the basename is what `lastIndexOf` finds — the empty segment
 *   between `a//` does not affect the result).
 *
 * **POSIX `//`-network-root semantics are NOT implemented.** POSIX
 * specifies that a path beginning with exactly two slashes may be
 * implementation-defined (often a network-root marker), and GNU
 * `basename '//'` returns `'//'`. V1 collapses every all-slash path to
 * `'/'`. This is a documented V1 simplification; a future spec that
 * introduces network-root handling would need to distinguish `'/'`,
 * `'//'`, and `'///'` separately.
 *
 * Works on arbitrary strings — `basename /nope/x` returns `'x'` even
 * though `/nope/x` doesn't exist in the VFS.
 *
 * @module shell/commands/basename
 */

/**
 * Last path component, string-only. Handles `'/'`, `'///'` (all-slash
 * paths → `'/'`), empty-internal-segment paths (`'a//b'` → `'b'`),
 * and trailing slashes (`'foo/'` → `'foo'`).
 *
 * POSIX `//`-network-root semantics are intentionally not preserved:
 * `/^\/+$/` matches one or more slashes, so every all-slash path
 * collapses to `'/'`. See module JSDoc "Slash handling (V1)" for the
 * rationale.
 *
 * @param {string} path
 * @returns {string}
 */
function basenameString(path) {
  // All-slash path (one or more `/` chars) → root marker.
  if (/^\/+$/.test(path)) return '/';
  let p = path;
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const basename = {
  name: 'basename',
  usage: 'basename PATH [SUFFIX]',
  description: 'Gibt den letzten Pfadbestandteil aus.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    if (argv.length === 0 || argv[0] === '') {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 1 };
    }
    if (argv.length > 2) {
      return {
        stdout: '',
        stderr: `${name}: extra operand: ${argv[2]}\n`,
        exitCode: 1,
      };
    }

    let result = basenameString(argv[0]);
    if (argv.length === 2 && argv[1] !== '') {
      const suffix = argv[1];
      if (result.endsWith(suffix)) {
        result = result.slice(0, result.length - suffix.length);
      }
    }
    return { stdout: `${result}\n`, stderr: '', exitCode: 0 };
  },
};