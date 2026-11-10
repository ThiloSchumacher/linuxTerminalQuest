/**
 * `date` — print the current local date and time.
 *
 * Format: `YYYY-MM-DD HH:MM:SS\n`. No flags in V1 (no `-u`, no
 * `+FORMAT`). Uses local time via the `Date` getters.
 *
 * @module shell/commands/date
 */

/**
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * @type {import('./index.js').CommandObject}
 */
export const date = {
  name: 'date',
  usage: 'date',
  description: 'Zeigt Datum und Uhrzeit.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env }) {
    const d = new Date();
    const out =
      `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
      ` ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return { stdout: `${out}\n`, stderr: '', exitCode: 0 };
  },
};