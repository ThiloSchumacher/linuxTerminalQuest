import { parseFlags, fsErrorLine, displayTarget, invalidArgLine } from './_helpers.js';

/**
 * `cp` — copy files.
 *
 * V1 supports a single source and a single destination. Recursive
 * directory copies are not implemented (`vfs.copy` is non-recursive);
 * `-r` on a directory source yields a "not yet implemented" message with
 * exit 2, while `-r` on a file source has no effect.
 *
 * ## Same-file detection (spec009a Note)
 *
 * Two layers detect "same file":
 *
 *  1. **Shell preflight** (this command): `src` and `dest` are resolved
 *     with `followLinks: true`; if they yield the same node, the
 *     command returns `cp: <dest>: Invalid argument` (spec004a
 *     convention: `invalidArgLine`, path = dest). This fires FIRST for
 *     every same-file case reachable from the shell.
 *
 *  2. **VFS-level** (`vfs.copy`, spec008a Patch 1 §3.15): throws
 *     `EINVAL` with `message: 'same file'`, `.path = src`. UNREACHABLE
 *     from this command because the preflight above already caught the
 *     same-file case.
 *
 * The two layers are not symmetric in the reported path (dest vs. src)
 * or in the message (`Invalid argument` vs. `same file`). That is
 * intentional and pinned by tests on both sides. If a future spec
 * removes the shell preflight (assuming "VFS handles it now"), the
 * user-visible message would change from `cp: <dest>: Invalid
 * argument` to `cp: <src>: same file` — this is a knowing decision,
 * not an oversight, so a change must update the spec004a tests too.
 *
 * @module shell/commands/cp
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const cp = {
  name: 'cp',
  usage: 'cp [-r] SRC DST',
  description: 'Kopiert Dateien.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    const { flags, args, unknown } = parseFlags(argv, ['r']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }

    if (args.length < 2) {
      return { stdout: '', stderr: `${name}: missing destination file operand\n`, exitCode: 1 };
    }
    if (args.length > 2) {
      return { stdout: '', stderr: `${name}: multiple sources not supported\n`, exitCode: 1 };
    }

    const [src, dest] = args;
    const recursive = flags.has('r');
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

    if (vfs.isDir(srcNode)) {
      if (recursive) {
        return { stdout: '', stderr: `${name}: -r not yet implemented\n`, exitCode: 2 };
      }
      return { stdout: '', stderr: `${name}: ${src}: is a directory (use -r)\n`, exitCode: 1 };
    }

    try {
      vfs.copy(src, dest, cwd);
    } catch (err) {
      return { stdout: '', stderr: fsErrorLine(name, displayTarget(err, src), err), exitCode: 1 };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  },
};