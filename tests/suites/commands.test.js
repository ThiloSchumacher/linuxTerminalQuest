import { describe, it, expect } from '../runner.js';
import { pwd } from '../../js/shell/commands/pwd.js';
import { cd } from '../../js/shell/commands/cd.js';
import { echo } from '../../js/shell/commands/echo.js';
import { ls } from '../../js/shell/commands/ls.js';
import { cat } from '../../js/shell/commands/cat.js';
import { mkdir } from '../../js/shell/commands/mkdir.js';
import { touch } from '../../js/shell/commands/touch.js';
import { rm } from '../../js/shell/commands/rm.js';
import { cp } from '../../js/shell/commands/cp.js';
import { mv } from '../../js/shell/commands/mv.js';
import { chmod } from '../../js/shell/commands/chmod.js';
import { Env } from '../../js/shell/env.js';
import { createInitialFS } from '../../js/vfs/initial-fs.js';
import { grep } from '../../js/shell/commands/grep.js';
import { head } from '../../js/shell/commands/head.js';
import { tail } from '../../js/shell/commands/tail.js';
import { wc } from '../../js/shell/commands/wc.js';
import { sort } from '../../js/shell/commands/sort.js';
import { ln } from '../../js/shell/commands/ln.js';
import { clear } from '../../js/shell/commands/clear.js';
import { history } from '../../js/shell/commands/history.js';
import { whoami } from '../../js/shell/commands/whoami.js';
import { date } from '../../js/shell/commands/date.js';
import { uname } from '../../js/shell/commands/uname.js';
import { LineEditor } from '../../js/terminal/line-editor.js';
import { which } from '../../js/shell/commands/which.js';
import { stat } from '../../js/shell/commands/stat.js';
import { file } from '../../js/shell/commands/file.js';
import { tree } from '../../js/shell/commands/tree.js';
import { sed } from '../../js/shell/commands/sed.js';
import { cut } from '../../js/shell/commands/cut.js';
import { tr } from '../../js/shell/commands/tr.js';
import { Executor } from '../../js/shell/executor.js';
import { createCommandRegistry } from '../../js/shell/commands/index.js';
import { tee } from '../../js/shell/commands/tee.js';
import { seq } from '../../js/shell/commands/seq.js';
import { nl } from '../../js/shell/commands/nl.js';
import { rev } from '../../js/shell/commands/rev.js';
import { basename } from '../../js/shell/commands/basename.js';
import { dirname } from '../../js/shell/commands/dirname.js';
import { find } from '../../js/shell/commands/find.js';
import { help } from '../../js/shell/commands/help.js';
import { chown } from '../../js/shell/commands/chown.js';

/**
 * Fresh vfs + env for one test.
 *
 * @returns {{
 *   vfs: import('../../js/vfs/filesystem.js').VFS,
 *   env: Env,
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
  return { vfs, env };
}

/**
 * Setup for service-dependent commands: vfs, env, a real LineEditor,
 * and a fake terminal that records calls.
 *
 * @param {string[]} [historyEntries=[]]
 * @returns {{
 *   vfs: import('../../js/vfs/filesystem.js').VFS,
 *   env: Env,
 *   lineEditor: LineEditor,
 *   terminal: {writeCalls: string[], clearCalls: number, write: (t: string) => void, clear: () => void},
 *   services: {terminal: object, lineEditor: LineEditor},
 * }}
 */
function setupWithServices(historyEntries = []) {
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
  const lineEditor = new LineEditor();
  for (const h of historyEntries) lineEditor.pushHistory(h);
  const terminal = {
    writeCalls: [],
    clearCalls: 0,
    write(t) { this.writeCalls.push(t); },
    clear() { this.clearCalls++; },
  };
  const registry = createCommandRegistry();
  return {
    vfs,
    env,
    lineEditor,
    terminal,
    registry,
    services: { terminal, lineEditor, registry },
  };
}

// ---------------------------------------------------------------------------
// pwd
// ---------------------------------------------------------------------------

describe('pwd', () => {
  it('prints PWD on stdout with exit 0', () => {
    const { vfs, env } = setup();
    const r = pwd.run({ argv: [], name: 'pwd', env, vfs });
    expect(r.stdout).toBe('/home/user\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('rejects extra arguments', () => {
    const { vfs, env } = setup();
    const r = pwd.run({ argv: ['x'], name: 'pwd', env, vfs });
    expect(r.stderr).toBe('pwd: too many arguments\n');
    expect(r.exitCode).toBe(1);
  });

  it('falls back to / when PWD is unset (defensive)', () => {
    const { vfs, env } = setup();
    env.delete('PWD');
    const r = pwd.run({ argv: [], name: 'pwd', env, vfs });
    expect(r.stdout).toBe('/\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cd
// ---------------------------------------------------------------------------

describe('cd', () => {
  it('without argument jumps to HOME and records OLDPWD', () => {
    const { vfs, env } = setup();
    env.set('PWD', '/etc');
    const r = cd.run({ argv: [], name: 'cd', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(env.get('PWD')).toBe('/home/user');
    expect(env.get('OLDPWD')).toBe('/etc');
  });

  it('to /etc updates PWD and OLDPWD', () => {
    const { vfs, env } = setup();
    const r = cd.run({ argv: ['/etc'], name: 'cd', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(env.get('PWD')).toBe('/etc');
    expect(env.get('OLDPWD')).toBe('/home/user');
  });

  it('to a file fails with Not a directory', () => {
    const { vfs, env } = setup();
    const r = cd.run({ argv: ['/etc/passwd'], name: 'cd', env, vfs });
    expect(r.stderr).toBe('cd: /etc/passwd: Not a directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('to a missing path fails with No such file or directory', () => {
    const { vfs, env } = setup();
    const r = cd.run({ argv: ['/nope'], name: 'cd', env, vfs });
    expect(r.stderr).toBe('cd: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('does not touch ? (that is the executor\'s job)', () => {
    const { vfs, env } = setup();
    env.set('?', '42');
    cd.run({ argv: ['/etc'], name: 'cd', env, vfs });
    expect(env.get('?')).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// echo
// ---------------------------------------------------------------------------

describe('echo', () => {
  it('with no args prints just a newline', () => {
    const { vfs, env } = setup();
    const r = echo.run({ argv: [], name: 'echo', env, vfs });
    expect(r.stdout).toBe('\n');
    expect(r.exitCode).toBe(0);
  });

  it('with one arg echoes it', () => {
    const { vfs, env } = setup();
    const r = echo.run({ argv: ['hi'], name: 'echo', env, vfs });
    expect(r.stdout).toBe('hi\n');
  });

  it('joins multiple args with a single space', () => {
    const { vfs, env } = setup();
    const r = echo.run({ argv: ['a', 'b', 'c'], name: 'echo', env, vfs });
    expect(r.stdout).toBe('a b c\n');
  });

  it('-n suppresses trailing newline', () => {
    const { vfs, env } = setup();
    const r = echo.run({ argv: ['-n', 'hi'], name: 'echo', env, vfs });
    expect(r.stdout).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
// ls
// ---------------------------------------------------------------------------

describe('ls', () => {
  it('lists /etc sorted, one per line', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['/etc'], name: 'ls', env, vfs });
    expect(r.stdout).toBe('hosts\nmotd\npasswd\n');
    expect(r.exitCode).toBe(0);
  });

  it('without path argument lists PWD', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: [], name: 'ls', env, vfs });
    expect(r.stdout).toBe('notes.txt\nprojects\n');
    expect(r.exitCode).toBe(0);
  });

  it('with a file argument prints the name', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['/etc/hosts'], name: 'ls', env, vfs });
    expect(r.stdout).toBe('hosts\n');
    expect(r.exitCode).toBe(0);
  });

  it('hides dotfiles for /home/user by default', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['/home/user'], name: 'ls', env, vfs });
    expect(r.stdout).toBe('notes.txt\nprojects\n');
  });

  it('with -a shows hidden children', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['-a', '/home/user'], name: 'ls', env, vfs });
    expect(r.stdout).toBe('.bashrc\nnotes.txt\nprojects\n');
  });

  it('with -A shows hidden children (same path as -a in V1)', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['-A', '/home/user'], name: 'ls', env, vfs });
    expect(r.stdout).toBe('.bashrc\nnotes.txt\nprojects\n');
  });

  it('with -l prints long format', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['-l', '/home/user'], name: 'ls', env, vfs });
    expect(/drwxr-xr-x user\s+user\s+0\s+projects/.test(r.stdout)).toBe(true);
  });

  it('accepts combined flags (-la) and combines both effects', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['-la', '/home/user'], name: 'ls', env, vfs });
    expect(/-rw-r--r-- user\s+user\s+\d+\s+\.bashrc/.test(r.stdout)).toBe(true);
    expect(/drwxr-xr-x user\s+user\s+0\s+projects/.test(r.stdout)).toBe(true);
  });

  it('renders sticky bit as if unset (V1 limitation, documented)', () => {
    const { vfs, env } = setup();
    vfs.createDir('/tmp/sub', '/');
    vfs.chmod('/tmp/sub', 0o1777);
    const r = ls.run({ argv: ['-l', '/tmp'], name: 'ls', env, vfs });
    expect(/drwxrwxrwx root\s+root\s+0\s+sub/.test(r.stdout)).toBe(true);
  });

  it('rejects unknown flags with exit 2', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['-x', '/etc'], name: 'ls', env, vfs });
    expect(r.stderr).toBe("ls: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });

  it('reports a missing path with exit 2', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['/nope'], name: 'ls', env, vfs });
    expect(r.stderr).toBe('ls: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(2);
  });

  it('continues after a per-arg error', () => {
    const { vfs, env } = setup();
    const r = ls.run({ argv: ['/nope', '/etc'], name: 'ls', env, vfs });
    expect(r.stderr).toBe('ls: /nope: No such file or directory\n');
    expect(r.stdout).toBe('hosts\nmotd\npasswd\n');
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// cat
// ---------------------------------------------------------------------------

describe('cat', () => {
  it('reads /etc/hosts', () => {
    const { vfs, env } = setup();
    const r = cat.run({ argv: ['/etc/hosts'], name: 'cat', env, vfs });
    expect(r.stdout).toBe('127.0.0.1 localhost\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('with no args is a no-op', () => {
    const { vfs, env } = setup();
    const r = cat.run({ argv: [], name: 'cat', env, vfs });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('with -n numbers lines', () => {
    const { vfs, env } = setup();
    const r = cat.run({ argv: ['-n', '/etc/passwd'], name: 'cat', env, vfs });
    expect(r.stdout.startsWith('    1\t')).toBe(true);
    expect(r.stdout.includes('    2\t')).toBe(true);
  });

  it('with -n adds a newline after a final line that had none (V1)', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/no-nl', '/', 'a\nb');
    const r = cat.run({ argv: ['-n', '/tmp/no-nl'], name: 'cat', env, vfs });
    expect(r.stdout).toBe('    1\ta\n    2\tb\n');
  });

  it('on a directory fails with Is a directory', () => {
    const { vfs, env } = setup();
    const r = cat.run({ argv: ['/etc'], name: 'cat', env, vfs });
    expect(r.stderr).toBe('cat: /etc: Is a directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('on a missing file fails with No such file or directory', () => {
    const { vfs, env } = setup();
    const r = cat.run({ argv: ['/nope'], name: 'cat', env, vfs });
    expect(r.stderr).toBe('cat: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// mkdir
// ---------------------------------------------------------------------------

describe('mkdir', () => {
  it('creates a single directory', () => {
    const { vfs, env } = setup();
    const r = mkdir.run({ argv: ['/tmp/newdir'], name: 'mkdir', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.exists('/tmp/newdir')).toBe(true);
  });

  it('with -p creates intermediate directories', () => {
    const { vfs, env } = setup();
    const r = mkdir.run({ argv: ['-p', '/tmp/a/b/c'], name: 'mkdir', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(vfs.exists('/tmp/a')).toBe(true);
    expect(vfs.exists('/tmp/a/b')).toBe(true);
    expect(vfs.exists('/tmp/a/b/c')).toBe(true);
  });

  it('with -p on an existing directory is idempotent (exit 0)', () => {
    const { vfs, env } = setup();
    const r = mkdir.run({ argv: ['-p', '/etc'], name: 'mkdir', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.exists('/etc')).toBe(true);
  });

  it('without -p requires the parent to exist', () => {
    const { vfs, env } = setup();
    const r = mkdir.run({ argv: ['/nonexistent/x'], name: 'mkdir', env, vfs });
    expect(r.stderr).toBe('mkdir: /nonexistent/x: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('reports EEXIST for an existing directory without -p', () => {
    const { vfs, env } = setup();
    const r = mkdir.run({ argv: ['/etc'], name: 'mkdir', env, vfs });
    expect(r.stderr).toBe('mkdir: /etc: File exists\n');
    expect(r.exitCode).toBe(1);
  });

  it('without argument reports missing operand', () => {
    const { vfs, env } = setup();
    const r = mkdir.run({ argv: [], name: 'mkdir', env, vfs });
    expect(r.stderr).toBe('mkdir: missing operand\n');
    expect(r.exitCode).toBe(1);
  });

  it('rejects unknown flags with exit 2', () => {
    const { vfs, env } = setup();
    const r = mkdir.run({ argv: ['-x', '/tmp/z'], name: 'mkdir', env, vfs });
    expect(r.stderr).toBe("mkdir: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// touch
// ---------------------------------------------------------------------------

describe('touch', () => {
  it('creates a new empty file', () => {
    const { vfs, env } = setup();
    const r = touch.run({ argv: ['/tmp/newfile'], name: 'touch', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.exists('/tmp/newfile')).toBe(true);
    expect(vfs.stat('/tmp/newfile').size).toBe(0);
  });

  it('advances mtime on an existing file', () => {
    const { vfs, env } = setup();
    const node = vfs.resolve('/etc/hosts');
    node.mtime = 1000;
    const r = touch.run({ argv: ['/etc/hosts'], name: 'touch', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(vfs.exists('/etc/hosts')).toBe(true);
    expect(node.mtime).toBeGreaterThan(1000);
  });

  it('also advances ctime and atime on an existing file', () => {
    const { vfs, env } = setup();
    const node = vfs.resolve('/etc/hosts');
    node.mtime = 1000;
    node.ctime = 1000;
    node.atime = 1000;
    const r = touch.run({ argv: ['/etc/hosts'], name: 'touch', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(node.mtime).toBeGreaterThan(1000);
    expect(node.ctime).toBeGreaterThan(1000);
    expect(node.atime).toBeGreaterThan(1000);
  });

  it('updates timestamps on an existing directory without error', () => {
    const { vfs, env } = setup();
    const node = vfs.resolve('/etc');
    node.mtime = 1000;
    const r = touch.run({ argv: ['/etc'], name: 'touch', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(node.mtime).toBeGreaterThan(1000);
    expect(vfs.exists('/etc')).toBe(true);
  });

  it('without argument reports missing operand', () => {
    const { vfs, env } = setup();
    const r = touch.run({ argv: [], name: 'touch', env, vfs });
    expect(r.stderr).toBe('touch: missing operand\n');
    expect(r.exitCode).toBe(1);
  });

  it('reports ENOENT when the parent directory is missing', () => {
    const { vfs, env } = setup();
    const r = touch.run({ argv: ['/nonexistent/file'], name: 'touch', env, vfs });
    expect(r.stderr).toBe('touch: /nonexistent/file: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// rm
// ---------------------------------------------------------------------------

describe('rm', () => {
  it('removes a file', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/newfile', '/', '');
    const r = rm.run({ argv: ['/tmp/newfile'], name: 'rm', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.exists('/tmp/newfile')).toBe(false);
  });

  it('refuses a directory without -r (lowercase message)', () => {
    const { vfs, env } = setup();
    const r = rm.run({ argv: ['/home/user/projects'], name: 'rm', env, vfs });
    expect(r.stderr).toBe('rm: /home/user/projects: is a directory\n');
    expect(r.exitCode).toBe(1);
    expect(vfs.exists('/home/user/projects')).toBe(true);
  });

  it('with -r removes a directory', () => {
    const { vfs, env } = setup();
    const r = rm.run({ argv: ['-r', '/home/user/projects'], name: 'rm', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(vfs.exists('/home/user/projects')).toBe(false);
  });

  it('missing path without -f reports an error', () => {
    const { vfs, env } = setup();
    const r = rm.run({ argv: ['/nope'], name: 'rm', env, vfs });
    expect(r.stderr).toBe('rm: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('with -f swallows ENOENT silently', () => {
    const { vfs, env } = setup();
    const r = rm.run({ argv: ['-f', '/nope'], name: 'rm', env, vfs });
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('with -f and no operand exits 0', () => {
    const { vfs, env } = setup();
    const r = rm.run({ argv: ['-f'], name: 'rm', env, vfs });
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('without operand (and no -f) reports missing operand', () => {
    const { vfs, env } = setup();
    const r = rm.run({ argv: [], name: 'rm', env, vfs });
    expect(r.stderr).toBe('rm: missing operand\n');
    expect(r.exitCode).toBe(1);
  });

  it('refuses to delete root with EPERM', () => {
    const { vfs, env } = setup();
    const r = rm.run({ argv: ['-r', '/'], name: 'rm', env, vfs });
    expect(r.stderr).toBe('rm: /: Operation not permitted\n');
    expect(r.exitCode).toBe(1);
  });

  it('rejects unknown flags with exit 2', () => {
    const { vfs, env } = setup();
    const r = rm.run({ argv: ['-x', '/tmp/z'], name: 'rm', env, vfs });
    expect(r.stderr).toBe("rm: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// cp
// ---------------------------------------------------------------------------

describe('cp', () => {
  it('copies a file preserving content', () => {
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['/etc/hosts', '/tmp/hosts-copy'], name: 'cp', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.exists('/tmp/hosts-copy')).toBe(true);
    expect(vfs.readFile('/tmp/hosts-copy')).toBe(vfs.readFile('/etc/hosts'));
  });

  it('without destination reports missing destination operand', () => {
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['/etc/hosts'], name: 'cp', env, vfs });
    expect(r.stderr).toBe('cp: missing destination file operand\n');
    expect(r.exitCode).toBe(1);
  });

  it('with more than two operands reports multiple-sources error', () => {
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['/etc/hosts', '/etc/motd', '/tmp'], name: 'cp', env, vfs });
    expect(r.stderr).toBe('cp: multiple sources not supported\n');
    expect(r.exitCode).toBe(1);
  });

  it('without -r on a directory source reports is-a-directory', () => {
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['/etc', '/tmp'], name: 'cp', env, vfs });
    expect(r.stderr).toBe('cp: /etc: is a directory (use -r)\n');
    expect(r.exitCode).toBe(1);
  });

  it('with -r on a directory source reports not-yet-implemented', () => {
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['-r', '/etc', '/tmp'], name: 'cp', env, vfs });
    expect(r.stderr).toBe('cp: -r not yet implemented\n');
    expect(r.exitCode).toBe(2);
  });

  it('with a missing destination parent reports the destination path', () => {
    const { vfs, env } = setup();
    const r = cp.run({
      argv: ['/etc/hosts', '/nonexistent/x.txt'],
      name: 'cp', env, vfs,
    });
    expect(r.stderr).toBe('cp: /nonexistent/x.txt: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('rejects same-file copy with EINVAL (command-level guard)', () => {
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['/etc/hosts', '/etc/hosts'], name: 'cp', env, vfs });
    expect(r.stderr).toBe('cp: /etc/hosts: Invalid argument\n');
    expect(r.exitCode).toBe(1);
    expect(vfs.readFile('/etc/hosts')).toBe('127.0.0.1 localhost\n');
  });

  it('rejects same-file copy on a directory with -r (guard before isDir branch)', () => {
    // Differentiation test: without the command-level guard, `cp -r /x /x`
    // would fall into the isDir(srcNode) && recursive branch and return
    // "cp: -r not yet implemented" with exit 2. With the guard, it returns
    // EINVAL with exit 1. This proves the guard runs BEFORE the
    // directory-source branch, not only that vfs.copy would reject
    // a self-copy.
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['-r', '/home/user/projects', '/home/user/projects'], name: 'cp', env, vfs });
    expect(r.stderr).toBe('cp: /home/user/projects: Invalid argument\n');
    expect(r.exitCode).toBe(1);
    // Source directory still exists.
    expect(vfs.exists('/home/user/projects')).toBe(true);
  });

  it('with -r on a file source has no effect (file copied normally)', () => {
    // Documented V1 behaviour: -r on a non-directory source is silently
    // ignored. Pins that a later refactor cannot turn this into an error.
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['-r', '/etc/hosts', '/tmp/hosts-copy'], name: 'cp', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.exists('/tmp/hosts-copy')).toBe(true);
    expect(vfs.readFile('/tmp/hosts-copy')).toBe(vfs.readFile('/etc/hosts'));
  });

  it('empty source path is reported as <empty> without a doubled colon', () => {
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['', '/tmp/x'], name: 'cp', env, vfs });
    expect(r.stderr).toBe('cp: <empty>: Invalid argument\n');
    expect(r.exitCode).toBe(1);
  });

  it('empty destination path is reported as <empty>, not against src', () => {
    // Symmetric to the empty-source test: destination-side EINVAL must
    // name <empty>, not the (valid) source.
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['/etc/hosts', ''], name: 'cp', env, vfs });
    expect(r.stderr).toBe('cp: <empty>: Invalid argument\n');
    expect(r.exitCode).toBe(1);
    // Source still there.
    expect(vfs.exists('/etc/hosts')).toBe(true);
  });

  it('with a directory already occupying the target name reports Is a directory', () => {
    // V1 limitation (documented): the message names the directory target
    // (/tmp) per VFS EISDIR semantics, not the conflicting entry
    // (/tmp/hosts). A future "cannot overwrite directory '<path>'" is
    // possible once the VFS exposes the concrete conflict; not required
    // by spec004a.
    const { vfs, env } = setup();
    vfs.createDir('/tmp/hosts', '/');
    const r = cp.run({ argv: ['/etc/hosts', '/tmp'], name: 'cp', env, vfs });
    expect(r.stderr).toBe('cp: /tmp: Is a directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('rejects unknown flags with exit 2', () => {
    const { vfs, env } = setup();
    const r = cp.run({ argv: ['-x', '/etc/hosts', '/tmp/x'], name: 'cp', env, vfs });
    expect(r.stderr).toBe("cp: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// mv
// ---------------------------------------------------------------------------

describe('mv', () => {
  it('renames a file', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/x', '/', 'hello');
    const r = mv.run({ argv: ['/tmp/x', '/tmp/y'], name: 'mv', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.exists('/tmp/x')).toBe(false);
    expect(vfs.exists('/tmp/y')).toBe(true);
    expect(vfs.readFile('/tmp/y')).toBe('hello');
  });

  it('without destination reports missing destination operand', () => {
    const { vfs, env } = setup();
    const r = mv.run({ argv: ['/tmp/x'], name: 'mv', env, vfs });
    expect(r.stderr).toBe('mv: missing destination file operand\n');
    expect(r.exitCode).toBe(1);
  });

  it('with more than two operands reports multiple-sources error', () => {
    const { vfs, env } = setup();
    const r = mv.run({ argv: ['/tmp/a', '/tmp/b', '/tmp/c'], name: 'mv', env, vfs });
    expect(r.stderr).toBe('mv: multiple sources not supported\n');
    expect(r.exitCode).toBe(1);
  });

  it('reports ENOENT when the source does not exist', () => {
    const { vfs, env } = setup();
    const r = mv.run({ argv: ['/nope', '/tmp/y'], name: 'mv', env, vfs });
    expect(r.stderr).toBe('mv: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('with a missing destination parent reports the destination path', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/x', '/', 'hello');
    const r = mv.run({
      argv: ['/tmp/x', '/nonexistent/y'],
      name: 'mv', env, vfs,
    });
    expect(r.stderr).toBe('mv: /nonexistent/y: No such file or directory\n');
    expect(r.exitCode).toBe(1);
    expect(vfs.exists('/tmp/x')).toBe(true);
  });

  it('rejects same-file move with EINVAL (command-level guard)', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/x', '/', 'hello');
    const r = mv.run({ argv: ['/tmp/x', '/tmp/x'], name: 'mv', env, vfs });
    expect(r.stderr).toBe('mv: /tmp/x: Invalid argument\n');
    expect(r.exitCode).toBe(1);
    expect(vfs.readFile('/tmp/x')).toBe('hello');
  });

  it('empty destination path is reported as <empty>, not against src', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/x', '/', 'hello');
    const r = mv.run({ argv: ['/tmp/x', ''], name: 'mv', env, vfs });
    expect(r.stderr).toBe('mv: <empty>: Invalid argument\n');
    expect(r.exitCode).toBe(1);
    expect(vfs.exists('/tmp/x')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// chmod
// ---------------------------------------------------------------------------

describe('chmod', () => {
  it('applies a numeric mode to a file', () => {
    const { vfs, env } = setup();
    const r = chmod.run({ argv: ['755', '/etc/hosts'], name: 'chmod', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.stat('/etc/hosts').mode).toBe(0o755);
  });

  it('applies a numeric mode to a directory', () => {
    const { vfs, env } = setup();
    const r = chmod.run({ argv: ['700', '/tmp'], name: 'chmod', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.stat('/tmp').mode).toBe(0o700);
  });

  it('accepts a leading-zero mode', () => {
    const { vfs, env } = setup();
    const r = chmod.run({ argv: ['0644', '/etc/passwd'], name: 'chmod', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(vfs.stat('/etc/passwd').mode).toBe(0o644);
  });

  it('rejects a non-octal mode', () => {
    const { vfs, env } = setup();
    const r = chmod.run({ argv: ['999', '/etc/hosts'], name: 'chmod', env, vfs });
    expect(r.stderr).toBe("chmod: invalid mode: '999'\n");
    expect(r.exitCode).toBe(1);
  });

  it('without a file argument reports missing operand', () => {
    const { vfs, env } = setup();
    const r = chmod.run({ argv: ['755'], name: 'chmod', env, vfs });
    expect(r.stderr).toBe('chmod: missing operand\n');
    expect(r.exitCode).toBe(1);
  });

  it('without any argument reports missing operand', () => {
    const { vfs, env } = setup();
    const r = chmod.run({ argv: [], name: 'chmod', env, vfs });
    expect(r.stderr).toBe('chmod: missing operand\n');
    expect(r.exitCode).toBe(1);
  });

  it('reports ENOENT for a missing target', () => {
    const { vfs, env } = setup();
    const r = chmod.run({ argv: ['755', '/nope'], name: 'chmod', env, vfs });
    expect(r.stderr).toBe('chmod: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

describe('grep', () => {
  it('finds a literal substring in a file', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['root', '/etc/passwd'], name: 'grep', env, vfs });
    expect(r.stdout.startsWith('root:x:0:0:')).toBe(true);
    expect(r.stdout.endsWith('\n')).toBe(true);
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('is case-sensitive by default', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['ROOT', '/etc/passwd'], name: 'grep', env, vfs });
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(1);
  });

  it('with -i matches case-insensitively', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['-i', 'ROOT', '/etc/passwd'], name: 'grep', env, vfs });
    expect(r.stdout.startsWith('root:')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('with -c prints only the count', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['-c', 'root', '/etc/passwd'], name: 'grep', env, vfs });
    expect(r.stdout).toBe('1\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -n prefixes line numbers', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['-n', 'root', '/etc/passwd'], name: 'grep', env, vfs });
    expect(r.stdout.startsWith('1:')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('with -v inverts the selection', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['-v', 'root', '/etc/passwd'], name: 'grep', env, vfs });
    expect(r.stdout.startsWith('user:')).toBe(true);
    expect(r.stdout.includes('root:')).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  it('reports a missing file with exit 2', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['x', '/nope'], name: 'grep', env, vfs });
    expect(r.stderr).toBe('grep: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(2);
  });

  it('without arguments reports missing pattern and exit 2', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: [], name: 'grep', env, vfs });
    expect(r.stderr).toBe('grep: missing pattern\n');
    expect(r.exitCode).toBe(2);
  });

  it('without file argument reports missing file and exit 2', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['root'], name: 'grep', env, vfs });
    expect(r.stderr).toBe('grep: missing file\n');
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// head
// ---------------------------------------------------------------------------

describe('head', () => {
  it('with default N shows the first 10 lines of /etc/passwd', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: ['/etc/passwd'], name: 'head', env, vfs });
    // /etc/passwd has 2 lines — the whole file is shown.
    expect(r.stdout).toBe(
      'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:User:/home/user:/bin/bash\n',
    );
    expect(r.exitCode).toBe(0);
  });

  it('with -n 1 shows only the first line', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: ['-n', '1', '/etc/passwd'], name: 'head', env, vfs });
    expect(r.stdout).toBe('root:x:0:0:root:/root:/bin/bash\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -n 0 produces empty output and exit 0', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: ['-n', '0', '/etc/passwd'], name: 'head', env, vfs });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('rejects a non-numeric -n value', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: ['-n', 'abc', '/etc/passwd'], name: 'head', env, vfs });
    expect(r.stderr.includes('invalid number of lines')).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  it('without -n value reports option-requires-argument and exit 1', () => {
    // Patch 2 §2: explicit error class for `head -n` (no value).
    const { vfs, env } = setup();
    const r = head.run({ argv: ['-n'], name: 'head', env, vfs });
    expect(r.stderr).toBe("head: option requires an argument -- 'n'\n");
    expect(r.exitCode).toBe(1);
  });

  it('without file reports missing file and exit 1', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: [], name: 'head', env, vfs });
    expect(r.stderr).toBe('head: missing file\n');
    expect(r.exitCode).toBe(1);
  });

  it('with multiple files emits a <filename>: header on its own line', () => {
    // Patch 1 §2: header on its own line, GNU-style (NOT inline grep-style).
    // Patch 1 §7 acceptance uses ['/etc/passwd', '/etc/hosts'].
    const { vfs, env } = setup();
    const r = head.run({ argv: ['/etc/passwd', '/etc/hosts'], name: 'head', env, vfs });
    expect(r.stdout.startsWith('/etc/passwd:\n')).toBe(true);
    expect(r.stdout.includes('/etc/hosts:\n')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('with -n 0 and multiple files still emits per-file headers (GNU behavior)', () => {
    // Patch 2 §2: this matches GNU head — the header is emitted for
    // every file even when the block is empty.
    const { vfs, env } = setup();
    const r = head.run({ argv: ['-n', '0', '/etc/passwd', '/etc/hosts'], name: 'head', env, vfs });
    expect(r.stdout).toBe('/etc/passwd:\n/etc/hosts:\n');
    expect(r.exitCode).toBe(0);
  });

  it('rejects an unknown flag with exit 2 (Patch 1 §6a)', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: ['-x', '/etc/passwd'], name: 'head', env, vfs });
    expect(r.stderr).toBe("head: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// tail
// ---------------------------------------------------------------------------

describe('tail', () => {
  it('with default N shows the whole 2-line file', () => {
    const { vfs, env } = setup();
    const r = tail.run({ argv: ['/etc/passwd'], name: 'tail', env, vfs });
    expect(r.stdout).toBe(
      'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:User:/home/user:/bin/bash\n',
    );
    expect(r.exitCode).toBe(0);
  });

  it('with -n 1 shows only the last line', () => {
    const { vfs, env } = setup();
    const r = tail.run({ argv: ['-n', '1', '/etc/passwd'], name: 'tail', env, vfs });
    expect(r.stdout).toBe('user:x:1000:1000:User:/home/user:/bin/bash\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -n 0 produces empty output and exit 0', () => {
    const { vfs, env } = setup();
    const r = tail.run({ argv: ['-n', '0', '/etc/passwd'], name: 'tail', env, vfs });
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('rejects a non-numeric -n value', () => {
    const { vfs, env } = setup();
    const r = tail.run({ argv: ['-n', 'abc', '/etc/passwd'], name: 'tail', env, vfs });
    expect(r.stderr.includes('invalid number of lines')).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  it('without -n value reports option-requires-argument and exit 1', () => {
    // Patch 2 §3: explicit error class for `tail -n` (no value).
    const { vfs, env } = setup();
    const r = tail.run({ argv: ['-n'], name: 'tail', env, vfs });
    expect(r.stderr).toBe("tail: option requires an argument -- 'n'\n");
    expect(r.exitCode).toBe(1);
  });

  it('without file reports missing file and exit 1', () => {
    const { vfs, env } = setup();
    const r = tail.run({ argv: [], name: 'tail', env, vfs });
    expect(r.stderr).toBe('tail: missing file\n');
    expect(r.exitCode).toBe(1);
  });

  it('with multiple files emits a <filename>: header on its own line', () => {
    // Patch 1 §3: header on its own line, GNU-style.
    const { vfs, env } = setup();
    const r = tail.run({ argv: ['/etc/passwd', '/etc/hosts'], name: 'tail', env, vfs });
    expect(r.stdout.startsWith('/etc/passwd:\n')).toBe(true);
    expect(r.stdout.includes('/etc/hosts:\n')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('with -n 0 and multiple files still emits per-file headers (GNU behavior)', () => {
    // Patch 2 §3: matches GNU tail — header for every file, even empty.
    const { vfs, env } = setup();
    const r = tail.run({ argv: ['-n', '0', '/etc/passwd', '/etc/hosts'], name: 'tail', env, vfs });
    expect(r.stdout).toBe('/etc/passwd:\n/etc/hosts:\n');
    expect(r.exitCode).toBe(0);
  });

  it('rejects an unknown flag with exit 2 (Patch 1 §6a)', () => {
    const { vfs, env } = setup();
    const r = tail.run({ argv: ['-x', '/etc/passwd'], name: 'tail', env, vfs });
    expect(r.stderr).toBe("tail: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// wc
// ---------------------------------------------------------------------------

describe('wc', () => {
  it('reports lines, words and chars with the documented format', () => {
    const { vfs, env } = setup();
    const content = vfs.readFile('/etc/passwd');
    const lines = 2;
    // Word count is whitespace-token count per spec004b §4 — colons in
    // /etc/passwd are NOT separators, so "root:x:0:0:root:/root:/bin/bash"
    // is one token.
    const words = content.split(/\s+/).filter((w) => w.length > 0).length;
    const chars = content.length;
    const expected =
      String(lines).padStart(8, ' ') + ' ' +
      String(words).padStart(8, ' ') + ' ' +
      String(chars).padStart(8, ' ') + ' /etc/passwd\n';
    const r = wc.run({ argv: ['/etc/passwd'], name: 'wc', env, vfs });
    expect(r.stdout).toBe(expected);
    expect(r.exitCode).toBe(0);
  });

  it('with -l reports only lines', () => {
    const { vfs, env } = setup();
    const r = wc.run({ argv: ['-l', '/etc/passwd'], name: 'wc', env, vfs });
    expect(r.stdout).toBe('       2 /etc/passwd\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -w on a standard file counts whitespace tokens (colons do not split)', () => {
    // Patch 2 §7: -w on /etc/passwd → 2 words (colons are not separators).
    const { vfs, env } = setup();
    const r = wc.run({ argv: ['-w', '/etc/passwd'], name: 'wc', env, vfs });
    expect(/^\s*2\s+\/etc\/passwd\n$/.test(r.stdout)).toBe(true);
    // Explicit padding check: 8-char right-aligned.
    expect(r.stdout.startsWith('       2 ')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('with -lw reports lines and words in order', () => {
    const { vfs, env } = setup();
    const content = vfs.readFile('/etc/passwd');
    const words = content.split(/\s+/).filter((w) => w.length > 0).length;
    const expected = '       2 ' + String(words).padStart(8, ' ') + ' /etc/passwd\n';
    const r = wc.run({ argv: ['-lw', '/etc/passwd'], name: 'wc', env, vfs });
    expect(r.stdout).toBe(expected);
    expect(r.exitCode).toBe(0);
  });

  it('with -lw on a single file does NOT emit a total line', () => {
    // Patch 2 §7: multiple===false → no total, regardless of metrics.
    const { vfs, env } = setup();
    const r = wc.run({ argv: ['-lw', '/etc/passwd'], name: 'wc', env, vfs });
    expect(/^\s*2\s+2\s+\/etc\/passwd\n$/.test(r.stdout)).toBe(true);
    expect(r.stdout.includes('total')).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  it('with -wc omits lines but keeps words-then-chars order (padding checked)', () => {
    // Patch 2 §7: regex format + EXPLICIT 8-char padding on BOTH columns.
    // chars is computed from readFile so this test is robust against
    // content changes; the padding assertion then compares the full
    // output line character-for-character, so a regression that drops
    // padStart on either column fails with a clear diff.
    const { vfs, env } = setup();
    const content = vfs.readFile('/etc/passwd');
    const words = content.split(/\s+/).filter((w) => w.length > 0).length;
    const chars = content.length;
    const expected =
      String(words).padStart(8, ' ') + ' ' +
      String(chars).padStart(8, ' ') + ' /etc/passwd\n';
    const r = wc.run({ argv: ['-wc', '/etc/passwd'], name: 'wc', env, vfs });
    expect(r.stdout).toBe(expected);
    // Redundant-but-explicit: chars column is right-aligned to 8 chars.
    // If chars is >= 8 digits long, padStart would yield the raw number;
    // the word column check via the full-string `toBe` above already
    // covers that case.
    const paddingForChars = 8 - String(chars).length;
    if (paddingForChars > 0) {
      const charsStartIdx = 9; // 8 chars word col + 1 space
      for (let i = 0; i < paddingForChars; i++) {
        expect(r.stdout[charsStartIdx + i]).toBe(' ');
      }
      expect(r.stdout[charsStartIdx + paddingForChars]).toBe(
        String(chars)[0],
      );
    }
    expect(r.exitCode).toBe(0);
  });

  it('with -c reports only chars', () => {
    const { vfs, env } = setup();
    const chars = vfs.readFile('/etc/passwd').length;
    const expected = String(chars).padStart(8, ' ') + ' /etc/passwd\n';
    const r = wc.run({ argv: ['-c', '/etc/passwd'], name: 'wc', env, vfs });
    expect(r.stdout).toBe(expected);
    expect(r.exitCode).toBe(0);
  });

  it('without file reports missing file and exit 1', () => {
    const { vfs, env } = setup();
    const r = wc.run({ argv: [], name: 'wc', env, vfs });
    expect(r.stderr).toBe('wc: missing file\n');
    expect(r.exitCode).toBe(1);
  });

  it('with multiple files appends a total line (single metric)', () => {
    const { vfs, env } = setup();
    const r = wc.run({ argv: ['-l', '/etc/passwd', '/etc/hosts'], name: 'wc', env, vfs });
    expect(r.stdout.includes(' /etc/passwd\n')).toBe(true);
    expect(r.stdout.includes(' /etc/hosts\n')).toBe(true);
    expect(r.stdout.includes(' total\n')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('with -lw on multiple files also appends a total line', () => {
    // Patch 2 §4 + §7: total for EVERY flag combination, not just
    // single-metric.
    //
    // Word counts: whitespace-token count per §4, so colons do NOT split.
    //   /etc/passwd → 2 lines, 2 words
    //   /etc/hosts  → 1 line,  2 words
    //   total       → 3 lines, 4 words
    //
    // Line counts are stable because /etc/passwd and /etc/hosts are
    // fixed in initial-fs.js. If initial-fs.js changes, this test MUST
    // be updated.
    const { vfs, env } = setup();
    const r = wc.run({ argv: ['-lw', '/etc/passwd', '/etc/hosts'], name: 'wc', env, vfs });
    const lines = r.stdout.split('\n');
    expect(/^\s*2\s+2\s+\/etc\/passwd$/.test(lines[0])).toBe(true);
    expect(/^\s*1\s+2\s+\/etc\/hosts$/.test(lines[1])).toBe(true);
    expect(/^\s*3\s+4\s+total$/.test(lines[2])).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('counts words independently of the implementation', () => {
    // Patch 1 §7 (kept in Patch 2 §7): constructed content with
    // unambiguous word count. Deliberately NOT derived from the same
    // regex used inside the implementation, so a bug in word-splitting
    // would be caught.
    const { vfs, env } = setup();
    vfs.createFile('/tmp/wc-input.txt', '/', 'a b\nc d e\n');
    const r = wc.run({ argv: ['-w', '/tmp/wc-input.txt'], name: 'wc', env, vfs });
    expect(/^\s*5\s+\/tmp\/wc-input\.txt$/.test(r.stdout.trimEnd())).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('rejects an unknown flag with exit 2 (Patch 1 §6a)', () => {
    const { vfs, env } = setup();
    const r = wc.run({ argv: ['-x', '/etc/passwd'], name: 'wc', env, vfs });
    expect(r.stderr).toBe("wc: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// sort
// ---------------------------------------------------------------------------

describe('sort', () => {
  it('sorts lines in ascending order', () => {
    const { vfs, env } = setup();
    const r = sort.run({ argv: ['/etc/passwd'], name: 'sort', env, vfs });
    expect(r.stdout).toBe(
      'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:User:/home/user:/bin/bash\n',
    );
    expect(r.exitCode).toBe(0);
  });

  it('with -r reverses the order', () => {
    const { vfs, env } = setup();
    const r = sort.run({ argv: ['-r', '/etc/passwd'], name: 'sort', env, vfs });
    expect(r.stdout).toBe(
      'user:x:1000:1000:User:/home/user:/bin/bash\nroot:x:0:0:root:/root:/bin/bash\n',
    );
    expect(r.exitCode).toBe(0);
  });

  it('with -u leaves a duplicate-free file unchanged', () => {
    const { vfs, env } = setup();
    const r = sort.run({ argv: ['-u', '/etc/passwd'], name: 'sort', env, vfs });
    expect(r.stdout).toBe(
      'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:User:/home/user:/bin/bash\n',
    );
    expect(r.exitCode).toBe(0);
  });

  it('with -u removes duplicates after sorting', () => {
    // Patch 2 §7: dedicated dup fixture so dedupe logic is exercised
    // (the previous -u test used a duplicate-free file → no-op).
    const { vfs, env } = setup();
    vfs.createFile('/tmp/sort-dup.txt', '/', 'a\nb\na\n');
    const r = sort.run({ argv: ['-u', '/tmp/sort-dup.txt'], name: 'sort', env, vfs });
    expect(r.stdout).toBe('a\nb\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -r -u reverses then dedupes', () => {
    // Patch 2 §7: pins the "sort-then-dedupe-then-reverse-via-comparator"
    // pipeline. This test catches an "adjacent-dedupe before sort"
    // refactor: on 'a\nb\na\n', adjacent-dedupe-before-sort would yield
    // 'a\nb' (the second 'a' is not adjacent to the first) before
    // sorting — and then 'b\na' after reverse — which differs from the
    // expected 'b\na\n'. It does NOT catch a Set-based
    // "remove-all-duplicates before sort" refactor, which would
    // legitimately produce the same output here.
    const { vfs, env } = setup();
    vfs.createFile('/tmp/sort-dup.txt', '/', 'a\nb\na\n');
    const r = sort.run({ argv: ['-r', '-u', '/tmp/sort-dup.txt'], name: 'sort', env, vfs });
    expect(r.stdout).toBe('b\na\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -n sorts numerically', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/numbers', '/', '10\n2\n1\n');
    const r = sort.run({ argv: ['-n', '/tmp/numbers'], name: 'sort', env, vfs });
    expect(r.stdout).toBe('1\n2\n10\n');
    expect(r.exitCode).toBe(0);
  });

  it('without file reports missing file and exit 1', () => {
    const { vfs, env } = setup();
    const r = sort.run({ argv: [], name: 'sort', env, vfs });
    expect(r.stderr).toBe('sort: missing file\n');
    expect(r.exitCode).toBe(1);
  });

  it('rejects an unknown flag with exit 2 (Patch 1 §6a)', () => {
    const { vfs, env } = setup();
    const r = sort.run({ argv: ['-x', '/etc/passwd'], name: 'sort', env, vfs });
    expect(r.stderr).toBe("sort: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// cat — stdin
// ---------------------------------------------------------------------------

describe('cat — stdin', () => {
  it('without args and stdin null produces empty output', () => {
    const { vfs, env } = setup();
    const r = cat.run({ argv: [], name: 'cat', env, vfs, stdin: null });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('without args echoes stdin', () => {
    const { vfs, env } = setup();
    const r = cat.run({
      argv: [], name: 'cat', env, vfs, stdin: 'hello\nworld\n',
    });
    expect(r.stdout).toBe('hello\nworld\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -n numbers stdin lines', () => {
    const { vfs, env } = setup();
    const r = cat.run({
      argv: ['-n'], name: 'cat', env, vfs, stdin: 'a\nb\n',
    });
    expect(r.stdout).toBe('    1\ta\n    2\tb\n');
    expect(r.exitCode).toBe(0);
  });

  it('ignores stdin when file args are present', () => {
    const { vfs, env } = setup();
    const r = cat.run({
      argv: ['/etc/hosts'], name: 'cat', env, vfs, stdin: 'ignored',
    });
    expect(r.stdout).toBe('127.0.0.1 localhost\n');
    expect(r.exitCode).toBe(0);
  });

  it('with stdin "" (empty string) returns empty output, exit 0 (not "missing file")', () => {
    // Design contract from spec007a: `''` is a VALID empty stdin,
    // distinct from `null` ("no stdin"). A refactor that changes
    // `typeof stdin === 'string'` to `stdin != null` would break this
    // — `''` would then fall through to the "no stdin" branch.
    const { vfs, env } = setup();
    const r = cat.run({ argv: [], name: 'cat', env, vfs, stdin: '' });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('treats "-" as a literal filename (ENOENT), not as stdin', () => {
    // V1 boundary (spec007a §4.2): `-` is not a stdin alias. If a
    // later spec introduces `-` as an alias, this test will break —
    // which is exactly the moment we want to re-check the docs.
    const { vfs, env } = setup();
    const r = cat.run({ argv: ['-'], name: 'cat', env, vfs, stdin: 'ignored' });
    expect(r.stderr).toBe('cat: -: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin "\\n" (single newline) preserves the empty line', () => {
    // Single-newline stdin is the first non-trivial input: split('\\n')
    // yields ['', ''] and the implementation does not add any extra
    // empty line. A refactor that filtered empty lines would break
    // this (and would silently drop legitimate blank lines from files).
    const { vfs, env } = setup();
    const r = cat.run({ argv: [], name: 'cat', env, vfs, stdin: '\n' });
    expect(r.stdout).toBe('\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// head — stdin
// ---------------------------------------------------------------------------

describe('head — stdin', () => {
  it('without args and stdin null reports missing file', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: [], name: 'head', env, vfs, stdin: null });
    expect(r.stderr).toBe('head: missing file\n');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin emits the first 10 lines', () => {
    const { vfs, env } = setup();
    const lines = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n';
    const r = head.run({ argv: [], name: 'head', env, vfs, stdin: lines });
    expect(r.stdout).toBe('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -n 2 emits the first two lines of stdin', () => {
    const { vfs, env } = setup();
    const r = head.run({
      argv: ['-n', '2'], name: 'head', env, vfs, stdin: 'a\nb\nc\n',
    });
    expect(r.stdout).toBe('a\nb\n');
    expect(r.exitCode).toBe(0);
  });

  it('ignores stdin when file args are present', () => {
    const { vfs, env } = setup();
    const r = head.run({
      argv: ['/etc/hosts'], name: 'head', env, vfs, stdin: 'ignored',
    });
    expect(r.stdout).toBe('127.0.0.1 localhost\n');
    expect(r.exitCode).toBe(0);
  });

  it('with stdin "" returns empty output, exit 0 (not "missing file")', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: [], name: 'head', env, vfs, stdin: '' });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('treats "-" as a literal filename (ENOENT), not as stdin', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: ['-'], name: 'head', env, vfs, stdin: 'ignored' });
    expect(r.stderr).toBe('head: -: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin "\\n" (single newline) returns one empty line', () => {
    // split('\\n') → ['', ''] → pop() → [''] → one blank line out.
    // A refactor that pops twice (for a hypothetical "two newlines"
    // case) would count 0 lines here and break this test.
    const { vfs, env } = setup();
    const r = head.run({ argv: [], name: 'head', env, vfs, stdin: '\n' });
    expect(r.stdout).toBe('\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tail — stdin
// ---------------------------------------------------------------------------

describe('tail — stdin', () => {
  it('without args and stdin null reports missing file', () => {
    const { vfs, env } = setup();
    const r = tail.run({ argv: [], name: 'tail', env, vfs, stdin: null });
    expect(r.stderr).toBe('tail: missing file\n');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin emits the last 10 lines', () => {
    const { vfs, env } = setup();
    const lines = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n';
    const r = tail.run({ argv: [], name: 'tail', env, vfs, stdin: lines });
    expect(r.stdout).toBe('2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -n 1 emits only the last line of stdin', () => {
    const { vfs, env } = setup();
    const r = tail.run({
      argv: ['-n', '1'], name: 'tail', env, vfs, stdin: 'a\nb\nc\n',
    });
    expect(r.stdout).toBe('c\n');
    expect(r.exitCode).toBe(0);
  });

  it('with stdin "" returns empty output, exit 0 (not "missing file")', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: [], name: 'head', env, vfs, stdin: '' });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('treats "-" as a literal filename (ENOENT), not as stdin', () => {
    const { vfs, env } = setup();
    const r = head.run({ argv: ['-'], name: 'head', env, vfs, stdin: 'ignored' });
    expect(r.stderr).toBe('head: -: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin "\\n" (single newline) returns one empty line', () => {
    const { vfs, env } = setup();
    const r = tail.run({ argv: [], name: 'tail', env, vfs, stdin: '\n' });
    expect(r.stdout).toBe('\n');
    expect(r.exitCode).toBe(0);
  });

  it('ignores stdin when file args are present', () => {
    // File args win over stdin (POSIX). This is tested for `cat` and
    // `head` in Runde 1; the same contract must hold for the other
    // four stdin-commands, each with its own `args.length === 0`-
    // branch. A refactor that re-ordered the checks in `tail` would
    // break this.
    const { vfs, env } = setup();
    const r = tail.run({
      argv: ['/etc/hosts'], name: 'tail', env, vfs, stdin: 'ignored',
    });
    expect(r.stdout).toBe('127.0.0.1 localhost\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// wc — stdin
// ---------------------------------------------------------------------------

describe('wc — stdin', () => {
  it('without args and stdin null reports missing file', () => {
    const { vfs, env } = setup();
    const r = wc.run({ argv: [], name: 'wc', env, vfs, stdin: null });
    expect(r.stderr).toBe('wc: missing file\n');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin outputs counts without a filename column (exact padding)', () => {
    // Exact string comparison rather than a whitespace-tolerant regex:
    // the stdin path uses the same 8-char right-alignment as the file
    // path, and this test should catch a regression that drops it.
    // `2`, `5`, `10` are right-aligned to 8 chars each, joined by one
    // space, with no trailing filename column.
    const { vfs, env } = setup();
    const r = wc.run({
      argv: [], name: 'wc', env, vfs, stdin: 'a b\nc d e\n',
    });
    expect(r.stdout).toBe('       2        5       10\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -l counts lines only', () => {
    const { vfs, env } = setup();
    const r = wc.run({
      argv: ['-l'], name: 'wc', env, vfs, stdin: 'a\nb\nc\n',
    });
    expect(r.stdout).toBe('       3\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -w counts words only', () => {
    const { vfs, env } = setup();
    const r = wc.run({
      argv: ['-w'], name: 'wc', env, vfs, stdin: 'a b c\n',
    });
    expect(r.stdout).toBe('       3\n');
    expect(r.exitCode).toBe(0);
  });

  it('with stdin "" outputs "0 0 0" with no filename column, exit 0', () => {
    // Empty stdin is valid input, not "missing file". Three zero
    // columns, right-aligned to 8 chars each, no trailing filename.
    const { vfs, env } = setup();
    const r = wc.run({ argv: [], name: 'wc', env, vfs, stdin: '' });
    expect(r.stdout).toBe('       0        0        0\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('treats "-" as a literal filename (ENOENT), not as stdin', () => {
    const { vfs, env } = setup();
    const r = wc.run({ argv: ['-'], name: 'wc', env, vfs, stdin: 'ignored' });
    expect(r.stderr).toBe('wc: -: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin "\\n" (single newline) counts 1 line, 0 words, 1 char', () => {
    // split('\\n') → ['', ''] → pop() → [''] → 1 line.
    // split(/\\s+/) → ['', ''] → filter → [] → 0 words.
    // length → 1 char. This is the smallest non-empty input that
    // distinguishes a correct `pop()`-based line count from a naive
    // `filter(line => line !== '')` (which would yield 0 lines) or a
    // "pop twice" (which would also yield 0 lines).
    const { vfs, env } = setup();
    const r = wc.run({ argv: [], name: 'wc', env, vfs, stdin: '\n' });
    expect(r.stdout).toBe('       1        0        1\n');
    expect(r.exitCode).toBe(0);
  });

  it('ignores stdin when file args are present', () => {
    // `endsWith(' /etc/hosts\n')` is stricter than `includes`:
    // a refactor that emitted BOTH the file line and a stdin-derived
    // line (e.g. `'       1        2       22 /etc/hosts\n       1        1        7\n'`)
    // would satisfy `includes('/etc/hosts')` but fail `endsWith`. The
    // `endsWith('\n')` assertion from the previous version is now
    // redundant — the new assertion implies it.
    const { vfs, env } = setup();
    const r = wc.run({
      argv: ['/etc/hosts'], name: 'wc', env, vfs, stdin: 'ignored',
    });
    expect(r.stdout.endsWith(' /etc/hosts\n')).toBe(true);
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('without a trailing newline on stdin: pop() does not fire', () => {
    // All other stdin tests use inputs that end in `\n` (pop fires)
    // or are empty (split yields ['']). This test uses `'a b'` — a
    // single line with no trailing newline — so the conditional
    // `if (last === '') pop()` does NOT fire and the content stays
    // one line. A refactor that unconditionally pops (or that
    // simplifies `if (last === '') pop()` to `pop()`) would count 0
    // lines and break this test.
    const { vfs, env } = setup();
    const r = wc.run({ argv: [], name: 'wc', env, vfs, stdin: 'a b' });
    // 1 line, 2 words, 3 chars, no filename column.
    expect(r.stdout).toBe('       1        2        3\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sort — stdin
// ---------------------------------------------------------------------------

describe('sort — stdin', () => {
  it('without args and stdin null reports missing file', () => {
    const { vfs, env } = setup();
    const r = sort.run({ argv: [], name: 'sort', env, vfs, stdin: null });
    expect(r.stderr).toBe('sort: missing file\n');
    expect(r.exitCode).toBe(1);
  });

  it('sorts stdin lines', () => {
    const { vfs, env } = setup();
    const r = sort.run({
      argv: [], name: 'sort', env, vfs, stdin: 'b\na\nc\n',
    });
    expect(r.stdout).toBe('a\nb\nc\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -r reverses stdin', () => {
    const { vfs, env } = setup();
    const r = sort.run({
      argv: ['-r'], name: 'sort', env, vfs, stdin: 'a\nb\n',
    });
    expect(r.stdout).toBe('b\na\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -u dedupes stdin', () => {
    const { vfs, env } = setup();
    const r = sort.run({
      argv: ['-u'], name: 'sort', env, vfs, stdin: 'a\nb\na\n',
    });
    expect(r.stdout).toBe('a\nb\n');
    expect(r.exitCode).toBe(0);
  });

  it('with stdin "" returns empty output, exit 0 (not "missing file")', () => {
    const { vfs, env } = setup();
    const r = sort.run({ argv: [], name: 'sort', env, vfs, stdin: '' });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('treats "-" as a literal filename (ENOENT), not as stdin', () => {
    const { vfs, env } = setup();
    const r = sort.run({ argv: ['-'], name: 'sort', env, vfs, stdin: 'ignored' });
    expect(r.stderr).toBe('sort: -: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin "\\n" (single newline) preserves the empty line', () => {
    // One empty line in, one empty line out. A refactor that filtered
    // blank lines (a common "sort should skip empty lines" temptation)
    // would return '' instead of '\\n' and break this.
    const { vfs, env } = setup();
    const r = sort.run({ argv: [], name: 'sort', env, vfs, stdin: '\n' });
    expect(r.stdout).toBe('\n');
    expect(r.exitCode).toBe(0);
  });

  it('ignores stdin when file args are present', () => {
    // File args win over stdin (POSIX). `sort` on /etc/hosts yields
    // the file's single line unchanged; if the stdin path had won,
    // the output would be 'ignored\n' instead.
    const { vfs, env } = setup();
    const r = sort.run({
      argv: ['/etc/hosts'], name: 'sort', env, vfs, stdin: 'ignored',
    });
    expect(r.stdout).toBe('127.0.0.1 localhost\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// grep — stdin
// ---------------------------------------------------------------------------

describe('grep — stdin', () => {
  it('with a pattern and stdin null reports missing file', () => {
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['root'], name: 'grep', env, vfs, stdin: null });
    expect(r.stderr).toBe('grep: missing file\n');
    expect(r.exitCode).toBe(2);
  });

  it('matches stdin lines without a filename prefix', () => {
    const { vfs, env } = setup();
    const r = grep.run({
      argv: ['root'], name: 'grep', env, vfs, stdin: 'root:x\nuser:y\n',
    });
    expect(r.stdout).toBe('root:x\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -i is case-insensitive on stdin', () => {
    const { vfs, env } = setup();
    const r = grep.run({
      argv: ['-i', 'ROOT'], name: 'grep', env, vfs, stdin: 'root:x\n',
    });
    expect(r.stdout).toBe('root:x\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -v inverts the selection on stdin', () => {
    const { vfs, env } = setup();
    const r = grep.run({
      argv: ['-v', 'root'], name: 'grep', env, vfs, stdin: 'root:x\nuser:y\n',
    });
    expect(r.stdout).toBe('user:y\n');
    expect(r.exitCode).toBe(0);
  });

  it('returns exit 1 when stdin has no match', () => {
    const { vfs, env } = setup();
    const r = grep.run({
      argv: ['nomatch'], name: 'grep', env, vfs, stdin: 'a\nb\n',
    });
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin "" returns empty output, exit 1 (no match), not "missing file"', () => {
    // Empty stdin → no lines → no match → exit 1. Different from
    // `stdin: null` (which produces "missing file", exit 2). Pins the
    // `null` vs `''` distinction at the grep exit-code level, where
    // the difference is most visible.
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['x'], name: 'grep', env, vfs, stdin: '' });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(1);
  });

  it('treats "-" as a literal filename (ENOENT), not as stdin', () => {
    const { vfs, env } = setup();
    const r = grep.run({
      argv: ['pattern', '-'], name: 'grep', env, vfs, stdin: 'ignored',
    });
    expect(r.stderr).toBe('grep: -: No such file or directory\n');
    expect(r.exitCode).toBe(2);
  });

  it('with stdin "\\n" (single empty line) reports no match, exit 1', () => {
    // The single empty line is a real line for the match pipeline —
    // '' does not contain 'x', so no line is selected. Exit 1 ("no
    // match") is correct, NOT exit 0 ("empty input, trivially no-op")
    // and NOT exit 2 ("missing file"). Pins the point at which an
    // empty line stops being a no-op and becomes a real (empty)
    // input.
    //
    // Note: the observable output of this test (''/exit 1) is
    // IDENTICAL to the '' test — the "empty line is a real line"
    // distinction is not visible with a non-empty pattern. The
    // `-v`-test below is the one that actually proves it.
    const { vfs, env } = setup();
    const r = grep.run({ argv: ['x'], name: 'grep', env, vfs, stdin: '\n' });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(1);
  });

  it('with stdin "\\n" and -v selects the empty line (proves it is a real line)', () => {
    // The distinguishing test for "an empty line is a real line".
    // With -v (invert), the empty line IS selected (`!''.includes('x')`
    // = true), so stdout is the empty line + '\n' = '\n' and exit is 0.
    // With stdin: '' (zero lines), -v selects nothing → stdout '' and
    // exit 1. So this test would break if `grep` treated the empty
    // line as "no line" (e.g. `if (line === '') continue;`).
    const { vfs, env } = setup();
    const r = grep.run({
      argv: ['-v', 'x'], name: 'grep', env, vfs, stdin: '\n',
    });
    expect(r.stdout).toBe('\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('with stdin "" and -v selects nothing, exit 1 (closes the -v/"" contrast)', () => {
    // The counterpart to the `-v '\n'` test above. Together they pin
    // the FULL boundary:
    //   - stdin '\n' → 1 empty line → `-v` selects it → stdout '\n', exit 0
    //   - stdin ''   → 0 lines      → `-v` selects nothing → stdout '', exit 1
    // A hypothetical shortcut in `grep`'s stdin branch (e.g.
    // `if (stdin === '') return { stdout: '', stderr: '', exitCode: 0 };`)
    // would break this test but leave the non-`-v`-`''` test green
    // (both return the same shape for a non-matching pattern).
    const { vfs, env } = setup();
    const r = grep.run({
      argv: ['-v', 'x'], name: 'grep', env, vfs, stdin: '',
    });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(1);
  });

  it('ignores stdin when file args are present', () => {
    // File args win over stdin (POSIX). `grep root /etc/passwd` must
    // return the root line from the file, not match against 'ignored'.
    const { vfs, env } = setup();
    const r = grep.run({
      argv: ['root', '/etc/passwd'], name: 'grep', env, vfs, stdin: 'ignored',
    });
    expect(r.stdout.startsWith('root:x:')).toBe(true);
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ln (spec008b)
// ---------------------------------------------------------------------------

describe('ln', () => {
  it('creates a symlink with -s', () => {
    const { vfs, env } = setup();
    const r = ln.run({
      argv: ['-s', '/etc/hosts', '/tmp/h'],
      name: 'ln', env, vfs,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    expect(vfs.readlink('/tmp/h', '/')).toBe('/etc/hosts');
  });

  it('with one arg uses basename in cwd', () => {
    const { vfs, env } = setup();
    env.set('PWD', '/tmp');
    const r = ln.run({
      argv: ['-s', '/etc/hosts'],
      name: 'ln', env, vfs,
    });
    expect(r.exitCode).toBe(0);
    expect(vfs.readlink('/tmp/hosts', '/')).toBe('/etc/hosts');
  });

  it('rejects an existing path with File exists', () => {
    const { vfs, env } = setup();
    ln.run({ argv: ['-s', '/etc/hosts', '/tmp/h'], name: 'ln', env, vfs });
    const r = ln.run({
      argv: ['-s', '/etc/hosts', '/tmp/h'],
      name: 'ln', env, vfs,
    });
    expect(r.stderr.includes('File exists')).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  it('rejects hardlink attempt without -s', () => {
    const { vfs, env } = setup();
    const r = ln.run({
      argv: ['/etc/hosts', '/tmp/h'],
      name: 'ln', env, vfs,
    });
    expect(r.stderr).toBe('ln: hard links not supported\n');
    expect(r.exitCode).toBe(2);
  });

  it('with no args reports missing operand', () => {
    const { vfs, env } = setup();
    const r = ln.run({ argv: ['-s'], name: 'ln', env, vfs });
    expect(r.stderr).toBe('ln: missing file operand\n');
    expect(r.exitCode).toBe(1);
  });

  it('with more than two args reports multiple targets', () => {
    const { vfs, env } = setup();
    const r = ln.run({
      argv: ['-s', 'a', 'b', 'c'],
      name: 'ln', env, vfs,
    });
    expect(r.stderr).toBe('ln: multiple targets not supported\n');
    expect(r.exitCode).toBe(2);
  });

  it('allows a broken target (POSIX ln -s)', () => {
    const { vfs, env } = setup();
    const r = ln.run({
      argv: ['-s', '/nope', '/tmp/b'],
      name: 'ln', env, vfs,
    });
    expect(r.exitCode).toBe(0);
    expect(vfs.readlink('/tmp/b', '/')).toBe('/nope');
  });

  it('rejects an unknown flag', () => {
    const { vfs, env } = setup();
    const r = ln.run({
      argv: ['-x', '-s', '/a', '/b'],
      name: 'ln', env, vfs,
    });
    expect(r.stderr).toBe("ln: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });

  it('reports ENOENT for a missing parent', () => {
    const { vfs, env } = setup();
    const r = ln.run({
      argv: ['-s', '/etc/hosts', '/nope/h'],
      name: 'ln', env, vfs,
    });
    expect(r.stderr).toBe('ln: /nope/h: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('reports ENOTDIR when parent is a file', () => {
    // `ln -s /etc/hosts /etc/passwd/h` — /etc/passwd is a file, so the
    // parent of the intended link is not a directory. createSymlink's
    // isDir(parent)-check throws ENOTDIR; ln.js must pass it through.
    const { vfs, env } = setup();
    const r = ln.run({
      argv: ['-s', '/etc/hosts', '/etc/passwd/h'],
      name: 'ln', env, vfs,
    });
    expect(r.stderr).toBe('ln: /etc/passwd/h: Not a directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('rejects `ln -s /` (basename would be `/`, no sensible link name)', () => {
    // V1-specific edge case: without a guard, `createSymlink('/', '/')
    // would fail with EEXIST. The explicit "Invalid argument" message
    // tells the user that the NAME is the problem, not that a file
    // already exists. Pinned so removing the guard surfaces loudly.
    const { vfs, env } = setup();
    const r = ln.run({ argv: ['-s', '/'], name: 'ln', env, vfs });
    expect(r.stderr).toBe('ln: /: Invalid argument\n');
    expect(r.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ls -l with links (spec008b §3)
// ---------------------------------------------------------------------------

describe('ls -l Links', () => {
  it('shows a link with l-mode and -> target, size = target.length', () => {
    // Setup in /home/user so owner is 'user' (in a fresh VFS /tmp is
    // owned by root — spec §5's example output uses 'user user' but
    // that only holds for user-owned paths).
    const { vfs, env } = setup();
    vfs.createFile('/home/user/datei', '/', 'a');
    vfs.createSymlink('/home/user/datei', '/home/user/link', '/');
    vfs.createSymlink('/etc/hosts', '/home/user/h', '/');

    const r = ls.run({
      argv: ['-l', '/home/user'],
      name: 'ls', env, vfs,
    });

    // Link 'link': mode 'lrwxrwxrwx', size = target.length ('/home/user/datei' = 16).
    const linkTarget = '/home/user/datei';
    const linkSize = String(linkTarget.length).padStart(8, ' ');
    expect(r.stdout.includes(`lrwxrwxrwx user user ${linkSize} link -> ${linkTarget}\n`)).toBe(true);

    // Link 'h': target '/etc/hosts' (10 chars).
    const hTarget = '/etc/hosts';
    const hSize = String(hTarget.length).padStart(8, ' ');
    expect(r.stdout.includes(`lrwxrwxrwx user user ${hSize} h -> ${hTarget}\n`)).toBe(true);

    // File 'datei' must NOT have ' -> ' suffix.
    expect(r.stdout.includes(' datei\n')).toBe(true);
    expect(r.stdout.includes('datei -> ')).toBe(false);
  });

  it('without -l shows link names but no " -> "', () => {
    const { vfs, env } = setup();
    vfs.createFile('/home/user/datei', '/', 'a');
    vfs.createSymlink('/home/user/datei', '/home/user/link', '/');
    vfs.createSymlink('/etc/hosts', '/home/user/h', '/');

    const r = ls.run({
      argv: ['/home/user'],
      name: 'ls', env, vfs,
    });
    // Link names appear (as plain names) …
    expect(r.stdout.includes('link\n')).toBe(true);
    expect(r.stdout.includes('h\n')).toBe(true);
    // … but never with the arrow suffix.
    expect(r.stdout.includes('->')).toBe(false);
  });

  it('ls -l /tmp/dl (link to dir) lists the target directory\'s children', () => {
    const { vfs, env } = setup();
    vfs.createDir('/home/user/sub', '/');
    vfs.createFile('/home/user/sub/child', '/', 'x');
    vfs.createSymlink('/home/user/sub', '/home/user/dl', '/');

    const r = ls.run({
      argv: ['-l', '/home/user/dl'],
      name: 'ls', env, vfs,
    });
    // Lists child of the target, not the link itself:
    expect(r.stdout.includes(' child\n')).toBe(true);
    expect(r.stdout.includes('dl -> ')).toBe(false);
  });

  it('ls -l on a link argument shows the link (POSIX, not -d)', () => {
    const { vfs, env } = setup();
    vfs.createFile('/home/user/file', '/', 'content');
    vfs.createSymlink('/home/user/file', '/home/user/link-to-file', '/');

    const r = ls.run({
      argv: ['-l', '/home/user/link-to-file'],
      name: 'ls', env, vfs,
    });
    const linkTarget = '/home/user/file';
    const linkSize = String(linkTarget.length).padStart(8, ' ');
    expect(r.stdout.includes(`lrwxrwxrwx user user ${linkSize} link-to-file -> ${linkTarget}\n`)).toBe(true);
  });

  it('children are sorted alphabetically, links like files', () => {
    const { vfs, env } = setup();
    vfs.createFile('/home/user/a-file', '/', '');
    vfs.createSymlink('/etc/hosts', '/home/user/b-link', '/');
    vfs.createFile('/home/user/c-file', '/', '');

    const r = ls.run({
      argv: ['-l', '/home/user'],
      name: 'ls', env, vfs,
    });
    const lines = r.stdout.split('\n').filter((l) => l.length > 0);
    const idxA = lines.findIndex((l) => l.includes(' a-file'));
    const idxB = lines.findIndex((l) => l.includes(' b-link'));
    const idxC = lines.findIndex((l) => l.includes(' c-file'));
    expect(idxA >= 0).toBe(true);
    expect(idxB >= 0).toBe(true);
    expect(idxC >= 0).toBe(true);
    expect(idxA < idxB).toBe(true);
    expect(idxB < idxC).toBe(true);
  });

  it('link whose name sorts FIRST is not deferred to the end', () => {
    // Control against a hypothetical refactor that sorts links after
    // files ("ls -l --group-directories-first"-style). With a link
    // sorting first alphabetically, a "links at the end" sort would
    // produce [bb-file, cc-file, aa-link] — the assertion below would
    // fail on `idxA < idxB`.
    const { vfs, env } = setup();
    vfs.createSymlink('/etc/hosts', '/home/user/aa-link', '/');
    vfs.createFile('/home/user/bb-file', '/', '');
    vfs.createFile('/home/user/cc-file', '/', '');

    const r = ls.run({
      argv: ['-l', '/home/user'],
      name: 'ls', env, vfs,
    });
    const lines = r.stdout.split('\n').filter((l) => l.length > 0);
    const idxA = lines.findIndex((l) => l.includes(' aa-link'));
    const idxB = lines.findIndex((l) => l.includes(' bb-file'));
    const idxC = lines.findIndex((l) => l.includes(' cc-file'));
    expect(idxA >= 0).toBe(true);
    expect(idxB >= 0).toBe(true);
    expect(idxC >= 0).toBe(true);
    expect(idxA < idxB).toBe(true);
    expect(idxB < idxC).toBe(true);
  });

  it('broken link as an ls -l argument is displayed as a link (not an error)', () => {
    // Exercises the `catch { resolvedNode = directNode; }` fallback in
    // ls.js: a broken link resolves to itself (lstat view), and its
    // line carries ` -> /nope`. Removing the try/catch would cause
    // `ls -l /home/user/broken` to fail with the ENOENT from the
    // follow-resolution instead of displaying the link.
    const { vfs, env } = setup();
    vfs.createSymlink('/nope', '/home/user/broken', '/');

    const r = ls.run({
      argv: ['-l', '/home/user/broken'],
      name: 'ls', env, vfs,
    });
    expect(r.exitCode).toBe(0);
    // Full long-form line: mode, owner, group, size (target.length),
    // name, arrow, target.
    const target = '/nope';
    const size = String(target.length).padStart(8, ' ');
    expect(r.stdout).toBe(
      `lrwxrwxrwx user user ${size} broken -> /nope\n`,
    );
  });
});

// ---------------------------------------------------------------------------
// clear (spec009a)
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('calls services.terminal.clear() exactly once', () => {
    const { vfs, env, terminal, services } = setupWithServices();
    const r = clear.run({
      argv: [], name: 'clear', env, vfs, stdin: null, services,
    });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
    expect(terminal.clearCalls).toBe(1);
  });

  it('reports "terminal not available" when services has no terminal', () => {
    const { vfs, env } = setupWithServices();
    const r = clear.run({
      argv: [], name: 'clear', env, vfs, stdin: null, services: {},
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.includes('terminal not available')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// history (spec009a)
// ---------------------------------------------------------------------------

describe('history', () => {
  it('prints numbered history entries, right-aligned to 4 chars', () => {
    const { vfs, env, services } = setupWithServices(['ls', 'cd /tmp']);
    const r = history.run({
      argv: [], name: 'history', env, vfs, stdin: null, services,
    });
    expect(r.stdout).toBe('   1  ls\n   2  cd /tmp\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('empty history → empty stdout, exit 0', () => {
    const { vfs, env, services } = setupWithServices();
    const r = history.run({
      argv: [], name: 'history', env, vfs, stdin: null, services,
    });
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('reports "line editor not available" when services has no lineEditor', () => {
    const { vfs, env } = setupWithServices();
    const r = history.run({
      argv: [], name: 'history', env, vfs, stdin: null, services: {},
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.includes('line editor not available')).toBe(true);
  });

  it('ignores arguments (no flags in V1)', () => {
    const { vfs, env, services } = setupWithServices(['ls']);
    const r = history.run({
      argv: ['whatever'], name: 'history', env, vfs, stdin: null, services,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('   1  ls\n');
  });
});

// ---------------------------------------------------------------------------
// whoami (spec009a)
// ---------------------------------------------------------------------------

describe('whoami', () => {
  it('prints env.USER', () => {
    const { vfs, env } = setupWithServices();
    env.set('USER', 'alice');
    const r = whoami.run({ argv: [], name: 'whoami', env, vfs });
    expect(r.stdout).toBe('alice\n');
    expect(r.exitCode).toBe(0);
  });

  it('falls back to "user" when env.USER is unset', () => {
    const { vfs, env } = setupWithServices();
    env.delete('USER');
    const r = whoami.run({ argv: [], name: 'whoami', env, vfs });
    expect(r.stdout).toBe('user\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// date (spec009a)
// ---------------------------------------------------------------------------

describe('date', () => {
  it('outputs a valid YYYY-MM-DD HH:MM:SS line (in-range components)', () => {
    // Range-checked regex: rejects month 00/13+, day 00/32+, hour
    // 24+, minute 60+, second 60+ — i.e. an off-by-one like
    // `getMonth() + 2` or `getHours() + 1` would fail here (month 13,
    // hour 24+), not just at a specific wall-clock moment.
    const { vfs, env } = setupWithServices();
    const r = date.run({ argv: [], name: 'date', env, vfs });
    expect(
      /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d\n$/.test(
        r.stdout,
      ),
    ).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// uname (spec009a)
// ---------------------------------------------------------------------------

describe('uname', () => {
  it('without args prints "Linux"', () => {
    const { vfs, env } = setupWithServices();
    const r = uname.run({ argv: [], name: 'uname', env, vfs });
    expect(r.stdout).toBe('Linux\n');
    expect(r.exitCode).toBe(0);
  });

  it('with -a prints the exact fake full string', () => {
    // Pinned to the exact string from spec009a §4.5. If the fake
    // version/kernel/arch is ever bumped, this test breaks — that is
    // the intended signal, update both this test and the command
    // together. A prefix-only check would pass silently on a version
    // bump or a wrong word in the middle.
    const { vfs, env } = setupWithServices();
    const r = uname.run({ argv: ['-a'], name: 'uname', env, vfs });
    expect(r.stdout).toBe(
      'Linux bashquest 5.10.0-bashquest #1 SMP x86_64 GNU/Linux\n',
    );
    expect(r.exitCode).toBe(0);
  });

  it('rejects an unknown flag with exit 2', () => {
    const { vfs, env } = setupWithServices();
    const r = uname.run({ argv: ['-x'], name: 'uname', env, vfs });
    expect(r.stderr).toBe("uname: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// which (spec009b)
// ---------------------------------------------------------------------------

describe('which', () => {
  it("['ls'] → '/usr/bin/ls\\n', exit 0", () => {
    const { vfs, env, services } = setupWithServices();
    const r = which.run({ argv: ['ls'], name: 'which', env, vfs, services });
    expect(r.stdout).toBe('/usr/bin/ls\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it("['nope'] → stderr 'which: nope: not found\\n', exit 1", () => {
    const { vfs, env, services } = setupWithServices();
    const r = which.run({ argv: ['nope'], name: 'which', env, vfs, services });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('which: nope: not found\n');
    expect(r.exitCode).toBe(1);
  });

  it("['ls','nope','cat'] → stdout '/usr/bin/ls\\n/usr/bin/cat\\n', stderr 'which: nope: not found\\n', exit 1", () => {
    const { vfs, env, services } = setupWithServices();
    const r = which.run({
      argv: ['ls', 'nope', 'cat'],
      name: 'which', env, vfs, services,
    });
    expect(r.stdout).toBe('/usr/bin/ls\n/usr/bin/cat\n');
    expect(r.stderr).toBe('which: nope: not found\n');
    expect(r.exitCode).toBe(1);
  });

  it("[] → stderr 'which: missing command\\n', exit 1", () => {
    const { vfs, env, services } = setupWithServices();
    const r = which.run({ argv: [], name: 'which', env, vfs, services });
    expect(r.stderr).toBe('which: missing command\n');
    expect(r.exitCode).toBe(1);
  });

  it('reports "registry not available" when services has no registry', () => {
    const { vfs, env } = setupWithServices();
    const r = which.run({
      argv: ['ls'], name: 'which', env, vfs, services: {},
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.includes('registry not available')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stat (spec009b)
// ---------------------------------------------------------------------------

describe('stat', () => {
  it("['/etc/hosts'] → regular file metadata", () => {
    const { vfs, env } = setup();
    const r = stat.run({ argv: ['/etc/hosts'], name: 'stat', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.includes('File: /etc/hosts')).toBe(true);
    expect(r.stdout.includes('Size: 20')).toBe(true);
    expect(r.stdout.includes('Type: regular file')).toBe(true);
    expect(r.stdout.includes('Mode: 0644 (-rw-r--r--)')).toBe(true);
    expect(r.stdout.includes('Owner: root/root')).toBe(true);
  });

  it("['/etc'] → Type: directory", () => {
    const { vfs, env } = setup();
    const r = stat.run({ argv: ['/etc'], name: 'stat', env, vfs });
    expect(r.stdout.includes('Type: directory')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('shows link metadata for a symlink (lstat view)', () => {
    const { vfs, env } = setup();
    vfs.createSymlink('/etc/hosts', '/tmp/l', '/');
    const r = stat.run({ argv: ['/tmp/l'], name: 'stat', env, vfs });
    expect(r.stdout.includes('Type: symbolic link')).toBe(true);
    // size = target.length ('/etc/hosts' = 10)
    expect(r.stdout.includes('Size: 10')).toBe(true);
    expect(r.stdout.includes('Mode: 0777 (lrwxrwxrwx)')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("['/nope'] → 'stat: /nope: No such file or directory\\n', exit 1", () => {
    const { vfs, env } = setup();
    const r = stat.run({ argv: ['/nope'], name: 'stat', env, vfs });
    expect(r.stderr).toBe('stat: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('multiple files are separated by a blank line', () => {
    const { vfs, env } = setup();
    const r = stat.run({
      argv: ['/etc/hosts', '/etc/motd'], name: 'stat', env, vfs,
    });
    // Blank line between sections: `...Change: <ts>\n\nFile: /etc/motd`
    expect(r.stdout.includes('\n\nFile: /etc/motd')).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// file (spec009b)
// ---------------------------------------------------------------------------

describe('file', () => {
  it("['/etc/hosts'] → '/etc/hosts: ASCII text\\n'", () => {
    const { vfs, env } = setup();
    const r = file.run({ argv: ['/etc/hosts'], name: 'file', env, vfs });
    expect(r.stdout).toBe('/etc/hosts: ASCII text\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/etc'] → '/etc: directory\\n'", () => {
    const { vfs, env } = setup();
    const r = file.run({ argv: ['/etc'], name: 'file', env, vfs });
    expect(r.stdout).toBe('/etc: directory\n');
  });

  it("['/tmp/leer'] (empty file) → 'empty'", () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/leer', '/', '');
    const r = file.run({ argv: ['/tmp/leer'], name: 'file', env, vfs });
    expect(r.stdout).toBe('/tmp/leer: empty\n');
  });

  it("['/tmp/u'] (UTF-8) → 'UTF-8 Unicode text'", () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/u', '/', 'Hällo');
    const r = file.run({ argv: ['/tmp/u'], name: 'file', env, vfs });
    expect(r.stdout).toBe('/tmp/u: UTF-8 Unicode text\n');
  });

  it("['/tmp/b'] (contains NUL) → 'data'", () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/b', '/', 'bin\0är');
    const r = file.run({ argv: ['/tmp/b'], name: 'file', env, vfs });
    expect(r.stdout).toBe('/tmp/b: data\n');
  });

  it('symlink argument shows target', () => {
    const { vfs, env } = setup();
    vfs.createSymlink('/etc/hosts', '/tmp/l', '/');
    const r = file.run({ argv: ['/tmp/l'], name: 'file', env, vfs });
    expect(r.stdout).toBe('/tmp/l: symbolic link to /etc/hosts\n');
  });

  it("['/nope'] → 'file: /nope: No such file or directory\\n', exit 1", () => {
    const { vfs, env } = setup();
    const r = file.run({ argv: ['/nope'], name: 'file', env, vfs });
    expect(r.stderr).toBe('file: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('content containing \\uFFFD (replacement char) is classified as data', () => {
    // The \uFFFD branch is defensive: V1's VFS stores strings as-is,
    // so a normal `createFile('…', …, 'valid utf-8')` never produces
    // \uFFFD. It only arises from a lossy decode. This test pins the
    // branch so a future refactor cannot silently drop it.
    const { vfs, env } = setup();
    vfs.createFile('/tmp/fffd', '/', '\uFFFD');
    const r = file.run({ argv: ['/tmp/fffd'], name: 'file', env, vfs });
    expect(r.stdout).toBe('/tmp/fffd: data\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tree (spec009b)
// ---------------------------------------------------------------------------

describe('tree', () => {
  it("['/etc'] → tree with box-drawing, ends with '1 directory, 3 files'", () => {
    const { vfs, env } = setup();
    const r = tree.run({ argv: ['/etc'], name: 'tree', env, vfs });
    expect(r.stdout.startsWith('etc\n')).toBe(true);
    expect(r.stdout.includes('├── hosts')).toBe(true);
    expect(r.stdout.includes('├── motd')).toBe(true);
    expect(r.stdout.includes('└── passwd')).toBe(true);
    expect(r.stdout.endsWith('\n1 directory, 3 files\n')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("['-L', '1', '/home/user'] → no subfolder content shown", () => {
    const { vfs, env } = setup();
    const r = tree.run({
      argv: ['-L', '1', '/home/user'], name: 'tree', env, vfs,
    });
    // projects shown as a leaf, but its (empty) content is not iterated
    expect(r.stdout.includes('projects')).toBe(true);
    // Hidden .bashrc not shown
    expect(r.stdout.includes('.bashrc')).toBe(false);
    // Wurzel + projects = 2 directories, notes.txt = 1 file
    expect(r.stdout.endsWith('\n2 directories, 1 file\n')).toBe(true);
  });

  it("['/nope'] → 'tree: /nope: No such file or directory\\n', exit 1", () => {
    const { vfs, env } = setup();
    const r = tree.run({ argv: ['/nope'], name: 'tree', env, vfs });
    expect(r.stderr).toBe('tree: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('symlinks are shown as "name -> target", never followed', () => {
    const { vfs, env } = setup();
    vfs.createSymlink('/tmp/a', '/tmp/self', '/');
    const r = tree.run({ argv: ['/tmp'], name: 'tree', env, vfs });
    expect(r.stdout.includes('self -> /tmp/a')).toBe(true);
    expect(r.exitCode).toBe(0);
    // The target of the symlink is not followed — nothing under /tmp/a
    // would appear even if it existed; the test would loop otherwise.
  });

  it("['/tmp'] empty → 'tmp\\n\\n1 directory, 0 files\\n' (spec009b Patch 1)", () => {
    // Patch 1 §6: the /tmp-empty case now expects '1 directory'
    // (PATH counts as 1 directory) — consistent with the /etc case
    // below ('1 directory, 3 files') and with §4's text rule
    // "PATH eingeschlossen". This is the resolved form of the earlier
    // spec discrepancy (the pre-Patch-1 test expected
    // '0 directories, 0 files', which would have matched GNU tree's
    // root-excluded convention but contradicted §4). See the tree.js
    // module JSDoc §"Counting rule" for the full rationale.
    const { vfs, env } = setup();
    const r = tree.run({ argv: ['/tmp'], name: 'tree', env, vfs });
    expect(r.stdout).toBe('tmp\n\n1 directory, 0 files\n');
    expect(r.exitCode).toBe(0);
  });

  it('invalid depth is rejected', () => {
    const { vfs, env } = setup();
    const r = tree.run({ argv: ['-L', '0', '/tmp'], name: 'tree', env, vfs });
    expect(r.stderr.includes('invalid depth')).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  it('non-directory path is rejected', () => {
    const { vfs, env } = setup();
    const r = tree.run({ argv: ['/etc/hosts'], name: 'tree', env, vfs });
    expect(r.stderr).toBe('tree: /etc/hosts: not a directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('detects cycles via visited set (test-only manipulation)', () => {
    // V1's VFS has no hardlinks, so a real cycle cannot be produced
    // through normal commands. The visited-set is defensive against
    // future extensions and this test pins the `[recursive, ignored]`
    // branch by directly manipulating the children map. If the
    // visited-check is ever removed (as "unreachable in V1"), this
    // test breaks — signalling that the defensive branch is gone.
    const { vfs, env } = setup();
    vfs.createDir('/tmp/a', '/');
    const aNode = vfs.resolve('/tmp/a', '/');
    // Force a cycle: /tmp/a contains a reference to itself under a
    // different map key. `tree` iterates `.children.values()`, so it
    // will see the same node twice — once from the walker's outer
    // scope, once via this child reference.
    aNode.children.set('self-loop', aNode);

    const r = tree.run({ argv: ['/tmp/a'], name: 'tree', env, vfs });
    expect(r.stdout.includes('[recursive, ignored]')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

    it("tree . shows the resolved directory name, not '.'", () => {
    const { vfs, env } = setup();
    env.set('PWD', '/etc');
    const r = tree.run({ argv: ['.'], name: 'tree', env, vfs });
    expect(r.stdout.startsWith('etc\n')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('recursive-ignored branch counts as 1 directory (2 directories, 0 files)', () => {
    // Pins the counting rule (d) from the tree.js JSDoc: a
    // `[recursive, ignored]` line still increments dirCount, because
    // it is displayed. `tree /tmp/a` where /tmp/a contains a
    // self-reference prints:
    //   a\n└── a [recursive, ignored]\n\n2 directories, 0 files\n
    // "2 directories" matches "two lines whose name is 'a'" — the
    // §4 text rule counts displayed, not unique, directories. If a
    // future spec prefers unique-node counting, the branch, this
    // test, and the JSDoc must all change together.
    const { vfs, env } = setup();
    vfs.createDir('/tmp/a', '/');
    const aNode = vfs.resolve('/tmp/a', '/');
    aNode.children.set('self-loop', aNode);

    const r = tree.run({ argv: ['/tmp/a'], name: 'tree', env, vfs });
    expect(r.stdout.endsWith('\n2 directories, 0 files\n')).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sed — Grundlagen (spec010a)
// ---------------------------------------------------------------------------

describe('sed — Grundlagen', () => {
  it("['s/root/admin/', '/etc/passwd'] substitutes first occurrence per line", () => {
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['s/root/admin/', '/etc/passwd'], name: 'sed', env, vfs,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.includes('admin:x:0:0:root:')).toBe(true);
    expect(r.stdout.includes('root:x:0:0:root:')).toBe(false);
  });

  it("['s/root/admin/g', '/etc/passwd'] substitutes all occurrences", () => {
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['s/root/admin/g', '/etc/passwd'], name: 'sed', env, vfs,
    });
    expect(r.stdout.includes('admin:x:0:0:admin:/admin:')).toBe(true);
    expect(r.stdout.includes('root')).toBe(false);
  });

  it("stdin 'a\\nb\\na\\n' with 's/a/x/' → 'x\\nb\\nx\\n'", () => {
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['s/a/x/'], name: 'sed', env, vfs, stdin: 'a\nb\na\n',
    });
    expect(r.stdout).toBe('x\nb\nx\n');
    expect(r.exitCode).toBe(0);
  });

  it("stdin 'a\\nb\\n' with 's/a/x/g' → 'x\\nb\\n'", () => {
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['s/a/x/g'], name: 'sed', env, vfs, stdin: 'a\nb\n',
    });
    expect(r.stdout).toBe('x\nb\n');
    expect(r.exitCode).toBe(0);
  });

  it("capture-group substitution 's/(a)(b)/$2$1/'", () => {
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['s/(a)(b)/$2$1/'], name: 'sed', env, vfs, stdin: 'abc',
    });
    expect(r.stdout).toBe('bac');
    expect(r.exitCode).toBe(0);
  });

  it('without file and without stdin reports missing input', () => {
    const { vfs, env } = setup();
    const r = sed.run({ argv: ['s/a/b/'], name: 'sed', env, vfs });
    expect(r.stderr).toBe('sed: missing input\n');
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// sed — -i (in-place)
// ---------------------------------------------------------------------------

describe('sed — -i (in-place)', () => {
  it("['-i','s/hi/hello/','/tmp/t'] writes back, no stdout", () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/t', '/', 'hi\nworld\n');
    const r = sed.run({
      argv: ['-i', 's/hi/hello/', '/tmp/t'], name: 'sed', env, vfs,
    });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/t', '/')).toBe('hello\nworld\n');
  });

  it("['-i','s/x/y/'] without file reports -i requires file", () => {
    const { vfs, env } = setup();
    const r = sed.run({ argv: ['-i', 's/x/y/'], name: 'sed', env, vfs });
    expect(r.stderr).toBe('sed: -i requires a file argument\n');
    expect(r.exitCode).toBe(2);
  });

  it("['-i','-n','s/hi/hello/','/tmp/t'] writes back, stdout empty (V1 -n + -i)", () => {
    // -i short-circuits BEFORE the noOutput check, so -n is a no-op
    // when combined with -i. This pins the ordering: the file is
    // written (write-back path fired), stdout is empty (inPlace
    // branch returned without touching stdout).
    const { vfs, env } = setup();
    vfs.createFile('/tmp/t', '/', 'hi\nworld\n');
    const r = sed.run({
      argv: ['-i', '-n', 's/hi/hello/', '/tmp/t'], name: 'sed', env, vfs,
    });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/t', '/')).toBe('hello\nworld\n');
  });

  it('with -i and multiple files only the FIRST file is modified (V1)', () => {
    // V1 processes files[0] only; additional file args are silently
    // ignored, so `-i` with two files only writes to the first. GNU
    // sed would process both in sequence — that extension belongs in
    // a future spec (documented in the module JSDoc "Input /
    // multi-file"). Pinned so a future multi-file change becomes a
    // visible behaviour change.
    const { vfs, env } = setup();
    vfs.createFile('/tmp/f1', '/', 'a\n');
    vfs.createFile('/tmp/f2', '/', 'a\n');
    const r = sed.run({
      argv: ['-i', 's/a/b/', '/tmp/f1', '/tmp/f2'], name: 'sed', env, vfs,
    });
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/f1', '/')).toBe('b\n');
    expect(vfs.readFile('/tmp/f2', '/')).toBe('a\n');
  });
});

// ---------------------------------------------------------------------------
// sed — Validierungsreihenfolge (spec010a: 1–6 in JSDoc-Reihenfolge)
// ---------------------------------------------------------------------------

describe('sed — Validierungsreihenfolge', () => {
  it('step 1: unknown flag before missing script', () => {
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['-x'], name: 'sed', env, vfs,
    });
    expect(r.stderr).toBe("sed: invalid option -- 'x'\n");
    expect(r.exitCode).toBe(2);
  });

  it('step 1: -i.bak reports invalid option -- \'.\' (no backup suffixes)', () => {
    // `-i.bak` is parsed as flag `i` + unknown character `.`. The
    // error names the actual mismatched character, which is the exact
    // interaction with parseFlags (not a generic "invalid option").
    // Pinned so a future `.bak`-support addition breaks this test
    // visibly.
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['-i.bak', 's/a/b/', '/etc/passwd'], name: 'sed', env, vfs,
    });
    expect(r.stderr).toBe("sed: invalid option -- '.'\n");
    expect(r.exitCode).toBe(2);
  });

  it('step 2: no args → missing script (not "-i requires file")', () => {
    const { vfs, env } = setup();
    const r = sed.run({ argv: ['-i'], name: 'sed', env, vfs });
    expect(r.stderr).toBe('sed: missing script\n');
    expect(r.exitCode).toBe(2);
  });

  it('step 3: unsupported script before regex compile', () => {
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['d', '/etc/passwd'], name: 'sed', env, vfs,
    });
    expect(r.stderr.includes('sed: unsupported script')).toBe(true);
    expect(r.exitCode).toBe(2);
  });

  it('step 4: invalid regex reports before file read', () => {
    // Pattern `(` is invalid. Would fail even if the file existed; the
    // point is the error fires in step 4, before step 6 (ENOENT would
    // shadow it if the file were read first).
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['s/(/x/', '/etc/passwd'], name: 'sed', env, vfs,
    });
    expect(r.stderr.includes('sed: invalid regex')).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  it('step 5: -i without file reports the flag error', () => {
    const { vfs, env } = setup();
    const r = sed.run({ argv: ['-i', 's/a/b/'], name: 'sed', env, vfs });
    expect(r.stderr).toBe('sed: -i requires a file argument\n');
    expect(r.exitCode).toBe(2);
  });

  it('step 6: no file and no stdin → missing input', () => {
    const { vfs, env } = setup();
    const r = sed.run({ argv: ['s/a/b/'], name: 'sed', env, vfs });
    expect(r.stderr).toBe('sed: missing input\n');
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// sed — Fehler (Datei-/IO-Ebene; Reihenfolge siehe voriger Block)
// ---------------------------------------------------------------------------

describe('sed — Fehler', () => {
  it('file read error reports ENOENT', () => {
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['s/a/b/', '/nope'], name: 'sed', env, vfs,
    });
    expect(r.stderr).toBe('sed: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('with -n and a file produces empty stdout (V1 -n)', () => {
    const { vfs, env } = setup();
    const r = sed.run({
      argv: ['-n', 's/a/b/', '/etc/passwd'], name: 'sed', env, vfs,
    });
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cut — Grundlagen (spec010a)
// ---------------------------------------------------------------------------

describe('cut — Grundlagen', () => {
  it("['-d',':','-f','1','/etc/passwd'] picks field 1", () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-d', ':', '-f', '1', '/etc/passwd'], name: 'cut', env, vfs,
    });
    expect(r.stdout).toBe('root\nuser\n');
    expect(r.exitCode).toBe(0);
  });

  it("['-d',':','-f','1,3','/etc/passwd'] picks fields 1 and 3", () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-d', ':', '-f', '1,3', '/etc/passwd'], name: 'cut', env, vfs,
    });
    expect(r.stdout).toBe('root:0\nuser:1000\n');
    expect(r.exitCode).toBe(0);
  });

  it("stdin 'a:b:c\\n' with -f 2 → 'b\\n'", () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-d', ':', '-f', '2'], name: 'cut', env, vfs, stdin: 'a:b:c\n',
    });
    expect(r.stdout).toBe('b\n');
    expect(r.exitCode).toBe(0);
  });

  it("['-d',':','-f','1-2','/etc/passwd'] picks a range", () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-d', ':', '-f', '1-2', '/etc/passwd'], name: 'cut', env, vfs,
    });
    expect(r.stdout).toBe('root:x\nuser:x\n');
    expect(r.exitCode).toBe(0);
  });

  it("['-d',':','-f','4','/etc/passwd'] picks field 4", () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-d', ':', '-f', '4', '/etc/passwd'], name: 'cut', env, vfs,
    });
    expect(r.stdout).toBe('0\n1000\n');
    expect(r.exitCode).toBe(0);
  });

  it('processes only the FIRST file argument (V1 multi-file limit)', () => {
    // V1 processes files[0]; additional file args are silently
    // ignored. Pin that so a later multi-file extension is a visible
    // behaviour change.
    const { vfs, env } = setup();
    vfs.createFile('/tmp/f1', '/', 'a:b\n');
    vfs.createFile('/tmp/f2', '/', 'c:d\n');
    const r = cut.run({
      argv: ['-d', ':', '-f', '1', '/tmp/f1', '/tmp/f2'],
      name: 'cut', env, vfs,
    });
    expect(r.stdout).toBe('a\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cut — Fehler
// ---------------------------------------------------------------------------

describe('cut — Fehler', () => {
  it("['-f','1','/etc/passwd'] reports missing -d", () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-f', '1', '/etc/passwd'], name: 'cut', env, vfs,
    });
    expect(r.stderr).toBe('cut: missing -d option\n');
    expect(r.exitCode).toBe(2);
  });

  it("['-d',':','/etc/passwd'] reports missing -f", () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-d', ':', '/etc/passwd'], name: 'cut', env, vfs,
    });
    expect(r.stderr).toBe('cut: missing -f option\n');
    expect(r.exitCode).toBe(2);
  });

  it("['-d','::','-f','1','/etc/passwd'] rejects multi-char delimiter", () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-d', '::', '-f', '1', '/etc/passwd'], name: 'cut', env, vfs,
    });
    expect(r.stderr).toBe('cut: -d requires single character\n');
    expect(r.exitCode).toBe(2);
  });

  it("['-d',':','-f','x','/etc/passwd'] rejects invalid field list", () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-d', ':', '-f', 'x', '/etc/passwd'], name: 'cut', env, vfs,
    });
    expect(r.stderr.includes('cut: invalid field list')).toBe(true);
    expect(r.exitCode).toBe(2);
  });

  it('without file and without stdin reports missing input', () => {
    const { vfs, env } = setup();
    const r = cut.run({
      argv: ['-d', ':', '-f', '1'], name: 'cut', env, vfs,
    });
    expect(r.stderr).toBe('cut: missing input\n');
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// tr — Grundlagen (spec010a)
// ---------------------------------------------------------------------------

describe('tr — Grundlagen', () => {
  it("stdin 'abc' with ['abc','xyz'] → 'xyz'", () => {
    const { vfs, env } = setup();
    const r = tr.run({
      argv: ['abc', 'xyz'], name: 'tr', env, vfs, stdin: 'abc',
    });
    expect(r.stdout).toBe('xyz');
    expect(r.exitCode).toBe(0);
  });

  it("stdin 'Hello World' with ['a-z','A-Z'] → 'HELLO WORLD'", () => {
    const { vfs, env } = setup();
    const r = tr.run({
      argv: ['a-z', 'A-Z'], name: 'tr', env, vfs, stdin: 'Hello World',
    });
    expect(r.stdout).toBe('HELLO WORLD');
    expect(r.exitCode).toBe(0);
  });

  it("stdin 'a\\nb\\n' with ['\\\\n',' '] translates newline to space", () => {
    const { vfs, env } = setup();
    // The argv value is the two-char string `\n` (backslash-n), which
    // parseSet expands to the newline character.
    const r = tr.run({
      argv: ['\\n', ' '], name: 'tr', env, vfs, stdin: 'a\nb\n',
    });
    expect(r.stdout).toBe('a b ');
    expect(r.exitCode).toBe(0);
  });

  it("stdin 'Hällo' with ['ä','a'] → 'Hallo' (UTF-8 safe)", () => {
    const { vfs, env } = setup();
    const r = tr.run({
      argv: ['ä', 'a'], name: 'tr', env, vfs, stdin: 'Hällo',
    });
    expect(r.stdout).toBe('Hallo');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tr — Fehler
// ---------------------------------------------------------------------------

describe('tr — Fehler', () => {
  it('[] reports missing operand', () => {
    const { vfs, env } = setup();
    const r = tr.run({ argv: [], name: 'tr', env, vfs });
    expect(r.stderr).toBe('tr: missing operand\n');
    expect(r.exitCode).toBe(2);
  });

  it("['abc'] reports V1 requires two sets", () => {
    const { vfs, env } = setup();
    const r = tr.run({ argv: ['abc'], name: 'tr', env, vfs });
    expect(r.stderr.includes('tr: V1 requires two sets')).toBe(true);
    expect(r.exitCode).toBe(2);
  });

  it("['z-a','a-z'] reports invalid range", () => {
    const { vfs, env } = setup();
    const r = tr.run({
      argv: ['z-a', 'a-z'], name: 'tr', env, vfs,
    });
    expect(r.stderr.includes('tr: invalid range')).toBe(true);
    expect(r.exitCode).toBe(2);
  });

  it('without stdin reports missing input (use with pipe)', () => {
    const { vfs, env } = setup();
    const r = tr.run({ argv: ['abc', 'xyz'], name: 'tr', env, vfs });
    expect(r.stderr).toBe('tr: missing input (use with pipe)\n');
    expect(r.exitCode).toBe(2);
  });

  it("['-d', 'abc'] rejects flag-shaped args before treating them as sets", () => {
    // GNU `tr -d abc` deletes characters. V1 does not support -d.
    // Silent-acceptance (parsing `-d` as the SET1 `-`+`d`) would be
    // the worst UX; the flag check makes the error explicit.
    const { vfs, env } = setup();
    const r = tr.run({
      argv: ['-d', 'abc'], name: 'tr', env, vfs, stdin: 'abcdef',
    });
    expect(r.stderr).toBe("tr: invalid option -- 'd'\n");
    expect(r.exitCode).toBe(2);
  });

  it("['-s'] rejects flag-shaped args", () => {
    const { vfs, env } = setup();
    const r = tr.run({
      argv: ['-s', 'abc'], name: 'tr', env, vfs, stdin: 'aabbcc',
    });
    expect(r.stderr).toBe("tr: invalid option -- 's'\n");
    expect(r.exitCode).toBe(2);
  });

  it("['-c', 'abc'] rejects flag-shaped args", () => {
    const { vfs, env } = setup();
    const r = tr.run({
      argv: ['-c', 'abc'], name: 'tr', env, vfs, stdin: 'abc',
    });
    expect(r.stderr).toBe("tr: invalid option -- 'c'\n");
    expect(r.exitCode).toBe(2);
  });

  it("['-d'] (single flag, no set) reports invalid option (not 'V1 requires two sets')", () => {
    // Flag detection runs BEFORE the argv.length < 2 check, so a
    // single flag-shaped arg produces `invalid option -- 'd'` — the
    // specific diagnosis. A hypothetical refactor that moved the
    // count-check before the flag-check would report the less useful
    // `V1 requires two sets` for `tr -d`. See the module JSDoc
    // "Flag-shaped arguments".
    const { vfs, env } = setup();
    const r = tr.run({ argv: ['-d'], name: 'tr', env, vfs, stdin: 'abc' });
    expect(r.stderr).toBe("tr: invalid option -- 'd'\n");
    expect(r.exitCode).toBe(2);
  });

  it("['--'] reports invalid option -- '-' (no `--` terminator in V1)", () => {
    // Unlike head/tail/sort, `tr` does not use parseFlags (because
    // ranges like `a-z` contain `-` and would be mis-parsed as
    // flags), so `--` is NOT a terminator. Documented as a V1
    // inconsistency; pinned so a future `--`-support addition breaks
    // this test visibly.
    const { vfs, env } = setup();
    const r = tr.run({
      argv: ['--', 'abc'], name: 'tr', env, vfs, stdin: 'abc',
    });
    expect(r.stderr).toBe("tr: invalid option -- '-'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Executor — Pipelines mit neuen Befehlen
// ---------------------------------------------------------------------------

describe('Executor — Pipelines mit neuen Befehlen', () => {
  /**
   * Build a minimal Executor with the real command registry, so
   * pipelines involving `sed`, `cut`, `tr` can be exercised end-to-end.
   *
   * @returns {{executor: Executor, vfs: import('../../js/vfs/filesystem.js').VFS}}
   */
  function execSetup() {
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
    const executor = new Executor({ vfs, env, registry });
    return { executor, vfs };
  }

  it("cat /etc/passwd | sed 's/x/y/' → stdout contains 'y'", () => {
    const { executor } = execSetup();
    const r = executor.execute("cat /etc/passwd | sed 's/x/y/'");
    expect(r.stdout.includes('y')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('cat /etc/passwd | cut -d: -f1 → root/user lines', () => {
    const { executor } = execSetup();
    const r = executor.execute('cat /etc/passwd | cut -d: -f1');
    expect(r.stdout).toBe('root\nuser\n');
    expect(r.exitCode).toBe(0);
  });

  it('echo abc | tr a-z A-Z → ABC', () => {
    const { executor } = execSetup();
    const r = executor.execute('echo abc | tr a-z A-Z');
    expect(r.stdout).toBe('ABC\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tee (spec010b)
// ---------------------------------------------------------------------------

describe('tee', () => {
  it("stdin with no files echoes to stdout only", () => {
    const { vfs, env } = setup();
    const r = tee.run({
      argv: [], name: 'tee', env, vfs, stdin: 'hi\n',
    });
    expect(r.stdout).toBe('hi\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('stdin with one file writes the file and echoes stdout', () => {
    const { vfs, env } = setup();
    const r = tee.run({
      argv: ['/tmp/t'], name: 'tee', env, vfs, stdin: 'hi\n',
    });
    expect(r.stdout).toBe('hi\n');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/t', '/')).toBe('hi\n');
  });

  it('with -a appends to an existing file', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/a', '/', 'x\n');
    const r = tee.run({
      argv: ['-a', '/tmp/a'], name: 'tee', env, vfs, stdin: 'y\n',
    });
    expect(r.stdout).toBe('y\n');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/a', '/')).toBe('x\ny\n');
  });

  it('without -a overwrites an existing file', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/a', '/', 'x\n');
    const r = tee.run({
      argv: ['/tmp/a'], name: 'tee', env, vfs, stdin: 'y\n',
    });
    expect(r.stdout).toBe('y\n');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/a', '/')).toBe('y\n');
  });

  it('without stdin reports missing input', () => {
    const { vfs, env } = setup();
    const r = tee.run({
      argv: ['/tmp/t'], name: 'tee', env, vfs,
    });
    expect(r.stderr).toBe('tee: missing input (use with pipe)\n');
    expect(r.exitCode).toBe(2);
  });

  it('per-file error: other files + stdout continue, exit code 1', () => {
    // The reference hint calls out "Fehler bei einer Datei: exit 1,
    // andere Dateien + stdout werden TROTZDEM verarbeitet" as the
    // critical per-file-continue path. No existing test covers a
    // multi-file scenario with one failure. A refactor from
    // `failed = true; continue` to `failed = true; return` would
    // pass all current tests but break this one.
    const { vfs, env } = setup();
    const r = tee.run({
      argv: ['/nope', '/tmp/ok'],
      name: 'tee', env, vfs, stdin: 'hi\n',
    });
    expect(r.stdout).toBe('hi\n');
    expect(r.stderr.includes('/nope')).toBe(true);
    expect(r.exitCode).toBe(1);
    expect(vfs.readFile('/tmp/ok', '/')).toBe('hi\n');
  });
});

// ---------------------------------------------------------------------------
// seq (spec010b)
// ---------------------------------------------------------------------------

describe('seq', () => {
  it("['3'] → 1 2 3", () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: ['3'], name: 'seq', env, vfs });
    expect(r.stdout).toBe('1\n2\n3\n');
    expect(r.exitCode).toBe(0);
  });

  it("['2','5'] → 2 3 4 5", () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: ['2', '5'], name: 'seq', env, vfs });
    expect(r.stdout).toBe('2\n3\n4\n5\n');
    expect(r.exitCode).toBe(0);
  });

  it("['1','2','7'] → 1 3 5 7", () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: ['1', '2', '7'], name: 'seq', env, vfs });
    expect(r.stdout).toBe('1\n3\n5\n7\n');
    expect(r.exitCode).toBe(0);
  });

  it("['0.5','0.5','2'] → 0.5 1 1.5 2", () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: ['0.5', '0.5', '2'], name: 'seq', env, vfs });
    expect(r.stdout).toBe('0.5\n1\n1.5\n2\n');
    expect(r.exitCode).toBe(0);
  });

  it("['5','-1','1'] → 5 4 3 2 1", () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: ['5', '-1', '1'], name: 'seq', env, vfs });
    expect(r.stdout).toBe('5\n4\n3\n2\n1\n');
    expect(r.exitCode).toBe(0);
  });

  it("['5','1'] → empty output, exit 0 (FIRST > LAST, step 1)", () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: ['5', '1'], name: 'seq', env, vfs });
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('[] reports missing operand', () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: [], name: 'seq', env, vfs });
    expect(r.stderr).toBe('seq: missing operand\n');
    expect(r.exitCode).toBe(2);
  });

  it("['1','0','5'] reports invalid step", () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: ['1', '0', '5'], name: 'seq', env, vfs });
    expect(r.stderr).toBe('seq: invalid step: 0\n');
    expect(r.exitCode).toBe(2);
  });

  it("['a'] reports invalid number", () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: ['a'], name: 'seq', env, vfs });
    expect(r.stderr).toBe('seq: invalid number: a\n');
    expect(r.exitCode).toBe(2);
  });

  it('negative FIRST is a number, not a flag', () => {
    const { vfs, env } = setup();
    const r = seq.run({ argv: ['-2', '2'], name: 'seq', env, vfs });
    expect(r.stdout).toBe('-2\n-1\n0\n1\n2\n');
    expect(r.exitCode).toBe(0);
  });

  it("['1', '0.1', '1.3'] → 1 1.1 1.2 1.3 (float step epsilon)", () => {
    // Regression: pre-fix, `(1.3 - 1) / 0.1` in IEEE-754 is
    // `2.9999999999999996`, so `floor` gave 2 → 3 iterations →
    // `1, 1.1, 1.2` (last value dropped). The `+ 1e-10` epsilon in
    // the iterations calculation closes this.
    const { vfs, env } = setup();
    const r = seq.run({
      argv: ['1', '0.1', '1.3'], name: 'seq', env, vfs,
    });
    expect(r.stdout).toBe('1\n1.1\n1.2\n1.3\n');
    expect(r.exitCode).toBe(0);
  });

  it("['-h', '5'] rejects a flag-shaped non-numeric arg", () => {
    // The flag check only rejects `-x` if `Number('-x')` is NaN.
    // Negative numbers (`-2`) are accepted as FIRST/STEP/LAST. This
    // test pins the OTHER side of that decision: an alpha flag is
    // rejected with `invalid option`, not `invalid number` (which
    // would be the fallback if the flag check were removed).
    const { vfs, env } = setup();
    const r = seq.run({
      argv: ['-h', '5'], name: 'seq', env, vfs,
    });
    expect(r.stderr).toBe("seq: invalid option -- 'h'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// nl (spec010b)
// ---------------------------------------------------------------------------

describe('nl', () => {
  it("default style 'a' numbers every line", () => {
    const { vfs, env } = setup();
    const r = nl.run({ argv: [], name: 'nl', env, vfs, stdin: 'a\nb\n' });
    expect(r.stdout).toBe('     1\ta\n     2\tb\n');
    expect(r.exitCode).toBe(0);
  });

  it("style 't' skips empty lines in numbering", () => {
    const { vfs, env } = setup();
    const r = nl.run({
      argv: ['-b', 't'], name: 'nl', env, vfs, stdin: 'a\n\nb\n',
    });
    expect(r.stdout).toBe('     1\ta\n      \n     2\tb\n');
    expect(r.exitCode).toBe(0);
  });

  it("style 'a' numbers empty lines too", () => {
    const { vfs, env } = setup();
    const r = nl.run({
      argv: ['-b', 'a'], name: 'nl', env, vfs, stdin: 'a\n\nb\n',
    });
    expect(r.stdout).toBe('     1\ta\n     2\t\n     3\tb\n');
    expect(r.exitCode).toBe(0);
  });

  it("['-b', 'x'] reports invalid style", () => {
    const { vfs, env } = setup();
    const r = nl.run({
      argv: ['-b', 'x'], name: 'nl', env, vfs, stdin: 'a\n',
    });
    expect(r.stderr).toBe('nl: invalid style: x\n');
    expect(r.exitCode).toBe(2);
  });

  it('without stdin reports missing input', () => {
    const { vfs, env } = setup();
    const r = nl.run({ argv: [], name: 'nl', env, vfs });
    expect(r.stderr).toBe('nl: missing input\n');
    expect(r.exitCode).toBe(2);
  });

  it("['-b'] without a style reports 'option requires an argument'", () => {
    // The current `nl` test `['-b', 'x']` exercises the invalid-style
    // path (the style ARG is present, it's just wrong). The
    // `-b`-without-value path (arg missing entirely) is separately
    // reachable and needs its own test — a refactor that drops the
    // `i + 1 >= argv.length` guard would silently swallow `nl -b`.
    const { vfs, env } = setup();
    const r = nl.run({
      argv: ['-b'], name: 'nl', env, vfs, stdin: 'a\n',
    });
    expect(r.stderr).toBe("nl: option requires an argument -- 'b'\n");
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// rev (spec010b)
// ---------------------------------------------------------------------------

describe('rev', () => {
  it("stdin 'abc\\n' → 'cba\\n'", () => {
    const { vfs, env } = setup();
    const r = rev.run({
      argv: [], name: 'rev', env, vfs, stdin: 'abc\n',
    });
    expect(r.stdout).toBe('cba\n');
    expect(r.exitCode).toBe(0);
  });

  it('UTF-8 safe: reverses umlauts correctly', () => {
    const { vfs, env } = setup();
    const r = rev.run({
      argv: [], name: 'rev', env, vfs, stdin: 'hällo\n',
    });
    expect(r.stdout).toBe('olläh\n');
    expect(r.exitCode).toBe(0);
  });

  it('single-character lines reverse to themselves', () => {
    const { vfs, env } = setup();
    const r = rev.run({
      argv: [], name: 'rev', env, vfs, stdin: 'a\nb\n',
    });
    expect(r.stdout).toBe('a\nb\n');
    expect(r.exitCode).toBe(0);
  });

  it('without stdin reports missing input', () => {
    const { vfs, env } = setup();
    const r = rev.run({ argv: [], name: 'rev', env, vfs });
    expect(r.stderr).toBe('rev: missing input\n');
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// basename (spec010b)
// ---------------------------------------------------------------------------

describe('basename', () => {
  it("['/etc/passwd'] → 'passwd'", () => {
    const { vfs, env } = setup();
    const r = basename.run({
      argv: ['/etc/passwd'], name: 'basename', env, vfs,
    });
    expect(r.stdout).toBe('passwd\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/etc/passwd', 'sswd'] → 'pa' (suffix removed)", () => {
    const { vfs, env } = setup();
    const r = basename.run({
      argv: ['/etc/passwd', 'sswd'], name: 'basename', env, vfs,
    });
    expect(r.stdout).toBe('pa\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/etc/'] → 'etc' (trailing slash stripped)", () => {
    const { vfs, env } = setup();
    const r = basename.run({ argv: ['/etc/'], name: 'basename', env, vfs });
    expect(r.stdout).toBe('etc\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/'] → '/'", () => {
    const { vfs, env } = setup();
    const r = basename.run({ argv: ['/'], name: 'basename', env, vfs });
    expect(r.stdout).toBe('/\n');
    expect(r.exitCode).toBe(0);
  });

  it("['foo.txt', '.txt'] → 'foo'", () => {
    const { vfs, env } = setup();
    const r = basename.run({
      argv: ['foo.txt', '.txt'], name: 'basename', env, vfs,
    });
    expect(r.stdout).toBe('foo\n');
    expect(r.exitCode).toBe(0);
  });

  it('[] reports missing operand', () => {
    const { vfs, env } = setup();
    const r = basename.run({ argv: [], name: 'basename', env, vfs });
    expect(r.stderr).toBe('basename: missing operand\n');
    expect(r.exitCode).toBe(1);
  });

  it("['a', 'b', 'c'] reports extra operand", () => {
    const { vfs, env } = setup();
    const r = basename.run({
      argv: ['a', 'b', 'c'], name: 'basename', env, vfs,
    });
    expect(r.stderr.includes('basename: extra operand')).toBe(true);
    expect(r.exitCode).toBe(1);
  });

    it("['///'] → '/' (all-slash path)", () => {
    // Regression: pre-fix, `basenameString('///')` returned `''`
    // because the only-all-slash case fell through to the final
    // slice. `'/^\/+$/'` catches it explicitly.
    const { vfs, env } = setup();
    const r = basename.run({
      argv: ['///'], name: 'basename', env, vfs,
    });
    expect(r.stdout).toBe('/\n');
    expect(r.exitCode).toBe(0);
  });

  it("['//'] → '/' (all-slash path, run length ≥ 1)", () => {
    // Companion to the `['///']` test: the `/^\/+$/` regex matches
    // ANY run length ≥ 1, so `'/'`, `'//'`, `'///'`, … all collapse
    // to `'/'`. This test pins the two-slash boundary. POSIX `'//'`
    // would preserve the double slash (network root); V1 collapses
    // to `/` — documented in the module JSDoc "Slash handling (V1)".
    const { vfs, env } = setup();
    const r = basename.run({
      argv: ['//'], name: 'basename', env, vfs,
    });
    expect(r.stdout).toBe('/\n');
    expect(r.exitCode).toBe(0);
  });

  it("['a//b'] → 'b' (internal duplicate slashes, basename side)", () => {
    // Pins the JSDoc claim in `basenameString`: lastIndexOf('/') on
    // 'a//b' finds index 2 (the second slash of the '//' run), so the
    // result is 'b'. A refactor that used split('/').filter(Boolean)
    // would produce the same result here, but one that filtered
    // empty segments AND then sliced by index-of-last-filtered would
    // diverge — the test locks in the "last slash wins" semantics.
    const { vfs, env } = setup();
    const r = basename.run({
      argv: ['a//b'], name: 'basename', env, vfs,
    });
    expect(r.stdout).toBe('b\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dirname (spec010b)
// ---------------------------------------------------------------------------

describe('dirname', () => {
  it("['/etc/passwd'] → '/etc'", () => {
    const { vfs, env } = setup();
    const r = dirname.run({
      argv: ['/etc/passwd'], name: 'dirname', env, vfs,
    });
    expect(r.stdout).toBe('/etc\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/etc/passwd/x'] → '/etc/passwd'", () => {
    const { vfs, env } = setup();
    const r = dirname.run({
      argv: ['/etc/passwd/x'], name: 'dirname', env, vfs,
    });
    expect(r.stdout).toBe('/etc/passwd\n');
    expect(r.exitCode).toBe(0);
  });

  it("['foo'] → '.'", () => {
    const { vfs, env } = setup();
    const r = dirname.run({ argv: ['foo'], name: 'dirname', env, vfs });
    expect(r.stdout).toBe('.\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/'] → '/'", () => {
    const { vfs, env } = setup();
    const r = dirname.run({ argv: ['/'], name: 'dirname', env, vfs });
    expect(r.stdout).toBe('/\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/etc/'] → '/' (trailing slash stripped first)", () => {
    const { vfs, env } = setup();
    const r = dirname.run({ argv: ['/etc/'], name: 'dirname', env, vfs });
    expect(r.stdout).toBe('/\n');
    expect(r.exitCode).toBe(0);
  });

  it('[] reports missing operand', () => {
    const { vfs, env } = setup();
    const r = dirname.run({ argv: [], name: 'dirname', env, vfs });
    expect(r.stderr).toBe('dirname: missing operand\n');
    expect(r.exitCode).toBe(1);
  });

  it("['a', 'b'] reports extra operand", () => {
    const { vfs, env } = setup();
    const r = dirname.run({ argv: ['a', 'b'], name: 'dirname', env, vfs });
    expect(r.stderr.includes('dirname: extra operand')).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  it("['/foo//bar'] → '/foo' (internal duplicate slashes normalised)", () => {
    // Regression: pre-fix, `lastIndexOf('/')` on `'/foo//bar'` gave
    // index 5, so `slice(0, 5)` returned `'/foo/'` (with a trailing
    // slash). POSIX dirname collapses internal duplicate slashes to
    // single slashes before splitting. The `.replace(/\/+/g, '/')`
    // in `dirnameString` closes this.
    const { vfs, env } = setup();
    const r = dirname.run({
      argv: ['/foo//bar'], name: 'dirname', env, vfs,
    });
    expect(r.stdout).toBe('/foo\n');
    expect(r.exitCode).toBe(0);
  });

  it("['a//b'] → 'a' (internal duplicate slashes, dirname side)", () => {
    // Companion to the `['/foo//bar']` test (which covers an absolute
    // path). Here the path is relative: `.replace(/\/+/g, '/')`
    // gives 'a/b', lastIndexOf('/') = 1, slice(0, 1) = 'a'. Pins
    // that the duplicate-slash collapse also works for relative
    // paths — the same code path as the absolute case, but the
    // `idx === 0` branch is NOT taken here (a relative path never
    // starts with '/'), so a refactor that broke the `idx === 0`
    // branch would not be caught by this test — that is what
    // `['/foo//bar']` covers. Together they pin both the collapse
    // logic and the leading-slash handling.
    const { vfs, env } = setup();
    const r = dirname.run({
      argv: ['a//b'], name: 'dirname', env, vfs,
    });
    expect(r.stdout).toBe('a\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Executor — Pipelines mit neuen Befehlen
// ---------------------------------------------------------------------------

describe('Executor — Pipelines mit neuen Befehlen (spec010b)', () => {
  /**
   * @returns {{executor: Executor, vfs: import('../../js/vfs/filesystem.js').VFS}}
   */
  function execSetup() {
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
    const executor = new Executor({ vfs, env, registry });
    return { executor, vfs };
  }

  it('seq 3 | nl produces numbered lines', () => {
    const { executor } = execSetup();
    const r = executor.execute('seq 3 | nl');
    expect(r.stdout).toBe('     1\t1\n     2\t2\n     3\t3\n');
    expect(r.exitCode).toBe(0);
  });

  it('echo abc | rev reverses the line', () => {
    const { executor } = execSetup();
    const r = executor.execute('echo abc | rev');
    expect(r.stdout).toBe('cba\n');
    expect(r.exitCode).toBe(0);
  });

  it('seq 5 | tee file | tail -n 1 keeps last line, writes file', () => {
    const { executor, vfs } = execSetup();
    const r = executor.execute('seq 5 | tee /tmp/z | tail -n 1');
    expect(r.stdout).toBe('5\n');
    expect(r.exitCode).toBe(0);
    expect(vfs.readFile('/tmp/z', '/')).toBe('1\n2\n3\n4\n5\n');
  });
});

// ---------------------------------------------------------------------------
// find — Grundlagen (spec011a)
// ---------------------------------------------------------------------------

describe('find — Grundlagen', () => {
  it("['/etc'] prints the directory and all entries", () => {
    const { vfs, env } = setup();
    const r = find.run({ argv: ['/etc'], name: 'find', env, vfs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(
      '/etc\n/etc/hosts\n/etc/motd\n/etc/passwd\n',
    );
  });

  it("['/etc','-name','pass*'] matches passwd", () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-name', 'pass*'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/etc/passwd\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/etc','-name','pas?wd'] matches passwd with a single-char wildcard", () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-name', 'pas?wd'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/etc/passwd\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/etc','-name','pas?'] matches nothing (pas? is too short)", () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-name', 'pas?'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it("['/etc','-type','f'] lists only files", () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-type', 'f'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/etc/hosts\n/etc/motd\n/etc/passwd\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/etc','-type','d'] lists only the directory itself", () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-type', 'd'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/etc\n');
    expect(r.exitCode).toBe(0);
  });

  it("['/home/user','-maxdepth','1'] lists PATH and direct children", () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/home/user', '-maxdepth', '1'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe(
      '/home/user\n' +
        '/home/user/.bashrc\n' +
        '/home/user/notes.txt\n' +
        '/home/user/projects\n',
    );
    expect(r.exitCode).toBe(0);
  });

  it("['/home/user','-maxdepth','0'] lists only PATH itself", () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/home/user', '-maxdepth', '0'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/home/user\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// find — Kombination (AND)
// ---------------------------------------------------------------------------

describe('find — Kombination (AND)', () => {
  it('type f + name host* narrows to /etc/hosts', () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-type', 'f', '-name', 'host*'],
      name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/etc/hosts\n');
    expect(r.exitCode).toBe(0);
  });

  it('name * + type d narrows to the directory itself', () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-name', '*', '-type', 'd'],
      name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/etc\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// find — Fehler
// ---------------------------------------------------------------------------

describe('find — Fehler', () => {
  it("['/nope'] reports ENOENT and exit 1", () => {
    const { vfs, env } = setup();
    const r = find.run({ argv: ['/nope'], name: 'find', env, vfs });
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('find: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it('a missing path errors out but the valid path is still searched', () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/nope', '/etc', '-type', 'd'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/etc\n');
    expect(r.stderr).toBe('find: /nope: No such file or directory\n');
    expect(r.exitCode).toBe(1);
  });

  it("['/etc','-type','l'] rejects symlink type", () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-type', 'l'], name: 'find', env, vfs,
    });
    expect(r.stderr).toBe('find: unsupported type: l\n');
    expect(r.exitCode).toBe(2);
  });

  it('negative maxdepth is rejected', () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-maxdepth', '-1'], name: 'find', env, vfs,
    });
    expect(r.stderr).toBe('find: invalid maxdepth: -1\n');
    expect(r.exitCode).toBe(2);
  });

  it('non-numeric maxdepth is rejected', () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-maxdepth', 'abc'], name: 'find', env, vfs,
    });
    expect(r.stderr).toBe('find: invalid maxdepth: abc\n');
    expect(r.exitCode).toBe(2);
  });

  it('unknown predicate is rejected', () => {
    const { vfs, env } = setup();
    const r = find.run({
      argv: ['/etc', '-bogus'], name: 'find', env, vfs,
    });
    expect(r.stderr).toBe('find: unknown predicate: -bogus\n');
    expect(r.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// find — cwd-relative Ausgabe
// ---------------------------------------------------------------------------

describe('find — cwd-relative Ausgabe', () => {
  it("'find . -name notes.txt' from cwd=/home/user yields './notes.txt'", () => {
    const { vfs, env } = setup();
    env.set('PWD', '/home/user');
    const r = find.run({
      argv: ['.', '-name', 'notes.txt'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('./notes.txt\n');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// find — Symlinks
// ---------------------------------------------------------------------------

describe('find — Symlinks', () => {
  it('finds a symlink by name (the link itself, not the target)', () => {
    const { vfs, env } = setup();
    vfs.createSymlink('/etc/hosts', '/home/user/hosts-link', '/');
    const r = find.run({
      argv: ['/home/user', '-name', 'hosts-link'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/home/user/hosts-link\n');
    expect(r.exitCode).toBe(0);
  });

  it('does not include a symlink under -type f', () => {
    const { vfs, env } = setup();
    vfs.createSymlink('/etc/hosts', '/home/user/hosts-link', '/');
    const r = find.run({
      argv: ['/home/user', '-type', 'f'], name: 'find', env, vfs,
    });
    expect(r.stdout.includes('hosts-link')).toBe(false);
    // Regular files still show up:
    expect(r.stdout.includes('/home/user/notes.txt')).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('does not follow a link-to-dir with -type d', () => {
    const { vfs, env } = setup();
    vfs.createSymlink('/etc', '/home/user/etc-link', '/');
    const r = find.run({
      argv: ['/home/user', '-type', 'd'], name: 'find', env, vfs,
    });
    // The link node is type 'link', not 'dir' — it is not printed…
    expect(r.stdout.includes('etc-link')).toBe(false);
    // …and its target's children are not traversed.
    expect(r.stdout.includes('etc-link/hosts')).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  it('PATH argument that is a symlink is not followed (V1 -P default)', () => {
    // `find /home/user/etc-link` where /etc-link -> /etc. V1 resolves
    // the PATH with followLinks:false, so the LINK node itself is the
    // search root: it is printed (subject to filters), but its
    // target's children are not traversed. `-P` behaviour.
    //
    // The display path uses the user's argument as written
    // (`/home/user/etc-link`), not the target path. The link's child
    // subpaths (which would be `/home/user/etc-link/hosts` etc.) are
    // never emitted because the link is not entered.
    //
    // If a future spec adds `-L` (follow all links), this test must
    // remain for the `-P` case and a new `-L` test must be added —
    // the two behaviours differ for exactly this scenario.
    const { vfs, env } = setup();
    vfs.createSymlink('/etc', '/home/user/etc-link', '/');
    const r = find.run({
      argv: ['/home/user/etc-link'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/home/user/etc-link\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('broken-link PATH argument is printed, not followed', () => {
    // Fragilste Kante der followLinks:false-Änderung: bei einem
    // BROKEN-Link als PATH-Argument unterscheidet sich die Ausgabe
    // von followLinks:true (würde ENOENT werfen) klar von
    // followLinks:false (gibt den Link-Node aus). Bei funktionierenden
    // Link-Zielen würde der Unterschied durch den Node-Typ
    // (link vs. dir/file) maskiert — aber ohne -type-Filter sieht man
    // bei einem funktionierenden -P-PATH-Link trotzdem den Link.
    //
    // Broken-Link ist der reinste Fall: der Code gibt den Link-Knoten
    // aus, prüft das Target gar nicht (weil _resolveInternal bei
    // isLast && !followLinks direkt `return child` macht, ohne das
    // Ziel aufzulösen). exit 0 — kein ENOENT.
    const { vfs, env } = setup();
    vfs.createSymlink('/nope', '/home/user/broken-link', '/');
    const r = find.run({
      argv: ['/home/user/broken-link'], name: 'find', env, vfs,
    });
    expect(r.stdout).toBe('/home/user/broken-link\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('CWD that is a symlink: find . does not traverse the target', () => {
    // CWD-symlink edge case (documented in module JSDoc): env.PWD is
    // itself a link, so `find .` resolves `.` against the link path
    // with followLinks:false → link node as root → only `.` printed,
    // no children. Consistent with -P, but non-obvious because the
    // user thinks of themselves as "in /etc".
    const { vfs, env } = setup();
    vfs.createSymlink('/etc', '/home/user/etc-link', '/');
    env.set('PWD', '/home/user/etc-link');
    const r = find.run({ argv: ['.'], name: 'find', env, vfs });
    expect(r.stdout).toBe('.\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('bare `find` (no args) in a symlink-CWD behaves like find .', () => {
    // `find` without arguments defaults `paths` to `['.']`. In a
    // symlink-CWD, that resolves to the link node (followLinks:false),
    // so bare `find` prints `.` and nothing else — same as the
    // explicit-`.` case. This test pins the default-path branch
    // (`if (paths.length === 0) paths.push('.')`) in the same
    // symlink-CWD context, so a refactor that changed the default
    // (e.g. to `'/'`) would break here without needing the explicit
    // `.` invocation.
    const { vfs, env } = setup();
    vfs.createSymlink('/etc', '/home/user/etc-link', '/');
    env.set('PWD', '/home/user/etc-link');
    const r = find.run({ argv: [], name: 'find', env, vfs });
    expect(r.stdout).toBe('.\n');
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// help — ohne Argument (spec011b)
// ---------------------------------------------------------------------------

describe('help — ohne Argument', () => {
  it('prints header and footer with the documented blank-line structure', () => {
    // Exact blank-line structure from spec011b §3.1:
    //   Header + '\n\n'  →  rows  →  '\n' + Footer + '\n'
    //
    // Both assertions require TWO consecutive '\n' — one from the end
    // of the previous row / header, one as the actual blank line.
    // A single-'\n' form (e.g. `includes('\nFür Details…')`) would
    // match EITHER with or without the blank line, because the last
    // row already ends in '\n'. Using '\n\n' forces the blank line to
    // be present, which is what the spec pins ("Abschließend eine
    // Leerzeile, dann …").
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: [], name: 'help', env, vfs, stdin: null, services,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.includes('Verfügbare Befehle:\n\n')).toBe(true);
    expect(r.stdout.includes('\n\nFür Details: help <befehl>\n')).toBe(true);
  });

  it('includes the expected set of commands (row-format-aware)', () => {
    // Row-format-aware match: the prefix `  <name><padding> ` (with
    // name right-padded to 14 chars and a trailing space) is specific
    // to a table row. `includes('help')` alone would also match the
    // footer `Für Details: help <befehl>`, and `includes('ls')` would
    // also match the substring `Details` — neither collision is
    // possible with the padded prefix. This also pins the spec §3.1
    // `padEnd(14)` width: a hypothetical `padEnd(10)` refactor would
    // fail here.
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: [], name: 'help', env, vfs, stdin: null, services,
    });
    for (const n of ['basename', 'cat', 'find', 'help', 'ls', 'pwd', 'which']) {
      expect(r.stdout.includes(`  ${n.padEnd(14)} `)).toBe(true);
    }
    expect(r.exitCode).toBe(0);
  });

  it('a known command row matches the exact spec §3.1 format', () => {
    // Full-row assertion for `cat`: `'  ' + 'cat'.padEnd(14) + ' ' +
    // 'Gibt Dateiinhalte aus.' + '\n'`. Any change to the padEnd width,
    // the column separator, or the description text breaks this test.
    // The spec §3.1 format is a contract, not a nice-to-have — it is
    // what `help` output looks like to every user.
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: [], name: 'help', env, vfs, stdin: null, services,
    });
    expect(r.stdout.includes(`  ${'cat'.padEnd(14)} Gibt Dateiinhalte aus.\n`)).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// help — mit Argument (spec011b)
// ---------------------------------------------------------------------------

describe('help — mit Argument', () => {
  it("['ls'] prints name, description and usage", () => {
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: ['ls'], name: 'help', env, vfs, services,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.includes('ls:')).toBe(true);
    expect(r.stdout.includes('Listet Verzeichnisinhalte')).toBe(true);
    expect(r.stdout.includes('Verwendung: ls')).toBe(true);
  });

  it("['pwd'] prints name and usage", () => {
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: ['pwd'], name: 'help', env, vfs, services,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.includes('pwd:')).toBe(true);
    expect(r.stdout.includes('Verwendung: pwd')).toBe(true);
  });

  it("['nope'] reports command not found", () => {
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: ['nope'], name: 'help', env, vfs, services,
    });
    expect(r.stderr).toBe('help: nope: command not found\n');
    expect(r.exitCode).toBe(1);
  });

  it("['-a'] is treated as a literal command name (no flag stripping)", () => {
    // Spec011b §3.3: `help -a` is not a flag; it is parsed as the
    // command name `-a`, which does not exist. Guards against a
    // hypothetical refactor that adds real flag parsing here.
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: ['-a'], name: 'help', env, vfs, services,
    });
    expect(r.stderr).toBe('help: -a: command not found\n');
    expect(r.exitCode).toBe(1);
  });

  it("['--all'] is treated as a literal command name (no flag stripping)", () => {
    // Companion to the `-a` test: both `-a` and `--all` must be
    // treated as literal command names, not as flags (spec011b §3.3
    // forbids flag support in V1). A hypothetical refactor that
    // routed `help` through `parseFlags` (like `head`/`tail` do)
    // would accept `--all` as a "show all with usage" flag — the
    // test catches that.
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: ['--all'], name: 'help', env, vfs, services,
    });
    expect(r.stderr).toBe('help: --all: command not found\n');
    expect(r.exitCode).toBe(1);
  });

  it("['ls', 'pwd'] processes only the first arg (extra args ignored)", () => {
    // Documented V1 behaviour in help.js module JSDoc: "first arg
    // only; extra args ignored". A hypothetical refactor to a
    // multi-arg loop would produce details for BOTH `ls` and `pwd` —
    // this test pins the single-arg contract by asserting that `pwd`'s
    // description and usage do not appear.
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: ['ls', 'pwd'], name: 'help', env, vfs, services,
    });
    expect(r.exitCode).toBe(0);
    // `ls` details are present:
    expect(r.stdout.includes('ls:')).toBe(true);
    expect(r.stdout.includes('Verwendung: ls')).toBe(true);
    // `pwd` details are absent — extra args are ignored:
    expect(r.stdout.includes('pwd:')).toBe(false);
    expect(r.stdout.includes('Verwendung: pwd')).toBe(false);
  });

  it("['--help'] is treated as a literal command name (not a universal alias)", () => {
    // `--help` is the most common "obvious" flag users expect to work
    // in any CLI — but V1 has no flags at all (spec011b §3.3). This
    // test pins that `--help` is parsed as the command name `--help`
    // and yields `command not found`, NOT the overview. A hypothetical
    // refactor that special-cased `--help` as an alias for the
    // overview would break this — and that would be a spec violation,
    // not an improvement. See help.js module JSDoc "## Flags".
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: ['--help'], name: 'help', env, vfs, services,
    });
    expect(r.stderr).toBe('help: --help: command not found\n');
    expect(r.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// help — Sortierung (spec011b §5)
// ---------------------------------------------------------------------------

describe('help — Sortierung', () => {
  it('commands are alphabetical (basename < cat < ls < pwd)', () => {
    const { vfs, env, services } = setupWithServices();
    const r = help.run({
      argv: [], name: 'help', env, vfs, stdin: null, services,
    });
    const idxBase = r.stdout.indexOf('basename');
    const idxCat = r.stdout.indexOf('cat');
    const idxLs = r.stdout.indexOf('ls');
    const idxPwd = r.stdout.indexOf('pwd');
    expect(idxBase).toBeGreaterThan(-1);
    expect(idxCat).toBeGreaterThan(idxBase);
    expect(idxLs).toBeGreaterThan(idxCat);
    expect(idxPwd).toBeGreaterThan(idxLs);
  });
});

// ---------------------------------------------------------------------------
// chown (spec014a §2)
// ---------------------------------------------------------------------------

describe('chown', () => {
  it('sets owner only (OWNER form), group unchanged', () => {
    const { vfs, env } = setup();
    vfs.createFile('/tmp/x', '/', '');
    const before = vfs.lstat('/tmp/x', '/');
    const r = chown.run({
      argv: ['user', '/tmp/x'],
      name: 'chown',
      env,
      vfs,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    const after = vfs.lstat('/tmp/x', '/');
    expect(after.owner).toBe('user');
    // before.owner is 'root' (inherited from /tmp) — this assertion
    // is not vacuous: without an actual change, `after.owner` would
    // still be 'root'.
    expect(after.group).toBe(before.group);
  });

  it('sets owner and group (OWNER:GROUP form)', () => {
    const { vfs, env } = setup();
    // Spec §4 names /etc/hosts, but its default group is already
    // 'root', which would make the group-set path trivially pass.
    // Use a fresh /tmp file and a non-default group so this test
    // actually exercises the assignment.
    vfs.createFile('/tmp/x', '/', '');
    const r = chown.run({
      argv: ['user:staff', '/tmp/x'],
      name: 'chown',
      env,
      vfs,
    });
    expect(r.exitCode).toBe(0);
    const after = vfs.lstat('/tmp/x', '/');
    expect(after.owner).toBe('user');
    expect(after.group).toBe('staff');
  });

  it('sets group only (:GROUP form), owner unchanged', () => {
    const { vfs, env } = setup();
    // Same reasoning as above: /etc/hosts is already owner='root',
    // so `:root` on /etc/hosts would not prove "owner preserved".
    // With a fresh /tmp file (owner='root' by default) and
    // group='staff', both assertions are non-vacuous.
    vfs.createFile('/tmp/x', '/', '');
    const before = vfs.lstat('/tmp/x', '/');
    expect(before.owner).toBe('root');
    const r = chown.run({
      argv: [':staff', '/tmp/x'],
      name: 'chown',
      env,
      vfs,
    });
    expect(r.exitCode).toBe(0);
    const after = vfs.lstat('/tmp/x', '/');
    expect(after.group).toBe('staff');
    expect(after.owner).toBe('root');
  });

  it('reports ENOENT for a missing file, exit 1', () => {
    const { vfs, env } = setup();
    const r = chown.run({
      argv: ['user', '/nope'],
      name: 'chown',
      env,
      vfs,
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.includes('chown: /nope: No such file or directory')).toBe(
      true,
    );
  });

  it('processes remaining files after one failure', () => {
    const { vfs, env } = setup();
    const r = chown.run({
      argv: ['user', '/nope', '/etc/hosts'],
      name: 'chown',
      env,
      vfs,
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.includes('/nope')).toBe(true);
    expect(vfs.lstat('/etc/hosts', '/').owner).toBe('user');
  });

  it('missing operand → exit 1', () => {
    const { vfs, env } = setup();
    const r = chown.run({ argv: [], name: 'chown', env, vfs });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('chown: missing operand\n');
  });

  it('missing file operand → exit 1', () => {
    const { vfs, env } = setup();
    const r = chown.run({ argv: ['user'], name: 'chown', env, vfs });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('chown: missing file operand\n');
  });

  it("rejects unknown flags with exit 2", () => {
    const { vfs, env } = setup();
    const r = chown.run({
      argv: ['-R', 'user', '/etc'],
      name: 'chown',
      env,
      vfs,
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBe("chown: invalid option -- 'R'\n");
  });

  it("'user:' form sets owner only, group unchanged (colon present, group empty)", () => {
    // Fourth valid spec form (documented in chown.js module JSDoc):
    // colon present, group field empty. The `g === ''` branch of the
    // parser must leave `group` as null so `vfs.chown` skips the
    // group assignment. A refactor that changed
    // `if (g !== '') group = g;` to `group = g;` would silently set
    // group = '' and either crash in vfs.chown's validation or null
    // out the group.
    const { vfs, env } = setup();
    vfs.createFile('/tmp/x', '/', '');
    const before = vfs.lstat('/tmp/x', '/');
    expect(before.owner).toBe('root');
    const r = chown.run({
      argv: ['user:', '/tmp/x'],
      name: 'chown',
      env,
      vfs,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe('');
    const after = vfs.lstat('/tmp/x', '/');
    expect(after.owner).toBe('user');
    expect(after.group).toBe(before.group);
  });

  it("empty spec with file operand ('' + file) is rejected as invalid spec", () => {
    // NOTE on argv shape: `argv: ['']` ALONE would hit the
    // "missing file operand" branch (argv.length === 1) BEFORE the
    // spec-parse logic runs — that is already covered by the
    // `['user']` test. To actually reach the `spec === ''` check in
    // the `colonIdx === -1` branch, we need a file operand:
    // `chown '' <file>` is the only invocation that exercises the
    // empty-spec guard.
    const { vfs, env } = setup();
    vfs.createFile('/tmp/x', '/', '');
    const r = chown.run({
      argv: ['', '/tmp/x'],
      name: 'chown',
      env,
      vfs,
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.includes('invalid spec')).toBe(true);
    // Owner must remain unchanged — the invalid-spec guard fires
    // before any vfs.chown call.
    expect(vfs.lstat('/tmp/x', '/').owner).toBe('root');
  });

  it("':' spec with file operand is rejected as invalid spec", () => {
    // Same ordering caveat as the '' test: `argv: [':']` alone hits
    // "missing file operand". With a file operand, both `o` and `g`
    // are empty (colon present, both sides empty), so the
    // `o === '' && g === ''` guard fires — the command would be a
    // no-op on every file, hence the explicit rejection.
    const { vfs, env } = setup();
    vfs.createFile('/tmp/x', '/', '');
    const r = chown.run({
      argv: [':', '/tmp/x'],
      name: 'chown',
      env,
      vfs,
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.includes('invalid spec')).toBe(true);
    expect(vfs.lstat('/tmp/x', '/').owner).toBe('root');
  });
});
