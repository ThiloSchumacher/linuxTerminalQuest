/**
 * `cd` — change the current working directory.
 *
 * V1 does not support `cd -`. The `?` variable is left untouched — only the
 * executor writes it after a command completes.
 *
 * ## `vfs` must be destructured
 *
 * `run()` receives `{ argv, name, env, vfs, stdin, services }` from the
 * executor (spec007c §2.2 Schritt 3d). `vfs` is REQUIRED here — both for
 * `resolve` (path lookup) and `isDir` (type check). Missing it in the
 * destructuring is a ReferenceError, not a VFS error — the bug that
 * spec013c-fix addresses.
 *
 * ## Path resolution
 *
 * `target` goes into `vfs.resolve(target, cwd)` UNCHANGED. The VFS
 * handles relative paths, `..`, `.` and multi-slash inputs itself
 * (spec001 §3.1). The resolved absolute PATH for `PWD` is computed by
 * `toAbsolute`, which mirrors VFS normalization so `PWD` always points
 * at the same directory the resolver found.
 *
 * Error messages use `target` (what the user typed), NOT the
 * normalized path.
 *
 * @module shell/commands/cd
 */

/**
 * Compute the absolute, normalized form of `target` relative to `cwd`.
 * Mirrors the VFS normalization rules so the resulting `PWD` matches the
 * path resolution that `vfs.resolve` performed.
 *
 * @param {string} target
 * @param {string} cwd
 * @returns {string}
 */
function toAbsolute(target, cwd) {
  const combined = target.startsWith('/') ? target : cwd + '/' + target;
  /** @type {string[]} */
  const stack = [];
  for (const part of combined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return '/' + stack.join('/');
}

/**
 * Map a VFS error code to a user-facing message.
 *
 * @param {string} code
 * @returns {string|null}
 */
function mapError(code) {
  if (code === 'ENOENT') return 'No such file or directory';
  if (code === 'ENOTDIR') return 'Not a directory';
  return null;
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const cd = {
  name: 'cd',
  usage: 'cd [DIR]',
  description: 'Wechselt das Verzeichnis.',

  run({ argv, name, env, vfs }) {
    let target;
    if (argv.length === 0) {
      const home = env.get('HOME');
      if (home === undefined || home === '') {
        return { stdout: '', stderr: `${name}: HOME not set\n`, exitCode: 1 };
      }
      target = home;
    } else if (argv.length === 1) {
      target = argv[0];
    } else {
      return { stdout: '', stderr: `${name}: too many arguments\n`, exitCode: 1 };
    }

    const cwd = env.get('PWD') || '/';
    let node;
    try {
      node = vfs.resolve(target, cwd);
    } catch (err) {
      const mapped =
        (err && mapError(err.code)) || (err && err.message) || 'Unknown error';
      return {
        stdout: '',
        stderr: `${name}: ${target}: ${mapped}\n`,
        exitCode: 1,
      };
    }
    if (!vfs.isDir(node)) {
      return {
        stdout: '',
        stderr: `${name}: ${target}: Not a directory\n`,
        exitCode: 1,
      };
    }

    env.set('OLDPWD', cwd);
    env.set('PWD', toAbsolute(target, cwd));
    return { stdout: '', stderr: '', exitCode: 0 };
  },
};