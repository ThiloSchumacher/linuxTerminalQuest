import { describe, it, expect } from '../runner.js';
import { createInitialFS } from '../../js/vfs/initial-fs.js';
import { serializeVFS, deserializeVFS } from '../../js/vfs/serialize.js';

/**
 * Recursively check whether a serialized tree contains a `size` field
 * anywhere. The spec explicitly forbids `size` in the JSON format.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function hasSizeField(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasSizeField);
  if (Object.prototype.hasOwnProperty.call(value, 'size')) return true;
  return Object.values(value).some(hasSizeField);
}

/**
 * Assert that `fn` throws EINVAL; optionally also assert `.path`
 * contains a substring.
 *
 * @param {() => void} fn
 * @param {string} [pathContains]
 * @returns {Error}
 */
function expectEINVAL(fn, pathContains) {
  try {
    fn();
  } catch (err) {
    expect(err.code).toBe('EINVAL');
    if (pathContains !== undefined) {
      expect(typeof err.path).toBe('string');
      expect(err.path.includes(pathContains)).toBe(true);
    }
    return err;
  }
  throw new Error('expected EINVAL, none was thrown');
}

// ---------------------------------------------------------------------------
// Roundtrip
// ---------------------------------------------------------------------------

describe('serializeVFS + deserializeVFS — Roundtrip', () => {
  it('serialize → deserialize → serialize is a fixed point', () => {
    const json1 = serializeVFS(createInitialFS());
    const json2 = serializeVFS(deserializeVFS(json1));
    expect(json2).toEqual(json1);
  });

  it('root node has name "/", type "dir", children array', () => {
    const json = serializeVFS(createInitialFS());
    expect(json.root.name).toBe('/');
    expect(json.root.type).toBe('dir');
    expect(Array.isArray(json.root.children)).toBe(true);
    expect(json.root.children.length).toBeGreaterThan(0);
  });

  it('root children include bin, etc, home, tmp, var', () => {
    const json = serializeVFS(createInitialFS());
    const names = json.root.children.map((c) => c.name);
    for (const expected of ['bin', 'etc', 'home', 'tmp', 'var']) {
      expect(names.includes(expected)).toBe(true);
    }
  });

  it('/etc/passwd has content, mode 0o644, and no size field', () => {
    const json = serializeVFS(createInitialFS());
    const etc = json.root.children.find((c) => c.name === 'etc');
    expect(etc).toBeTruthy();
    const passwd = etc.children.find((c) => c.name === 'passwd');
    expect(passwd).toBeTruthy();
    expect(passwd.type).toBe('file');
    expect(passwd.content).toBe(
      'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:User:/home/user:/bin/bash\n',
    );
    expect(passwd.mode).toBe(0o644);
    expect('size' in passwd).toBe(false);
  });

  it('no "size" field anywhere in the serialized JSON', () => {
    const json = serializeVFS(createInitialFS());
    expect(hasSizeField(json)).toBe(false);
  });
  
  it('round-trips a link node (target preserved, no content/children)', () => {
    // Three separate concerns are verified here:
    //
    // (1)  The link NODE itself — its `type === 'link'` and `target`
    //      value — must survive the roundtrip. Note: `vfs.resolve()`
    //      FOLLOWS symlinks (spec001 §3.1), so it returns the *target*
    //      node, not the link node. To inspect the link node we use
    //      `vfs.list()`, which is the formal API for "children of a
    //      directory, no link-following". This avoids relying on the
    //      internal `Node.children` container type (currently a `Map`,
    //      but not a formal API guarantee — a future refactor could
    //      change it, and this test should stay agnostic).
    //
    // (2a) Link-FOLLOWING via `readFile` — reading through `/my-link`
    //      must return the target file's content. This exercises
    //      `readFile` → `resolve` on a link that itself came from
    //      deserialization.
    //
    // (2b) Link-FOLLOWING via `resolve` directly — must return the
    //      target node (type `'file'`), not the link node. Confirms
    //      the VFS's path-resolution semantics were not disturbed by
    //      the serialization roundtrip.
    const data = {
      schemaVersion: 1,
      root: {
        name: '/', type: 'dir', mode: 493, owner: 'root', group: 'root',
        mtime: 0, atime: 0, ctime: 0,
        children: [
          {
            name: 'target-file', type: 'file', mode: 420,
            owner: 'user', group: 'user',
            mtime: 0, atime: 0, ctime: 0, content: 'huhu',
          },
          {
            name: 'my-link', type: 'link', mode: 511,
            owner: 'user', group: 'user',
            mtime: 0, atime: 0, ctime: 0, target: '/target-file',
          },
        ],
      },
    };
    const vfs = deserializeVFS(data);

    // (1) Inspect the link node itself via the formal list() API.
    // `showHidden: true` is DEFENSIVE: the current fixtures are not
    // dot-files, so the default `showHidden: false` would also find
    // them. It is set explicitly so that if a future test adds a
    // hidden link (e.g. `.hidden-link`) and reuses this pattern, the
    // lookup does not silently miss it. Do not remove this flag
    // without checking whether the fixture names might ever start
    // with a dot.
    const linkNode = vfs
      .list('/', '/', { showHidden: true })
      .find((n) => n.name === 'my-link');
    expect(linkNode).toBeTruthy();
    expect(vfs.isLink(linkNode)).toBe(true);
    expect(linkNode.target).toBe('/target-file');

    // Serialize and verify the JSON shape of the link node.
    const json = serializeVFS(vfs);
    const linkJson = json.root.children.find((c) => c.name === 'my-link');
    expect(linkJson).toBeTruthy();
    expect(linkJson.type).toBe('link');
    expect(linkJson.target).toBe('/target-file');
    expect('content' in linkJson).toBe(false);
    expect('children' in linkJson).toBe(false);
    expect('size' in linkJson).toBe(false);

    // Re-deserialize for the follow-path assertions.
    const vfs2 = deserializeVFS(json);

    // (2a) readFile follows the link on the restored VFS.
    expect(vfs2.readFile('/my-link', '/')).toBe('huhu');

    // (2b) resolve follows the link on the restored VFS — returns
    // the target node, not the link node.
    const followed = vfs2.resolve('/my-link', '/');
    expect(followed.type).toBe('file');
    expect(followed.content).toBe('huhu');
  });
});

// ---------------------------------------------------------------------------
// Metadata preserved on deserialize
// ---------------------------------------------------------------------------

describe('deserializeVFS — Metadaten', () => {
  it('preserves mode, owner, group, mtime', () => {
    const data = {
      schemaVersion: 1,
      root: {
        name: '/', type: 'dir', mode: 493, owner: 'root', group: 'root',
        mtime: 1700000000000, atime: 1700000000000, ctime: 1700000000000,
        children: [
          {
            name: 'x', type: 'dir', mode: 493, owner: 'root', group: 'root',
            mtime: 1700000000000, atime: 1700000000000, ctime: 1700000000000,
            children: [],
          },
        ],
      },
    };
    const vfs = deserializeVFS(data);
    const stat = vfs.stat('/x', '/');
    expect(stat.mode).toBe(0o755);          // 493
    expect(stat.owner).toBe('root');
    expect(stat.group).toBe('root');
    expect(stat.mtime).toBe(1700000000000);
  });

  it('preserves Unicode content exactly', () => {
    const data = {
      schemaVersion: 1,
      root: {
        name: '/', type: 'dir', mode: 493, owner: 'root', group: 'root',
        mtime: 0, atime: 0, ctime: 0,
        children: [
          {
            name: 'u', type: 'file', mode: 420, owner: 'root', group: 'root',
            mtime: 0, atime: 0, ctime: 0,
            content: 'héllo\nwörld',
          },
        ],
      },
    };
    const vfs = deserializeVFS(data);
    expect(vfs.readFile('/u', '/')).toBe('héllo\nwörld');
  });

  it('accepts mode 0 (does not fall back to default)', () => {
    const data = {
      schemaVersion: 1,
      root: {
        name: '/', type: 'dir', mode: 0, owner: 'root', group: 'root',
        mtime: 0, atime: 0, ctime: 0, children: [],
      },
    };
    const vfs = deserializeVFS(data);
    expect(vfs.stat('/', '/').mode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// size recomputation on deserialize
// ---------------------------------------------------------------------------

describe('deserializeVFS — size-Berechnung', () => {
  it('computes size from content.length', () => {
    const data = {
      schemaVersion: 1,
      root: {
        name: '/', type: 'dir', mode: 493, owner: 'root', group: 'root',
        mtime: 0, atime: 0, ctime: 0,
        children: [
          {
            name: 'a', type: 'file', mode: 420, owner: 'root', group: 'root',
            mtime: 0, atime: 0, ctime: 0, content: 'abc',
          },
        ],
      },
    };
    const vfs = deserializeVFS(data);
    expect(vfs.stat('/a', '/').size).toBe(3);
  });

  it('empty content yields size 0', () => {
    const data = {
      schemaVersion: 1,
      root: {
        name: '/', type: 'dir', mode: 493, owner: 'root', group: 'root',
        mtime: 0, atime: 0, ctime: 0,
        children: [
          {
            name: 'e', type: 'file', mode: 420, owner: 'root', group: 'root',
            mtime: 0, atime: 0, ctime: 0, content: '',
          },
        ],
      },
    };
    const vfs = deserializeVFS(data);
    expect(vfs.stat('/e', '/').size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe('deserializeVFS — Fehler', () => {
  it('rejects null', () => {
    expectEINVAL(() => deserializeVFS(null));
  });

  it('rejects empty object (no schemaVersion)', () => {
    expectEINVAL(() => deserializeVFS({}));
  });

  it('rejects unsupported schemaVersion', () => {
    expectEINVAL(
      () => deserializeVFS({ schemaVersion: 2, root: {} }),
      'schemaVersion',
    );
  });

  it('rejects missing root', () => {
    expectEINVAL(() => deserializeVFS({ schemaVersion: 1 }), 'root');
  });

  it('rejects bogus root.type', () => {
    const err = expectEINVAL(
      () => deserializeVFS({
        schemaVersion: 1,
        root: { name: '/', type: 'bogus', mode: 493, owner: 'root', group: 'root', mtime: 0, atime: 0, ctime: 0 },
      }),
      'type',
    );
    // Path must point at the type field.
    expect(err.path.includes('.type')).toBe(true);
  });

  it('rejects non-array children for a dir node', () => {
    expectEINVAL(
      () => deserializeVFS({
        schemaVersion: 1,
        root: {
          name: '/', type: 'dir', mode: 493, owner: 'root', group: 'root',
          mtime: 0, atime: 0, ctime: 0,
          children: 'not-an-array',
        },
      }),
      'children',
    );
  });

  it('rejects a file node without content', () => {
    expectEINVAL(
      () => deserializeVFS({
        schemaVersion: 1,
        root: {
          name: '/', type: 'dir', mode: 493, owner: 'root', group: 'root',
          mtime: 0, atime: 0, ctime: 0,
          children: [
            { name: 'x', type: 'file', mode: 420, owner: 'root', group: 'root', mtime: 0, atime: 0, ctime: 0 },
          ],
        },
      }),
      'content',
    );
  });

  it('rejects a link node without target', () => {
    expectEINVAL(
      () => deserializeVFS({
        schemaVersion: 1,
        root: {
          name: '/', type: 'dir', mode: 493, owner: 'root', group: 'root',
          mtime: 0, atime: 0, ctime: 0,
          children: [
            { name: 'l', type: 'link', mode: 511, owner: 'root', group: 'root', mtime: 0, atime: 0, ctime: 0 },
          ],
        },
      }),
      'target',
    );
  });

  it('rejects mode > 0o7777', () => {
    expectEINVAL(
      () => deserializeVFS({
        schemaVersion: 1,
        root: {
          name: '/', type: 'dir', mode: 0o10000, owner: 'root', group: 'root',
          mtime: 0, atime: 0, ctime: 0, children: [],
        },
      }),
      'mode',
    );
  });

  it('rejects negative mode', () => {
    expectEINVAL(
      () => deserializeVFS({
        schemaVersion: 1,
        root: {
          name: '/', type: 'dir', mode: -1, owner: 'root', group: 'root',
          mtime: 0, atime: 0, ctime: 0, children: [],
        },
      }),
      'mode',
    );
  });

  it('rejects non-integer mode', () => {
    expectEINVAL(
      () => deserializeVFS({
        schemaVersion: 1,
        root: {
          name: '/', type: 'dir', mode: 1.5, owner: 'root', group: 'root',
          mtime: 0, atime: 0, ctime: 0, children: [],
        },
      }),
      'mode',
    );
  });
});

// ---------------------------------------------------------------------------
// After mutation
// ---------------------------------------------------------------------------

describe('serializeVFS — nach Mutation', () => {
  it('preserves a created file', () => {
    const vfs = createInitialFS();
    vfs.createFile('/tmp/x', '/', 'huhu');
    const restored = deserializeVFS(serializeVFS(vfs));
    expect(restored.readFile('/tmp/x', '/')).toBe('huhu');
  });

  it('preserves a recursively created directory', () => {
    const vfs = createInitialFS();
    vfs.createDir('/tmp/d1/d2', '/', { recursive: true });
    const restored = deserializeVFS(serializeVFS(vfs));
    const names = restored.list('/tmp/d1', '/').map((n) => n.name);
    expect(names.includes('d2')).toBe(true);
  });
});