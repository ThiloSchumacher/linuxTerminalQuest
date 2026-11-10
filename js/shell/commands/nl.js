import { mapFsError } from './_helpers.js';

/**
 * `nl` — number lines.
 *
 * ## Flags
 *
 * - `-b STYLE` — numbering style:
 *     - `a` (default): number every line
 *     - `t`: number non-empty lines only (empty lines get 6 spaces in
 *       the number column, no digit)
 *
 * ## Format
 *
 * `<N6>\t<line>\n` — `N` is right-aligned to 6 chars, followed by a
 * TAB, then the line content, then `\n`. For style `t` and an empty
 * line: 6 spaces + TAB + empty line + `\n`.
 *
 * Numbering starts at 1 (in style `a`); in style `t`, only non-empty
 * lines advance the counter.
 *
 * ## Input
 *
 * - With FILE: reads the FIRST file argument (V1 single-file model,
 *   matching `sed`/`cut`).
 * - Without FILE and with `stdin`: reads from the pipe.
 * - Without either: `nl: missing input`, exit 2.
 *
 * @module shell/commands/nl
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const nl = {
  name: 'nl',
  usage: 'nl [-b STYLE] [FILE...]',
  description: 'Nummeriert Zeilen.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, stdin }) {
    let style = 'a';
    /** @type {string[]} */
    const files = [];

    let i = 0;
    while (i < argv.length) {
      const arg = argv[i];
      if (arg === '-b') {
        if (i + 1 >= argv.length) {
          return {
            stdout: '',
            stderr: `${name}: option requires an argument -- 'b'\n`,
            exitCode: 2,
          };
        }
        style = argv[i + 1];
        if (style !== 'a' && style !== 't') {
          return {
            stdout: '',
            stderr: `${name}: invalid style: ${style}\n`,
            exitCode: 2,
          };
        }
        i += 2;
      } else if (arg.startsWith('-') && arg.length > 1) {
        return {
          stdout: '',
          stderr: `${name}: invalid option -- '${arg[1]}'\n`,
          exitCode: 2,
        };
      } else {
        files.push(arg);
        i += 1;
      }
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

    let counter = 0;
    let stdout = '';
    for (const line of lines) {
      let number = '';
      if (style === 'a' || (style === 't' && line !== '')) {
        counter += 1;
        number = String(counter).padStart(6, ' ');
      } else {
        number = '      '; // 6 spaces
      }
      stdout += `${number}\t${line}\n`;
    }
    return { stdout, stderr: '', exitCode: 0 };
  },
};