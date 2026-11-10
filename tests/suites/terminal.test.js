import { describe, it, expect } from '../runner.js';
import {
  visibleLength,
  sanitizeInsert,
  resolveXtermGlobals,
  colorize,
  formatResultForTerminal,
} from '../../js/terminal/terminal.js';

/**
 * These helpers are the pure, xterm-instance-free parts of terminal.js.
 * The rest of TerminalUI (mount/unmount/handlers) needs a real terminal
 * and DOM and is covered by the manual browser test.
 *
 * `resolveXtermGlobals` reads `window.Terminal` / `window.FitAddon`. The
 * tests mutate those globals and restore them in a try/finally inside
 * each `it` (the runner has no afterEach) so no state leaks into other
 * suites in the same page.
 */

// ---------------------------------------------------------------------------
// visibleLength
// ---------------------------------------------------------------------------

describe('terminal — visibleLength', () => {
  it('empty string -> 0', () => {
    expect(visibleLength('')).toBe(0);
  });

  it('plain text -> its length', () => {
    expect(visibleLength('abc')).toBe(3);
  });

  it('single SGR pair is stripped', () => {
    expect(visibleLength('\x1b[32mabc\x1b[0m')).toBe(3);
  });

  it('SGR-only string -> 0', () => {
    expect(visibleLength('\x1b[1;32m\x1b[0m')).toBe(0);
  });

  it('mixed colours in a realistic prompt', () => {
    const prompt =
      '\x1b[32muser\x1b[0m@\x1b[32mbashquest\x1b[0m:' +
      '\x1b[34m~\x1b[0m$ ';
    expect(visibleLength(prompt)).toBe('user@bashquest:~$ '.length);
  });

  it('non-SGR escapes count as visible (intentional asymmetry vs sanitizeInsert)', () => {
    expect(visibleLength('\x1b[K')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// sanitizeInsert
// ---------------------------------------------------------------------------

describe('terminal — sanitizeInsert', () => {
  it('empty string -> empty string', () => {
    expect(sanitizeInsert('')).toBe('');
  });

  it('plain text passes through', () => {
    expect(sanitizeInsert('abc')).toBe('abc');
  });

  it('TAB is preserved (Patch 1 §2a contract; caller drops Tab key presses)', () => {
    expect(sanitizeInsert('a\tb')).toBe('a\tb');
  });

  it('CR is dropped', () => {
    expect(sanitizeInsert('a\rb')).toBe('ab');
  });

  it('LF is dropped', () => {
    expect(sanitizeInsert('a\nb')).toBe('ab');
  });

  it('ANSI cursor sequence is dropped', () => {
    expect(sanitizeInsert('a\x1b[Ab')).toBe('ab');
  });

  it('ANSI SGR sequence is dropped', () => {
    expect(sanitizeInsert('\x1b[32mred\x1b[0m')).toBe('red');
  });

  it('ANSI tilde-terminated key sequence is dropped', () => {
    expect(sanitizeInsert('a\x1b[3~b')).toBe('ab');
  });

  it('bracketed paste markers are dropped but the payload survives', () => {
    expect(sanitizeInsert('\x1b[200~paste\x1b[201~')).toBe('paste');
  });

  it('Unicode and umlauts are preserved', () => {
    expect(sanitizeInsert('Hällo')).toBe('Hällo');
  });

  it('pure C0 control bytes -> empty string', () => {
    expect(sanitizeInsert('\x00\x01\x02')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// resolveXtermGlobals
// ---------------------------------------------------------------------------

describe('terminal — resolveXtermGlobals', () => {
  /**
   * Run `fn` with `window.Terminal` / `window.FitAddon` replaced by the
   * provided values, restoring the previous values in `finally` so the
   * suite leaves no trace.
   *
   * @param {{Terminal: any, FitAddon: any}} values
   * @param {() => void} fn
   * @returns {void}
   */
  function withGlobals(values, fn) {
    const w = /** @type {any} */ (window);
    const prevTerminal = w.Terminal;
    const prevFitAddon = w.FitAddon;
    w.Terminal = values.Terminal;
    w.FitAddon = values.FitAddon;
    try {
      fn();
    } finally {
      w.Terminal = prevTerminal;
      w.FitAddon = prevFitAddon;
    }
  }

  it('returns the classes when both globals are present', () => {
    class FakeTerminal {}
    class FakeFitAddon {}
    withGlobals({ Terminal: FakeTerminal, FitAddon: { FitAddon: FakeFitAddon } }, () => {
      const resolved = resolveXtermGlobals();
      expect(resolved.Terminal).toBe(FakeTerminal);
      expect(resolved.FitAddon).toBe(FakeFitAddon);
    });
  });

  it('missing Terminal -> EXTERNAL with missing=[Terminal]', () => {
    class FakeFitAddon {}
    withGlobals({ Terminal: undefined, FitAddon: { FitAddon: FakeFitAddon } }, () => {
      try {
        resolveXtermGlobals();
        throw new Error('expected throw');
      } catch (err) {
        expect(/** @type {any} */ (err).code).toBe('EXTERNAL');
        expect(/** @type {any} */ (err).missing).toEqual(['Terminal']);
        expect(err.message.includes('missing Terminal')).toBe(true);
      }
    });
  });

  it('missing FitAddon -> EXTERNAL with missing=[FitAddon]', () => {
    class FakeTerminal {}
    withGlobals({ Terminal: FakeTerminal, FitAddon: undefined }, () => {
      try {
        resolveXtermGlobals();
        throw new Error('expected throw');
      } catch (err) {
        expect(/** @type {any} */ (err).code).toBe('EXTERNAL');
        expect(/** @type {any} */ (err).missing).toEqual(['FitAddon']);
        expect(err.message.includes('missing FitAddon')).toBe(true);
      }
    });
  });

  it('missing both -> EXTERNAL with missing=[Terminal, FitAddon] in that order', () => {
    withGlobals({ Terminal: undefined, FitAddon: undefined }, () => {
      try {
        resolveXtermGlobals();
        throw new Error('expected throw');
      } catch (err) {
        expect(/** @type {any} */ (err).code).toBe('EXTERNAL');
        expect(/** @type {any} */ (err).missing).toEqual(['Terminal', 'FitAddon']);
        expect(err.message.includes('missing Terminal, FitAddon')).toBe(true);
      }
    });
  });

  it('FitAddon present but FitAddon.FitAddon not a function -> EXTERNAL', () => {
    class FakeTerminal {}
    withGlobals({ Terminal: FakeTerminal, FitAddon: {} }, () => {
      try {
        resolveXtermGlobals();
        throw new Error('expected throw');
      } catch (err) {
        expect(/** @type {any} */ (err).code).toBe('EXTERNAL');
        expect(/** @type {any} */ (err).missing).toEqual(['FitAddon']);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// colorize
// ---------------------------------------------------------------------------

describe('terminal — colorize', () => {
  it('wraps text in red', () => {
    expect(colorize('hallo', { fg: 'red' })).toBe('\x1b[31mhallo\x1b[0m');
  });

  it('wraps text in bold red', () => {
    expect(colorize('hallo', { fg: 'red', bold: true })).toBe('\x1b[1;31mhallo\x1b[0m');
  });

  it('returns the empty string for empty input', () => {
    expect(colorize('', { fg: 'red' })).toBe('');
  });

  it('returns text unchanged when fg is default and not bold', () => {
    expect(colorize('hallo', { fg: 'default' })).toBe('hallo');
  });

  it('applies bold without colour when fg is default and bold is set', () => {
    expect(colorize('hallo', { fg: 'default', bold: true })).toBe('\x1b[1mhallo\x1b[0m');
  });

  it('wraps a multi-line block as one span (SGR stays active across the newline)', () => {
    // The input is a real newline between 'multi' and 'line'; the SGR
    // wrap spans both lines and the reset is emitted only at the end.
    expect(colorize('multi\nline', { fg: 'red' })).toBe('\x1b[31mmulti\nline\x1b[0m');
  });

  it('supports the remaining base colours', () => {
    expect(colorize('x', { fg: 'green' })).toBe('\x1b[32mx\x1b[0m');
    expect(colorize('x', { fg: 'yellow' })).toBe('\x1b[33mx\x1b[0m');
    expect(colorize('x', { fg: 'blue' })).toBe('\x1b[34mx\x1b[0m');
    expect(colorize('x', { fg: 'magenta' })).toBe('\x1b[35mx\x1b[0m');
    expect(colorize('x', { fg: 'cyan' })).toBe('\x1b[36mx\x1b[0m');
    expect(colorize('x', { fg: 'white' })).toBe('\x1b[37mx\x1b[0m');
  });

  it('treats unknown fg as default (defensive, Patch 1 §2.1)', () => {
    // Unknown fg value (not in FG_CODES) → treated as 'default':
    // text returned unchanged, no SGR sequence emitted. Prevents a
    // caller typo from producing a broken escape sequence.
    expect(colorize('hi', { fg: 'bogus' })).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
// formatResultForTerminal
// ---------------------------------------------------------------------------

describe('terminal — formatResultForTerminal', () => {
  it('returns stdout unchanged when it already ends with a newline', () => {
    const out = formatResultForTerminal({ stdout: 'hi\n', stderr: '', exitCode: 0 });
    expect(out).toBe('hi\n');
  });

  it('appends a newline to stdout when missing', () => {
    const out = formatResultForTerminal({ stdout: 'hi', stderr: '', exitCode: 0 });
    expect(out).toBe('hi\n');
  });

  it('wraps stderr in red when it already ends with a newline', () => {
    const out = formatResultForTerminal({ stdout: '', stderr: 'err\n', exitCode: 1 });
    expect(out).toBe('\x1b[31merr\n\x1b[0m');
  });

  it('appends a newline to stderr, then wraps it in red', () => {
    const out = formatResultForTerminal({ stdout: '', stderr: 'err', exitCode: 1 });
    expect(out).toBe('\x1b[31merr\n\x1b[0m');
  });

  it('returns empty string when both streams are empty', () => {
    const out = formatResultForTerminal({ stdout: '', stderr: '', exitCode: 0 });
    expect(out).toBe('');
  });

  it('writes stdout first, then coloured stderr', () => {
    const out = formatResultForTerminal({ stdout: 'out\n', stderr: 'err\n', exitCode: 1 });
    expect(out).toBe('out\n\x1b[31merr\n\x1b[0m');
  });

  it('appends newlines to both streams when missing, then colours stderr', () => {
    const out = formatResultForTerminal({ stdout: 'out', stderr: 'err', exitCode: 1 });
    expect(out).toBe('out\n\x1b[31merr\n\x1b[0m');
  });

  it('treats null stdout as empty string (defensive, Patch 1 §2.2)', () => {
    // Nullish-Coalescing (??): null/undefined → '', ohne truthy-Fallen.
    const out = formatResultForTerminal({ stdout: null, stderr: 'err\n', exitCode: 1 });
    expect(out).toBe('\x1b[31merr\n\x1b[0m');
  });

  it('treats undefined stderr as empty string (defensive, Patch 1 §2.2)', () => {
    const out = formatResultForTerminal({ stdout: 'hi\n', stderr: undefined, exitCode: 0 });
    expect(out).toBe('hi\n');
  });

  it('preserves a literal "0" stdout (sanity check, not an ??/|| separator)', () => {
    // The string '0' is truthy in JS (Boolean('0') === true), so
    // '0' || '' === '0' just like '0' ?? ''. This test therefore does
    // NOT distinguish ?? from || — it is a sanity check that neither
    // operator accidentally coerces string contents.
    //
    // The actual motivation for ?? over || is a hypothetical bug where
    // a command returns a non-string falsy stdout (number 0, false):
    //   - `0 || ''`  → ''
    //   - `0 ?? ''`  → 0
    // That scenario is out of scope for the typed signature
    // (stdout: string|null|undefined) and is caught by the executor's
    // CommandResult field check before reaching this helper, so it is
    // not tested here.
    const out = formatResultForTerminal({ stdout: '0', stderr: '', exitCode: 0 });
    expect(out).toBe('0\n');
  });

  it('colours stderr regardless of exitCode (§1-note, Patch 1)', () => {
    // §1 (deskriptiv: "bei Exit-Code !== 0 …") vs. §2.2 (normativ: immer).
    // Rotfärbung ist unabhängig vom exitCode — gepinnt für exitCode 0.
    const out = formatResultForTerminal({ stdout: '', stderr: 'warn\n', exitCode: 0 });
    expect(out).toBe('\x1b[31mwarn\n\x1b[0m');
  });
});

import { TerminalUI } from '../../js/terminal/terminal.js';
// ---------------------------------------------------------------------------
// TerminalUI — onCommand callback
// ---------------------------------------------------------------------------

describe('terminal — onCommand callback', () => {
  /**
   * `_handleSubmit` needs a live xterm.js terminal to run through
   * `mount()`, which is not feasible in a headless test. Instead we call
   * the prototype method with a stub `this` that only implements the
   * fields the method touches. This pins the callback contract
   * (invocation, argument shape, silent catch, timing relative to
   * `_redraw`) without spinning up xterm.
   *
   * @param {object} overrides
   * @returns {object} A fake `this` for `_handleSubmit`.
   */
  function makeFakeThis(overrides = {}) {
    const writes = [];
    return {
      _lineEditor: {
        submit: () => 'pwd',
        getBuffer: () => '',
        getCursor: () => 0,
        ...overrides._lineEditor,
      },
      _term: {
        write: (s) => writes.push(['write', s]),
        ...overrides._term,
      },
      _executor: {
        execute: () => ({ stdout: 'out\n', stderr: '', exitCode: 0 }),
        ...overrides._executor,
      },
      _onCommand: overrides._onCommand,
      _writePrompt: overrides._writePrompt || (() => { writes.push(['writePrompt']); }),
      _redraw: overrides._redraw || (() => { writes.push(['redraw']); }),
      _writes: writes,
    };
  }

  it('invokes onCommand with the input and result after stdout is written', () => {
    let receivedInput = null;
    let receivedResult = null;
    const fake = makeFakeThis({
      _onCommand: (input, result) => {
        receivedInput = input;
        receivedResult = result;
      },
    });
    TerminalUI.prototype._handleSubmit.call(fake);
    expect(receivedInput).toBe('pwd');
    expect(receivedResult.stdout).toBe('out\n');
    expect(receivedResult.exitCode).toBe(0);
  });

  it('does not invoke onCommand when the input is whitespace-only', () => {
    // Also pins the return path: whitespace-only input must go through
    // `_writePrompt()` (fresh prompt, no redraw) rather than `_redraw()`
    // (which would clear the current line). A refactor that flipped
    // these two branches would still pass `called === false` but would
    // silently break the "no redraw on empty submit" contract.
    let called = false;
    const fake = makeFakeThis({
      _lineEditor: { submit: () => '   ' },
      _onCommand: () => { called = true; },
    });
    TerminalUI.prototype._handleSubmit.call(fake);
    expect(called).toBe(false);
    const sawWritePrompt = fake._writes.some(([kind]) => kind === 'writePrompt');
    const sawRedraw = fake._writes.some(([kind]) => kind === 'redraw');
    expect(sawWritePrompt).toBe(true);
    expect(sawRedraw).toBe(false);
  });

  it('does not invoke onCommand when it is not set (null)', () => {
    // No _onCommand at all — should not crash, terminal still redraws.
    const fake = makeFakeThis({});
    delete fake._onCommand;
    TerminalUI.prototype._handleSubmit.call(fake);
    // Only check it did not throw and the redraw path was reached.
    const sawRedraw = fake._writes.some(([kind]) => kind === 'redraw');
    expect(sawRedraw).toBe(true);
  });

  it('swallows onCommand errors without propagating them', () => {
    const fake = makeFakeThis({
      _onCommand: () => { throw new Error('boom'); },
    });
    // Should not throw:
    TerminalUI.prototype._handleSubmit.call(fake);
    // And the redraw should still have happened.
    const sawRedraw = fake._writes.some(([kind]) => kind === 'redraw');
    expect(sawRedraw).toBe(true);
  });

  it('invokes onCommand BEFORE _redraw (timing contract)', () => {
    const events = [];
    const fake = makeFakeThis({
      _onCommand: () => events.push('onCommand'),
      _redraw: () => events.push('redraw'),
    });
    TerminalUI.prototype._handleSubmit.call(fake);
    const cmdIdx = events.indexOf('onCommand');
    const redrawIdx = events.indexOf('redraw');
    expect(cmdIdx >= 0).toBe(true);
    expect(redrawIdx >= 0).toBe(true);
    expect(cmdIdx < redrawIdx).toBe(true);
  });
});