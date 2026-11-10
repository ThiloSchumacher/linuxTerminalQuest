/**
 * xterm.js color theme and font configuration for BashQuest.
 *
 * Colors are tuned to match the dark slate background used across the UI
 * (see tests/index.html and the app shell). ANSI colors are declared only
 * for the eight base slots we actually render.
 *
 * @module terminal/theme
 */

/**
 * xterm.js theme object (`ITheme`). Pass directly to `new Terminal({ theme })`.
 *
 * @type {{
 *   background: string,
 *   foreground: string,
 *   cursor: string,
 *   cursorAccent: string,
 *   selectionBackground: string,
 *   black: string, red: string, green: string, yellow: string,
 *   blue: string, magenta: string, cyan: string, white: string,
 * }}
 */
export const theme = {
  background: '#0f172a',
  foreground: '#e2e8f0',
  cursor: '#facc15',
  cursorAccent: '#0f172a',
  selectionBackground: '#334155',

  // ANSI (only the ones we actually use):
  black: '#1e293b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e2e8f0',
};

/**
 * @type {number}
 */
export const fontSize = 14;

/**
 * Font stack; falls back to system monospace fonts if the bundled
 * JetBrains Mono / Fira Code are unavailable.
 *
 * @type {string}
 */
export const fontFamily = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";