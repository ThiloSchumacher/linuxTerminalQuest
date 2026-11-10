/**
 * `echo` — join arguments with a single space and append a newline.
 *
 * V1 supports `-n` as first argument only, and performs no escape
 * interpretation (`-e` is treated as literal text).
 *
 * @module shell/commands/echo
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const echo = {
  name: 'echo',
  usage: 'echo [-n] [TEXT...]',
  description: 'Gibt Text aus.',

  run({ argv, name, env }) {
    let noNewline = false;
    let start = 0;
    if (argv.length > 0 && argv[0] === '-n') {
      noNewline = true;
      start = 1;
    }
    const out = argv.slice(start).join(' ') + (noNewline ? '' : '\n');
    return { stdout: out, stderr: '', exitCode: 0 };
  },
};