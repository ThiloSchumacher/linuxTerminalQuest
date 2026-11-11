import { fsErrorLine } from './_helpers.js';

/**
 * `chown` — change file owner and/or group.
 *
 * ## No permission checks (V1)
 *
 * In real Linux, `chown` requires root (or CAP_CHOWN). This app has
 * no permission model (spec001.1 §C — deliberate V1 simplification),
 * so `chown` changes metadata unconditionally, the same way `chmod`
 * does. Do not add a rights check here without also introducing a
 * permission model to the VFS.
 *
 * ## `OWNER[:GROUP]` syntax (V1 subset)
 *
 *   `'user'`       → owner='user', group unchanged
 *   `'user:staff'` → owner='user', group='staff'
 *   `':staff'`     → group='staff', owner unchanged
 *   `'user:'`      → owner='user', group unchanged
 *                    (V1 does not infer the login group; real chown
 *                    substitutes the primary group of `user`)
 *   `''` or `':'`  → invalid spec (neither field specified)
 *
 * ## Flags (V1)
 *
 * No flags are supported. An argument beginning with `-` (other than
 * a bare `-`, which is a legal filename) produces
 * `chown: invalid option -- 'X'` with exit 2. `--help` is intercepted
 * by the executor before this command is called (spec013c-fix §Bug C).
 *
 * @module shell/commands/chown
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const chown = {
  name: 'chown',
  usage: 'chown OWNER[:GROUP] FILE...',
  description: 'Ändert Besitzer und/oder Gruppe einer Datei.',

  run({ argv, name, env, vfs }) {
    if (argv.length === 0) {
      return { stdout: '', stderr: `${name}: missing operand\n`, exitCode: 1 };
    }

    const spec = argv[0];
    // Unknown flag: `-R`, `-x`, etc. `-` alone is treated as a filename
    // (consistent with real chown; V1 does not read stdin). `--help`
    // is intercepted by the executor before we get here, so it never
    // reaches this branch.
    if (spec.length > 1 && spec[0] === '-') {
      return {
        stdout: '',
        stderr: `${name}: invalid option -- '${spec.slice(1)}'\n`,
        exitCode: 2,
      };
    }

    if (argv.length === 1) {
      return {
        stdout: '',
        stderr: `${name}: missing file operand\n`,
        exitCode: 1,
      };
    }

    // Parse OWNER[:GROUP]. Colon distinguishes the two fields; empty
    // field = "leave unchanged". Both-empty (`''` or `':'`) is invalid
    // because the command would be a no-op on every file.
    let owner = null;
    let group = null;
    const colonIdx = spec.indexOf(':');
    if (colonIdx === -1) {
      if (spec === '') {
        return {
          stdout: '',
          stderr: `${name}: invalid spec: '${spec}'\n`,
          exitCode: 1,
        };
      }
      owner = spec;
    } else {
      const o = spec.slice(0, colonIdx);
      const g = spec.slice(colonIdx + 1);
      if (o === '' && g === '') {
        return {
          stdout: '',
          stderr: `${name}: invalid spec: '${spec}'\n`,
          exitCode: 1,
        };
      }
      if (o !== '') owner = o;
      if (g !== '') group = g;
    }

    const cwd = env.get('PWD') || '/';
    let stderr = '';
    let failed = false;

    // Continue on error: a failing file does not stop the rest (same
    // contract as chmod, cp, mv).
    for (const path of argv.slice(1)) {
      try {
        vfs.chown(path, owner, group, cwd);
      } catch (err) {
        stderr += fsErrorLine(name, path, err);
        failed = true;
      }
    }

    return { stdout: '', stderr, exitCode: failed ? 1 : 0 };
  },
};