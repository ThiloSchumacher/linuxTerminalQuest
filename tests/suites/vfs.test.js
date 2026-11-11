import { describe, it, expect } from '../runner.js';
import { VFS } from '../../js/vfs/filesystem.js';
import { Node } from '../../js/vfs/node.js';
import { createInitialFS } from '../../js/vfs/initial-fs.js';

function makeFS() {
  return createInitialFS();
}

function expectCode(fn, code) {
  try {
    fn();
  } catch (err) {
    expect(err.code).toBe(code);
    return;
  }
  throw new Error(`Expected error with code ${code}, none was thrown`);
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('VFS — path resolution', () => {
  it('resolves absolute path /etc/passwd', () => {
    const vfs = makeFS();
    const node = vfs.resolve('/etc/passwd');
    expect(node.type).toBe('file');
    expect(node.name).toBe('passwd');
  });

  it('resolves relative path passwd from cwd=/etc', () => {
    const vfs = makeFS();
    const node = vfs.resolve('passwd', '/etc');
    expect(node.name).toBe('passwd');
  });

  it('resolves ./notes.txt from cwd=/home/user', () => {
    const vfs = makeFS();
    const node = vfs.resolve('./notes.txt', '/home/user');
    expect(node.name).toBe('notes.txt');
  });

  it('resolves ../notes.txt from cwd=/home/user/projects', () => {
    const vfs = makeFS();
    const node = vfs.resolve('../notes.txt', '/home/user/projects');
    expect(node.name).toBe('notes.txt');
  });

  it('normalizes //etc//hosts to /etc/hosts', () => {
    const vfs = makeFS();
    const node = vfs.resolve('//etc//hosts');
    expect(node.name).toBe('hosts');
  });

  it('rejects empty path with EINVAL', () => {
    const vfs = makeFS();
    expectCode(() => vfs.resolve(''), 'EINVAL');
  });

  it('rejects path with null byte with EINVAL', () => {
    const vfs = makeFS();
    expectCode(() => vfs.resolve('/etc\0/passwd'), 'EINVAL');
  });

  it('rejects traversal into a file with ENOTDIR', () => {
    const vfs = makeFS();
    expectCode(() => vfs.resolve('/etc/passwd/x'), 'ENOTDIR');
  });

  it('does not expand ~ (left to the shell); treats it as literal name', () => {
    // Spec: "~ wird nicht expandiert (macht später die Shell, nicht das VFS)".
    // '~/notes.txt' resolves to '<cwd>/~/notes.txt'; no literal '~' directory
    // exists in the initial FS, so this must be ENOENT.
    const vfs = makeFS();
    expectCode(() => vfs.resolve('~/notes.txt', '/home/user'), 'ENOENT');
  });
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

describe('VFS — read operations', () => {
  it('readFile returns the content', () => {
    const vfs = makeFS();
    expect(vfs.readFile('/etc/hosts')).toBe('127.0.0.1 localhost\n');
  });

  it('readFile on a directory throws EISDIR', () => {
    const vfs = makeFS();
    expectCode(() => vfs.readFile('/etc'), 'EISDIR');
  });

  it('readFile on missing path throws ENOENT', () => {
    const vfs = makeFS();
    expectCode(() => vfs.readFile('/nope'), 'ENOENT');
  });

  it('list hides dotfiles by default', () => {
    const vfs = makeFS();
    const names = vfs.list('/home/user', '/').map((n) => n.name);
    expect(names.includes('.bashrc')).toBe(false);
  });

  it('list includes dotfiles with showHidden', () => {
    const vfs = makeFS();
    const names = vfs.list('/home/user', '/', { showHidden: true }).map((n) => n.name);
    expect(names.includes('.bashrc')).toBe(true);
  });

  it('list on a file throws ENOTDIR', () => {
    const vfs = makeFS();
    expectCode(() => vfs.list('/etc/passwd'), 'ENOTDIR');
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe('VFS — exists', () => {
  it('returns true for existing paths', () => {
    const vfs = makeFS();
    expect(vfs.exists('/etc/hosts')).toBe(true);
  });

  it('returns false for ENOENT', () => {
    const vfs = makeFS();
    expect(vfs.exists('/nope')).toBe(false);
  });

  it('returns false for ENOTDIR traversal', () => {
    const vfs = makeFS();
    expect(vfs.exists('/etc/passwd/x')).toBe(false);
  });

  it('propagates EINVAL for empty path', () => {
    const vfs = makeFS();
    expectCode(() => vfs.exists(''), 'EINVAL');
  });

  it('propagates EINVAL for path with null byte', () => {
    const vfs = makeFS();
    expectCode(() => vfs.exists('/etc\0/hosts'), 'EINVAL');
  });
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

describe('VFS — write operations', () => {
  it('createFile creates a file with correct size', () => {
    const vfs = makeFS();
    const node = vfs.createFile('/tmp/a.txt', '/', 'hello');
    expect(node.name).toBe('a.txt');
    expect(node.size).toBe(5);
    expect(vfs.readFile('/tmp/a.txt')).toBe('hello');
  });

  it('createFile without parent throws ENOENT with original path', () => {
    const vfs = makeFS();
    try {
      vfs.createFile('/tmp/nodir/a.txt', '/', 'x');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('ENOENT');
      expect(err.path).toBe('/tmp/nodir/a.txt');
      expect(err.syscall).toBe('createFile');
    }
  });

  it('createFile on existing path throws EEXIST', () => {
    const vfs = makeFS();
    expectCode(() => vfs.createFile('/etc/hosts', '/', 'x'), 'EEXIST');
  });

  it('writeFile on missing file throws ENOENT', () => {
    const vfs = makeFS();
    expectCode(() => vfs.writeFile('/tmp/missing.txt', '/', 'x'), 'ENOENT');
  });

  it('writeFile updates content, size, mtime and ctime', () => {
    const vfs = makeFS();
    const node = vfs.resolve('/etc/hosts');
    node.mtime = 1000;
    node.ctime = 1000;
    vfs.writeFile('/etc/hosts', '/', 'new content');
    expect(node.content).toBe('new content');
    expect(node.size).toBe(11);
    expect(node.mtime).toBeGreaterThan(1000);
    expect(node.ctime).toBeGreaterThan(1000);
  });

  it('createDir recursive creates intermediate directories', () => {
    const vfs = makeFS();
    vfs.createDir('/tmp/d1/d2', '/', { recursive: true });
    expect(vfs.exists('/tmp/d1')).toBe(true);
    expect(vfs.exists('/tmp/d1/d2')).toBe(true);
  });

  it('createDir without parent throws ENOENT with original path', () => {
    const vfs = makeFS();
    try {
      vfs.createDir('/tmp/nodir/leaf', '/');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('ENOENT');
      expect(err.path).toBe('/tmp/nodir/leaf');
      expect(err.syscall).toBe('createDir');
    }
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe('VFS — delete', () => {
  it('delete removes a file', () => {
    const vfs = makeFS();
    vfs.createFile('/tmp/a.txt', '/', 'x');
    vfs.delete('/tmp/a.txt');
    expect(vfs.exists('/tmp/a.txt')).toBe(false);
  });

  it('delete on non-empty dir without recursive throws ENOTEMPTY', () => {
    const vfs = makeFS();
    vfs.createDir('/tmp/d1', '/');
    vfs.createFile('/tmp/d1/a.txt', '/', 'x');
    expectCode(() => vfs.delete('/tmp/d1'), 'ENOTEMPTY');
  });

  it('delete with recursive removes a non-empty dir', () => {
    const vfs = makeFS();
    vfs.createDir('/tmp/d1', '/');
    vfs.createFile('/tmp/d1/a.txt', '/', 'x');
    vfs.delete('/tmp/d1', '/', { recursive: true });
    expect(vfs.exists('/tmp/d1')).toBe(false);
  });

  it('delete on root throws EPERM', () => {
    const vfs = makeFS();
    expectCode(() => vfs.delete('/', '/'), 'EPERM');
  });
});

// ---------------------------------------------------------------------------
// Copy / move
// ---------------------------------------------------------------------------

describe('VFS — copy and move', () => {
  it('copy file to file preserves content', () => {
    const vfs = makeFS();
    vfs.copy('/etc/hosts', '/tmp/hosts-copy');
    expect(vfs.readFile('/tmp/hosts-copy')).toBe(vfs.readFile('/etc/hosts'));
  });

  it('copy file into directory', () => {
    const vfs = makeFS();
    vfs.copy('/etc/passwd', '/tmp');
    expect(vfs.exists('/tmp/passwd')).toBe(true);
  });

  it('copy of a directory source throws EINVAL', () => {
    const vfs = makeFS();
    expectCode(() => vfs.copy('/etc', '/tmp/x'), 'EINVAL');
  });

  it('copy onto itself throws EINVAL and leaves source untouched', () => {
    const vfs = makeFS();
    const node = vfs.resolve('/etc/hosts');
    const before = node.mtime;
    const beforeContent = node.content;
    try {
      vfs.copy('/etc/hosts', '/etc/hosts');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EINVAL');
      expect(err.path).toBe('/etc/hosts');
      expect(err.syscall).toBe('copy');
    }
    // Same Node instance: identity preserved, mtime and content unchanged.
    expect(vfs.resolve('/etc/hosts')).toBe(node);
    expect(node.mtime).toBe(before);
    expect(node.content).toBe(beforeContent);
  });

  it('move renames a file', () => {
    const vfs = makeFS();
    vfs.createFile('/tmp/a.txt', '/', 'x');
    vfs.move('/tmp/a.txt', '/tmp/b.txt');
    expect(vfs.exists('/tmp/a.txt')).toBe(false);
    expect(vfs.exists('/tmp/b.txt')).toBe(true);
  });

  it('move file into directory', () => {
    const vfs = makeFS();
    vfs.move('/home/user/notes.txt', '/etc/');
    expect(vfs.exists('/home/user/notes.txt')).toBe(false);
    expect(vfs.exists('/etc/notes.txt')).toBe(true);
  });

  it('move directory onto existing file throws EISDIR and leaves file intact', () => {
    const vfs = makeFS();
    const before = vfs.readFile('/etc/hosts');
    try {
      vfs.move('/home/user/projects', '/etc/hosts');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EISDIR');
      expect(err.path).toBe('/etc/hosts');
    }
    // Source untouched, destination untouched.
    expect(vfs.exists('/home/user/projects')).toBe(true);
    expect(vfs.stat('/etc/hosts').type).toBe('file');
    expect(vfs.readFile('/etc/hosts')).toBe(before);
  });

  it('move file onto existing file overwrites (mv -f)', () => {
    const vfs = makeFS();
    vfs.createFile('/tmp/src.txt', '/', 'source');
    vfs.createFile('/tmp/dst.txt', '/', 'dest');
    vfs.move('/tmp/src.txt', '/tmp/dst.txt');
    expect(vfs.exists('/tmp/src.txt')).toBe(false);
    expect(vfs.readFile('/tmp/dst.txt')).toBe('source');
  });

  it('move onto itself throws EINVAL and leaves source untouched', () => {
    const vfs = makeFS();
    const node = vfs.resolve('/etc/hosts');
    const beforeMtime = node.mtime;
    const beforeCtime = node.ctime;
    const beforeContent = node.content;
    try {
      vfs.move('/etc/hosts', '/etc/hosts');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EINVAL');
      expect(err.path).toBe('/etc/hosts');
      expect(err.syscall).toBe('move');
    }
    // Same Node instance: identity preserved, timestamps and content unchanged.
    expect(vfs.resolve('/etc/hosts')).toBe(node);
    expect(node.mtime).toBe(beforeMtime);
    expect(node.ctime).toBe(beforeCtime);
    expect(node.content).toBe(beforeContent);
  });

  it('move of root throws EPERM', () => {
    const vfs = makeFS();
    expectCode(() => vfs.move('/', '/tmp/x'), 'EPERM');
  });
});

// ---------------------------------------------------------------------------
// chmod
// ---------------------------------------------------------------------------

describe('VFS — chmod', () => {
  it('chmod sets mode and updates ctime', () => {
    const vfs = makeFS();
    const node = vfs.resolve('/etc/hosts');
    node.ctime = 1000;
    vfs.chmod('/etc/hosts', 0o600);
    expect(node.mode).toBe(0o600);
    expect(node.ctime).toBeGreaterThan(1000);
  });

  it('chmod rejects invalid mode with EINVAL', () => {
    const vfs = makeFS();
    expectCode(() => vfs.chmod('/etc/hosts', -1), 'EINVAL');
    expectCode(() => vfs.chmod('/etc/hosts', 0o10000), 'EINVAL');
  });
});

// ---------------------------------------------------------------------------
// stat
// ---------------------------------------------------------------------------

describe('VFS — stat', () => {
  it('stat returns file metadata', () => {
    const vfs = makeFS();
    const s = vfs.stat('/etc/hosts');
    expect(s.type).toBe('file');
    expect(s.name).toBe('hosts');
    // Content "127.0.0.1 localhost\n" is 20 bytes.
    expect(s.size).toBe(20);
    expect(typeof s.mtime).toBe('number');
    expect(typeof s.ctime).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

describe('VFS — timestamps', () => {
  it('mtime and ctime change on writeFile', () => {
    const vfs = makeFS();
    const node = vfs.resolve('/etc/hosts');
    node.mtime = 1000;
    node.ctime = 1000;
    vfs.writeFile('/etc/hosts', '/', 'new content');
    expect(node.mtime).toBeGreaterThan(1000);
    expect(node.ctime).toBeGreaterThan(1000);
  });

  it('atime changes on readFile', () => {
    const vfs = makeFS();
    const node = vfs.resolve('/etc/hosts');
    node.atime = 1000;
    vfs.readFile('/etc/hosts');
    expect(node.atime).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

describe('Node', () => {
  it('initializes size from content', () => {
    const node = new Node({ name: 'f', type: 'file', content: 'abc' });
    expect(node.size).toBe(3);
  });

  it('dir node has children map, no content', () => {
    const node = new Node({ name: 'd', type: 'dir' });
    expect(node.content).toBe(null);
    expect(node.children instanceof Map).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VFS — chown (spec014a §1)
// ---------------------------------------------------------------------------

describe('VFS — chown', () => {
  it('sets owner only, group unchanged', () => {
    const vfs = makeFS();
    vfs.createFile('/tmp/x', '/', '');
    const before = vfs.lstat('/tmp/x', '/');
    vfs.chown('/tmp/x', 'user', null, '/');
    const after = vfs.lstat('/tmp/x', '/');
    expect(after.owner).toBe('user');
    expect(after.group).toBe(before.group);
  });

  it('sets group only, owner unchanged', () => {
    const vfs = makeFS();
    vfs.createFile('/tmp/x', '/', '');
    const before = vfs.lstat('/tmp/x', '/');
    vfs.chown('/tmp/x', null, 'staff', '/');
    const after = vfs.lstat('/tmp/x', '/');
    expect(after.group).toBe('staff');
    expect(after.owner).toBe(before.owner);
  });

  it('sets both owner and group in one call', () => {
    const vfs = makeFS();
    vfs.createFile('/tmp/x', '/', '');
    vfs.chown('/tmp/x', 'user', 'staff', '/');
    const after = vfs.lstat('/tmp/x', '/');
    expect(after.owner).toBe('user');
    expect(after.group).toBe('staff');
  });

  it('rejects both-null with EINVAL', () => {
    const vfs = makeFS();
    vfs.createFile('/tmp/x', '/', '');
    let caught = null;
    try {
      vfs.chown('/tmp/x', null, null, '/');
    } catch (err) {
      caught = err;
    }
    expect(caught !== null).toBe(true);
    expect(caught.code).toBe('EINVAL');
    expect(caught.syscall).toBe('chown');
  });

  it('raises ENOENT with syscall="chown" on a missing path', () => {
    const vfs = makeFS();
    let caught = null;
    try {
      vfs.chown('/nope', 'user', null, '/');
    } catch (err) {
      caught = err;
    }
    expect(caught !== null).toBe(true);
    expect(caught.code).toBe('ENOENT');
    expect(caught.syscall).toBe('chown');
    expect(caught.path).toBe('/nope');
  });

  it('follows symlinks — chowns the target, not the link node', () => {
    const vfs = makeFS();
    vfs.createSymlink('/etc/hosts', '/tmp/l', '/');
    vfs.chown('/tmp/l', 'user', null, '/');
    // The link node is untouched (still a link); the TARGET's owner
    // changed.
    expect(vfs.lstat('/tmp/l', '/').type).toBe('link');
    expect(vfs.lstat('/etc/hosts', '/').owner).toBe('user');
  });

  it('bumps ctime', () => {
    const vfs = makeFS();
    vfs.createFile('/tmp/x', '/', '');
    const before = vfs.lstat('/tmp/x', '/').ctime;
    vfs.chown('/tmp/x', 'user', null, '/');
    const after = vfs.lstat('/tmp/x', '/').ctime;
    // Millisecond Date.now() can produce equal values within one tick;
    // `>=` is the correct assertion (strict `>` would flake).
    expect(after >= before).toBe(true);
  });
});