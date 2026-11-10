import {
  parseFlags,
  fsErrorLine,
  displayTarget,
  invalidArgLine,
} from './_helpers.js';

/**
 * `ln` — create symbolic links (hardlinks not supported in V1).
 *
 * ## Signature
 *
 *     ln -s TARGET [LINK_NAME]
 *
 * `-s` is mandatory. Without it (a hardlink attempt), the command fails
 * with `ln: hard links not supported` and exit 2 — V1 does not create
 * hardlinks.
 *
 * ## Argument handling
 *
 *  - No args → `ln: missing file operand`, exit 1.
 *  - One arg (`TARGET`) → creates `./basename(TARGET)` in `cwd`
 *    (POSIX `ln -s /etc/hosts` → `./hosts -> /etc/hosts`).
 *  - Two args (`TARGET LINK_NAME`) → `createSymlink(TARGET, LINK_NAME)`.
 *  - More than two args → `ln: multiple targets not supported`, exit 2
 *    (V1 simplification; POSIX allows multiple targets into a directory).
 *
 * ## Broken links
 *
 * `TARGET` is NOT validated — `ln -s /nope /tmp/b` creates a broken
 * link (POSIX `ln -s` behaviour). No error.
 *
 * ## Error message sourcing
 *
 * `EEXIST`, `ENOENT`, `ENOTDIR` and other VFS errors are routed through
 * `fsErrorLine` / `displayTarget` from `_helpers.js`. The one
 * command-local error (`ln -s /`, whose basename would be `/`) goes
 * through `invalidArgLine` — same helper family, so an eventual rename
 * of the `EINVAL` message affects both paths together.
 *
 * @module shell/commands/ln
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const ln = {
  name: 'ln',
  usage: 'ln -s TARGET [LINK_NAME]',
  description: 'Erstellt symbolische Links.',

  run({ argv, name, env, vfs }) {
    const { flags, args, unknown } = parseFlags(argv, ['s']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }

    // Order of the three operand/flag checks below (arg-count first
    // so "missing operand" is the highest-priority diagnosis):
    //   1. args.length === 0   → "missing file operand" (exit 1)
    //   2. args.length > 2     → "multiple targets not supported" (exit 2)
    //   3. !flags.has('s')     → "hard links not supported" (exit 2)
    //
    // The `>2` check sits BEFORE the `-s` check on purpose: for
    // `ln a b c` (3 args, no -s), "multiple targets not supported" is
    // the more specific diagnosis — the user has a completely different
    // problem than "missing -s". Both paths exit 2, so the choice is
    // about which message the user sees.
    if (args.length === 0) {
      return { stdout: '', stderr: `${name}: missing file operand\n`, exitCode: 1 };
    }

    if (args.length > 2) {
      return {
        stdout: '',
        stderr: `${name}: multiple targets not supported\n`,
        exitCode: 2,
      };
    }

    if (!flags.has('s')) {
      return {
        stdout: '',
        stderr: `${name}: hard links not supported\n`,
        exitCode: 2,
      };
    }

    const target = args[0];
    const cwd = env.get('PWD') || '/';
    let linkName;
    if (args.length === 1) {
      // `ln -s TARGET` → create the link in the current directory,
      // named after TARGET's basename.
      //
      // Edge case `ln -s /` (and any other path whose basename is `/`
      // or empty): we reject explicitly rather than let the request
      // flow into `createSymlink('/', '/', …)`. That call would also
      // fail (with EEXIST, because the root already exists), but the
      // "Invalid argument" message here tells the user that the
      // *name* is the problem — there is no sensible basename to
      // derive from `/`. Exit code is 1 in both paths; the specific
      // message is the only difference.
      linkName = vfs.basename(target);
      if (linkName === '/' || linkName === '') {
        // Uses invalidArgLine (spec004a `_helpers.js`) so this EINVAL
        // message is coupled to mapFsError('EINVAL'). If a later spec
        // renames the EINVAL message, this guard updates with it —
        // there is no risk of the two paths diverging silently.
        return {
          stdout: '',
          stderr: invalidArgLine(name, target),
          exitCode: 1,
        };
      }
    } else {
      linkName = args[1];
    }

    try {
      vfs.createSymlink(target, linkName, cwd);
    } catch (err) {
      return {
        stdout: '',
        stderr: fsErrorLine(name, displayTarget(err, linkName), err),
        exitCode: 1,
      };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  },
};