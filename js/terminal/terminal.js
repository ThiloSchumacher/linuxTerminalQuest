import { theme, fontSize, fontFamily } from './theme.js';

const SGR_PATTERN = /\x1b\[[\d;]*m/g;
const ANSI_CSI_PATTERN = /\x1b\[[\d;]*[\x40-\x7e]/g;
const C0_EXCEPT_TAB_PATTERN = /[\x00-\x08\x0a-\x1f\x7f]/g;

const FG_CODES = {
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
};

/**
 * Length of `str` as it appears on screen, ignoring ANSI SGR escapes.
 *
 * @param {string} str
 * @returns {number}
 */
export function visibleLength(str) {
  return str.replace(SGR_PATTERN, '').length;
}

/**
 * Filter a raw `onData` payload down to characters that belong in the
 * LineEditor buffer.
 *
 * @param {string} data
 * @returns {string}
 */
export function sanitizeInsert(data) {
  return data.replace(ANSI_CSI_PATTERN, '').replace(C0_EXCEPT_TAB_PATTERN, '');
}

/**
 * Wrap `text` in ANSI SGR escape sequences.
 *
 * @param {string} text
 * @param {{fg?: string, bold?: boolean}} [options]
 * @returns {string}
 */
export function colorize(text, options = {}) {
  if (text === '') return '';
  const { fg = 'default', bold = false } = options;
  const codes = [];
  if (bold) codes.push('1');
  if (fg !== 'default' && Object.prototype.hasOwnProperty.call(FG_CODES, fg)) {
    codes.push(String(FG_CODES[fg]));
  }
  if (codes.length === 0) return text;
  return `\x1b[${codes.join(';')}m${text}\x1b[0m`;
}

/**
 * Turn an `{ stdout, stderr, exitCode }` result into the string to write
 * into xterm.
 *
 * @param {{stdout: string|null|undefined, stderr: string|null|undefined, exitCode: number}} result
 * @returns {string}
 */
export function formatResultForTerminal(result) {
  let stdout = result.stdout ?? '';
  let stderr = result.stderr ?? '';
  if (stdout.length > 0 && !stdout.endsWith('\n')) stdout += '\n';
  if (stderr.length > 0 && !stderr.endsWith('\n')) stderr += '\n';
  const coloredStderr = stderr.length > 0 ? colorize(stderr, { fg: 'red' }) : '';
  return stdout + coloredStderr;
}

/**
 * Resolve the xterm.js classes from the UMD globals.
 *
 * @returns {{Terminal: any, FitAddon: any}}
 * @throws {Error} with `.code = 'EXTERNAL'` when the bundles are missing.
 */
export function resolveXtermGlobals() {
  const Terminal = /** @type {any} */ (window).Terminal;
  const FitAddon =
    /** @type {any} */ (window).FitAddon &&
    /** @type {any} */ (window).FitAddon.FitAddon;
  const missing = [];
  if (typeof Terminal !== 'function') missing.push('Terminal');
  if (typeof FitAddon !== 'function') missing.push('FitAddon');
  if (missing.length > 0) {
    const err = new Error(
      'xterm.js not loaded: missing ' + missing.join(', ') +
      '. Check <script> tags in index.html.',
    );
    /** @type {any} */ (err).code = 'EXTERNAL';
    /** @type {any} */ (err).missing = missing;
    throw err;
  }
  return { Terminal, FitAddon };
}

/**
 * Wires xterm.js to a LineEditor and an executor.
 *
 * ## Services (spec009a §5.2)
 *
 * The TerminalUI exposes itself to commands via the `services` object
 * handed to `executor.execute(input, services)`. `services` is built
 * in the constructor: `{ terminal: this, lineEditor: this._lineEditor }`.
 * Commands like `clear` and `history` use it; the executor forwards it
 * untouched.
 *
 * ## Other responsibilities (spec003b/spec004c, unchanged)
 *
 *  - Instantiate and mount an xterm.js terminal.
 *  - Translate raw key sequences from `term.onData` into LineEditor
 *    actions.
 *  - Redraw the current input line after every action.
 *  - On Enter: submit the line, run it via the injected executor
 *    (passing `services`), write the result through
 *    `formatResultForTerminal`, then start a fresh prompt.
 *
 * ## V1 limitations (see spec003b/spec004c for details)
 *
 *  - `convertEol` is enabled, so `\n` is rendered as `\r\n`.
 *  - Wrapped input buffers are not handled consistently.
 *  - Line breaks in pasted input are dropped by `sanitizeInsert`.
 *  - Tab key presses are ignored; a Tab inside a paste carries the
 *    documented cursor-math caveat.
 */
export class TerminalUI {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container
   * @param {import('../shell/executor.js').Executor} options.executor
   * @param {import('../shell/env.js').Env} options.env
   * @param {import('./line-editor.js').LineEditor} options.lineEditor
   * @param {() => string} options.prompt
   * @param {(input: string, result: {stdout: string, stderr: string, exitCode: number}) => void} [options.onCommand]
   */
  constructor({ container, executor, env, lineEditor, prompt, onCommand }) {
    this._container = container;
    this._executor = executor;
    this._env = env;
    this._lineEditor = lineEditor;
    this._promptFn = prompt;
    this._onCommand = typeof onCommand === 'function' ? onCommand : null;

    // CommandServices object passed to every command via the executor
    // (spec009a §5.2). `terminal` is this instance, `lineEditor` is the
    // same instance passed to the constructor.
    this.services = { terminal: this, lineEditor: this._lineEditor };

    /** @type {any|null} */
    this._term = null;
    /** @type {any|null} */
    this._fitAddon = null;
    /** @type {ResizeObserver|null} */
    this._resizeObserver = null;
    /** @type {{dispose: () => void}|null} */
    this._dataDisposable = null;
  }

  /**
   * Create the xterm instance, load the fit addon, hook input, focus,
   * and write the initial prompt.
   *
   * @returns {void}
   * @throws {Error} with `.code = 'EXTERNAL'` if xterm.js has not been
   *   loaded into `window`.
   */
  mount() {
    if (this._term) this.unmount();
    const { Terminal, FitAddon } = resolveXtermGlobals();

    this._term = new Terminal({
      theme, fontSize, fontFamily,
      cursorBlink: true,
      convertEol: true,
      scrollback: 1000,
    });

    this._fitAddon = new FitAddon();
    this._term.loadAddon(this._fitAddon);
    this._term.open(this._container);

    requestAnimationFrame(() => {
      if (this._fitAddon) this._fitAddon.fit();
    });

    this._dataDisposable = this._term.onData((data) => this._handleData(data));
    this._term.focus();
    this._writePrompt();

    this._resizeObserver = new ResizeObserver(() => {
      if (this._fitAddon) this._fitAddon.fit();
    });
    this._resizeObserver.observe(this._container);
  }

  /**
   * Tear down the terminal.
   *
   * @returns {void}
   */
  unmount() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._dataDisposable) {
      this._dataDisposable.dispose();
      this._dataDisposable = null;
    }
    if (this._term) {
      this._term.dispose();
      this._term = null;
    }
    this._fitAddon = null;
    if (this._container && typeof this._container.replaceChildren === 'function') {
      this._container.replaceChildren();
    }
  }

  /**
   * Write raw text into the terminal.
   *
   * @param {string} text
   * @returns {void}
   */
  write(text) {
    if (this._term) this._term.write(text);
  }

  /**
   * Replace the services object passed to commands via
   * `executor.execute(input, this.services)`.
   *
   * Why a setter and not a constructor parameter: at construction time
   * the caller cannot pass `{ terminal: this, … }` (this instance is
   * still being built — Henne-Ei). `app.js` calls
   * `terminal.setServices({ terminal, lineEditor, registry })` AFTER
   * `mount()`, once every component exists. Tests that don't need
   * extra services (e.g. terminal.test.js) never call this setter and
   * keep the constructor default.
   *
   * @param {import('../shell/commands/index.js').CommandServices} services
   * @returns {void}
   */
  setServices(services) {
    this.services = services;
  }

  /**
   * Clear the terminal screen and repaint the current input line
   * (spec009a §5.1). Called by the `clear` command via
   * `services.terminal.clear()`.
   *
   * After `_term.clear()`, only `_writePrompt()` is called — `_redraw()`
   * would emit a leading `\r\x1b[K` that is harmless but redundant on an
   * already-empty screen. `_writePrompt()` re-emits the prompt and buffer
   * with the cursor in the right position.
   *
   * When this method is reached via `_handleSubmit` (`clear` + Enter),
   * the caller subsequently calls `_redraw()` which writes the prompt a
   * second time (`\r\x1b[K` overwrites the first). That is intentional:
   * keeping the prompt-write inside `clear()` means `clear()` works
   * standalone too (future Ctrl-based clear, scripted clear, etc.). Do
   * not remove this write without checking such callers.
   *
   * @returns {void}
   */
  clear() {
    if (!this._term) return;
    this._term.clear();
    this._writePrompt();
  }

  /**
   * Dispatch a raw `onData` payload.
   *
   * @param {string} data
   * @returns {void}
   */
  _handleData(data) {
    switch (data) {
      case '\r': this._handleSubmit(); return;
      case '\t': return;
      case '\x7f':
      case '\x08':
        this._lineEditor.backspace();
        this._redraw();
        return;
      case '\x1b[3~':
        this._lineEditor.delete();
        this._redraw();
        return;
      case '\x1b[A':
        this._lineEditor.historyPrev();
        this._redraw();
        return;
      case '\x1b[B':
        this._lineEditor.historyNext();
        this._redraw();
        return;
      case '\x1b[C':
        this._lineEditor.moveRight();
        this._redraw();
        return;
      case '\x1b[D':
        this._lineEditor.moveLeft();
        this._redraw();
        return;
      case '\x1b[H':
      case '\x1b[1~':
      case '\x1bOH':
      case '\x01':
        this._lineEditor.moveToStart();
        this._redraw();
        return;
      case '\x1b[F':
      case '\x1b[4~':
      case '\x1bOF':
      case '\x05':
        this._lineEditor.moveToEnd();
        this._redraw();
        return;
      case '\x15':
        this._lineEditor.clearBeforeCursor();
        this._redraw();
        return;
      case '\x0b':
        this._lineEditor.clearAfterCursor();
        this._redraw();
        return;
      case '\x03':
        this._handleCtrlC();
        return;
      case '\x0c':
        this._handleCtrlL();
        return;
      default: {
        const clean = sanitizeInsert(data);
        if (clean) {
          this._lineEditor.insert(clean);
          this._redraw();
        }
        return;
      }
    }
  }

  /**
   * Handle Enter: submit the line, run it (with services), write the
   * coloured result, call `onCommand`, then start a fresh prompt.
   *
   * @returns {void}
   */
  _handleSubmit() {
    const line = this._lineEditor.submit();
    this._term.write('\n');

    if (line.trim() === '') {
      this._writePrompt();
      return;
    }

    const result = this._executor.execute(line, this.services);
    this._term.write(formatResultForTerminal(result));

    if (this._onCommand) {
      try { this._onCommand(line, result); }
      catch { /* silent */ }
    }

    this._redraw();
  }

  /**
   * Ctrl+C: discard the current line, echo `^C`, set `?` to 130, and
   * start a fresh prompt.
   *
   * @returns {void}
   */
  _handleCtrlC() {
    this._lineEditor.reset();
    this._term.write('^C\n');
    this._env.set('?', '130');
    this._redraw();
  }

  /**
   * Ctrl+L: clear the screen and redraw the current input line.
   *
   * @returns {void}
   */
  _handleCtrlL() {
    this._term.clear();
    this._redraw();
  }

  /**
   * Clear the current line and rewrite the prompt + buffer.
   *
   * @returns {void}
   */
  _redraw() {
    this._term.write('\r\x1b[K');
    this._writePrompt();
  }

  /**
   * Write prompt + buffer, then step the cursor back to its logical
   * position.
   *
   * @returns {void}
   */
  _writePrompt() {
    const promptStr = this._promptFn();
    const buffer = this._lineEditor.getBuffer();
    const cursor = this._lineEditor.getCursor();
    this._term.write(promptStr);
    this._term.write(buffer);
    const currentCol = visibleLength(promptStr) + buffer.length;
    const targetCol = visibleLength(promptStr) + cursor;
    const back = currentCol - targetCol;
    if (back > 0) this._term.write(`\x1b[${back}D`);
  }
}