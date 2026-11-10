/**
 * `clear` — clear the terminal screen.
 *
 * Delegates to `services.terminal.clear()`; the TerminalUI is
 * responsible for repainting the prompt. If no terminal is available
 * (e.g. in tests that pass `services: {}`), the command reports a
 * user-facing error instead of crashing.
 *
 * Note on prompt writes: when called from `_handleSubmit`, the prompt
 * is written twice — once by `TerminalUI.clear()`, once by the
 * subsequent `_redraw()`. The second write emits `\r\x1b[K` first, so
 * the user sees one prompt. This is intentional: `clear()` stays
 * self-contained for callers that do NOT go through `_handleSubmit`
 * (a future Ctrl-based or scripted clear would rely on the prompt
 * write inside `clear()`). Do not remove the `_writePrompt()` call
 * from `TerminalUI.clear()` without checking those callers.
 *
 * @module shell/commands/clear
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const clear = {
  name: 'clear',
  usage: 'clear',
  description: 'Leert den Bildschirm.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, stdin, services }) {
    if (!services || !services.terminal || typeof services.terminal.clear !== 'function') {
      return {
        stdout: '',
        stderr: `${name}: terminal not available\n`,
        exitCode: 1,
      };
    }
    services.terminal.clear();
    return { stdout: '', stderr: '', exitCode: 0 };
  },
};