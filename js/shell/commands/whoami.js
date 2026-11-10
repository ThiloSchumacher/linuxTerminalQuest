/**
 * `whoami` — print the current user name.
 *
 * Reads `USER` from the env; falls back to `'user'` when unset. No
 * flags, arguments ignored.
 *
 * @module shell/commands/whoami
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const whoami = {
  name: 'whoami',
  usage: 'whoami',
  description: 'Zeigt den aktuellen Benutzernamen.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env }) {
    const user = env.get('USER') || 'user';
    return { stdout: `${user}\n`, stderr: '', exitCode: 0 };
  },
};