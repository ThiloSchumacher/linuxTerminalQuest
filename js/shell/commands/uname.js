import { parseFlags } from './_helpers.js';

/**
 * `uname` — print system information.
 *
 * V1 is a fake system: `uname` (no args) → `'Linux\n'`;
 * `uname -a` → a fixed string that looks like `uname -a` output but is
 * not the real OS (`Linux bashquest 5.10.0-bashquest #1 SMP x86_64
 * GNU/Linux\n`). This is a learning exercise, not a system probe.
 *
 * Unknown flags → `uname: invalid option -- 'x'`, exit 2.
 *
 * @module shell/commands/uname
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const uname = {
  name: 'uname',
  usage: 'uname [-a]',
  description: 'Zeigt Systeminformationen.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env }) {
    const { flags, unknown } = parseFlags(argv, ['a']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }
    if (flags.has('a')) {
      return {
        stdout: 'Linux bashquest 5.10.0-bashquest #1 SMP x86_64 GNU/Linux\n',
        stderr: '',
        exitCode: 0,
      };
    }
    return { stdout: 'Linux\n', stderr: '', exitCode: 0 };
  },
};