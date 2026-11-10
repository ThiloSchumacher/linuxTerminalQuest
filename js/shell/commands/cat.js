/**
 * `cat` — concatenate files (or stdin) to stdout.
 *
 * V1 supports the `-n` flag (line numbers, GNU-style). No other flags;
 * unknown `-x` args are treated as file names and typically fail with
 * ENOENT.
 *
 * stdin mode (spec007a §4.2): when there are no file arguments and
 * `stdin` is a string, its content is emitted instead of reading files.
 * When file arguments are present, `stdin` is ignored (POSIX: file
 * arguments win). `-` as a filename is not supported in V1 — it is a
 * literal filename.
 *
 * `-n` always terminates every line with `\n`, matching the spec's
 * format template. This diverges from GNU `cat -n` for a final line
 * without a trailing newline; the test suite pins the V1 behaviour.
 *
 * @module shell/commands/cat
 */

/**
 * Prefix each line with a right-aligned 5-char number and a tab.
 *
 * @param {string} content
 * @returns {string}
 */
function numberLines(content) {
  if (content === '') return '';
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines
    .map((line, i) => String(i + 1).padStart(5, ' ') + '\t' + line + '\n')
    .join('');
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const cat = {
  name: 'cat',
  usage: 'cat [-n] [FILE...]',
  description: 'Gibt Dateiinhalte aus.',
  
  run({ argv, name, env, vfs, stdin }) {
    let numberFlag = false;
    /** @type {string[]} */
    const paths = [];
    for (const arg of argv) {
      if (arg === '-n') numberFlag = true;
      else paths.push(arg);
    }

    // stdin mode: only when there are no file arguments and stdin is
    // actually a string. File arguments always win (POSIX); a `null`
    // or `undefined` stdin means "no pipe feeding this command" and
    // falls back to the legacy no-op behaviour.
    if (paths.length === 0 && typeof stdin === 'string') {
      return {
        stdout: numberFlag ? numberLines(stdin) : stdin,
        stderr: '',
        exitCode: 0,
      };
    }

    const cwd = env.get('PWD') || '/';
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    for (const pathArg of paths) {
      try {
        const content = vfs.readFile(pathArg, cwd);
        stdout += numberFlag ? numberLines(content) : content;
      } catch (err) {
        const code = err && err.code;
        const mapped =
          code === 'ENOENT'
            ? 'No such file or directory'
            : code === 'EISDIR'
              ? 'Is a directory'
              : (err && err.message) || 'Unknown error';
        stderr += `${name}: ${pathArg}: ${mapped}\n`;
        exitCode = 1;
      }
    }

    return { stdout, stderr, exitCode };
  },
};