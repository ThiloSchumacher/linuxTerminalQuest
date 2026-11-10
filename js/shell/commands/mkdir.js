import { parseFlags, fsErrorLine } from './_helpers.js';

/**
 * `mkdir` — create directories.
 *
 * V1 supports `-p` (recursive). Unknown flags are rejected with exit 2.
 *
 * @module shell/commands/mkdir
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const mkdir = {
  name: 'mkdir',
  usage: 'mkdir [-p] DIR...',
  description: 'Erstellt Verzeichnisse.',

  run({ argv, name, env, vfs }) {
    const { flags, args, unknown } = parseFlags(argv, ['p']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }
    if (args.length === 0) {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 1 };
    }

    const recursive = flags.has('p');
    const cwd = env.get('PWD') || '/';
    let stderr = '';
    let failed = false;

    for (const path of args) {
      try {
        vfs.createDir(path, cwd, { recursive });
      } catch (err) {
        stderr += fsErrorLine(name, path, err);
        failed = true;
      }
    }

    return { stdout: '', stderr, exitCode: failed ? 1 : 0 };
  },
};