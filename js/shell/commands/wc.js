import { parseFlags, fsErrorLine, displayTarget } from './_helpers.js';

/**
 * `wc` — count lines, words and characters.
 *
 * V1 flags: `-l`, `-w`, `-c` (combinable). Without any flag all three
 * are reported, in the order lines → words → chars, each right-aligned
 * to 8 characters.
 *
 * Definitions:
 *  - lines: number of `\n`-separated lines (trailing newline ignored)
 *  - words: whitespace-separated tokens across the entire content
 *  - chars: raw `content.length` including newlines
 *
 * stdin mode (spec007a §4.2): when there are no file arguments and
 * `stdin` is a string, its content is counted. The output has NO
 * filename column — only the numeric columns (spec007a §4.2). A
 * missing / `null` stdin without file arguments yields the "missing
 * file" error.
 *
 * Multiple files: a `total` line is appended with the sums, for EVERY
 * flag combination. Single file: no total line. GNU-compatible.
 *
 * Unknown flags: `${name}: invalid option -- 'x'\n`, exit 2.
 *
 * @module shell/commands/wc
 */

/**
 * Format a single wc output line for the selected metrics.
 *
 * `fileName` may be `null` in stdin mode (spec007a §4.2): in that case
 * only the numeric columns are emitted (no trailing space, no
 * filename).
 *
 * @param {number} lines
 * @param {number} words
 * @param {number} chars
 * @param {string|null} fileName
 * @param {{l: boolean, w: boolean, c: boolean}} metrics
 * @returns {string}
 */
function formatWcLine(lines, words, chars, fileName, metrics) {
  const cols = [];
  if (metrics.l) cols.push(String(lines).padStart(8, ' '));
  if (metrics.w) cols.push(String(words).padStart(8, ' '));
  if (metrics.c) cols.push(String(chars).padStart(8, ' '));
  if (fileName === null) return `${cols.join(' ')}\n`;
  return `${cols.join(' ')} ${fileName}\n`;
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const wc = {
  name: 'wc',
  usage: 'wc [-l] [-w] [-c] [FILE...]',
  description: 'Zählt Zeilen, Wörter, Zeichen.',

  run({ argv, name, env, vfs, stdin }) {
    const { flags, args, unknown } = parseFlags(argv, ['l', 'w', 'c']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }

    const anyFlag = flags.has('l') || flags.has('w') || flags.has('c');
    const metrics = {
      l: anyFlag ? flags.has('l') : true,
      w: anyFlag ? flags.has('w') : true,
      c: anyFlag ? flags.has('c') : true,
    };

    // stdin mode: no file args + a real stdin string. Counts the input
    // directly with no filename column in the output.
    if (args.length === 0 && typeof stdin === 'string') {
      const linesArr = stdin.split('\n');
      if (linesArr.length > 0 && linesArr[linesArr.length - 1] === '') {
        linesArr.pop();
      }
      const lines = linesArr.length;
      const words = stdin.split(/\s+/).filter((w) => w.length > 0).length;
      const chars = stdin.length;
      return {
        stdout: formatWcLine(lines, words, chars, null, metrics),
        stderr: '',
        exitCode: 0,
      };
    }

    if (args.length === 0) {
      return { stdout: '', stderr: `${name}: missing file\n`, exitCode: 1 };
    }

    const cwd = env.get('PWD') || '/';
    const multiple = args.length > 1;

    let stdout = '';
    let stderr = '';
    let failed = false;
    let successCount = 0;

    let totalLines = 0;
    let totalWords = 0;
    let totalChars = 0;

    for (const file of args) {
      let content;
      try {
        content = vfs.readFile(file, cwd);
      } catch (err) {
        stderr += fsErrorLine(name, displayTarget(err, file), err);
        failed = true;
        continue;
      }
      successCount += 1;

      const linesArr = content.split('\n');
      if (linesArr.length > 0 && linesArr[linesArr.length - 1] === '') {
        linesArr.pop();
      }
      const lines = linesArr.length;
      const words = content.split(/\s+/).filter((w) => w.length > 0).length;
      const chars = content.length;

      totalLines += lines;
      totalWords += words;
      totalChars += chars;

      stdout += formatWcLine(lines, words, chars, file, metrics);
    }

    if (multiple && successCount > 0) {
      stdout += formatWcLine(totalLines, totalWords, totalChars, 'total', metrics);
    }

    return { stdout, stderr, exitCode: failed ? 1 : 0 };
  },
};