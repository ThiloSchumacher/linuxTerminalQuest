import { parseFlags, fsErrorLine, displayTarget } from './_helpers.js';

/**
 * `sort` — sort lines of files or stdin.
 *
 * V1 flags: `-r` (reverse), `-n` (numeric via parseFloat; NaN → 0),
 * `-u` (unique after sorting, by string equality).
 *
 * stdin mode (spec007a §4.2): when there are no file arguments and
 * `stdin` is a string, its lines are sorted and emitted. File
 * arguments always win; `null`/`undefined` stdin falls back to the
 * "missing file" error.
 *
 * Each file is sorted separately and output is concatenated. No
 * per-file header, no cross-file merge.
 *
 * @module shell/commands/sort
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const sort = {
  name: 'sort',
  usage: 'sort [-r] [-n] [-u] [FILE...]',
  description: 'Sortiert Zeilen.',

  run({ argv, name, env, vfs, stdin }) {
    const { flags, args, unknown } = parseFlags(argv, ['r', 'n', 'u']);
    if (unknown !== null) {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${unknown}'\n`,
        exitCode: 2,
      };
    }

    const reverse = flags.has('r');
    const numeric = flags.has('n');
    const unique = flags.has('u');

    /**
     * Sort (and optionally dedupe) the given lines, then return the
     * joined output. Shared between the stdin path and the per-file
     * loop so both follow identical semantics.
     *
     * @param {string[]} lines
     * @returns {string}
     */
    function renderSorted(lines) {
      const sorted = lines.slice().sort((a, b) => {
        let cmp;
        if (numeric) {
          const an = parseFloat(a);
          const bn = parseFloat(b);
          const av = Number.isNaN(an) ? 0 : an;
          const bv = Number.isNaN(bn) ? 0 : bn;
          cmp = av - bv;
        } else {
          cmp = a < b ? -1 : a > b ? 1 : 0;
        }
        return reverse ? -cmp : cmp;
      });

      let final = sorted;
      if (unique) {
        final = [];
        for (const line of sorted) {
          if (final.length === 0 || final[final.length - 1] !== line) {
            final.push(line);
          }
        }
      }

      let out = '';
      for (const line of final) {
        out += `${line}\n`;
      }
      return out;
    }

    // stdin mode: no file args + a real stdin string.
    if (args.length === 0 && typeof stdin === 'string') {
      const lines = stdin.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      return { stdout: renderSorted(lines), stderr: '', exitCode: 0 };
    }

    if (args.length === 0) {
      return { stdout: '', stderr: `${name}: missing file\n`, exitCode: 1 };
    }

    const cwd = env.get('PWD') || '/';
    let stdout = '';
    let stderr = '';
    let failed = false;

    for (const file of args) {
      let content;
      try {
        content = vfs.readFile(file, cwd);
      } catch (err) {
        stderr += fsErrorLine(name, displayTarget(err, file), err);
        failed = true;
        continue;
      }

      const lines = content.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      stdout += renderSorted(lines);
    }

    return { stdout, stderr, exitCode: failed ? 1 : 0 };
  },
};