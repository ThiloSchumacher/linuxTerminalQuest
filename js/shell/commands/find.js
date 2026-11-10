import { mapFsError } from './_helpers.js';

/**
 * `find` — search the VFS tree recursively.
 *
 * ## Signature
 *
 *     find [PATH...] [EXPRESSION]
 *
 * Every argument before the first `-`-prefixed argument is treated as
 * a PATH; the rest is EXPRESSION. Without any PATH, `.` (cwd) is used.
 * Multiple filters are AND-combined. No filter → every node under
 * PATH is printed.
 *
 * ## Supported predicates (V1)
 *
 * - `-name PATTERN` — glob match on `node.name` (the basename).
 *   Only `*` (zero or more chars) and `?` (exactly one char) are
 *   wildcards; everything else is literal. No `[abc]` character
 *   classes, no `**`, and no escape sequences (`\` is a literal
 *   character, per spec011a §3.2).
 * - `-type f|d` — match only files or only directories. `l` (symlink)
 *   is not supported (`unsupported type: l`, exit 2). Other values
 *   also error out.
 * - `-maxdepth N` — maximum recursion depth. N is a non-negative
 *   integer. `-maxdepth 0` visits only PATH itself (no children);
 *   `-maxdepth 1` visits PATH and its direct children. Without
 *   `-maxdepth`, recursion is unbounded — POSIX-conform, and the
 *   initial-fs is shallow enough for this to be safe in practice.
 *
 * ## Symlink handling
 *
 * Symlinks are NOT followed (POSIX `-P` default). This applies to
 * **both** child links and PATH arguments:
 *
 *  - A child link node is printed if it passes the filters, but its
 *    target is never traversed.
 *  - A PATH argument that is a symlink is resolved with
 *    `followLinks: false` — the link node itself is used as the
 *    search root, and its target's children are NOT traversed. So
 *    `find /etc-link` (where `etc-link -> /etc`) prints `/etc-link`
 *    (subject to filters) but not `/etc-link/hosts`.
 *
 * V1 implements only `-P`. If a later spec adds `-H`/`-L` (follow
 * PATH links or follow all links), this must be revisited: `-H`
 * would use `followLinks: true` for PATH args only; `-L` would
 * additionally follow child links during traversal.
 *
 * There is no separate loop-detection guard because the VFS tree
 * itself cannot contain cycles — only symlinks can, and they're not
 * followed.
 *
 * ### CWD-symlink edge case
 *
 * If the CWD itself is a symlink (e.g. `cd /etc-link; find .` where
 * `etc-link -> /etc`), `.` resolves to the LINK node (not the target)
 * because PATH resolution uses `followLinks: false`. `find .` then
 * prints only `.` — the link's target's children are NOT traversed.
 * This is consistent with `-P` and with the rest of V1's symlink
 * handling, but it is called out because the CWD-based invocation is
 * not the obvious place to expect it: a user who `cd`-ed into `/etc-link`
 * sees `pwd` report `/etc-link`, and `find .` returning only `.` is
 * surprising without this note.
 *
 * The `find`-without-arguments invocation is affected the same way:
 * `paths` defaults to `['.']`, so a bare `find` in a symlink-CWD
 * prints `.` and nothing else. Both entry points share the same
 * `followLinks: false` resolution — a fix that only handled the
 * explicit `.` case would leave the bare-invocation inconsistent.
 *
 * ## Output
 *
 * One line per match, path prefixed with the PATH argument as the
 * user wrote it (no `./`-stripping, no absolutisation):
 *  - `find /etc`      →  `/etc`, `/etc/hosts`, `/etc/motd`, `/etc/passwd`
 *  - `find .`         →  `.`, `./notes.txt`, …
 *  - `find /home/user -maxdepth 1` →  the four direct entries
 *
 * Trailing slashes in PATH are stripped before prefixing, except when
 * PATH is `'/'`. Hidden files are printed (find is not `ls`).
 *
 * Per-directory ordering is alphabetical (string `<`), traversed
 * depth-first: PATH first, then its children in order, each child's
 * subtree before the next sibling (POSIX `find` order).
 *
 * ## Errors
 *
 * A path that cannot be resolved produces `find: <path>: <mapped>` on
 * stderr and exit 1; remaining paths are still searched. A missing
 * filter argument or an unsupported/unknown predicate → exit 2.
 * Zero matches → empty stdout, exit 0 (POSIX: no-match is not an
 * error for find).
 *
 * @module shell/commands/find
 */

/**
 * Convert a `-name` glob pattern to an anchored RegExp.
 *
 * Only `*` and `?` are wildcards. All other characters — including
 * `\`, which V1 does NOT treat as an escape — are escaped so they
 * match literally. No character classes.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  /** @type {string} */
  let out = '';
  for (const ch of pattern) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else if (/[.*+?^${}()|[\]\\]/.test(ch)) out += '\\' + ch;
    else out += ch;
  }
  return new RegExp('^' + out + '$');
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const find = {
  name: 'find',
  usage: 'find [PATH...] [EXPRESSION]',
  description: 'Sucht Dateien rekursiv.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    // --- Parse: PATHs, then EXPRESSION ------------------------------
    // Everything before the first `-`-prefixed arg (length > 1) is a
    // PATH; everything after is a filter. A bare `-` (single char)
    // would be a path, though nobody does that — the rule mirrors the
    // spec's "vor dem ersten `-`-Argument".
    /** @type {string[]} */
    const paths = [];
    let i = 0;
    while (
      i < argv.length &&
      !(argv[i].startsWith('-') && argv[i].length > 1)
    ) {
      paths.push(argv[i]);
      i += 1;
    }
    if (paths.length === 0) paths.push('.');

    /** @type {RegExp|null} */
    let namePattern = null;
    /** @type {'file'|'dir'|null} */
    let typeFilter = null;
    /** @type {number|null} */
    let maxdepth = null;

    while (i < argv.length) {
      const arg = argv[i];
      if (arg === '-name') {
        if (i + 1 >= argv.length) {
          return {
            stdout: '',
            stderr: `${name}: missing argument for -name\n`,
            exitCode: 2,
          };
        }
        namePattern = globToRegex(argv[i + 1]);
        i += 2;
      } else if (arg === '-type') {
        if (i + 1 >= argv.length) {
          return {
            stdout: '',
            stderr: `${name}: missing argument for -type\n`,
            exitCode: 2,
          };
        }
        const t = argv[i + 1];
        if (t === 'f') typeFilter = 'file';
        else if (t === 'd') typeFilter = 'dir';
        else {
          return {
            stdout: '',
            stderr: `${name}: unsupported type: ${t}\n`,
            exitCode: 2,
          };
        }
        i += 2;
      } else if (arg === '-maxdepth') {
        if (i + 1 >= argv.length) {
          return {
            stdout: '',
            stderr: `${name}: missing argument for -maxdepth\n`,
            exitCode: 2,
          };
        }
        const n = argv[i + 1];
        if (!/^\d+$/.test(n)) {
          return {
            stdout: '',
            stderr: `${name}: invalid maxdepth: ${n}\n`,
            exitCode: 2,
          };
        }
        maxdepth = parseInt(n, 10);
        i += 2;
      } else {
        return {
          stdout: '',
          stderr: `${name}: unknown predicate: ${arg}\n`,
          exitCode: 2,
        };
      }
    }

    // --- Search each PATH ------------------------------------------
    const cwd = env.get('PWD') || '/';
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    for (const pathArg of paths) {
      // followLinks: false — a PATH argument that is a symlink is used
      // as the search root ITSELF, not the target. Matches POSIX find
      // default -P and the module JSDoc "Symlink handling" rule.
      //
      // Intermediate path components that are symlinks ARE still
      // followed (vfs.resolve's contract), so `find /link-to-dir/sub`
      // searches /etc/sub correctly.
      //
      // Also covers the CWD-symlink case: if `cwd` is a link, `.`
      // resolves to the link node (not its target), and no traversal
      // happens. See module JSDoc "CWD-symlink edge case".
      let rootNode;
      try {
        rootNode = vfs.resolve(pathArg, cwd, { followLinks: false });
      } catch (err) {
        stderr += `${name}: ${pathArg}: ${mapFsError(err)}\n`;
        exitCode = 1;
        continue;
      }
      // Display path: the PATH as the user wrote it, but with trailing
      // slashes stripped (unless it's just '/'). Children get
      // `displayRoot + '/' + name`.
      const displayRoot = pathArg.replace(/\/+$/, '') || '/';

      /**
       * Walk a subtree, emitting matches.
       *
       * @param {import('../../vfs/node.js').Node} node
       * @param {string} displayPath
       * @param {number} depth  Distance from the PATH root (0).
       */
      const walk = (node, displayPath, depth) => {
        const matches =
          (namePattern === null || namePattern.test(node.name)) &&
          (typeFilter === null || node.type === typeFilter);
        if (matches) stdout += displayPath + '\n';

        if (maxdepth !== null && depth >= maxdepth) return;
        if (!vfs.isDir(node)) return;

        const children = Array.from(node.children.values()).sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        for (const child of children) {
          // Don't double-slash at the root '/' display path.
          const childPath =
            (displayPath === '/' ? '' : displayPath) + '/' + child.name;
          walk(child, childPath, depth + 1);
        }
      };

      walk(rootNode, displayRoot, 0);
    }

    return { stdout, stderr, exitCode };
  },
};