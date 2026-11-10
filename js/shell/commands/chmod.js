import { fsErrorLine } from './_helpers.js';

/**
 * `chmod` — change file modes.
 *
 * V1 accepts numeric modes only: 1–4 octal digits (`/^[0-7]{1,4}$/`).
 * Symbolic modes (`u+x`, `go-w`) are not implemented in V1; a non-octal
 * first argument produces `chmod: invalid mode: '<input>'` with exit 1.
 *
 * @module shell/commands/chmod
 */

/**
 * Match a numeric octal mode: one to four digits in `0..7`.
 * Applied to the raw string before `parseInt(..., 8)` so that inputs
 * like `"8"`, `"755x"`, or `"-1"` are rejected instead of being
 * silently coerced.
 */
const OCTAL_MODE_PATTERN = /^[0-7]{1,4}$/;

/**
 * @type {import('./index.js').CommandObject}
 */
export const chmod = {
  name: 'chmod',
  usage: 'chmod MODE FILE...',
  description: 'Ändert Dateiberechtigungen.',

  run({ argv, name, env, vfs }) {
    if (argv.length < 2) {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 1 };
    }

    const modeStr = argv[0];
    if (!OCTAL_MODE_PATTERN.test(modeStr)) {
      return {
        stdout: '',
        stderr: `${name}: invalid mode: '${modeStr}'\n`,
        exitCode: 1,
      };
    }

    const mode = parseInt(modeStr, 8);
    const cwd = env.get('PWD') || '/';
    let stderr = '';
    let failed = false;

    for (const path of argv.slice(1)) {
      try {
        vfs.chmod(path, mode, cwd);
      } catch (err) {
        stderr += fsErrorLine(name, path, err);
        failed = true;
      }
    }

    return { stdout: '', stderr, exitCode: failed ? 1 : 0 };
  },
};