import { mapFsError } from './_helpers.js';

/**
 * `file` — report the type of a file.
 *
 * V1 descriptions:
 *  - `directory`
 *  - `symbolic link to <target>`
 *  - `regular file`, classified by content:
 *      - `empty` when the file is 0 bytes
 *      - `data` when the content contains a NUL byte, or when it has
 *        non-ASCII bytes and looks like mojibake (a `\uFFFD` in the
 *        decoded string — the Unicode replacement character that a
 *        lossy UTF-8 decode would produce)
 *      - `ASCII text` when every byte is < 0x80
 *      - `UTF-8 Unicode text` for everything else
 *
 * The UTF-8 heuristic is not a real charset sniffer; it follows the
 * spec's "JSON.stringify(content) has no \uFFFD" rule and is meant for
 * the learning exercises, not for real binary detection.
 *
 * @module shell/commands/file
 */

/**
 * @param {string} content
 * @returns {string} Description of file content.
 */
function classifyContent(content) {
  if (content === '') return 'empty';
  if (content.includes('\0')) return 'data';
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(content)) return 'ASCII text';
  if (content.includes('\uFFFD')) return 'data';
  return 'UTF-8 Unicode text';
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const file = {
  name: 'file',
  usage: 'file FILE...',
  description: 'Erkennt den Dateityp.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    if (argv.length === 0) {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 1 };
    }
    const cwd = env.get('PWD') || '/';
    let stdout = '';
    let stderr = '';
    let failed = false;

    for (const path of argv) {
      try {
        const directNode = vfs.resolve(path, cwd, { followLinks: false });
        let description;
        if (directNode.type === 'link') {
          description = `symbolic link to ${directNode.target}`;
        } else if (directNode.type === 'dir') {
          description = 'directory';
        } else {
          const node = vfs.resolve(path, cwd);
          description = classifyContent(node.content);
        }
        stdout += `${path}: ${description}\n`;
      } catch (err) {
        stderr += `${name}: ${path}: ${mapFsError(err)}\n`;
        failed = true;
      }
    }

    return { stdout, stderr, exitCode: failed ? 1 : 0 };
  },
};