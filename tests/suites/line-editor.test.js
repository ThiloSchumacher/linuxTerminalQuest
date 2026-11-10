import { describe, it, expect } from '../runner.js';
import { LineEditor } from '../../js/terminal/line-editor.js';

/**
 * Fresh LineEditor with a given history limit.
 *
 * @param {number} [historyLimit=100]
 * @returns {LineEditor}
 */
function makeEditor(historyLimit = 100) {
  return new LineEditor({ historyLimit });
}

// ---------------------------------------------------------------------------
// Buffer manipulation
// ---------------------------------------------------------------------------

describe('LineEditor — buffer', () => {
  it('appends text at the end by default', () => {
    const ed = makeEditor();
    ed.insert('abc');
    expect(ed.getBuffer()).toBe('abc');
    expect(ed.getCursor()).toBe(3);
  });

  it('inserts at the cursor position after moveToStart', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.moveToStart();
    ed.insert('X');
    expect(ed.getBuffer()).toBe('Xabc');
    expect(ed.getCursor()).toBe(1);
  });

  it('backspace on empty buffer is a no-op', () => {
    const ed = makeEditor();
    ed.backspace();
    expect(ed.getBuffer()).toBe('');
    expect(ed.getCursor()).toBe(0);
  });

  it('backspace in the middle removes the preceding character', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.moveLeft();
    ed.backspace();
    expect(ed.getBuffer()).toBe('ac');
    expect(ed.getCursor()).toBe(1);
  });

  it('delete at end of buffer is a no-op', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.delete();
    expect(ed.getBuffer()).toBe('abc');
    expect(ed.getCursor()).toBe(3);
  });

  it('delete in the middle removes the following character', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.moveLeft();
    ed.delete();
    expect(ed.getBuffer()).toBe('ab');
    expect(ed.getCursor()).toBe(2);
  });

  it('clearBeforeCursor removes [0, cursor) and moves cursor to 0', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.moveToStart();
    ed.moveRight();
    ed.clearBeforeCursor();
    expect(ed.getBuffer()).toBe('bc');
    expect(ed.getCursor()).toBe(0);
  });

  it('clearAfterCursor removes [cursor, end) and keeps cursor', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.moveToStart();
    ed.moveRight();
    ed.clearAfterCursor();
    expect(ed.getBuffer()).toBe('a');
    expect(ed.getCursor()).toBe(1);
  });

  it('clearLine empties buffer and cursor', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.clearLine();
    expect(ed.getBuffer()).toBe('');
    expect(ed.getCursor()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

describe('LineEditor — cursor', () => {
  it('moveLeft at 0 is a no-op', () => {
    const ed = makeEditor();
    ed.moveLeft();
    expect(ed.getCursor()).toBe(0);
  });

  it('moveRight at end of buffer is a no-op', () => {
    const ed = makeEditor();
    ed.insert('ab');
    ed.moveRight();
    expect(ed.getCursor()).toBe(2);
  });

  it('moveToStart goes to 0', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.moveToStart();
    expect(ed.getCursor()).toBe(0);
  });

  it('moveToEnd goes to buffer length', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.moveToStart();
    ed.moveToEnd();
    expect(ed.getCursor()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe('LineEditor — history', () => {
  it('submit("ls") pushes to history and resets buffer', () => {
    const ed = makeEditor();
    ed.insert('ls');
    const line = ed.submit();
    expect(line).toBe('ls');
    expect(ed.getHistory()).toEqual(['ls']);
    expect(ed.getBuffer()).toBe('');
    expect(ed.getCursor()).toBe(0);
    expect(ed.historyIndex).toBe(null);
  });

  it('submit("") does not change history', () => {
    const ed = makeEditor();
    ed.submit();
    expect(ed.getHistory()).toEqual([]);
    expect(ed.getBuffer()).toBe('');
    expect(ed.historyIndex).toBe(null);
  });

  it('submit("   ") does not change history (trim-based)', () => {
    const ed = makeEditor();
    ed.insert('   ');
    ed.submit();
    expect(ed.getHistory()).toEqual([]);
  });

  it('two submits produce history in order', () => {
    const ed = makeEditor();
    ed.insert('ls');
    ed.submit();
    ed.insert('cd');
    ed.submit();
    expect(ed.getHistory()).toEqual(['ls', 'cd']);
  });

  it('historyPrev / historyNext round-trip through both entries', () => {
    const ed = makeEditor();
    ed.insert('a');
    ed.submit();
    ed.insert('b');
    ed.submit();
    ed.insert('c');
    ed.submit();

    ed.historyPrev();
    expect(ed.getBuffer()).toBe('c');
    expect(ed.getCursor()).toBe(1);
    ed.historyPrev();
    expect(ed.getBuffer()).toBe('b');
    ed.historyPrev();
    expect(ed.getBuffer()).toBe('a');

    ed.historyNext();
    expect(ed.getBuffer()).toBe('b');
    ed.historyNext();
    expect(ed.getBuffer()).toBe('c');
    ed.historyNext();
    expect(ed.getBuffer()).toBe('');
    expect(ed.historyIndex).toBe(null);
  });

  it('historyPrev beyond the oldest entry is a no-op', () => {
    const ed = makeEditor();
    ed.insert('a');
    ed.submit();
    ed.insert('b');
    ed.submit();

    ed.historyPrev(); // → 'b'
    ed.historyPrev(); // → 'a'
    ed.historyPrev(); // no-op
    expect(ed.getBuffer()).toBe('a');
  });

  it('historyNext at the newest entry clears the buffer and index', () => {
    const ed = makeEditor();
    ed.insert('ls');
    ed.submit();
    ed.historyPrev();
    expect(ed.getBuffer()).toBe('ls');
    ed.historyNext();
    expect(ed.getBuffer()).toBe('');
    expect(ed.historyIndex).toBe(null);
  });

  it('historyNext when not navigating history is a no-op', () => {
    const ed = makeEditor();
    ed.insert('ls');
    ed.submit();
    // historyIndex is null after submit.
    ed.historyNext();
    expect(ed.getBuffer()).toBe('');
    expect(ed.historyIndex).toBe(null);
  });

  it('respects historyLimit and evicts the oldest entry', () => {
    const ed = makeEditor(2);
    ed.insert('a');
    ed.submit();
    ed.insert('b');
    ed.submit();
    ed.insert('c');
    ed.submit();
    expect(ed.getHistory()).toEqual(['b', 'c']);
  });

  it('getHistory returns a copy; mutating it does not affect history', () => {
    const ed = makeEditor();
    ed.insert('ls');
    ed.submit();
    const copy = ed.getHistory();
    copy.push('injected');
    expect(ed.getHistory()).toEqual(['ls']);
  });

  it('historyPrev discards an in-progress draft (V1 divergence from bash)', () => {
    // GNU readline keeps the in-progress draft in a slot and restores it
    // when you step back past the newest history entry. V1 does not:
    // history navigation unconditionally overwrites the buffer. This test
    // pins that documented divergence so an unintentional switch to
    // readline-style draft handling would be caught here.
    const ed = makeEditor();
    ed.insert('ls');
    ed.submit();
    ed.insert('draft');

    ed.historyPrev();
    expect(ed.getBuffer()).toBe('ls');

    // Stepping past the newest entry clears the buffer instead of restoring
    // the draft — the V1 semantic this test exists to lock down.
    ed.historyNext();
    expect(ed.getBuffer()).toBe('');
    expect(ed.getBuffer()).not.toBe('draft');
  });
});

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

describe('LineEditor — submit', () => {
  it('returns the full buffer and clears it', () => {
    const ed = makeEditor();
    ed.insert('ls -la');
    const line = ed.submit();
    expect(line).toBe('ls -la');
    expect(ed.getBuffer()).toBe('');
    expect(ed.getCursor()).toBe(0);
  });

  it('submits the whole buffer regardless of cursor position', () => {
    const ed = makeEditor();
    ed.insert('abc');
    ed.moveToStart();
    ed.moveRight();
    const line = ed.submit();
    expect(line).toBe('abc');
    expect(ed.getBuffer()).toBe('');
  });

  it('submits the buffer loaded from history (and re-pushes it)', () => {
    const ed = makeEditor();
    ed.insert('ls');
    ed.submit();
    ed.historyPrev();
    expect(ed.getBuffer()).toBe('ls');
    const line = ed.submit();
    expect(line).toBe('ls');
    // V1: duplicates are not coalesced.
    expect(ed.getHistory()).toEqual(['ls', 'ls']);
    expect(ed.historyIndex).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe('LineEditor — reset', () => {
  it('clears buffer, cursor and historyIndex; preserves history', () => {
    const ed = makeEditor();
    ed.insert('ls');
    ed.submit();
    ed.insert('abc');
    ed.moveToStart();
    ed.historyPrev();
    ed.reset();
    expect(ed.getBuffer()).toBe('');
    expect(ed.getCursor()).toBe(0);
    expect(ed.historyIndex).toBe(null);
    expect(ed.getHistory()).toEqual(['ls']);
  });
});