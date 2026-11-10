/**
 * Shell input parser for BashQuest.
 *
 * Turns a raw input string into a pipeline AST. It recognises pipes (`|`)
 * and redirections (`>`, `>>`, `<`) so later stages can act on them, but
 * performs no expansion ($VAR, ~, globbing) and no execution.
 *
 * @module shell/parser
 */

/**
 * @typedef {{ op: '>'|'>>'|'<', fd: 0|1, target: string }} Redirect
 * @typedef {{ argv: string[], redirects: Redirect[] }} ParsedCommand
 * @typedef {{ commands: ParsedCommand[] }} ParsedPipeline
 * @typedef {{ pipelines: ParsedPipeline[] }} AST
 */

/**
 * Build an EPARSE error with the original input attached.
 *
 * @param {string} message
 * @param {string} input
 * @returns {Error}
 */
function eparse(message, input) {
  const err = new Error(message);
  err.code = 'EPARSE';
  err.input = input;
  return err;
}

/**
 * Tokenize the input into words and operators.
 *
 * Rules (V1):
 *  - Whitespace (space, tab) separates tokens; runs collapse.
 *  - Trailing newline(s) are stripped before tokenizing; internal newlines
 *    are literal (V1 keeps them as ordinary characters).
 *  - Single quotes `'...'`: content literal, quotes removed, no escapes.
 *  - Double quotes `"..."`: content literal, quotes removed. Escape rules
 *    still apply inside double quotes so `"a\"b"` yields `a"b`.
 *  - Backslash `\x`: `\ `, `\\`, `\'`, `\"` are translated; any other `\x`
 *    keeps both characters (e.g. `\n` stays as backslash + n).
 *  - Operators `|`, `>`, `>>`, `<` are recognised with or without
 *    surrounding whitespace (`ls>out` == `ls > out`).
 *  - `>>` takes precedence over `>`.
 *  - `||` raises EPARSE (V1 does not support logical OR).
 *
 * @param {string} input
 * @returns {Array<{type:'word'|'op', value:string}>}
 * @throws {Error} EPARSE
 */
function tokenize(input) {
  const text = input.replace(/[\r\n]+$/, '');

  /** @type {Array<{type:'word'|'op', value:string}>} */
  const tokens = [];
  let current = '';
  let tokenStarted = false;
  /** @type {"'"|'"'|null} */
  let quote = null;

  const flush = () => {
    if (tokenStarted) {
      tokens.push({ type: 'word', value: current });
      current = '';
      tokenStarted = false;
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      i += 1;
      continue;
    }

    // Escape handling applies both outside quotes and inside double quotes.
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) {
        current += '\\';
      } else if (next === ' ' || next === '\\' || next === "'" || next === '"') {
        current += next;
      } else {
        current += '\\' + next;
      }
      tokenStarted = true;
      i += next === undefined ? 1 : 2;
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
      } else {
        current += ch;
      }
      i += 1;
      continue;
    }

    // Outside quotes.
    if (ch === ' ' || ch === '\t') {
      flush();
      i += 1;
      continue;
    }

    if (ch === "'") {
      quote = "'";
      tokenStarted = true;
      i += 1;
      continue;
    }

    if (ch === '"') {
      quote = '"';
      tokenStarted = true;
      i += 1;
      continue;
    }

    if (ch === '>') {
      flush();
      if (text[i + 1] === '>') {
        tokens.push({ type: 'op', value: '>>' });
        i += 2;
      } else {
        tokens.push({ type: 'op', value: '>' });
        i += 1;
      }
      continue;
    }

    if (ch === '<') {
      flush();
      tokens.push({ type: 'op', value: '<' });
      i += 1;
      continue;
    }

    if (ch === '|') {
      flush();
      if (text[i + 1] === '|') {
        throw eparse('Doppelte Pipe wird nicht unterstützt', input);
      }
      tokens.push({ type: 'op', value: '|' });
      i += 1;
      continue;
    }

    current += ch;
    tokenStarted = true;
    i += 1;
  }

  if (quote !== null) {
    throw eparse(
      quote === "'"
        ? 'Nicht geschlossenes einfaches Anführungszeichen'
        : 'Nicht geschlossenes doppeltes Anführungszeichen',
      input,
    );
  }

  flush();
  return tokens;
}

/**
 * Parse a shell input string into a pipeline AST.
 *
 * V1 supports a single pipeline (commands separated by `|`) and per-command
 * redirections (`<`, `>`, `>>`). No expansion, no variable substitution,
 * no execution.
 *
 * Empty or whitespace-only input yields `{ pipelines: [] }`.
 *
 * @param {string} input Raw shell input.
 * @returns {AST} Parsed AST.
 * @throws {Error} EPARSE on any syntax error; the error carries `.code = 'EPARSE'`
 *   and `.input` set to the original input string.
 */
export function parse(input) {
  if (typeof input !== 'string') {
    throw eparse('Eingabe muss ein String sein', String(input));
  }

  const tokens = tokenize(input);
  if (tokens.length === 0) {
    return { pipelines: [] };
  }

  /** @type {ParsedCommand[]} */
  const commands = [];
  /** @type {ParsedCommand} */
  let command = { argv: [], redirects: [] };

  const flushCommand = () => {
    if (command.argv.length === 0 && command.redirects.length === 0) {
      if (commands.length === 0) {
        throw eparse('Pipe ohne vorhergehenden Befehl', input);
      }
      throw eparse('Leerer Befehl vor Pipe', input);
    }
    commands.push(command);
    command = { argv: [], redirects: [] };
  };

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.type === 'word') {
      command.argv.push(tok.value);
      i += 1;
      continue;
    }

    if (tok.value === '|') {
      flushCommand();
      i += 1;
      continue;
    }

    // Redirect token: `<`, `>`, `>>`.
    if (command.argv.length === 0) {
      throw eparse('Umleitung ohne vorhergehenden Befehl', input);
    }
    const next = tokens[i + 1];
    if (next === undefined || next.type === 'op') {
      throw eparse('Umleitung ohne Ziel', input);
    }
    const fd = tok.value === '<' ? 0 : 1;
    command.redirects.push({ op: tok.value, fd, target: next.value });
    i += 2;
  }

  if (command.argv.length === 0 && command.redirects.length === 0) {
    if (commands.length === 0) {
      // Defensive: tokens was non-empty but produced no command.
      return { pipelines: [] };
    }
    throw eparse('Pipe ohne folgenden Befehl', input);
  }
  commands.push(command);

  return { pipelines: [{ commands }] };
}