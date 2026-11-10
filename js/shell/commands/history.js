/**
 * `history` — print the command history.
 *
 * Formats as `<N>  <command>` per entry, `N` right-aligned in 4 chars,
 * 1-based. No flags in V1. Delegates to `services.lineEditor`; if no
 * line editor is available, reports a user-facing error instead of
 * crashing.
 *
 * @module shell/commands/history
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const history = {
  name: 'history',
  usage: 'history',
  description: 'Zeigt die bisherigen Befehle.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, stdin, services }) {
    if (!services || !services.lineEditor || typeof services.lineEditor.getHistory !== 'function') {
      return {
        stdout: '',
        stderr: `${name}: line editor not available\n`,
        exitCode: 1,
      };
    }
    const entries = services.lineEditor.getHistory();
    let stdout = '';
    for (let i = 0; i < entries.length; i++) {
      const n = String(i + 1).padStart(4, ' ');
      stdout += `${n}  ${entries[i]}\n`;
    }
    return { stdout, stderr: '', exitCode: 0 };
  },
};