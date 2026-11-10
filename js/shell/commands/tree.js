import { mapFsError } from './_helpers.js';

/**
 * `tree` — display a directory tree (GNU-like, V1 simplified).
 *
 * Flags: `-L N` — maximum depth N (positive integer). Without `-L`,
 * depth is 5. Hidden files/dirs (leading `.`) are skipped, matching
 * `ls` without `-a` and GNU `tree` without `-a`.
 *
 * Symlinks are displayed as `<name> -> <target>`, never followed.
 * Alphabetical (string `<`) order at each level. Box-drawing prefix
 * for children:
 *
 *     etc
 *     ├── hosts
 *     ├── motd
 *     └── passwd
 *
 *     N directories, M files
 *
 * ## Counting rule (spec009b §4 + Patch 1)
 *
 * **(a) V1 rule — PATH (root) counts as 1 directory.** The root of the
 * tree is displayed (its name appears on the first line), so it is
 * counted. Consequences:
 *
 *   - `tree /tmp` on an empty `/tmp` → `1 directory, 0 files`.
 *   - `tree /etc` (with hosts, motd, passwd) → `1 directory, 3 files`.
 *
 * **(b) Deliberate divergence from GNU `tree`.** GNU `tree` does NOT
 * count the root; it would print `0 directories, 0 files` for the
 * empty `/tmp` case and `0 directories, 3 files` for `/etc`. V1
 * diverges here on purpose: the count reflects the number of nodes
 * actually displayed in the output (the root IS displayed, so counting
 * it keeps "N directories" consistent with what the user sees on
 * screen). This is a knowing trade-off — do NOT "fix" the counter to
 * match GNU without also updating the tests and the spec.
 *
 * **(c) The `/etc` case follows the same rule.** `tree /etc` →
 * `1 directory, 3 files` — same rule as (a), also non-GNU. Pinned by
 * the test `['/etc'] → … ends with '1 directory, 3 files'`.
 *
 * **(d) The `[recursive, ignored]` branch also counts as 1 directory.**
 * When a cycle is detected, the child node is still printed (as
 * `<name> [recursive, ignored]`), so it counts toward `N` — the
 * general rule is "counted == displayed", not "counted == unique".
 * Consequence: `tree /tmp/a` where `/tmp/a` contains a self-reference
 * prints `a\n└── a [recursive, ignored]\n\n2 directories, 0 files`.
 * Semantically "two lines starting with the name 'a'" — pinned by the
 * test "recursive-ignored branch counts as 1 directory (2 directories,
 * 0 files)". If a future spec adds hardlinks or `move`-re-parenting,
 * re-verify this rule: "displayed count" and "unique-node count" will
 * diverge and the user-facing expectation must be clarified.
 *
 * `M` counts displayed files; symlinks count as files.
 *
 * ## Cycle protection
 *
 * A `visited` set guards against cycles. In V1 the VFS is a tree
 * (no hardlinks), so a real cycle is impossible through normal
 * commands — the guard is defensive against future extensions
 * (e.g. hardlinks, or a spec that allows re-parenting via `move`).
 * The branch is pinned by the test "detects cycles via visited set
 * (test-only manipulation)", which forces a cycle via direct
 * `.children` manipulation. Do NOT remove the visited-check without
 * removing that test and re-verifying that no reachable VFS state
 * can produce a cycle.
 *
 * @module shell/commands/tree
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const tree = {
  name: 'tree',
  usage: 'tree [-L N] [PATH]',
  description: 'Zeigt einen Verzeichnisbaum.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs }) {
    let maxDepth = 5;
    let path = null;
    let i = 0;
    while (i < argv.length) {
      const arg = argv[i];
      if (arg === '-L') {
        if (i + 1 >= argv.length) {
          return {
            stdout: '',
            stderr: `${name}: option requires an argument -- 'L'\n`,
            exitCode: 1,
          };
        }
        const v = argv[i + 1];
        if (!/^\d+$/.test(v) || parseInt(v, 10) < 1) {
          return {
            stdout: '',
            stderr: `${name}: invalid depth: '${v}'\n`,
            exitCode: 1,
          };
        }
        maxDepth = parseInt(v, 10);
        i += 2;
      } else if (arg.startsWith('-') && arg.length > 1) {
        return {
          stdout: '',
          stderr: `${name}: invalid option -- '${arg[1]}'\n`,
          exitCode: 2,
        };
      } else if (path === null) {
        path = arg;
        i += 1;
      } else {
        // Extra non-flag operands are ignored (V1 simplification).
        i += 1;
      }
    }

    const cwd = env.get('PWD') || '/';
    const targetPath = path === null ? cwd : path;
    let rootNode;
    try {
      rootNode = vfs.resolve(targetPath, cwd);
    } catch (err) {
      return {
        stdout: '',
        stderr: `${name}: ${targetPath}: ${mapFsError(err)}\n`,
        exitCode: 1,
      };
    }
    if (!vfs.isDir(rootNode)) {
      return {
        stdout: '',
        stderr: `${name}: ${targetPath}: not a directory\n`,
        exitCode: 1,
      };
    }

    // Display name: the resolved node's `.name` (not the raw argument).
    // For `tree /etc` this is `etc` (same as `vfs.basename('/etc')`),
    // but for `tree .` (cwd=/etc) it is also `etc` — the raw argument
    // would render `.\n`, which is technically what GNU tree shows but
    // is not what a user expects for "show me THIS directory". Using
    // `rootNode.name` uniformly keeps `.`/`..`/relative paths readable
    // and consistent with `tree <absolute-path>`.
    const rootName = rootNode.name;
    let stdout = `${rootName}\n`;
    let dirCount = 1;
    let fileCount = 0;
    /** @type {Set<import('../../vfs/node.js').Node>} */
    const visited = new Set();
    visited.add(rootNode);

    /**
     * @param {import('../../vfs/node.js').Node} node
     * @param {string} prefix
     * @param {number} depth  Distance from root; root is depth 0.
     */
    const walk = (node, prefix, depth) => {
      if (depth >= maxDepth) return;
      const children = Array.from(node.children.values())
        .filter((c) => !c.name.startsWith('.'))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (let j = 0; j < children.length; j++) {
        const child = children[j];
        const isLast = j === children.length - 1;
        const branch = isLast ? '└── ' : '├── ';

        if (child.type === 'link') {
          stdout += `${prefix}${branch}${child.name} -> ${child.target}\n`;
          fileCount += 1;
        } else if (child.type === 'dir') {
          if (visited.has(child)) {
            stdout += `${prefix}${branch}${child.name} [recursive, ignored]\n`;
            dirCount += 1;
          } else {
            visited.add(child);
            stdout += `${prefix}${branch}${child.name}\n`;
            dirCount += 1;
            const nextPrefix = prefix + (isLast ? '    ' : '│   ');
            walk(child, nextPrefix, depth + 1);
          }
        } else {
          stdout += `${prefix}${branch}${child.name}\n`;
          fileCount += 1;
        }
      }
    };

    walk(rootNode, '', 0);

    stdout += `\n${dirCount} ${dirCount === 1 ? 'directory' : 'directories'}, ${fileCount} ${fileCount === 1 ? 'file' : 'files'}\n`;
    return { stdout, stderr: '', exitCode: 0 };
  },
};