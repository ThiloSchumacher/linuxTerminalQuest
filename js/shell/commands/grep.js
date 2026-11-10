import { parseFlags, fsErrorLine, displayTarget } from './_helpers.js';

/**
 * `grep` — search files (or stdin) for lines matching a literal
 * substring.
 *
 * V1 does not use regular expressions: `PATTERN` is matched as a
 * literal substring. Flags: `-i` (case-insensitive), `-n` (line
 * numbers), `-v` (invert selection), `-c` (count only); they can be
 * combined (`-in`).
 *
 * stdin mode (spec007a §4.2): when PATTERN is given but no FILE, and
 * `stdin` is a string, the pattern is matched against stdin. No
 * `<filename>:` prefix is emitted in stdin mode (spec007a §4.2). File
 * arguments always win; `null`/`undefined` stdin without a file falls
 * back to the "missing file" error.
 *
 * Multiple files: each line is prefixed with `<filename>:`, and with
 * `-n` the format becomes `<filename>:<lineno>:<content>`. With `-c`
 * the per-file count is prefixed with `<filename>:`.
 *
 * Exit code: 0 if any line was selected, 1 if none, 2 on any file
 * error.
 *
 * @module shell/commands/grep
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const grep = {
  name: 'grep',
  usage: 'grep [-i] [-n] [-v] [-c] PATTERN [FILE...]',
  description: 'Sucht Text in Dateien.',

  run({ argv, name, env, vfs, stdin }) {
    const { flags, args, unknown } = parseFlags(argv, ['i', 'n', 'v', 'c']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }
    if (args.length === 0) {
      return { stdout: '', stderr: `${name}: missing pattern\n`, exitCode: 2 };
    }

    const pattern = args[0];
    const files = args.slice(1);
    const insensitive = flags.has('i');
    const showNumber = flags.has('n');
    const invert = flags.has('v');
    const countOnly = flags.has('c');

    const needle = insensitive ? pattern.toLowerCase() : pattern;

    /**
     * Run the match pipeline on a single source (either a file's content
     * or stdin).
     *
     * @param {string} content
     * @param {string|null} label Filename for prefixing, or null for
     *   stdin mode (no prefix).
     * @param {boolean} multiple True when >1 source — controls the
     *   `<filename>:` prefix even for `label !== null`.
     * @returns {{lines: string, matched: boolean}}
     */
    function processSource(content, label, multiple) {
      const lines = content.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

      let matchCount = 0;
      let out = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const haystack = insensitive ? line.toLowerCase() : line;
        let matched = haystack.includes(needle);
        if (invert) matched = !matched;
        if (!matched) continue;
        matchCount += 1;
        if (countOnly) continue;
        if (multiple && label !== null) out += `${label}:`;
        if (showNumber) out += `${i + 1}:`;
        out += `${line}\n`;
      }

      if (countOnly) {
        if (multiple && label !== null) {
          out = `${label}:${matchCount}\n`;
        } else {
          out = `${matchCount}\n`;
        }
      }

      return { lines: out, matched: matchCount > 0 };
    }

    // stdin mode: PATTERN only (no FILE) + a real stdin string.
    if (files.length === 0) {
      if (typeof stdin === 'string') {
        const result = processSource(stdin, null, false);
        return {
          stdout: result.lines,
          stderr: '',
          exitCode: result.matched ? 0 : 1,
        };
      }
      return { stdout: '', stderr: `${name}: missing file\n`, exitCode: 2 };
    }

    const cwd = env.get('PWD') || '/';
    const multiple = files.length > 1;

    let stdout = '';
    let stderr = '';
    let anyMatch = false;
    let anyError = false;

    for (const file of files) {
      let content;
      try {
        content = vfs.readFile(file, cwd);
      } catch (err) {
        stderr += fsErrorLine(name, displayTarget(err, file), err);
        anyError = true;
        continue;
      }
      const result = processSource(content, file, multiple);
      stdout += result.lines;
      if (result.matched) anyMatch = true;
    }

    let exitCode = 0;
    if (anyError) exitCode = 2;
    else if (!anyMatch) exitCode = 1;

    return { stdout, stderr, exitCode };
  },
};