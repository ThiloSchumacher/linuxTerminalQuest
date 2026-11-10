import { parseFlags, mapFsError } from './_helpers.js';

/**
 * `tee` — write stdin to stdout AND to files.
 *
 * ## Flags
 *
 * - `-a` append: append to existing files (write instead of
 *   overwriting). Files that don't exist are created either way.
 *
 * ## Input / output
 *
 * - stdin is mandatory. Without it:
 *   `tee: missing input (use with pipe)`, exit 2.
 * - stdin is always forwarded to stdout — even if every file write
 *   fails, the caller still sees the content.
 * - With no FILE args: pure pass-through (stdin → stdout, no files).
 *
 * ## Errors
 *
 * Per-file errors are reported as `tee: <path>: <mapped>` with exit 1,
 * but processing continues for remaining files. If at least one file
 * failed, the overall exit code is 1; stdout is unaffected.
 *
 * @module shell/commands/tee
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const tee = {
  name: 'tee',
  usage: 'tee [-a] [FILE...]',
  description: 'Schreibt stdin in Dateien und nach stdout.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, stdin }) {
    const { flags, args: files, unknown } = parseFlags(argv, ['a']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }

    if (typeof stdin !== 'string') {
      return {
        stdout: '',
        stderr: `${name}: missing input (use with pipe)\n`,
        exitCode: 2,
      };
    }

    const append = flags.has('a');
    const cwd = env.get('PWD') || '/';
    let stderr = '';
    let failed = false;

    for (const file of files) {
      try {
        const exists = vfs.exists(file, cwd);
        if (append && exists) {
          const prev = vfs.readFile(file, cwd);
          vfs.writeFile(file, cwd, prev + stdin);
        } else if (exists) {
          vfs.writeFile(file, cwd, stdin);
        } else {
          vfs.createFile(file, cwd, stdin);
        }
      } catch (err) {
        stderr += `${name}: ${file}: ${mapFsError(err)}\n`;
        failed = true;
      }
    }

    return { stdout: stdin, stderr, exitCode: failed ? 1 : 0 };
  },
};