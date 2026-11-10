import { fsErrorLine, displayTarget, invalidArgLine } from './_helpers.js';

/**
 * `mv` — move/rename.
 *
 * V1 takes no flags and a single source plus a single destination.
 * Multiple sources are not supported; the caller can move one item at a
 * time. `vfs.move` handles "dest is existing directory" (move inside)
 * and "dest is existing file" (overwrite) semantics.
 *
 * ## Same-file detection (spec009a Note)
 *
 * Two layers detect "same file":
 *
 *  1. **Shell preflight** (this command): `src` and `dest` are resolved
 *     with `followLinks: true`; if they yield the same node, the
 *     command returns `mv: <dest>: Invalid argument` (spec004a
 *     convention: `invalidArgLine`, path = dest). This fires FIRST for
 *     every same-file case reachable from the shell.
 *
 *  2. **VFS-level** (`vfs.move`, spec008a Patch 1 §3.14): throws
 *     `EINVAL` with `message: 'same file'`, `.path = src`. UNREACHABLE
 *     from this command because the preflight above already caught the
 *     same-file case — including the reverse direction
 *     (`mv /link-to-A /A`), where VFS would report `/link-to-A` as
 *     src but the shell reports `/A` as dest.
 *
 * The two layers differ in the reported path (dest vs. src) and in the
 * message (`Invalid argument` vs. `same file`). That is intentional
 * and pinned by tests on both sides. If a future spec removes the
 * shell preflight, the user-visible message changes to `mv: <src>:
 * same file` — a knowing change that would need the spec004a tests to
 * be updated too.
 *
 * @module shell/commands/mv
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const mv = {
  name: 'mv',
  usage: 'mv SRC DST',
  description: 'Verschiebt oder benennt um.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    if (argv.length < 2) {
      return { stdout: '', stderr: `${name}: missing destination file operand\n`, exitCode: 1 };
    }
    if (argv.length > 2) {
      return { stdout: '', stderr: `${name}: multiple sources not supported\n`, exitCode: 1 };
    }

    const [src, dest] = argv;
    const cwd = env.get('PWD') || '/';

    // Shell-level same-file preflight (see module JSDoc "Same-file
    // detection"). Reports against `dest` per spec004a convention.
    let srcNode;
    try {
      srcNode = vfs.resolve(src, cwd);
    } catch (err) {
      return { stdout: '', stderr: fsErrorLine(name, displayTarget(err, src), err), exitCode: 1 };
    }

    try {
      const destNode = vfs.resolve(dest, cwd);
      if (destNode === srcNode) {
        return { stdout: '', stderr: invalidArgLine(name, dest), exitCode: 1 };
      }
    } catch (err) {
      const code = err && err.code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return {
          stdout: '',
          stderr: fsErrorLine(name, displayTarget(err, dest), err),
          exitCode: 1,
        };
      }
    }

    try {
      vfs.move(src, dest, cwd);
    } catch (err) {
      return { stdout: '', stderr: fsErrorLine(name, displayTarget(err, src), err), exitCode: 1 };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  },
};