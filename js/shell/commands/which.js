/**
 * `which` — report the path of a command.
 *
 * V1 reports a fake `/usr/bin/<name>` for every command present in the
 * registry; commands are all built-in, there is no real `/usr/bin` in
 * the VFS. Missing names go to stderr, exit 1.
 *
 * Requires `services.registry` (a `Map` of command name → command
 * object). If missing, reports `registry not available` (user-facing
 * error, no crash) — consistent with `clear`/`history`.
 *
 * @module shell/commands/which
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const which = {
  name: 'which',
  usage: 'which COMMAND...',
  description: 'Zeigt den Pfad eines Befehls an.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, services }) {
    if (argv.length === 0) {
      return { stdout: '', stderr: `${name}: missing command\n`, exitCode: 1 };
    }
    if (!services || !services.registry) {
      return {
        stdout: '',
        stderr: `${name}: registry not available\n`,
        exitCode: 1,
      };
    }

    let stdout = '';
    let stderr = '';
    let anyMissing = false;
    for (const arg of argv) {
      if (services.registry.has(arg)) {
        stdout += `/usr/bin/${arg}\n`;
      } else {
        stderr += `${name}: ${arg}: not found\n`;
        anyMissing = true;
      }
    }
    return { stdout, stderr, exitCode: anyMissing ? 1 : 0 };
  },
};