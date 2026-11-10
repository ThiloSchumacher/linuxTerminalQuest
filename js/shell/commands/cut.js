import { mapFsError } from './_helpers.js';

/**
 * `cut` — extract fields from each line.
 *
 * ## Flags (V1)
 *
 * - `-d DELIM` — field separator, exactly ONE character. Mandatory in
 *   V1 (no default tab). Backslash escapes are NOT interpreted in `-d`
 *   (V1 simplification: pass the literal control character if needed).
 * - `-f FIELDS` — 1-based field numbers. Supported:
 *     - `'1'` single field
 *     - `'1,3'` comma-separated list
 *     - `'1-3'` inclusive ascending range
 *     - `'1,3-5'` combination
 *   Open-ended ranges (`3-`, `-3`) are NOT supported in V1.
 *
 * Both `-d` and `-f` are mandatory. Missing either → exit 2.
 * Other flags (`-c`, `-b`, `-s`) → `unsupported option`, exit 2.
 *
 * ## Input / multi-file
 *
 * - With FILE: reads the FIRST file argument; additional file arguments
 *   are silently ignored (V1 simplification — GNU cut processes every
 *   file in sequence; that extension belongs in a future spec, not
 *   this one). Pinned by the test `cut -d: -f1 f1 f2 processes only
 *   f1`.
 * - Without FILE and with `stdin`: reads from the pipe.
 * - Without either: `cut: missing input`, exit 2.
 *
 * Fields beyond a line's actual field count render as empty strings.
 * Output is one line per input line, each terminated by `\n`.
 *
 * @module shell/commands/cut
 */

/**
 * Parse `-f` field list. Returns an array of 1-based field numbers, or
 * `null` for invalid input.
 *
 * @param {string} str
 * @returns {number[]|null}
 */
function parseFields(str) {
  /** @type {number[]} */
  const result = [];
  for (const part of str.split(',')) {
    if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n < 1) return null;
      result.push(n);
    } else if (/^\d+-\d+$/.test(part)) {
      const [a, b] = part.split('-').map((s) => parseInt(s, 10));
      if (a < 1 || b < a) return null;
      for (let i = a; i <= b; i++) result.push(i);
    } else {
      return null;
    }
  }
  return result;
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const cut = {
  name: 'cut',
  usage: 'cut -d DELIM -f FIELDS [FILE...]',
  description: 'Schneidet Felder aus Zeilen aus.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, stdin }) {
    let delim = null;
    let fieldsStr = null;
    /** @type {string[]} */
    const files = [];

    let i = 0;
    while (i < argv.length) {
      const arg = argv[i];
      if (arg === '-d') {
        if (i + 1 >= argv.length) {
          return {
            stdout: '',
            stderr: `${name}: option requires an argument -- 'd'\n`,
            exitCode: 2,
          };
        }
        delim = argv[i + 1];
        i += 2;
      } else if (arg === '-f') {
        if (i + 1 >= argv.length) {
          return {
            stdout: '',
            stderr: `${name}: option requires an argument -- 'f'\n`,
            exitCode: 2,
          };
        }
        fieldsStr = argv[i + 1];
        i += 2;
      } else if (arg.startsWith('-') && arg.length > 1) {
        return {
          stdout: '',
          stderr: `${name}: unsupported option -- '${arg[1]}'\n`,
          exitCode: 2,
        };
      } else {
        files.push(arg);
        i += 1;
      }
    }

    // Validation order per spec §2.2.
    if (!delim) {
      return { stdout: '', stderr: `${name}: missing -d option\n`, exitCode: 2 };
    }
    if (!fieldsStr) {
      return { stdout: '', stderr: `${name}: missing -f option\n`, exitCode: 2 };
    }
    if (delim.length !== 1) {
      return {
        stdout: '',
        stderr: `${name}: -d requires single character\n`,
        exitCode: 2,
      };
    }
    const fields = parseFields(fieldsStr);
    if (!fields) {
      return {
        stdout: '',
        stderr: `${name}: invalid field list: ${fieldsStr}\n`,
        exitCode: 2,
      };
    }

    const cwd = env.get('PWD') || '/';
    let content;
    if (files.length > 0) {
      // V1: only the FIRST file argument is processed (see module
      // JSDoc "Input / multi-file"). Extra file args are silently
      // ignored.
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
      const parts = line.split(delim);
      stdout += fields.map((f) => parts[f - 1] ?? '').join(delim) + '\n';
    }
    return { stdout, stderr: '', exitCode: 0 };
  },
};