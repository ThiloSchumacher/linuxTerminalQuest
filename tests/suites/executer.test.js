import { describe, it, expect } from '../runner.js';
import { Executor } from '../../js/shell/executor.js';
import { Env } from '../../js/shell/env.js';
import { createInitialFS } from '../../js/vfs/initial-fs.js';
import { createCommandRegistry } from '../../js/shell/commands/index.js';

/**
 * Fresh executor with the standard test environment. The registry
 * combines the real V1 command set (from `createCommandRegistry`)
 * with a few test-only dummy commands:
 *
 *   - `hello`      — deterministic stdout (`'hi\n'`), exit 0
 *   - `boom`       — deterministic stderr (`'bam\n'`), exit 1
 *   - `partial`    — incomplete CommandResult (missing stderr/exitCode)
 *   - `echo-stdin` — echoes its `stdin` field (spec007a pass-through)
 *
 * @returns {{
 *   vfs: import('../../js/vfs/filesystem.js').VFS,
 *   env: Env,
 *   registry: Map<string, object>,
 *   ex: Executor,
 * }}
 */
function setup() {
  const vfs = createInitialFS();
  const env = new Env({
    PWD: '/home/user',
    OLDPWD: '/home/user',
    HOME: '/home/user',
    USER: 'user',
    SHELL: '/bin/bash',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    '?': '0',
  });
  const registry = createCommandRegistry();
  registry.set('hello', {
    name: 'hello',
    run: () => ({ stdout: 'hi\n', stderr: '', exitCode: 0 }),
  });
  registry.set('boom', {
    name: 'boom',
    run: () => ({ stdout: '', stderr: 'bam\n', exitCode: 1 }),
  });
  registry.set('partial', {
    name: 'partial',
    run: () => ({ stdout: 'x' }),
  });
  registry.set('echo-stdin', {
    name: 'echo-stdin',
    run: ({ stdin }) => ({ stdout: stdin || '', stderr: '', exitCode: 0 }),
  });

  registry.set('svc-check', {
    name: 'svc-check',
    run: ({ services }) =>
      services && services.terminal
        ? { stdout: 'terminal-present\n', stderr: '', exitCode: 0 }
        : { stdout: '', stderr: 'terminal-missing\n', exitCode: 1 },
  });
  
  const ex = new Executor({ vfs, env, registry });
  return { vfs, env, registry, ex };
}

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe('executor — empty input', () => {
  it('returns exit 0 with empty output', () => {
    const { ex } = setup();
    const r = ex.execute('');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('returns exit 0 for whitespace-only input', () => {
    const { ex } = setup();
    const r = ex.execute('   ');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('leaves ? unchanged after empty input (V1 divergence)', () => {
    // The only two early-return paths before `_runPipeline` are empty
    // input and EPARSE. Both leave `?` unchanged — the JSDoc `?`
    // invariant in executor.js pins this, and this test turns the
    // doc claim into an assertion.
    const { ex, env } = setup();
    env.set('?', '42');
    ex.execute('');
    expect(env.get('?')).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// Simple commands
// ---------------------------------------------------------------------------

describe('executor — simple commands', () => {
  it('runs a registered command and forwards stdout', () => {
    const { ex } = setup();
    const r = ex.execute('hello');
    expect(r.stdout).toBe('hi\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('propagates non-zero exit code and stderr', () => {
    const { ex } = setup();
    const r = ex.execute('boom');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bam\n');
    expect(r.exitCode).toBe(1);
  });

  it('passes argv without the program name', () => {
    const { ex } = setup();
    ex.registry.set('hello', {
      name: 'hello',
      run: ({ argv }) => ({ stdout: argv.join(','), stderr: '', exitCode: 0 }),
    });
    const r = ex.execute('hello a b c');
    expect(r.stdout).toBe('a,b,c');
  });
});

// ---------------------------------------------------------------------------
// `?` variable
// ---------------------------------------------------------------------------

describe('executor — ? variable', () => {
  it('sets ? to 1 after boom', () => {
    const { ex, env } = setup();
    ex.execute('boom');
    expect(env.get('?')).toBe('1');
  });

  it('sets ? back to 0 after hello', () => {
    const { ex, env } = setup();
    ex.execute('boom');
    ex.execute('hello');
    expect(env.get('?')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Unknown command
// ---------------------------------------------------------------------------

describe('executor — unknown command', () => {
  it('reports command-not-found with exit 127', () => {
    const { ex } = setup();
    const r = ex.execute('nope');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: nope: command not found\n');
    expect(r.exitCode).toBe(127);
  });

  it('sets ? = "127" after command not found (spec007c: now bash-compatible)', () => {
    // spec007b left ? unchanged on command-not-found (early return
    // before env.set). spec007c routes every path through
    // _runPipeline(), which reports the unknown command's exit code
    // (127) as the pipeline's final exit; execute() sets ? from that.
    // The V1 divergence documented in spec007b is gone — this test
    // replaces the old "leaves ? unchanged" assertion.
    const { ex, env } = setup();
    env.set('?', '42');
    const r = ex.execute('nope');
    expect(r.stderr).toBe('bash: nope: command not found\n');
    expect(r.exitCode).toBe(127);
    expect(env.get('?')).toBe('127');
  });
});

// ---------------------------------------------------------------------------
// Syntax errors
// ---------------------------------------------------------------------------

describe('executor — syntax errors', () => {
  it('wraps EPARSE as bash syntax error with exit 2', () => {
    const { ex } = setup();
    const r = ex.execute("hello 'unclosed");
    expect(r.stdout).toBe('');
    expect(r.stderr.startsWith('bash: syntax error:')).toBe(true);
    expect(r.exitCode).toBe(2);
  });

  it('leaves ? unchanged after EPARSE (V1 divergence)', () => {
    // Companion to the empty-input test above: `parse()` throws
    // EPARSE before `_runPipeline` runs, so `?` keeps its previous
    // value. Bash would set it to 2; V1 does not.
    const { ex, env } = setup();
    env.set('?', '42');
    ex.execute("hello 'unclosed");
    expect(env.get('?')).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// Invalid command result
// ---------------------------------------------------------------------------

describe('executor — invalid command result', () => {
  it('returns internal error with exit 1 when a command result is malformed (spec007c)', () => {
    // spec002b §3 originally required a throw for a malformed result.
    // spec007c changes that: _runPipeline catches the throw (or the
    // malformed result directly) and converts it to `bash: <name>:
    // internal error` (exit 1) so a buggy command in a pipeline cannot
    // crash the shell. The `execute()` public contract still never
    // throws for user-input problems; only genuine executor bugs (e.g.
    // a non-EPARSE error from parse) propagate.
    const { ex } = setup();
    const r = ex.execute('partial');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('bash: partial: internal error\n');
  });
});

// ---------------------------------------------------------------------------
// stdin pass-through (spec007a)
// ---------------------------------------------------------------------------

describe('executor — stdin pass-through', () => {
  it('runs an echo-stdin command to completion when stdin is null', () => {
    const { ex } = setup();
    const r = ex.execute('echo-stdin');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Redirects `>` (spec007b §6)
// ---------------------------------------------------------------------------

describe('executor — Redirects >', () => {
  it('writes stdout into a new file and blanks result.stdout', () => {
    const { ex, vfs } = setup();
    const r = ex.execute('echo hi > /tmp/x');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
    expect(vfs.exists('/tmp/x', '/')).toBe(true);
    expect(vfs.readFile('/tmp/x', '/')).toBe('hi\n');
  });

  it('overwrites an existing file', () => {
    const { ex, vfs } = setup();
    ex.execute('echo a > /tmp/x');
    ex.execute('echo b > /tmp/x');
    expect(vfs.readFile('/tmp/x', '/')).toBe('b\n');
  });

  it('fails with Is a directory when target is a directory', () => {
    const { ex, vfs } = setup();
    const before = vfs.stat('/etc', '/');
    const r = ex.execute('echo hi > /etc');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: /etc: Is a directory\n');
    expect(r.exitCode).toBe(1);
    expect(vfs.stat('/etc', '/').type).toBe(before.type);
  });

  it('fails with ENOENT when target parent is missing', () => {
    const { ex } = setup();
    const r = ex.execute('echo hi > /nope/file');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: /nope/file: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('redirects pwd output into a file', () => {
    const { ex, vfs } = setup();
    const r = ex.execute('pwd > /tmp/p');
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/p', '/')).toBe('/home/user\n');
  });

  it('ignores a redirect when the command fails', () => {
    // spec007b §5: a failed command leaves the target file untouched.
    const { ex, vfs } = setup();
    const r = ex.execute('boom > /tmp/x');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bam\n');
    expect(r.exitCode).toBe(1);
    expect(vfs.exists('/tmp/x', '/')).toBe(false);
  });

  it('a redirect on a non-existent command creates NO file (and ? = 127)', () => {
    // spec007c: _runPipeline() still treats "command not found" as a
    // redirect-skipping early-continue, so /tmp/x is not created. The
    // pipeline's final exit code is 127 (the unknown command is the
    // only one), and `?` reflects that — updated from spec007b where
    // `?` stayed at the previous value.
    const { ex, vfs, env } = setup();
    env.set('?', '42');
    const r = ex.execute('nope > /tmp/x');
    expect(r.stderr).toBe('bash: nope: command not found\n');
    expect(r.exitCode).toBe(127);
    expect(vfs.exists('/tmp/x', '/')).toBe(false);
    expect(env.get('?')).toBe('127');
  });
});

// ---------------------------------------------------------------------------
// Redirects `>>` (spec007b §6)
// ---------------------------------------------------------------------------

describe('executor — Redirects >>', () => {
  it('appends to an existing file', () => {
    const { ex, vfs } = setup();
    ex.execute('echo a > /tmp/x');
    ex.execute('echo b >> /tmp/x');
    expect(vfs.readFile('/tmp/x', '/')).toBe('a\nb\n');
  });

  it('creates the file when it does not exist', () => {
    const { ex, vfs } = setup();
    const r = ex.execute('echo a >> /tmp/y');
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/y', '/')).toBe('a\n');
  });

  it('fails with Is a directory when target is a directory', () => {
    const { ex } = setup();
    const r = ex.execute('echo hi >> /etc');
    expect(r.stderr).toBe('bash: /etc: Is a directory\n');
    expect(r.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Redirects `<` (spec007b §6)
// ---------------------------------------------------------------------------

describe('executor — Redirects <', () => {
  it('feeds file content into cat via stdin', () => {
    const { ex } = setup();
    const r = ex.execute('cat < /etc/hosts');
    expect(r.stdout).toBe('127.0.0.1 localhost\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('fails with ENOENT when the input file is missing', () => {
    const { ex } = setup();
    const r = ex.execute('cat < /nope');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('fails with Is a directory when the input is a directory', () => {
    const { ex } = setup();
    const r = ex.execute('cat < /etc');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: /etc: Is a directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('feeds file content into wc via stdin (no filename column, exact padding)', () => {
    // Same exact-padding contract as the direct `wc <stdin>` test in
    // commands.test.js. Columns are built via `padStart(8)` + `join(' ')`
    // — the same structure `formatWcLine` uses — so the
    // inter-column separator is structurally included.
    const { ex, vfs } = setup();
    const content = vfs.readFile('/etc/passwd', '/');
    const pad = (n) => String(n).padStart(8, ' ');
    const linesArr = content.split('\n');
    if (linesArr.length > 0 && linesArr[linesArr.length - 1] === '') {
      linesArr.pop();
    }
    const lines = linesArr.length;
    const words = content.split(/\s+/).filter((w) => w.length > 0).length;
    const chars = content.length;
    const r = ex.execute('wc < /etc/passwd');
    expect(r.stdout).toBe(`${pad(lines)} ${pad(words)} ${pad(chars)}\n`);
    expect(r.exitCode).toBe(0);
  });

  it('feeds file content into grep via stdin (no filename prefix)', () => {
    const { ex } = setup();
    const r = ex.execute('grep root < /etc/passwd');
    expect(r.stdout).toBe('root:x:0:0:root:/root:/bin/bash\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Combined redirects (spec007b §6)
// ---------------------------------------------------------------------------

describe('executor — Redirects kombiniert', () => {
  it('cat < file > file2 copies content and blanks stdout', () => {
    const { ex, vfs } = setup();
    const r = ex.execute('cat < /etc/hosts > /tmp/h');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/h', '/')).toBe('127.0.0.1 localhost\n');
  });

  it('chains echo > file and cat < file across executions', () => {
    const { ex } = setup();
    ex.execute('echo hi > /tmp/x');
    const r = ex.execute('cat < /tmp/x');
    expect(r.stdout).toBe('hi\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Redirect errors (spec007b §6)
// ---------------------------------------------------------------------------

describe('executor — Redirect-Fehler', () => {
  it('rejects multiple output redirects with exit 2 (no files created)', () => {
    const { ex, vfs } = setup();
    const r = ex.execute('echo a > /tmp/a > /tmp/b');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: multiple output redirects not supported\n');
    expect(r.exitCode).toBe(2);
    expect(vfs.exists('/tmp/a', '/')).toBe(false);
    expect(vfs.exists('/tmp/b', '/')).toBe(false);
  });

  it('rejects multiple input redirects with exit 2', () => {
    const { ex } = setup();
    const r = ex.execute('cat < /etc/hosts < /etc/passwd');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: multiple input redirects not supported\n');
    expect(r.exitCode).toBe(2);
  });

  it('a failed input redirect aborts before the output file is created', () => {
    const { ex, vfs } = setup();
    const r = ex.execute('cat < /nope > /tmp/x');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
    expect(vfs.exists('/tmp/x', '/')).toBe(false);
  });

  it('sets ? = "1" after an input redirect failure', () => {
    const { ex, env } = setup();
    env.set('?', '0');
    const r = ex.execute('cat < /nope');
    expect(r.exitCode).toBe(1);
    expect(env.get('?')).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// `?` tracking with redirects (spec007b §6)
// ---------------------------------------------------------------------------

describe('executor — env "?"-Tracking mit Redirects', () => {
  it('sets ? = "0" after a successful redirect', () => {
    const { ex, env } = setup();
    ex.execute('echo hi > /tmp/x');
    expect(env.get('?')).toBe('0');
  });

  it('sets ? = "1" after a redirect failure (overrides command exit)', () => {
    const { ex, env } = setup();
    ex.execute('echo hi > /etc');
    expect(env.get('?')).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Pipelines (spec007c)
// ---------------------------------------------------------------------------

describe('executor — einfache Pipes', () => {
  it('ls | grep filters to matching lines', () => {
    const { ex } = setup();
    const r = ex.execute('ls /etc | grep hosts');
    expect(r.stdout).toBe('hosts\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('cat | grep passes the file through the pipe', () => {
    const { ex } = setup();
    const r = ex.execute('cat /etc/passwd | grep root');
    expect(r.stdout).toBe('root:x:0:0:root:/root:/bin/bash\n');
    expect(r.exitCode).toBe(0);
  });

  it('three-stage pipeline cat | grep | wc -l', () => {
    const { ex } = setup();
    const r = ex.execute('cat /etc/passwd | grep root | wc -l');
    expect(/^\s*1\n$/.test(r.stdout)).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('echo | cat echoes the piped input', () => {
    const { ex } = setup();
    const r = ex.execute('echo hi | cat');
    expect(r.stdout).toBe('hi\n');
    expect(r.exitCode).toBe(0);
  });

  it('echo | cat -n numbers the piped lines', () => {
    const { ex } = setup();
    const r = ex.execute('echo hi | cat -n');
    expect(r.stdout).toBe('    1\thi\n');
    expect(r.exitCode).toBe(0);
  });

  it('returns exit 1 when grep finds no match in the pipeline', () => {
    const { ex } = setup();
    const r = ex.execute('echo hello | grep nomatch');
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(1);
  });
});

describe('executor — Pipes mit Redirects kombiniert', () => {
  it('ls | grep > file writes the grep output to a file', () => {
    const { ex, vfs } = setup();
    const r = ex.execute('ls /etc | grep hosts > /tmp/f');
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/f', '/')).toBe('hosts\n');
  });

  it('cat < file | grep uses the file as stdin of the first stage', () => {
    const { ex } = setup();
    const r = ex.execute('cat < /etc/passwd | grep root');
    expect(r.stdout).toBe('root:x:0:0:root:/root:/bin/bash\n');
    expect(r.exitCode).toBe(0);
  });

  it('cat < file | grep > file2 combines input and output redirect', () => {
    const { ex, vfs } = setup();
    const r = ex.execute('cat < /etc/passwd | grep root > /tmp/r');
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/r', '/')).toBe(
      'root:x:0:0:root:/root:/bin/bash\n',
    );
  });

  it('input redirect on a mid-pipeline stage overrides pipe stdin', () => {
    // `echo a | cat < /etc/hosts` — cat reads /etc/hosts, NOT the
    // pipe from echo. POSIX behaviour; documented in the class JSDoc.
    const { ex } = setup();
    const r = ex.execute('echo a | cat < /etc/hosts');
    expect(r.stdout).toBe('127.0.0.1 localhost\n');
    expect(r.exitCode).toBe(0);
  });

  it('output redirect on a non-last stage leaves the next stage with empty stdin', () => {
    // `echo a > /tmp/x | cat` — echo writes 'a\n' to /tmp/x, its
    // stdout is blanked, cat gets '' as stdin → produces ''.
    const { ex, vfs } = setup();
    const r = ex.execute('echo a > /tmp/x | cat');
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/x', '/')).toBe('a\n');
  });
});

describe('executor — Pipes mit Command-Not-Found', () => {
  it('a middle-stage unknown command feeds empty stdin to the next stage', () => {
    const { ex } = setup();
    const r = ex.execute('ls | nope | grep x');
    expect(r.stderr).toBe('bash: nope: command not found\n');
    expect(r.stdout).toBe('');
    // grep on empty stdin → exit 1
    expect(r.exitCode).toBe(1);
  });

  it('an unknown first stage still lets the rest of the pipeline run', () => {
    const { ex } = setup();
    const r = ex.execute('nope | cat');
    expect(r.stderr).toBe('bash: nope: command not found\n');
    expect(r.stdout).toBe('');
    // last command is `cat`; cat on empty stdin → exit 0
    expect(r.exitCode).toBe(0);
  });
});

describe('executor — Pipes mit Redirect-Fehler', () => {
  it('an output redirect failure on the last stage aborts the pipeline', () => {
    const { ex } = setup();
    const r = ex.execute('ls /etc | cat > /nope/x');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: /nope/x: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('an input redirect failure on the first stage aborts the pipeline', () => {
    const { ex } = setup();
    const r = ex.execute('cat < /nope | grep x');
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('bash: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
    // grep is never reached.
  });
});

describe('executor — env "?"-Tracking in Pipelines', () => {
  it('sets ? = "0" after a successful pipeline', () => {
    const { ex, env } = setup();
    ex.execute('ls /etc | grep hosts');
    expect(env.get('?')).toBe('0');
  });

  it('sets ? = "1" when the last stage exits 1', () => {
    const { ex, env } = setup();
    ex.execute('ls /etc | grep nomatch');
    expect(env.get('?')).toBe('1');
  });

  it('sets ? = "1" when a redirect error aborts the pipeline', () => {
    const { ex, env } = setup();
    ex.execute('cat /nope | grep x');
    expect(env.get('?')).toBe('1');
  });
});

describe('executor — Lange Pipeline', () => {
  it('cat | grep : | wc -l counts all lines with a colon', () => {
    const { ex } = setup();
    const r = ex.execute('cat /etc/passwd | grep : | wc -l');
    expect(/^\s*2\n$/.test(r.stdout)).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Executor — services-Weitergabe (spec009a §7)
// ---------------------------------------------------------------------------

describe('executor — services pass-through', () => {
  it('passes services to the command', () => {
    const { ex } = setup();
    const fakeTerminal = { clear() {} };
    const r = ex.execute('svc-check', { terminal: fakeTerminal });
    expect(r.stdout).toBe('terminal-present\n');
    expect(r.exitCode).toBe(0);
  });

  it('without services, command sees an empty object', () => {
    const { ex } = setup();
    const r = ex.execute('svc-check');
    expect(r.stderr).toBe('terminal-missing\n');
    expect(r.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Executor — Rückwärtskompatibilität (spec009a §7)
// ---------------------------------------------------------------------------

describe('executor — back-compat without services', () => {
  it('pwd still works when execute is called without services', () => {
    const { ex } = setup();
    const r = ex.execute('pwd');
    expect(r.stdout).toBe('/home/user\n');
    expect(r.exitCode).toBe(0);
  });
});