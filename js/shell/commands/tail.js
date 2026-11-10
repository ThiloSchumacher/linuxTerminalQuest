import { fsErrorLine, displayTarget } from './_helpers.js';

/**
 * `tail` — output the last N lines of each file (or stdin).
 *
 * Same interface, header semantics and error handling as `head` (see
 * head.js and spec007a §4.2): with multiple files each block is
 * preceded by a `<filename>:\n` header on its own line (GNU-style).
 * In stdin mode (no file args, `stdin` is a string) the last N lines of
 * stdin are emitted with no header.
 *
 * `-n` without a following value: `${name}: option requires an
 * argument -- 'n'`, exit 1.
 *
 * Header-with-zero-lines: the header is emitted for every file,
 * including when `-n 0` produces an empty block (GNU behavior).
 *
 * Unknown flags: `${name}: invalid option -- 'x'\n`, exit 2.
 *
 * @module shell/commands/tail
 */

const POSITIVE_INT_PATTERN = /^\d+$/;
const DEFAULT_LINES = 10;

/**
 * @type {import('./index.js').CommandObject}
 */
export const tail = {
  name: 'tail',
  usage: 'tail [-n N] [FILE...]',
  description: 'Zeigt die letzten N Zeilen.',

  run({ argv, name, env, vfs, stdin }) {
    let n = DEFAULT_LINES;
    /** @type {string[]} */
    const files = [];

    let i = 0;
    while (i < argv.length) {
      const arg = argv[i];
      if (arg === '--') {
        files.push(...argv.slice(i + 1));
        break;
      } else if (arg === '-n') {
        if (i + 1 >= argv.length) {
          return {
            stdout: '',
            stderr: `${name}: option requires an argument -- 'n'\n`,
            exitCode: 1,
          };
        }
        const val = argv[i + 1];
        if (!POSITIVE_INT_PATTERN.test(val)) {
          return {
            stdout: '',
            stderr: `${name}: invalid number of lines: '${val}'\n`,
            exitCode: 1,
          };
        }
        n = parseInt(val, 10);
        i += 2;
      } else if (arg.startsWith('-n') && arg.length > 2) {
        const val = arg.slice(2);
        if (!POSITIVE_INT_PATTERN.test(val)) {
          return {
            stdout: '',
            stderr: `${name}: invalid number of lines: '${val}'\n`,
            exitCode: 1,
          };
        }
        n = parseInt(val, 10);
        i += 1;
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

    if (files.length === 0) {
      // stdin mode: emit the last N lines of stdin, no header.
      if (typeof stdin === 'string') {
        const lines = stdin.split('\n');
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        const start = Math.max(0, lines.length - n);
        let stdout = '';
        for (const line of lines.slice(start)) {
          stdout += `${line}\n`;
        }
        return { stdout, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: `${name}: missing file\n`, exitCode: 1 };
    }

    const cwd = env.get('PWD') || '/';
    const multiple = files.length > 1;

    let stdout = '';
    let stderr = '';
    let failed = false;

    for (const file of files) {
      let content;
      try {
        content = vfs.readFile(file, cwd);
      } catch (err) {
        stderr += fsErrorLine(name, displayTarget(err, file), err);
        failed = true;
        continue;
      }

      const lines = content.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

      if (multiple) stdout += `${file}:\n`;
      const start = Math.max(0, lines.length - n);
      for (const line of lines.slice(start)) {
        stdout += `${line}\n`;
      }
    }

    return { stdout, stderr, exitCode: failed ? 1 : 0 };
  },
};