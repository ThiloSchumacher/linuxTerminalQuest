import { fsErrorLine } from './_helpers.js';

/**
 * `touch` — update timestamps of existing nodes, or create empty files.
 *
 * V1 has no flags. For an existing node (file or directory) all three
 * timestamps are advanced to `Date.now()`, matching POSIX `touch`. For a
 * missing path an empty file is created; if the parent directory does
 * not exist, the error is reported per-path.
 *
 * @module shell/commands/touch
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const touch = {
  name: 'touch',
  usage: 'touch FILE...',
  description: 'Erstellt leere Dateien oder aktualisiert Zeitstempel.',

  run({ argv, name, env, vfs }) {
    if (argv.length === 0) {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 1 };
    }

    const cwd = env.get('PWD') || '/';
    let stderr = '';
    let failed = false;

    for (const path of argv) {
      try {
        const node = vfs.resolve(path, cwd);
        const now = Date.now();
        node.mtime = now;
        node.ctime = now;
        node.atime = now;
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          try {
            vfs.createFile(path, cwd, '');
          } catch (err2) {
            stderr += fsErrorLine(name, path, err2);
            failed = true;
          }
        } else {
          stderr += fsErrorLine(name, path, err);
          failed = true;
        }
      }
    }

    return { stdout: '', stderr, exitCode: failed ? 1 : 0 };
  },
};