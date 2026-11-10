import { parseFlags, fsErrorLine, displayTarget } from './_helpers.js';

/**
 * `ls` — list directory contents.
 *
 * Supported flags (V1): `-a`, `-A`, `-l`, `-1`. Combined flags (`-la`)
 * are accepted. `-a` and `-A` behave identically because the VFS from
 * spec001 has no `.`/`..` entries as real children.
 *
 * ## `-l` mode and symlinks (spec008b §3)
 *
 * For `type === 'link'` nodes:
 *  - mode string starts with `l`,
 *  - size is the LINK's own size (`target.length`),
 *  - the line ends with ` -> <target>`.
 *
 * ## Argument handling with symlinks
 *
 * Directory arg (real or via symlink-to-dir) → list its children. A
 * non-directory arg that is a symlink to a file → show the LINK itself.
 * A broken link arg → show the link itself. Children returned by
 * `list()` are shown as-is (link children are displayed with `-> target`
 * in long mode).
 *
 * `formatMode` renders the low 9 permission bits only. Setuid/setgid/
 * sticky are intentionally not shown in V1 (e.g. `/tmp` at mode
 * `0o1777` renders as `drwxrwxrwx` — GNU `ls -l` would render
 * `drwxrwxrwt`). Not a bug: V1 limit, documented here so a future
 * reader does not mistake it for one.
 *
 * @module shell/commands/ls
 */

/**
 * Render a Unix-style mode string (10 chars, e.g. `drwxr-xr-x`).
 *
 * V1 ignores setuid/setgid/sticky; only the low 9 permission bits are
 * rendered. Type char: `d` for dirs, `l` for links, `-` for files.
 *
 * @param {import('../../vfs/node.js').Node} node
 * @returns {string}
 */
function formatMode(node) {
  const typeChar =
    node.type === 'dir' ? 'd' : node.type === 'link' ? 'l' : '-';
  const bits = ['r', 'w', 'x'];
  let s = typeChar;
  for (let g = 0; g < 3; g++) {
    for (let b = 0; b < 3; b++) {
      const bitPos = 8 - g * 3 - b;
      s += node.mode & (1 << bitPos) ? bits[b] : '-';
    }
  }
  return s;
}

/**
 * Pad a numeric size to 8 characters, right-aligned.
 *
 * @param {number} size
 * @returns {string}
 */
function padSize(size) {
  return String(size).padStart(8, ' ');
}

/**
 * Format a single `-l` output line for a node.
 *
 * @param {import('../../vfs/node.js').Node} node
 * @returns {string}
 */
function formatLongLine(node) {
  const suffix = node.type === 'link' ? ` -> ${node.target}` : '';
  return `${formatMode(node)} ${node.owner} ${node.group} ${padSize(node.size)} ${node.name}${suffix}\n`;
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const ls = {
  name: 'ls',
  usage: 'ls [-a] [-A] [-l] [-1] [PATH...]',
  description: 'Listet Verzeichnisinhalte auf.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    let showHidden = false;
    let longFormat = false;
    /** @type {string[]} */
    const paths = [];

    for (const arg of argv) {
      if (arg.startsWith('-') && arg.length > 1) {
        for (let i = 1; i < arg.length; i++) {
          const ch = arg[i];
          if (ch === 'a' || ch === 'A') showHidden = true;
          else if (ch === 'l') longFormat = true;
          else if (ch === '1') {
            // Default output is already one-per-line; no-op.
          } else {
            return {
              stdout: '',
              stderr: `${name}: invalid option -- '${ch}'\n`,
              exitCode: 2,
            };
          }
        }
      } else {
        paths.push(arg);
      }
    }

    const cwd = env.get('PWD') || '/';
    if (paths.length === 0) paths.push(cwd);

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    for (const pathArg of paths) {
      let directNode;
      try {
        directNode = vfs.resolve(pathArg, cwd, { followLinks: false });
      } catch (err) {
        stderr += fsErrorLine(name, displayTarget(err, pathArg), err);
        exitCode = 2;
        continue;
      }

      let resolvedNode = directNode;
      if (vfs.isLink(directNode)) {
        try {
          resolvedNode = vfs.resolve(pathArg, cwd, { followLinks: true });
        } catch {
          resolvedNode = directNode;
        }
      }

      if (vfs.isDir(resolvedNode)) {
        const children = vfs
          .list(pathArg, cwd, { showHidden })
          .slice()
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const child of children) {
          if (longFormat) stdout += formatLongLine(child);
          else stdout += `${child.name}\n`;
        }
      } else if (longFormat) {
        stdout += formatLongLine(directNode);
      } else {
        stdout += `${directNode.name}\n`;
      }
    }

    return { stdout, stderr, exitCode };
  },
};