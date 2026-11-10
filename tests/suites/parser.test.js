import { describe, it, expect } from '../runner.js';
import { parse } from '../../js/shell/parser.js';

/**
 * Assert that calling fn throws an Error with `.code === 'EPARSE'`.
 *
 * @param {() => void} fn
 * @returns {void}
 */
function expectEPARSE(fn) {
  try {
    fn();
  } catch (err) {
    expect(err.code).toBe('EPARSE');
    return;
  }
  throw new Error('Expected EPARSE, none was thrown');
}

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe('parser — empty input', () => {
  it('returns empty pipelines for empty string', () => {
    expect(parse('')).toEqual({ pipelines: [] });
  });

  it('returns empty pipelines for whitespace-only input', () => {
    expect(parse('   ')).toEqual({ pipelines: [] });
  });

  it('returns empty pipelines for tabs-only input', () => {
    expect(parse('\t\t')).toEqual({ pipelines: [] });
  });

  it('ignores trailing newline', () => {
    expect(parse('ls\n')).toEqual({
      pipelines: [{ commands: [{ argv: ['ls'], redirects: [] }] }],
    });
  });
});

// ---------------------------------------------------------------------------
// Simple commands
// ---------------------------------------------------------------------------

describe('parser — simple commands', () => {
  it('parses a single command', () => {
    expect(parse('ls')).toEqual({
      pipelines: [{ commands: [{ argv: ['ls'], redirects: [] }] }],
    });
  });

  it('parses command with arguments', () => {
    expect(parse('ls -la /etc')).toEqual({
      pipelines: [{ commands: [{ argv: ['ls', '-la', '/etc'], redirects: [] }] }],
    });
  });

  it('keeps semicolon as part of a word', () => {
    expect(parse('ls; ls')).toEqual({
      pipelines: [{ commands: [{ argv: ['ls;', 'ls'], redirects: [] }] }],
    });
  });

  it('keeps && as a word', () => {
    expect(parse('ls && ls')).toEqual({
      pipelines: [{ commands: [{ argv: ['ls', '&&', 'ls'], redirects: [] }] }],
    });
  });
});

// ---------------------------------------------------------------------------
// Quoting and escapes
// ---------------------------------------------------------------------------

describe('parser — quoting and escapes', () => {
  it('handles single quotes', () => {
    expect(parse("echo 'hello world'")).toEqual({
      pipelines: [{ commands: [{ argv: ['echo', 'hello world'], redirects: [] }] }],
    });
  });

  it('handles double quotes', () => {
    expect(parse('echo "a b"')).toEqual({
      pipelines: [{ commands: [{ argv: ['echo', 'a b'], redirects: [] }] }],
    });
  });

  it('handles escaped spaces', () => {
    expect(parse('echo a\\ b')).toEqual({
      pipelines: [{ commands: [{ argv: ['echo', 'a b'], redirects: [] }] }],
    });
  });

  it('keeps unknown escapes as-is', () => {
    expect(parse('echo \\n')).toEqual({
      pipelines: [{ commands: [{ argv: ['echo', '\\n'], redirects: [] }] }],
    });
  });

  it('handles \\" inside double quotes', () => {
    expect(parse('echo "a\\"b"')).toEqual({
      pipelines: [{ commands: [{ argv: ['echo', 'a"b'], redirects: [] }] }],
    });
  });
});

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

describe('parser — pipelines', () => {
  it('parses a pipeline with two commands', () => {
    expect(parse('ls | grep foo')).toEqual({
      pipelines: [
        {
          commands: [
            { argv: ['ls'], redirects: [] },
            { argv: ['grep', 'foo'], redirects: [] },
          ],
        },
      ],
    });
  });

  it('parses a pipeline without surrounding whitespace', () => {
    expect(parse('ls|grep foo')).toEqual({
      pipelines: [
        {
          commands: [
            { argv: ['ls'], redirects: [] },
            { argv: ['grep', 'foo'], redirects: [] },
          ],
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

describe('parser — redirects', () => {
  it('parses output redirect', () => {
    expect(parse('ls > out.txt')).toEqual({
      pipelines: [
        {
          commands: [
            { argv: ['ls'], redirects: [{ op: '>', fd: 1, target: 'out.txt' }] },
          ],
        },
      ],
    });
  });

  it('parses append redirect', () => {
    expect(parse('ls >> out')).toEqual({
      pipelines: [
        {
          commands: [
            { argv: ['ls'], redirects: [{ op: '>>', fd: 1, target: 'out' }] },
          ],
        },
      ],
    });
  });

  it('parses input redirect', () => {
    expect(parse('cmd < in')).toEqual({
      pipelines: [
        {
          commands: [
            { argv: ['cmd'], redirects: [{ op: '<', fd: 0, target: 'in' }] },
          ],
        },
      ],
    });
  });

  it('recognises redirects without surrounding whitespace', () => {
    expect(parse('ls>out')).toEqual({
      pipelines: [
        {
          commands: [
            { argv: ['ls'], redirects: [{ op: '>', fd: 1, target: 'out' }] },
          ],
        },
      ],
    });
  });

  it('keeps redirect order as written', () => {
    expect(parse('cmd < in > out')).toEqual({
      pipelines: [
        {
          commands: [
            {
              argv: ['cmd'],
              redirects: [
                { op: '<', fd: 0, target: 'in' },
                { op: '>', fd: 1, target: 'out' },
              ],
            },
          ],
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// EPARSE cases
// ---------------------------------------------------------------------------

describe('parser — EPARSE', () => {
  it('rejects unclosed single quote', () => {
    expectEPARSE(() => parse("echo 'hi"));
  });

  it('rejects unclosed double quote', () => {
    expectEPARSE(() => parse('echo "hi'));
  });

  it('rejects leading pipe', () => {
    expectEPARSE(() => parse('| ls'));
  });

  it('rejects trailing pipe', () => {
    expectEPARSE(() => parse('ls |'));
  });

  it('rejects double pipe', () => {
    expectEPARSE(() => parse('ls || grep'));
  });

  it('rejects redirect without target', () => {
    expectEPARSE(() => parse('ls >'));
  });

  it('rejects leading redirect', () => {
    expectEPARSE(() => parse('< foo'));
  });

  it('rejects redirect target that is an operator', () => {
    expectEPARSE(() => parse('ls > |'));
  });

  it('exposes the original input on the error', () => {
    try {
      parse('ls |');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EPARSE');
      expect(err.input).toBe('ls |');
    }
  });
});