import { parseFlags, mapFsError } from './_helpers.js';

/**
 * `sed` — stream editor, V1 supports substitution only.
 *
 * ## Script syntax (V1)
 *
 *     s/PATTERN/REPLACEMENT/[g]
 *
 * - Delimiter is `/` (no other delimiter in V1). A `/` inside the
 *   pattern or replacement is NOT supported — the script is split on
 *   `/` naively, so `s/a\/b/c/` is rejected as unsupported.
 * - `PATTERN` is interpreted as a JavaScript RegExp (`new RegExp`), NOT
 *   as POSIX BRE. **Deliberate divergence from POSIX sed**, chosen for
 *   familiarity in a JS environment. Consequences:
 *     - extended regex syntax (`(`, `)`, `+`, `?`, `|`) works out of the
 *       box,
 *     - backslash-escapes follow JS rules (e.g. `\d` is a digit).
 * - `REPLACEMENT` is a JS string, so `$1`, `$2`, `$&` (capture-group
 *   syntax) are supported.
 * - Flag `g` replaces all occurrences on each line. Without `g`, only
 *   the first occurrence per line.
 * - Other script forms (`d`, `p`, `y/…/`, addresses) → unsupported.
 *
 * ## Flags
 *
 * - `-i` in-place: the result is written back into the FILE argument.
 *   FILE is mandatory with `-i`. No stdout.
 *   `-i.bak`-style suffixes are NOT supported: parseFlags treats
 *   `-i.bak` as flag `i` + unknown character `.`, so `sed -i.bak …`
 *   reports `invalid option -- '.'` (V1 limitation, no backup files).
 * - `-n` suppresses default stdout. V1 has no `p` command, so `-n`
 *   alone produces no output. **Combined with `-i`, `-n` is a no-op**
 *   because `-i` short-circuits to the write-back path BEFORE the
 *   `noOutput` check — the file is written and stdout is already empty.
 *   This ordering is pinned by the test `sed -i -n … writes back with
 *   no stdout`. Do NOT move the `noOutput` check before the `inPlace`
 *   block without re-verifying that test.
 *
 * ## Input / multi-file
 *
 * - With FILE: reads the FIRST file argument; additional file arguments
 *   are silently ignored (V1 simplification, matching `sed -i`'s
 *   single-file model; a future spec can add per-file processing).
 * - With `-i` and multiple FILE args: only the FIRST file is
 *   modified; the rest are untouched. Pinned by the test
 *   `with -i and multiple files only the FIRST file is modified (V1)`.
 * - Without FILE and with `stdin`: reads from the pipe.
 * - Without either: `sed: missing input`, exit 2.
 *
 * ## Validation order
 *
 * The checks below run in this exact order — first failure wins:
 *
 *   1. Unknown flag               → `invalid option -- 'x'`, exit 2
 *   2. No args at all             → `missing script`, exit 2
 *   3. Malformed script           → `unsupported script`, exit 2
 *   4. Invalid regex              → `invalid regex`, exit 1
 *   5. `-i` without FILE          → `-i requires a file argument`, exit 2
 *   6. Input source resolution (FILE or stdin) → `missing input`, exit 2
 *
 * The specific order matters for user diagnostics: `sed -i` (only the
 * flag) reports `missing script` (step 2), not `-i requires a file`
 * (step 5). `sed -i.bak …` reports `invalid option -- '.'` (step 1),
 * not a backup-file error. `sed 'd' f` reports `unsupported script`
 * (step 3), not an attempt to read `f`. Each ordering edge case is
 * pinned by a test in the `sed — Validierungsreihenfolge` block; do
 * not reorder these checks without updating that block.
 *
 * @module shell/commands/sed
 */

/**
 * Parse a sed SCRIPT. Returns `{ pattern, replacement, flags }` on
 * success, `{ error }` on failure.
 *
 * @param {string} script
 * @returns {{pattern?: string, replacement?: string, flags?: string, error?: string}}
 */
function parseScript(script) {
  if (typeof script !== 'string' || script[0] !== 's') {
    return { error: `unsupported script: ${script}` };
  }
  const parts = script.split('/');
  if (parts.length < 3 || parts.length > 4) {
    return { error: `unsupported script: ${script}` };
  }
  if (parts[0] !== 's') {
    return { error: `unsupported script: ${script}` };
  }
  const pattern = parts[1];
  const replacement = parts[2];
  const flags = parts[3] || '';
  if (flags !== '' && flags !== 'g') {
    return { error: `unsupported script: ${script}` };
  }
  return { pattern, replacement, flags };
}

/**
 * Apply the substitution to `content`, preserving trailing-newline
 * semantics from the input (so `-i` doesn't strip a file's final
 * newline).
 *
 * @param {string} content
 * @param {RegExp} re
 * @param {string} replacement
 * @returns {string}
 */
function applySubstitution(content, re, replacement) {
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const endsWithNewline = content.endsWith('\n') || content === '';
  let result = lines.map((line) => line.replace(re, replacement)).join('\n');
  if (lines.length > 0 && endsWithNewline) result += '\n';
  return result;
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const sed = {
  name: 'sed',
  usage: 'sed [-i] [-n] SCRIPT [FILE...]',
  description: 'Ersetzt Text mit s/alt/neu/[g]-Ausdrücken.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, stdin }) {
    // Step 1: unknown flags.
    const { flags, args, unknown } = parseFlags(argv, ['i', 'n']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }
    // Step 2: no args.
    if (args.length === 0) {
      return { stdout: '', stderr: `${name}: missing script\n`, exitCode: 2 };
    }
    const script = args[0];
    const files = args.slice(1);
    const inPlace = flags.has('i');
    const noOutput = flags.has('n');

    // Step 3: malformed script.
    const parsed = parseScript(script);
    if (parsed.error) {
      return { stdout: '', stderr: `${name}: ${parsed.error}\n`, exitCode: 2 };
    }

    // Step 4: invalid regex — compile before touching the file, so a
    // regex error surfaces before an ENOENT on the file.
    let re;
    try {
      re = new RegExp(parsed.pattern, parsed.flags);
    } catch {
      return {
        stdout: '',
        stderr: `${name}: invalid regex: ${parsed.pattern}\n`,
        exitCode: 1,
      };
    }

    // Step 5: -i without file.
    if (inPlace && files.length === 0) {
      return {
        stdout: '',
        stderr: `${name}: -i requires a file argument\n`,
        exitCode: 2,
      };
    }

    // Step 6: input source resolution.
    const cwd = env.get('PWD') || '/';
    let content;
    let inputPath = null;
    if (files.length > 0) {
      // V1: only the FIRST file argument is processed (see module
      // JSDoc "Input / multi-file"). Extra file args are silently
      // ignored. With `-i`, only files[0] is modified — the others
      // are untouched, which is surprising relative to GNU sed but
      // pinned by the multi-file test.
      inputPath = files[0];
      try {
        content = vfs.readFile(inputPath, cwd);
      } catch (err) {
        return {
          stdout: '',
          stderr: `${name}: ${inputPath}: ${mapFsError(err)}\n`,
          exitCode: 1,
        };
      }
    } else if (typeof stdin === 'string') {
      content = stdin;
    } else {
      return { stdout: '', stderr: `${name}: missing input\n`, exitCode: 2 };
    }

    const result = applySubstitution(content, re, parsed.replacement);

    // `-i` short-circuits BEFORE the `noOutput` check: the file is
    // written and stdout is already empty. `-i -n` is therefore a
    // no-op for the `-n` part. See module JSDoc "Flags" for the
    // ordering rationale and the test that pins it.
    if (inPlace) {
      try {
        vfs.writeFile(inputPath, cwd, result);
      } catch (err) {
        return {
          stdout: '',
          stderr: `${name}: ${inputPath}: ${mapFsError(err)}\n`,
          exitCode: 1,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    if (noOutput) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    return { stdout: result, stderr: '', exitCode: 0 };
  },
};