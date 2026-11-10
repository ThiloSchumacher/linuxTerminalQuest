import { fsErrorLine, displayTarget } from './_helpers.js';

/**
 * `head` — output the first N lines of each file (or stdin).
 *
 * V1 supports `-n N` and the shorthand `-nN`. N must be a non-negative
 * integer; `-n 0` yields no lines but exit 0.
 *
 * stdin mode (spec007a §4.2): when there are no file arguments and
 * `stdin` is a string, the first N lines of stdin are emitted (no
 * per-file header — there is only one source). File arguments always
 * win (POSIX); `null`/`undefined` stdin falls back to the "missing
 * file" error.
 *
 * `-n` without a following value: `${name}: option requires an
 * argument -- 'n'`, exit 1.
 *
 * Multiple files: per Patch 1 §2, each block is preceded by a
 * `<filename>:\n` header on its OWN line (GNU-style).
 *
 * Unknown flags: `${name}: invalid option -- 'x'\n`, exit 2.
 *
 * @module shell/commands/head
 */

const POSITIVE_INT_PATTERN = /^\d+$/;
const DEFAULT_LINES = 10;

/**
 * @type {import('./index.js').CommandObject}
 */
export const head = {
  name: 'head',
  usage: 'head [-n N] [FILE...]',
  description: 'Zeigt die ersten N Zeilen.',

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
      // stdin mode: emit the first N lines of stdin, no header.
      if (typeof stdin === 'string') {
        const lines = stdin.split('\n');
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        let stdout = '';
        for (const line of lines.slice(0, n)) {
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
      for (const line of lines.slice(0, n)) {
        stdout += `${line}\n`;
      }
    }

    return { stdout, stderr, exitCode: failed ? 1 : 0 };
  },
};