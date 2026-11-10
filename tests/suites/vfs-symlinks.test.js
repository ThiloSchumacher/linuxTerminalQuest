import { describe, it, expect } from '../runner.js';
import { createInitialFS } from '../../js/vfs/initial-fs.js';
import { serializeVFS, deserializeVFS } from '../../js/vfs/serialize.js';

/**
 * Assert that `fn` throws an Error with `.code === code`. Optionally
 * also assert the message contains a substring.
 *
 * @param {() => void} fn
 * @param {string} code
 * @param {string} [messageContains]
 * @returns {Error}
 */
function expectCode(fn, code, messageContains) {
  try {
    fn();
  } catch (err) {
    expect(err.code).toBe(code);
    if (messageContains !== undefined) {
      expect(err.message.includes(messageContains)).toBe(true);
    }
    return err;
  }
  throw new Error(`Expected error with code ${code}, none was thrown`);
}

// ---------------------------------------------------------------------------
// createSymlink
// ---------------------------------------------------------------------------

describe('VFS — createSymlink', () => {
  it('creates a symlink and readlink returns the target', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    expect(vfs.readlink('/tmp/h', '/')).toBe('/etc/hosts');
  });

  it('rejects an existing path with EEXIST', () => {
    const vfs = createInitialFS();
    expectCode(() => vfs.createSymlink('/x', '/etc/hosts', '/'), 'EEXIST');
  });

  it('rejects a missing parent with ENOENT', () => {
    const vfs = createInitialFS();
    expectCode(() => vfs.createSymlink('/x', '/nope/link', '/'), 'ENOENT');
  });

  it('allows a broken target (POSIX ln -s)', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/nope/target', '/tmp/broken', '/');
    expect(vfs.readlink('/tmp/broken', '/')).toBe('/nope/target');
    // The broken link itself is accessible via lstat:
    expect(vfs.lstat('/tmp/broken', '/').type).toBe('link');
  });

  it('sets mode 0o777 on the link', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    expect(vfs.lstat('/tmp/h', '/').mode).toBe(0o777);
  });

  it('sets size = target.length', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    expect(vfs.lstat('/tmp/h', '/').size).toBe('/etc/hosts'.length);
  });
});

// ---------------------------------------------------------------------------
// stat follows, lstat does not
// ---------------------------------------------------------------------------

describe('VFS — stat folgt, lstat folgt nicht', () => {
  it('stat resolves to the target type; lstat reports the link', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    expect(vfs.stat('/tmp/h', '/').type).toBe('file');
    expect(vfs.lstat('/tmp/h', '/').type).toBe('link');
  });

  it('stat returns the target size; lstat returns the link size', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    expect(vfs.stat('/tmp/h', '/').size).toBe(vfs.stat('/etc/hosts', '/').size);
    expect(vfs.lstat('/tmp/h', '/').size).toBe('/etc/hosts'.length);
  });

  it('lstat target field is the raw target string', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    // Node returned by resolve(followLinks:false) carries `.target`:
    const node = vfs.resolve('/tmp/h', '/', { followLinks: false });
    expect(node.target).toBe('/etc/hosts');
  });

  it('stat on a link to a directory reports type "dir"', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc', '/tmp/etclink', '/');
    expect(vfs.stat('/tmp/etclink', '/').type).toBe('dir');
    expect(vfs.lstat('/tmp/etclink', '/').type).toBe('link');
  });
});

// ---------------------------------------------------------------------------
// readFile follows
// ---------------------------------------------------------------------------

describe('VFS — readFile folgt', () => {
  it('reads the target file content', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    expect(vfs.readFile('/tmp/h', '/')).toBe(vfs.readFile('/etc/hosts', '/'));
  });

  it('broken link → ENOENT', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/nope', '/tmp/b', '/');
    expectCode(() => vfs.readFile('/tmp/b', '/'), 'ENOENT');
  });
});

// ---------------------------------------------------------------------------
// list follows
// ---------------------------------------------------------------------------

describe('VFS — list folgt', () => {
  it('lists the target directory of a link', () => {
    const vfs = createInitialFS();
    vfs.createDir('/tmp/d1', '/');
    vfs.createFile('/tmp/d1/x', '/', '');
    vfs.createSymlink('/tmp/d1', '/tmp/dl', '/');
    const names = vfs.list('/tmp/dl', '/').map((n) => n.name);
    expect(names.includes('x')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readlink
// ---------------------------------------------------------------------------

describe('VFS — readlink', () => {
  it('returns the target string', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    expect(vfs.readlink('/tmp/h', '/')).toBe('/etc/hosts');
  });

  it('rejects a non-link with EINVAL', () => {
    const vfs = createInitialFS();
    expectCode(() => vfs.readlink('/etc/hosts', '/'), 'EINVAL');
  });

  it('works on a broken link (returns the target)', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/nope', '/tmp/b', '/');
    expect(vfs.readlink('/tmp/b', '/')).toBe('/nope');
  });
});

// ---------------------------------------------------------------------------
// ELOOP
// ---------------------------------------------------------------------------

describe('VFS — ELOOP', () => {
  it('two-link loop → ELOOP with the documented message', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/tmp/b', '/tmp/a', '/');
    vfs.createSymlink('/tmp/a', '/tmp/b', '/');
    expectCode(
      () => vfs.stat('/tmp/a', '/'),
      'ELOOP',
      'too many levels of symbolic links',
    );
  });

  it('self-referential link → ELOOP', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/tmp/s', '/tmp/s', '/');
    expectCode(() => vfs.stat('/tmp/s', '/'), 'ELOOP');
  });

  it('41-link chain → ELOOP', () => {
    const vfs = createInitialFS();
    // l0 -> l1 -> ... -> l40 -> /etc/hosts
    // 41 links in the chain, 41 follows needed → exceeds 40.
    for (let i = 0; i < 40; i++) {
      vfs.createSymlink(`/tmp/l${i + 1}`, `/tmp/l${i}`, '/');
    }
    vfs.createSymlink('/etc/hosts', '/tmp/l40', '/');
    expectCode(() => vfs.stat('/tmp/l0', '/'), 'ELOOP');
  });

  it('40-link chain resolves fine (boundary case)', () => {
    const vfs = createInitialFS();
    // l0 -> l1 -> ... -> l39 -> /etc/hosts
    // 40 links, 40 follows needed → exactly at the limit → OK.
    for (let i = 0; i < 39; i++) {
      vfs.createSymlink(`/tmp/l${i + 1}`, `/tmp/l${i}`, '/');
    }
    vfs.createSymlink('/etc/hosts', '/tmp/l39', '/');
    expect(vfs.readFile('/tmp/l0', '/')).toBe(
      vfs.readFile('/etc/hosts', '/'),
    );
  });

  it('exists() returns false on ELOOP', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/tmp/b', '/tmp/a', '/');
    vfs.createSymlink('/tmp/a', '/tmp/b', '/');
    expect(vfs.exists('/tmp/a', '/')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// delete/move do not follow
// ---------------------------------------------------------------------------

describe('VFS — delete/move folgen nicht', () => {
  it('delete removes the link, not the target', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    vfs.delete('/tmp/h', '/');
    expect(vfs.exists('/etc/hosts', '/')).toBe(true);
    expect(vfs.exists('/tmp/h', '/')).toBe(false);
  });

  it('delete with recursive on link-to-dir removes only the link', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc', '/tmp/etclink', '/');
    vfs.delete('/tmp/etclink', '/', { recursive: true });
    expect(vfs.exists('/etc', '/')).toBe(true);
    expect(vfs.exists('/etc/passwd', '/')).toBe(true);
    expect(vfs.exists('/tmp/etclink', '/')).toBe(false);
  });

  it('move renames the link, target stays', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    vfs.move('/tmp/h', '/tmp/h2', '/');
    expect(vfs.exists('/tmp/h', '/')).toBe(false);
    expect(vfs.lstat('/tmp/h2', '/').type).toBe('link');
    expect(vfs.readlink('/tmp/h2', '/')).toBe('/etc/hosts');
    expect(vfs.readFile('/etc/hosts', '/')).toBe('127.0.0.1 localhost\n');
  });
});

// ---------------------------------------------------------------------------
// createFile/createDir do not follow
// ---------------------------------------------------------------------------

describe('VFS — createFile/createDir folgen nicht', () => {
  it('createFile at an existing link path → EEXIST (does not enter target dir)', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc', '/tmp/etclink', '/');
    expectCode(() => vfs.createFile('/tmp/etclink', '/', ''), 'EEXIST');
    // The link was not replaced:
    expect(vfs.lstat('/tmp/etclink', '/').type).toBe('link');
  });

  it('createDir at an existing link path → EEXIST', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc', '/tmp/etclink', '/');
    expectCode(() => vfs.createDir('/tmp/etclink', '/'), 'EEXIST');
  });
});

// ---------------------------------------------------------------------------
// writeFile/chmod follow
// ---------------------------------------------------------------------------

describe('VFS — writeFile/chmod folgen', () => {
  it('writeFile on a link writes into the target', () => {
    const vfs = createInitialFS();
    vfs.createFile('/tmp/f', '/', 'old');
    vfs.createSymlink('/tmp/f', '/tmp/l', '/');
    vfs.writeFile('/tmp/l', '/', 'neu');
    expect(vfs.readFile('/tmp/f', '/')).toBe('neu');
    // Link unchanged:
    expect(vfs.lstat('/tmp/l', '/').type).toBe('link');
  });

  it('chmod on a link changes the target mode', () => {
    const vfs = createInitialFS();
    vfs.createFile('/tmp/f', '/', '');
    vfs.createSymlink('/tmp/f', '/tmp/l', '/');
    vfs.chmod('/tmp/l', 0o600, '/');
    expect(vfs.lstat('/tmp/f', '/').mode).toBe(0o600);
    // Link mode stays 0o777:
    expect(vfs.lstat('/tmp/l', '/').mode).toBe(0o777);
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

describe('VFS — Serialisierung', () => {
  it('a link survives serialize/deserialize with target intact', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');

    const restored = deserializeVFS(serializeVFS(vfs));
    expect(restored.readlink('/tmp/h', '/')).toBe('/etc/hosts');
    expect(restored.lstat('/tmp/h', '/').type).toBe('link');
  });

  it('stat on a link still resolves to the target after deserialize', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    const restored = deserializeVFS(serializeVFS(vfs));
    expect(restored.stat('/tmp/h', '/').type).toBe('file');
    expect(restored.readFile('/tmp/h', '/')).toBe('127.0.0.1 localhost\n');
  });

  it('lstat().size survives round-trip (link size = target.length)', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/etc/hosts', '/tmp/h', '/');
    const restored = deserializeVFS(serializeVFS(vfs));
    expect(restored.lstat('/tmp/h', '/').size).toBe('/etc/hosts'.length);
  });
});

// ---------------------------------------------------------------------------
// Relative symlink targets (spec008a §3.1)
// ---------------------------------------------------------------------------

describe('VFS — relative Symlink-Ziele', () => {
  it('resolves a relative target against the LINK\'s directory, not cwd', () => {
    // `ln -s rel-target /tmp/link` means the target is '/tmp/rel-target'
    // — relative to the link's directory (/tmp), NOT to cwd. A naive
    // implementation resolving against cwd would fail to find the
    // target when cwd !== /tmp.
    const vfs = createInitialFS();
    vfs.createFile('/tmp/rel-target', '/', 'rel-content');
    vfs.createSymlink('rel-target', '/tmp/link', '/');
    // cwd is explicit and different from /tmp:
    expect(vfs.readFile('/tmp/link', '/home/user')).toBe('rel-content');
  });

  it('resolves a "../" relative target', () => {
    // `ln -s ../etc/hosts /tmp/sub/link` → target is '/tmp/etc/hosts'.
    // Here we place the link in /home/user and point at ../etc/hosts,
    // which resolves to /etc/hosts... wait: /home/user/../etc/hosts
    // is /home/etc/hosts. So use a link in /tmp pointing at ../etc,
    // which is /etc. Simpler and unambiguous.
    const vfs = createInitialFS();
    vfs.createSymlink('../etc/hosts', '/tmp/link-to-parent-hosts', '/');
    expect(vfs.readFile('/tmp/link-to-parent-hosts', '/')).toBe(
      '127.0.0.1 localhost\n',
    );
  });

  it('a relative target in a SUBDIRECTORY resolves against that subdirectory', () => {
    // `ln -s rel /tmp/sub/link` → target is '/tmp/sub/rel'.
    // A wrong implementation that used cwd for the base would resolve
    // 'rel' against cwd (e.g. '/home/user/rel'), which doesn't exist →
    // ENOENT. So this test fails loudly on that bug.
    const vfs = createInitialFS();
    vfs.createDir('/tmp/sub', '/');
    vfs.createFile('/tmp/sub/rel', '/', 'in-subdir');
    vfs.createSymlink('rel', '/tmp/sub/link', '/');
    expect(vfs.readFile('/tmp/sub/link', '/')).toBe('in-subdir');
  });
});

// ---------------------------------------------------------------------------
// Move — same-file check via link (both directions, spec008a §3.14)
// ---------------------------------------------------------------------------

describe('VFS — move same-file via link (both directions)', () => {
  it('mv /A /link-to-A → EINVAL (dest resolves to src)', () => {
    const vfs = createInitialFS();
    vfs.createFile('/tmp/A', '/', 'x');
    vfs.createSymlink('/tmp/A', '/tmp/link-to-A', '/');
    expectCode(() => vfs.move('/tmp/A', '/tmp/link-to-A', '/'), 'EINVAL');
    // Neither /tmp/A nor /tmp/link-to-A was disturbed:
    expect(vfs.readFile('/tmp/A', '/')).toBe('x');
    expect(vfs.lstat('/tmp/link-to-A', '/').type).toBe('link');
  });

  it('mv /link-to-A /A → EINVAL (reverse direction, prevents self-referential link)', () => {
    // Without the reverse-direction check, this would replace /tmp/A
    // with a link pointing at /tmp/A → self-referential → ELOOP on
    // every subsequent read. POSIX `mv` rejects it as "same file".
    const vfs = createInitialFS();
    vfs.createFile('/tmp/A', '/', 'x');
    vfs.createSymlink('/tmp/A', '/tmp/link-to-A', '/');
    expectCode(() => vfs.move('/tmp/link-to-A', '/tmp/A', '/'), 'EINVAL');
    // Both nodes still in their original state:
    expect(vfs.readFile('/tmp/A', '/')).toBe('x');
    expect(vfs.lstat('/tmp/link-to-A', '/').type).toBe('link');
  });

  it('mv /link-to-A /link-to-B (different targets) is allowed', () => {
    // Control: the reverse-direction check must not over-reject. Two
    // links with DIFFERENT targets are not "same file" — the move
    // should proceed (link node is moved, both targets untouched).
    const vfs = createInitialFS();
    vfs.createFile('/tmp/A', '/', 'a');
    vfs.createFile('/tmp/B', '/', 'b');
    vfs.createSymlink('/tmp/A', '/tmp/link-to-A', '/');
    vfs.createSymlink('/tmp/B', '/tmp/link-to-B', '/');
    vfs.move('/tmp/link-to-A', '/tmp/link-to-B', '/');
    expect(vfs.lstat('/tmp/link-to-B', '/').type).toBe('link');
    expect(vfs.readlink('/tmp/link-to-B', '/')).toBe('/tmp/A');
    // Both target files intact:
    expect(vfs.readFile('/tmp/A', '/')).toBe('a');
    expect(vfs.readFile('/tmp/B', '/')).toBe('b');
  });

  it('mv /link-to-A /link-to-A (exact same path) → EINVAL', () => {
    const vfs = createInitialFS();
    vfs.createFile('/tmp/A', '/', 'x');
    vfs.createSymlink('/tmp/A', '/tmp/link-to-A', '/');
    expectCode(() => vfs.move('/tmp/link-to-A', '/tmp/link-to-A', '/'), 'EINVAL');
  });
});

// ---------------------------------------------------------------------------
// Move — same-file detection via link (spec008a Patch 1 §3.14)
// ---------------------------------------------------------------------------

describe('VFS — move Same-file mit Links', () => {
  it('mv /A /link-to-A → EINVAL with .path=src and message "same file"', () => {
    // dest (link-to-A) resolves to the SAME node as src (A). Both
    // directions of the same-file check must fire — this is the
    // direction where the LINK is on `dest`.
    const vfs = createInitialFS();
    vfs.createFile('/tmp/A', '/', 'x');
    vfs.createSymlink('/tmp/A', '/tmp/link-to-A', '/');
    try {
      vfs.move('/tmp/A', '/tmp/link-to-A', '/');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EINVAL');
      // Patch 1 §3.14: path is the SRC path, message is 'same file'.
      expect(err.path).toBe('/tmp/A');
      expect(err.message.includes('same file')).toBe(true);
    }
    // Both nodes untouched:
    expect(vfs.readFile('/tmp/A', '/')).toBe('x');
    expect(vfs.lstat('/tmp/link-to-A', '/').type).toBe('link');
  });

  it('mv /link-to-A /A → EINVAL (reverse direction, prevents self-referential link)', () => {
    // This is the dangerous direction: without the check, /A would be
    // replaced by a link pointing at /A → self-referential link →
    // ELOOP on every read. POSIX `mv` rejects it as "same file".
    const vfs = createInitialFS();
    vfs.createFile('/tmp/A', '/', 'x');
    vfs.createSymlink('/tmp/A', '/tmp/link-to-A', '/');
    try {
      vfs.move('/tmp/link-to-A', '/tmp/A', '/');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EINVAL');
      expect(err.path).toBe('/tmp/link-to-A');
      expect(err.message.includes('same file')).toBe(true);
    }
    expect(vfs.readFile('/tmp/A', '/')).toBe('x');
    expect(vfs.lstat('/tmp/link-to-A', '/').type).toBe('link');
  });

  it('mv /link-to-A /link-to-A (exact same path) → EINVAL', () => {
    const vfs = createInitialFS();
    vfs.createFile('/tmp/A', '/', 'x');
    vfs.createSymlink('/tmp/A', '/tmp/link-to-A', '/');
    expectCode(() => vfs.move('/tmp/link-to-A', '/tmp/link-to-A', '/'), 'EINVAL');
  });

  it('mv /link-to-A /link-to-B (different targets) → OK', () => {
    // Control: the symmetric same-file check must NOT over-reject.
    // Two links with DIFFERENT targets are not "same file" — the move
    // proceeds (link node is moved, both targets untouched).
    const vfs = createInitialFS();
    vfs.createFile('/tmp/A', '/', 'a');
    vfs.createFile('/tmp/B', '/', 'b');
    vfs.createSymlink('/tmp/A', '/tmp/link-to-A', '/');
    vfs.createSymlink('/tmp/B', '/tmp/link-to-B', '/');
    vfs.move('/tmp/link-to-A', '/tmp/link-to-B', '/');
    expect(vfs.lstat('/tmp/link-to-B', '/').type).toBe('link');
    expect(vfs.readlink('/tmp/link-to-B', '/')).toBe('/tmp/A');
    expect(vfs.readFile('/tmp/A', '/')).toBe('a');
    expect(vfs.readFile('/tmp/B', '/')).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// Copy — same-file detection via link (spec008a Patch 1 §3.15)
// ---------------------------------------------------------------------------

describe('VFS — copy Same-file mit Links', () => {
  it('cp /link-to-X /X → EINVAL with .path=src and message "same file"', () => {
    // src (link-to-X) follows to X; dest (X) is X. Same resolved node.
    const vfs = createInitialFS();
    vfs.createFile('/tmp/x', '/', 'a');
    vfs.createSymlink('/tmp/x', '/tmp/lx', '/');
    try {
      vfs.copy('/tmp/lx', '/tmp/x', '/');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EINVAL');
      expect(err.path).toBe('/tmp/lx'); // src, not dest
      expect(err.message.includes('same file')).toBe(true);
    }
    // Source file untouched:
    expect(vfs.readFile('/tmp/x', '/')).toBe('a');
    // Link still a link:
    expect(vfs.lstat('/tmp/lx', '/').type).toBe('link');
  });

  it('cp /X /link-to-X → EINVAL (both directions)', () => {
    const vfs = createInitialFS();
    vfs.createFile('/tmp/x', '/', 'a');
    vfs.createSymlink('/tmp/x', '/tmp/lx', '/');
    try {
      vfs.copy('/tmp/x', '/tmp/lx', '/');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EINVAL');
      expect(err.path).toBe('/tmp/x');
      expect(err.message.includes('same file')).toBe(true);
    }
    expect(vfs.readFile('/tmp/x', '/')).toBe('a');

  it('cp /a /parent-of-a replaces the child with a copy of itself (V1 divergence from GNU cp)', () => {
    // Second V1 divergence from GNU cp in the "copy into a directory"
    // branch: when `dest` is the parent directory of `src`, the child
    // at `basename(src)` IS the source node. GNU cp would `stat` the
    // resolved child, see it equals src, and error as "same file".
    // V1 does not check this (the early same-file check compares
    // `dest` itself with `srcNode`, not a child), so the child is
    // replaced by a copy of itself: same content, NEW node.
    //
    // This test pins the V1 behaviour so a future change either
    // implements GNU semantics or documents a different resolution.
    const vfs = createInitialFS();
    vfs.createDir('/tmp/parent-of-a', '/');
    vfs.createFile('/tmp/parent-of-a/a', '/', 'content');

    // Sanity: the child exists before the copy.
    expect(vfs.exists('/tmp/parent-of-a/a', '/')).toBe(true);
    const originalChild = vfs.resolve(
      '/tmp/parent-of-a/a',
      '/',
      { followLinks: false },
    );
    // Pin the pre-copy content of the source node, so a failure of the
    // "newChild === originalChild" assertion below has an unambiguous
    // diagnosis: either the source node was mis-resolved (content
    // wrong), or the source node was replaced (identity wrong).
    expect(originalChild.content).toBe('content');

    vfs.copy('/tmp/parent-of-a/a', '/tmp/parent-of-a', '/');

    // Child still exists, still a regular file, content unchanged.
    expect(vfs.exists('/tmp/parent-of-a/a', '/')).toBe(true);
    expect(vfs.lstat('/tmp/parent-of-a/a', '/').type).toBe('file');
    expect(vfs.readFile('/tmp/parent-of-a/a', '/')).toBe('content');

    // It IS a new node (copy of itself) — the source node was replaced
    // in the parent's children map by a fresh Node instance.
    const newChild = vfs.resolve(
      '/tmp/parent-of-a/a',
      '/',
      { followLinks: false },
    );
    expect(newChild === originalChild).toBe(false);
  });
  });

  it('cp /lx /ly (different targets) → OK, ly is a regular file with copied content', () => {
    // Control: two links with DIFFERENT targets — the copy follows
    // src → copies the target's content; dest (ly) is a link-to-file,
    // so the copy is written INTO its target, not into ly itself.
    const vfs = createInitialFS();
    vfs.createFile('/tmp/x', '/', 'a');
    vfs.createFile('/tmp/y', '/', 'b');
    vfs.createSymlink('/tmp/x', '/tmp/lx', '/');
    vfs.createSymlink('/tmp/y', '/tmp/ly', '/');
    vfs.copy('/tmp/lx', '/tmp/ly', '/');
    // dest link stays a link, target content was overwritten:
    expect(vfs.lstat('/tmp/ly', '/').type).toBe('link');
    expect(vfs.readFile('/tmp/y', '/')).toBe('a');
    // src target untouched:
    expect(vfs.readFile('/tmp/x', '/')).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// _tryResolve / ELOOP interaction (spec008a Patch 1 §_tryResolve)
// ---------------------------------------------------------------------------

describe('VFS — _tryResolve/ELOOP-Interaktion', () => {
  it('move /etc/hosts /tmp/a (circular dest) → ELOOP, not ENOENT', () => {
    // If _tryResolve swallowed ELOOP and returned null, `move` would
    // fall into the "dest does not exist" branch and try to rename
    // src to /tmp/a — which would be a weird silent success on a
    // broken destination. The patch requires ELOOP to propagate so
    // the caller sees the real problem.
    const vfs = createInitialFS();
    vfs.createSymlink('/tmp/b', '/tmp/a', '/');
    vfs.createSymlink('/tmp/a', '/tmp/b', '/');
    expectCode(() => vfs.move('/etc/hosts', '/tmp/a', '/'), 'ELOOP');
    // /etc/hosts untouched:
    expect(vfs.readFile('/etc/hosts', '/')).toBe('127.0.0.1 localhost\n');
  });

  it('copy /etc/hosts /tmp/a (circular dest) → ELOOP, not ENOENT', () => {
    const vfs = createInitialFS();
    vfs.createSymlink('/tmp/b', '/tmp/a', '/');
    vfs.createSymlink('/tmp/a', '/tmp/b', '/');
    expectCode(() => vfs.copy('/etc/hosts', '/tmp/a', '/'), 'ELOOP');
  });

  it('exists(/tmp/a) on a circular dest → false (exists is a reachability test)', () => {
    // exists() maps ELOOP to false — it answers "can the user reach
    // this path?", and a loop is unreachable. _tryResolve, by
    // contrast, is a "does this node exist for internal logic?"
    // helper and propagates ELOOP so callers (move/copy) can
    // differentiate. The two behaviours are deliberately different.
    const vfs = createInitialFS();
    vfs.createSymlink('/tmp/b', '/tmp/a', '/');
    vfs.createSymlink('/tmp/a', '/tmp/b', '/');
    expect(vfs.exists('/tmp/a', '/')).toBe(false);
  });

  it('cp /a /dir with /dir/a → /a replaces the symlink (V1 divergence from GNU cp)', () => {
    // Copy into a directory whose child at `basename(src)` is a symlink
    // to src. GNU `cp` (without -P) would follow the child symlink and
    // error as "same file". V1 replaces the child symlink with a real
    // file — the "copy into a directory replaces the child" rule wins.
    // Documented V1 divergence in the copy() JSDoc; this test pins it
    // so a future change (either implementing GNU semantics or
    // documenting a different edge case) surfaces immediately.
    const vfs = createInitialFS();
    vfs.createFile('/tmp/a', '/', 'content');
    vfs.createDir('/tmp/dir', '/');
    vfs.createSymlink('/tmp/a', '/tmp/dir/a', '/');

    vfs.copy('/tmp/a', '/tmp/dir', '/');

    // The child at /tmp/dir/a is now a REGULAR FILE (link replaced):
    expect(vfs.lstat('/tmp/dir/a', '/').type).toBe('file');
    expect(vfs.readFile('/tmp/dir/a', '/')).toBe('content');
    // The original src and its target are untouched:
    expect(vfs.readFile('/tmp/a', '/')).toBe('content');
  });
});