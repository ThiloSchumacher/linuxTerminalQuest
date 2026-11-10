/**
 * `dirname` — directory portion of a path (string operation, no VFS).
 *
 * ## Signature
 *
 *     dirname PATH
 *
 * - 0 args → `dirname: missing operand`, exit 1.
 * - >1 arg → `dirname: extra operand: <arg>`, exit 1.
 *
 * Behaviour (POSIX-like):
 *  - No `/` in the path → `'.'`.
 *  - Trailing slashes are stripped (except when the path is `'/'`).
 *  - Internal duplicate slashes are collapsed to single slashes:
 *    `'/foo//bar'` → `'/foo'` (NOT `'/foo/'`).
 *  - `'/'` → `'/'`.
 *  - `'/foo'` → `'/'`.
 *  - `'foo/bar'` → `'foo'`.
 *  - `'/foo/bar/baz'` → `'/foo/bar'`.
 *  - `'/foo/bar/'` → `'/foo'`.
 *  - `'.'` → `'.'` (no `/`).
 *
 * **POSIX `//`-network-root semantics are NOT implemented.** POSIX
 * specifies that a path beginning with exactly two slashes may be
 * implementation-defined, and GNU `dirname '//foo'` returns `'//'`. V1
 * collapses every slash run (including leading `//`) to a single `/`,
 * so `dirname '//foo'` returns `'/'`. Documented V1 simplification;
 * a future spec that introduces network-root handling would need to
 * preserve the leading `//` explicitly.
 *
 * Works on arbitrary strings — no VFS lookup.
 *
 * @module shell/commands/dirname
 */

/**
 * Directory portion of a path, string-only. Collapses every run of
 * slashes (internal AND leading) to a single `/` before slicing —
 * hence `'/foo//bar'` → `'/foo'` and `'//foo'` → `'/'`. POSIX
 * `//`-network-root preservation is not implemented (see module JSDoc).
 *
 * @param {string} path
 * @returns {string}
 */
function dirnameString(path) {
  if (path === '/') return '/';
  // Collapse runs of `/` into single `/`; `/foo//bar` → `/foo/bar`.
  // This also collapses a leading `//` to `/` — documented V1
  // simplification (POSIX would preserve `//` as network-root).
  let p = path.replace(/\/+/g, '/');
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const idx = p.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  return p.slice(0, idx);
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const dirname = {
  name: 'dirname',
  usage: 'dirname PATH',
  description: 'Gibt den Verzeichnisbestandteil eines Pfads aus.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    if (argv.length === 0 || argv[0] === '') {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 1 };
    }
    if (argv.length > 1) {
      return {
        stdout: '',
        stderr: `${name}: extra operand: ${argv[1]}\n`,
        exitCode: 1,
      };
    }
    return { stdout: `${dirnameString(argv[0])}\n`, stderr: '', exitCode: 0 };
  },
};