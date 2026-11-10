import { mapFsError } from './_helpers.js';

/**
 * `rev` — reverse the characters of each line.
 *
 * Uses `Array.from(line).reverse().join('')` for UTF-8 safety
 * (codepoint-level reverse). Multi-codepoint graphemes are not
 * collapsed in V1 — e.g. a combining accent becomes reversed order.
 *
 * ## Input
 *
 * - With FILE: reads the FIRST file argument (V1 single-file model).
 * - Without FILE and with `stdin`: reads from the pipe.
 * - Without either: `rev: missing input`, exit 2.
 *
 * @module shell/commands/rev
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const rev = {
  name: 'rev',
  usage: 'rev [FILE...]',
  description: 'Kehrt die Zeichen jeder Zeile um.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, stdin }) {
    /** @type {string[]} */
    const files = [];
    for (const arg of argv) {
      if (arg.startsWith('-') && arg.length > 1) {
        return {
          stdout: '',
          stderr: `${name}: invalid option -- '${arg[1]}'\n`,
          exitCode: 2,
        };
      }
      files.push(arg);
    }

    const cwd = env.get('PWD') || '/';
    let content;
    if (files.length > 0) {
      try {
        content = vfs.readFile(files[0], cwd);
      } catch (err) {
        return {
          stdout: '',
          stderr: `${name}: ${files[0]}: ${mapFsError(err)}\n`,
          exitCode: 1,
        };
      }
    } else if (typeof stdin === 'string') {
      content = stdin;
    } else {
      return { stdout: '', stderr: `${name}: missing input\n`, exitCode: 2 };
    }

    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    let stdout = '';
    for (const line of lines) {
      stdout += Array.from(line).reverse().join('') + '\n';
    }
    return { stdout, stderr: '', exitCode: 0 };
  },
};