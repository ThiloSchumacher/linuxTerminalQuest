/**
 * Shared helpers for V1 filesystem commands.
 *
 * Not a command module — no `CommandObject` is defined here. Kept in a
 * single file so that `mkdir`, `touch`, `rm`, `cp`, `mv`, `chmod`, and
 * the text-processing commands map VFS errors to user messages
 * consistently; the leading underscore signals that this file is not
 * part of the public command surface.
 *
 * @module shell/commands/_helpers
 */

/**
 * Parse `-abc`-style flags from `argv` and return the remaining operands.
 *
 * A token is treated as a flag when it begins with `-`, is longer than
 * one character, and is not the terminator `--`. `--` stops flag parsing
 * so subsequent `-`-prefixed tokens are treated as operands.
 *
 * Flags are accepted one character at a time from `allowed`; a combined
 * token like `-rf` yields flags `r` and `f`. The first character not in
 * `allowed` is reported as `unknown`; the traversal of `argv` ALWAYS ends
 * at that point, and every current caller bails immediately on
 * `unknown !== null`.
 *
 * Long options (`--foo`) are not supported in V1. Such a token falls into
 * the flag branch, its second character (`-`) is compared against
 * `allowed`, is not found, and is reported as `unknown = '-'` — the
 * caller's message then reads `invalid option -- '-'`. That is accepted
 * V1 behaviour; only `-x`-style short options have meaningful error
 * messages.
 *
 * @param {string[]} argv
 * @param {string[]} allowed
 * @returns {{flags: Set<string>, args: string[], unknown: string|null}}
 */
export function parseFlags(argv, allowed) {
  const flags = new Set();
  const args = [];
  let unknown = null;
  let stop = false;

  for (const token of argv) {
    if (stop) {
      args.push(token);
      continue;
    }
    if (token === '--') {
      stop = true;
      continue;
    }
    if (token.length > 1 && token.startsWith('-')) {
      for (let i = 1; i < token.length; i++) {
        const ch = token[i];
        if (!allowed.includes(ch)) {
          unknown = ch;
          break;
        }
        flags.add(ch);
      }
      if (unknown !== null) break;
    } else {
      args.push(token);
    }
  }

  return { flags, args, unknown };
}

/**
 * Map a VFS `Error` (with a POSIX-style `.code`) to the English message
 * the shell prints after `${name}: ${target}: `.
 *
 * Deliberately stable across commands so that the same underlying error
 * reads the same everywhere (see spec004a §10). Codes not listed fall
 * back to the VFS message (for non-standard codes); EINVAL is mapped to a
 * fixed string so that the raw VFS message (`EINVAL: <syscall>
 * '<path>'`) never reaches the user.
 *
 * @param {Error & {code?: string}} err
 * @returns {string}
 */
export function mapFsError(err) {
  const code = err && err.code;
  switch (code) {
    case 'ENOENT':
      return 'No such file or directory';
    case 'EEXIST':
      return 'File exists';
    case 'ENOTDIR':
      return 'Not a directory';
    case 'EISDIR':
      return 'Is a directory';
    case 'ENOTEMPTY':
      return 'Directory not empty';
    case 'EPERM':
      return 'Operation not permitted';
    case 'EACCES':
      return 'Permission denied';
    case 'EINVAL':
      // Fixed message: the VFS-internal form (EINVAL: <syscall> '<path>')
      // is implementation detail and not appropriate user output.
      return 'Invalid argument';
    default:
      return (err && err.message) || 'Unknown error';
  }
}

/**
 * Pick the path to show as `<target>` in an error line.
 *
 * Preference order:
 *  1. `err.path`, if it is a non-empty string — the VFS sets it to the
 *     path the error actually refers to (spec001 contract).
 *  2. `fallback`, if it is a non-empty string — usually the command's
 *     source or destination path.
 *  3. the literal `<empty>` for a path-less operation (e.g. `cp '' x`).
 *     Keeps the message readable instead of degenerating into
 *     `cp: : Invalid argument` with a doubled colon.
 *
 * @param {Error & {path?: string}} err
 * @param {string} fallback
 * @returns {string}
 */
export function displayTarget(err, fallback) {
  if (err && typeof err.path === 'string' && err.path.length > 0) {
    return err.path;
  }
  if (typeof fallback === 'string' && fallback.length > 0) {
    return fallback;
  }
  return '<empty>';
}

/**
 * Format a per-target error line in the standard shell shape:
 * `${name}: ${target}: ${message}\n`.
 *
 * Callers that invoke VFS methods which can fail on either side of a
 * two-path operation should use `displayTarget(err, srcOrDest)` so that
 * destination-side failures (missing parent, is-a-directory) are
 * reported against the destination, not the source.
 *
 * @param {string} name     Program name (`argv[0]`).
 * @param {string} target   The path the error refers to.
 * @param {Error} err       VFS error with `.code`.
 * @returns {string}
 */
export function fsErrorLine(name, target, err) {
  return `${name}: ${target}: ${mapFsError(err)}\n`;
}

/**
 * Format a synthetic "invalid argument" line for a path that the command
 * itself rejects before calling into the VFS (e.g. `cp /x /x`).
 *
 * Constructs a real `Error` instance with `.code = 'EINVAL'` and
 * `.path = target` so the input to `fsErrorLine` conforms to its
 * `@param {Error}` contract — `mapFsError` only reads `.code` for the
 * EINVAL branch, but keeping the full Error instance avoids surprising a
 * future type-checker or reader of this file.
 *
 * @param {string} name
 * @param {string} target
 * @returns {string}
 */
export function invalidArgLine(name, target) {
  const err = new Error('Invalid argument');
  err.code = 'EINVAL';
  err.path = target;
  return fsErrorLine(name, target, err);
}