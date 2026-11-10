import { mapFsError } from './_helpers.js';

/**
 * `stat` — show file metadata (GNU-like, V1 simplified).
 *
 * Per argument: `lstat` semantics — for symlinks, the LINK's metadata
 * is shown (not the target's). For non-links, lstat and stat are
 * identical (lstat only skips following the FINAL component).
 *
 * Format (multi-line per file, blank line between files):
 *
 *     File: /abs/path
 *     Size: 20
 *     Type: regular file | directory | symbolic link
 *     Mode: 0644 (-rw-r--r--)
 *     Owner: root/root
 *     Access: 2025-01-01 12:00:00
 *     Modify: 2025-01-01 12:00:00
 *     Change: 2025-01-01 12:00:00
 *
 * `Mode` is 4-digit octal + the 10-char ls -l mode string. Setuid/
 * setgid/sticky are not shown (V1 limit, same as `ls -l`).
 *
 * @module shell/commands/stat
 */

/**
 * Normalize `path` relative to `cwd` into an absolute path. No VFS
 * lookup — pure path arithmetic (same rules as cd).
 *
 * @param {string} path
 * @param {string} cwd
 * @returns {string}
 */
function toAbsolute(path, cwd) {
  const combined = path.startsWith('/') ? path : cwd + '/' + path;
  /** @type {string[]} */
  const stack = [];
  for (const part of combined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return '/' + stack.join('/');
}

/**
 * Render a 10-char Unix-style mode string (same as `ls -l`).
 *
 * @param {{type: string, mode: number}} node
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
 * @param {number} ts
 * @returns {string} `YYYY-MM-DD HH:MM:SS` in local time.
 */
function formatDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * @param {string} type
 * @returns {string}
 */
function humanType(type) {
  if (type === 'file') return 'regular file';
  if (type === 'dir') return 'directory';
  if (type === 'link') return 'symbolic link';
  return type;
}

/**
 * @param {string} absPath
 * @param {{type: string, size: number, mode: number, owner: string,
 *          group: string, atime: number, mtime: number, ctime: number}} stat
 * @returns {string}
 */
function formatStatSection(absPath, stat) {
  const modeOctal = stat.mode.toString(8).padStart(4, '0');
  const modeStr = formatMode(stat);
  return [
    `File: ${absPath}`,
    `Size: ${stat.size}`,
    `Type: ${humanType(stat.type)}`,
    `Mode: ${modeOctal} (${modeStr})`,
    `Owner: ${stat.owner}/${stat.group}`,
    `Access: ${formatDate(stat.atime)}`,
    `Modify: ${formatDate(stat.mtime)}`,
    `Change: ${formatDate(stat.ctime)}`,
  ].join('\n');
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const stat = {
  name: 'stat',
  usage: 'stat FILE...',
  description: 'Zeigt Datei-Metadaten an.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    if (argv.length === 0) {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 1 };
    }
    const cwd = env.get('PWD') || '/';
    /** @type {string[]} */
    const sections = [];
    let stderr = '';
    let failed = false;

    for (const path of argv) {
      try {
        // lstat first: for symlinks it returns the LINK's metadata
        // (type='link', size = target.length). For non-links it is
        // identical to stat (lstat only skips following the final
        // component). We keep the resolve below to be spec-explicit
        // (spec §2 says "lstat; if not link, resolve"), even though
        // the values are the same for non-links.
        let statData = vfs.lstat(path, cwd);
        if (statData.type !== 'link') {
          const node = vfs.resolve(path, cwd);
          statData = {
            name: node.name,
            type: node.type,
            size: node.size,
            mode: node.mode,
            owner: node.owner,
            group: node.group,
            mtime: node.mtime,
            atime: node.atime,
            ctime: node.ctime,
          };
        }
        const absPath = toAbsolute(path, cwd);
        sections.push(formatStatSection(absPath, statData));
      } catch (err) {
        stderr += `${name}: ${path}: ${mapFsError(err)}\n`;
        failed = true;
      }
    }

    return {
      stdout: sections.join('\n\n'),
      stderr,
      exitCode: failed ? 1 : 0,
    };
  },
};