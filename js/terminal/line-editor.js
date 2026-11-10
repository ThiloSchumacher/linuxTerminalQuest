/**
 * Deterministic line editor state machine for shell input.
 *
 * Holds the current buffer, cursor position and command history. Knows
 * nothing about xterm, ANSI, the executor, the prompt, or the VFS — the
 * xterm binding (spec003b) drives this class by translating key presses
 * into method calls.
 *
 * V1 behaviour note: navigating history (`historyPrev`/`historyNext`)
 * overwrites the buffer, so any in-progress edit is discarded. GNU
 * readline keeps a draft slot and restores it when you return; V1 does
 * not. This divergence is explicitly pinned by the test
 * "historyPrev discards an in-progress draft (V1 divergence from bash)"
 * so an unintentional switch to readline-style draft handling would be
 * caught by the suite.
 *
 * @module terminal/line-editor
 */
export class LineEditor {
  /**
   * @param {object} [options]
   * @param {number} [options.historyLimit=100] Maximum number of history
   *   entries retained; oldest is evicted first.
   */
  constructor({ historyLimit = 100 } = {}) {
    this._historyLimit = historyLimit;
    this._buffer = '';
    this._cursor = 0;
    /** @type {string[]} */
    this._history = [];
    /**
     * Current history-navigation position, or `null` when not navigating.
     * Read-only from outside; exposed for tests and debugging.
     *
     * @type {number|null}
     */
    this.historyIndex = null;
  }

  // ------------------------------------------------------------------
  // Buffer manipulation
  // ------------------------------------------------------------------

  /**
   * Insert `text` at the cursor and advance the cursor past it.
   *
   * Complexity: amortized O(1) for the common append-at-end case; a
   * general mid-buffer insert is O(n) because the surrounding buffer
   * has to be re-concatenated.
   *
   * @param {string} text
   * @returns {void}
   */
  insert(text) {
    this._buffer =
      this._buffer.slice(0, this._cursor) + text + this._buffer.slice(this._cursor);
    this._cursor += text.length;
  }

  /**
   * Delete the character before the cursor. No-op at position 0.
   *
   * @returns {void}
   */
  backspace() {
    if (this._cursor === 0) return;
    this._buffer =
      this._buffer.slice(0, this._cursor - 1) + this._buffer.slice(this._cursor);
    this._cursor -= 1;
  }

  /**
   * Delete the character after the cursor. No-op at end of buffer.
   *
   * @returns {void}
   */
  delete() {
    if (this._cursor >= this._buffer.length) return;
    this._buffer =
      this._buffer.slice(0, this._cursor) + this._buffer.slice(this._cursor + 1);
  }

  /**
   * Delete everything before the cursor (Ctrl+U). Cursor ends at 0.
   *
   * @returns {void}
   */
  clearBeforeCursor() {
    this._buffer = this._buffer.slice(this._cursor);
    this._cursor = 0;
  }

  /**
   * Delete everything from the cursor to the end (Ctrl+K). Cursor unchanged.
   *
   * @returns {void}
   */
  clearAfterCursor() {
    this._buffer = this._buffer.slice(0, this._cursor);
  }

  /**
   * Clear the whole line (buffer + cursor).
   *
   * @returns {void}
   */
  clearLine() {
    this._buffer = '';
    this._cursor = 0;
  }

  // ------------------------------------------------------------------
  // Cursor movement
  // ------------------------------------------------------------------

  /**
   * Move cursor one position left. No-op at position 0.
   *
   * @returns {void}
   */
  moveLeft() {
    if (this._cursor > 0) this._cursor -= 1;
  }

  /**
   * Move cursor one position right. No-op at end of buffer.
   *
   * @returns {void}
   */
  moveRight() {
    if (this._cursor < this._buffer.length) this._cursor += 1;
  }

  /**
   * Move cursor to the beginning of the buffer.
   *
   * @returns {void}
   */
  moveToStart() {
    this._cursor = 0;
  }

  /**
   * Move cursor to the end of the buffer.
   *
   * @returns {void}
   */
  moveToEnd() {
    this._cursor = this._buffer.length;
  }

  // ------------------------------------------------------------------
  // History
  // ------------------------------------------------------------------

  /**
   * Load the previous (older) history entry into the buffer. No-op if the
   * history is empty or the oldest entry is already shown.
   *
   * Overwrites the current buffer — any in-progress edit is discarded
   * (V1 simplification; GNU readline restores a saved draft instead).
   * Pinned by the test "historyPrev discards an in-progress draft".
   *
   * @returns {void}
   */
  historyPrev() {
    if (this._history.length === 0) return;
    if (this.historyIndex === null) {
      this.historyIndex = this._history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1;
    } else {
      return;
    }
    this._buffer = this._history[this.historyIndex];
    this._cursor = this._buffer.length;
  }

  /**
   * Load the next (newer) history entry into the buffer. Stepping past the
   * newest entry clears the buffer and resets `historyIndex` to `null`.
   * No-op when not currently navigating history.
   *
   * Overwrites the current buffer — see `historyPrev` for the V1 note.
   *
   * @returns {void}
   */
  historyNext() {
    if (this.historyIndex === null) return;
    if (this.historyIndex === this._history.length - 1) {
      this._buffer = '';
      this._cursor = 0;
      this.historyIndex = null;
    } else {
      this.historyIndex += 1;
      this._buffer = this._history[this.historyIndex];
      this._cursor = this._buffer.length;
    }
  }

  /**
   * Append a line to history. Empty/whitespace-only lines are ignored.
   * Duplicate adjacent entries are NOT coalesced (V1 simplification).
   *
   * @param {string} line
   * @returns {void}
   */
  pushHistory(line) {
    if (line.trim() === '') return;
    this._history.push(line);
    if (this._history.length > this._historyLimit) {
      this._history.shift();
    }
  }

  // ------------------------------------------------------------------
  // Submit / reset
  // ------------------------------------------------------------------

  /**
   * Submit the current buffer: return its contents, push to history if
   * non-empty (after trim), and reset the buffer, cursor and navigation
   * index. Returns the exact buffer string (possibly `''`).
   *
   * @returns {string}
   */
  submit() {
    const line = this._buffer;
    if (line.trim() !== '') {
      this.pushHistory(line);
    }
    this._buffer = '';
    this._cursor = 0;
    this.historyIndex = null;
    return line;
  }

  /**
   * Clear the buffer, cursor and history-navigation index. History itself
   * is preserved.
   *
   * @returns {void}
   */
  reset() {
    this._buffer = '';
    this._cursor = 0;
    this.historyIndex = null;
  }

  // ------------------------------------------------------------------
  // State accessors
  // ------------------------------------------------------------------

  /**
   * @returns {string} Current buffer content.
   */
  getBuffer() {
    return this._buffer;
  }

  /**
   * @returns {number} Current cursor position (0 .. buffer.length).
   */
  getCursor() {
    return this._cursor;
  }

  /**
   * @returns {string[]} Copy of the current history array. Mutating the
   *   result has no effect on the editor's internal history.
   */
  getHistory() {
    return this._history.slice();
  }
}