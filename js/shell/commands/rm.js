import { parseFlags, fsErrorLine } from './_helpers.js';

/**
 * `rm` — remove files and directories.
 *
 * V1 flags: `-r`/`-R` (recursive), `-f` (force: swallow ENOENT). A
 * directory without `-r` is rejected with the GNU-style lowercase
 * message `is a directory`. Root protection is delegated to `vfs.delete`
 * which raises `EPERM` for `/`.
 *
 * @module shell/commands/rm
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const rm = {
  name: 'rm',
  usage: 'rm [-r] [-f] FILE...',
  description: 'Löscht Dateien und Verzeichnisse.',

  run({ argv, name, env, vfs }) {
    const { flags, args, unknown } = parseFlags(argv, ['r', 'R', 'f']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }

    const recursive = flags.has('r') || flags.has('R');
    const force = flags.has('f');

    if (args.length === 0) {
      if (force) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 1 };
    }

    const cwd = env.get('PWD') || '/';
    let stderr = '';
    let failed = false;

    for (const path of args) {
      let node;
      try {
        node = vfs.resolve(path, cwd);
      } catch (err) {
        if (force && err && err.code === 'ENOENT') continue;
        stderr += fsErrorLine(name, path, err);
        failed = true;
        continue;
      }

      if (vfs.isDir(node) && !recursive) {
        // GNU rm uses lowercase "is a directory" here (deliberate; the
        // spec pins the exact string).
        stderr += `${name}: ${path}: is a directory\n`;
        failed = true;
        continue;
      }

      try {
        vfs.delete(path, cwd, { recursive });
      } catch (err) {
        stderr += fsErrorLine(name, path, err);
        failed = true;
      }
    }

    return { stdout: '', stderr, exitCode: failed ? 1 : 0 };
  },
};