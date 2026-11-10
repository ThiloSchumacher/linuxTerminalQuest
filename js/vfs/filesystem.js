import { Node } from './node.js';

/**
 * Maximum symlink resolutions per `resolve()` call (Linux standard).
 * Exceeding it raises `ELOOP`, even if the chain is not an actual loop.
 */
const MAX_LINK_RESOLUTIONS = 40;

/**
 * Build an Error with a POSIX-style `.code`, plus `.path` and `.syscall`.
 *
 * @param {string} code
 * @param {string} path
 * @param {string} syscall
 * @param {string} [message]
 * @returns {Error}
 */
function fsError(code, path, syscall, message) {
  const err = new Error(message ?? `${code}: ${syscall} '${path}'`);
  err.code = code;
  err.path = path;
  err.syscall = syscall;
  return err;
}

/**
 * In-memory virtual file system.
 *
 * ## Symlink semantics (spec008a)
 *
 * Symlinks are supported per POSIX. Every public method either follows
 * symlinks or not, per its own rule:
 *  - **Follow links**: `resolve`, `stat`, `exists`, `readFile`, `list`,
 *    `writeFile`, `chmod`.
 *  - **Do NOT follow the final link**: `lstat`, `readlink`, `delete`,
 *    `createFile`, `createDir`, `createSymlink`. Intermediate path
 *    components that are links ARE followed (needed for traversal).
 *  - **`move`**: moves the LINK itself (target unchanged).
 *  - **`copy`**: follows `src` (copies the target's content); for
 *    `dest`, follows only to decide "is it a directory?", and treats
 *    `dest` as a link-to-file (write into target) or link-to-dir
 *    (`EINVAL`) explicitly.
 *
 * ## Error codes (spec008a §4)
 *
 * Standard POSIX-style codes: `ENOENT`, `EEXIST`, `EISDIR`, `ENOTDIR`,
 * `ENOTEMPTY`, `EPERM`, `EACCES`, `EINVAL`. New in spec008a:
 *  - `ELOOP` — too many levels of symbolic links (chain length > 40,
 *    or an actual loop). Error object carries `{ code, path, syscall,
 *    message: 'too many levels of symbolic links' }`.
 *
 * A **broken link** (target doesn't exist) resolves to `ENOENT`, not
 * `EINVAL`.
 */
export class VFS {
  /**
   * @param {Node} rootNode
   */
  constructor(rootNode) {
    if (!rootNode || rootNode.type !== 'dir') {
      throw fsError('EINVAL', '/', 'VFS');
    }
    this.root = rootNode;
  }

  // ------------------------------------------------------------------
  // Resolution
  // ------------------------------------------------------------------

  /**
   * Resolve a path to its Node.
   *
   * Follows symlinks by default, up to `MAX_LINK_RESOLUTIONS` follows.
   * Intermediate links (path components that are links) are ALWAYS
   * followed (needed to reach the requested final component);
   * `followLinks:false` only suppresses following the FINAL component
   * — that is what `lstat` and `readlink` need.
   *
   * A broken link (target doesn't exist) raises `ENOENT`. A chain of
   * more than `MAX_LINK_RESOLUTIONS` follows (loop or otherwise) raises
   * `ELOOP`.
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @param {{followLinks?: boolean}} [opts]
   * @returns {Node}
   * @throws {Error} EINVAL, ENOENT, ENOTDIR, ELOOP
   */
  resolve(path, cwd = '/', { followLinks = true } = {}) {
    return this._resolveInternal(path, cwd, followLinks, { count: 0 });
  }

  /**
   * Test whether a path exists, following symlinks.
   *
   * Returns `false` for ENOENT, ENOTDIR and ELOOP (spec008a §3.4).
   * Other codes (EINVAL for invalid path arguments) propagate, per the
   * spec001 design.
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @returns {boolean}
   */
  exists(path, cwd = '/') {
    try {
      this.resolve(path, cwd);
      return true;
    } catch (err) {
      if (
        err &&
        (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'ELOOP')
      ) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Stat the target of a path, FOLLOWING symlinks (spec008a §3.2).
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @returns {{name:string,type:string,size:number,mode:number,owner:string,group:string,mtime:number,atime:number,ctime:number}}
   */
  stat(path, cwd = '/') {
    const node = this.resolve(path, cwd);
    return this._statFields(node);
  }

  /**
   * Stat the node at `path` itself, NOT following the final symlink
   * (spec008a §3.3). Intermediate path components ARE followed.
   *
   * Returns the link node's fields when `path` is a link (type 'link',
   * `size === target.length` per Linux behaviour).
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @returns {{name:string,type:string,size:number,mode:number,owner:string,group:string,mtime:number,atime:number,ctime:number}}
   */
  lstat(path, cwd = '/') {
    const node = this.resolve(path, cwd, { followLinks: false });
    return this._statFields(node);
  }

  /**
   * Read the target string of a symlink (spec008a §3.10).
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @returns {string}
   * @throws {Error} EINVAL when `path` is not a symlink (its target
   *   not followed, per `readlink` semantics). Broken links are OK —
   *   the target string is returned even if it doesn't resolve.
   */
  readlink(path, cwd = '/') {
    const node = this.resolve(path, cwd, { followLinks: false });
    if (!this.isLink(node)) throw fsError('EINVAL', path, 'readlink');
    return node.target;
  }

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  /**
   * List the direct children of a directory, FOLLOWING symlinks
   * (spec008a §3.6).
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @param {{showHidden?:boolean}} [options]
   * @returns {Node[]}
   * @throws {Error} ENOTDIR, ENOENT, ELOOP
   */
  list(path, cwd = '/', { showHidden = false } = {}) {
    const node = this.resolve(path, cwd);
    if (!this.isDir(node)) throw fsError('ENOTDIR', path, 'list');
    node.atime = Date.now();
    const result = [];
    for (const child of node.children.values()) {
      if (!showHidden && child.name.startsWith('.')) continue;
      result.push(child);
    }
    return result;
  }

  /**
   * Read the content of a file, FOLLOWING symlinks (spec008a §3.5).
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @returns {string}
   * @throws {Error} EISDIR, ENOENT, ELOOP
   */
  readFile(path, cwd = '/') {
    const node = this.resolve(path, cwd);
    if (this.isDir(node)) throw fsError('EISDIR', path, 'readFile');
    if (!this.isFile(node)) throw fsError('EINVAL', path, 'readFile');
    node.atime = Date.now();
    return node.content;
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  /**
   * Create a new file. The parent directory is resolved FOLLOWING
   * symlinks, but the final path is not — if a link already exists at
   * `path`, the call fails with `EEXIST` (spec008a §3.7).
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @param {string} [content='']
   * @returns {Node}
   * @throws {Error} EINVAL, ENOENT, ENOTDIR, EEXIST
   */
  createFile(path, cwd = '/', content = '') {
    this._validatePath(path);
    const abs = this._normalize(path, cwd);
    if (abs === '/') throw fsError('EEXIST', path, 'createFile');

    const parent = this._resolveOrRethrow(this.dirname(abs), path, 'createFile');
    if (!this.isDir(parent)) throw fsError('ENOTDIR', path, 'createFile');

    const name = this.basename(abs);
    if (parent.children.has(name)) throw fsError('EEXIST', path, 'createFile');

    const node = new Node({
      name,
      type: 'file',
      content,
      mode: 0o644,
      owner: parent.owner,
      group: parent.group,
    });
    parent.children.set(name, node);
    this._touch(parent);
    return node;
  }

  /**
   * Create a directory. Same link semantics as `createFile`
   * (spec008a §3.8): parent is followed, target path is not.
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @param {{recursive?:boolean}} [options]
   * @returns {Node}
   * @throws {Error} EINVAL, ENOENT, ENOTDIR, EEXIST
   */
  createDir(path, cwd = '/', { recursive = false } = {}) {
    this._validatePath(path);
    const abs = this._normalize(path, cwd);

    if (abs === '/') {
      if (recursive) return this.root;
      throw fsError('EEXIST', path, 'createDir');
    }

    if (!recursive) {
      const parent = this._resolveOrRethrow(this.dirname(abs), path, 'createDir');
      if (!this.isDir(parent)) throw fsError('ENOTDIR', path, 'createDir');
      const name = this.basename(abs);
      if (parent.children.has(name)) throw fsError('EEXIST', path, 'createDir');
      const node = new Node({
        name,
        type: 'dir',
        mode: 0o755,
        owner: parent.owner,
        group: parent.group,
      });
      parent.children.set(name, node);
      this._touch(parent);
      return node;
    }

    const parts = abs.split('/').filter(Boolean);
    let node = this.root;
    for (const part of parts) {
      if (!this.isDir(node)) throw fsError('ENOTDIR', path, 'createDir');
      if (node.children.has(part)) {
        const child = node.children.get(part);
        if (!this.isDir(child)) throw fsError('ENOTDIR', path, 'createDir');
        node = child;
        continue;
      }
      const child = new Node({
        name: part,
        type: 'dir',
        mode: 0o755,
        owner: node.owner,
        group: node.group,
      });
      node.children.set(part, child);
      this._touch(node);
      node = child;
    }
    return node;
  }

  /**
   * Create a symlink (spec008a §3.9).
   *
   * - `path` must not exist (including as a symlink) → `EEXIST`.
   * - The parent directory must exist and be a directory.
   * - `target` is NOT validated — a broken link is allowed (matches
   *   POSIX `ln -s`).
   * - Link mode: `0o777` (POSIX default for symlinks).
   * - `size`: `target.length` (Linux reports the link size as the
   *   length of the target string in bytes).
   *
   * @param {string} target Target path string (kept verbatim; not
   *   resolved or normalized).
   * @param {string} path Where the link should live.
   * @param {string} [cwd='/']
   * @returns {Node}
   * @throws {Error} EINVAL, ENOENT, ENOTDIR, EEXIST
   */
  createSymlink(target, path, cwd = '/') {
    if (typeof target !== 'string') {
      throw fsError('EINVAL', path, 'createSymlink');
    }
    this._validatePath(path);
    const abs = this._normalize(path, cwd);
    if (abs === '/') throw fsError('EEXIST', path, 'createSymlink');

    const parent = this._resolveOrRethrow(
      this.dirname(abs),
      path,
      'createSymlink',
    );
    if (!this.isDir(parent)) throw fsError('ENOTDIR', path, 'createSymlink');

    const name = this.basename(abs);
    if (parent.children.has(name)) {
      throw fsError('EEXIST', path, 'createSymlink');
    }

    const node = new Node({
      name,
      type: 'link',
      target,
      mode: 0o777,
      owner: parent.owner,
      group: parent.group,
    });
    // Linux reports link size as target.length. The Node constructor
    // seeds size=0 for non-file types (spec001 design), so we override
    // it here to match POSIX/Linux expectations and to keep
    // `lstat().size === target.length`.
    node.size = target.length;
    parent.children.set(name, node);
    this._touch(parent);
    return node;
  }

  /**
   * Overwrite the content of an existing file, FOLLOWING symlinks
   * (spec008a §3.11). If `path` is a link to a file, the target's
   * content and mtime are updated.
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @param {string} content
   * @returns {Node}
   * @throws {Error} ENOENT, EISDIR, ELOOP
   */
  writeFile(path, cwd = '/', content) {
    const node = this.resolve(path, cwd);
    if (this.isDir(node)) throw fsError('EISDIR', path, 'writeFile');
    if (!this.isFile(node)) throw fsError('EINVAL', path, 'writeFile');

    node.content = String(content ?? '');
    node.size = node.content.length;
    this._touch(node);
    return node;
  }

  /**
   * Delete a file or directory. Does NOT follow the final link
   * (spec008a §3.13): deleting a symlink removes the link only, the
   * target is untouched. `recursive:true` on a link-to-dir still only
   * removes the link, not the target.
   *
   * @param {string} path
   * @param {string} [cwd='/']
   * @param {{recursive?:boolean}} [options]
   * @returns {void}
   * @throws {Error} EINVAL, EPERM, ENOENT, ENOTEMPTY
   */
  delete(path, cwd = '/', { recursive = false } = {}) {
    this._validatePath(path);
    const abs = this._normalize(path, cwd);
    if (abs === '/') throw fsError('EPERM', path, 'delete');

    const parent = this._resolveOrRethrow(this.dirname(abs), path, 'delete');
    const name = this.basename(abs);
    if (!parent.children.has(name)) throw fsError('ENOENT', path, 'delete');

    const node = parent.children.get(name);
    // A symlink has type='link', so `isDir(node)` is false even if the
    // target is a directory. That is exactly the POSIX `rm` behaviour:
    // deleting a link-to-dir removes the link, not the target.
    if (this.isDir(node) && node.children.size > 0 && !recursive) {
      throw fsError('ENOTEMPTY', path, 'delete');
    }
    parent.children.delete(name);
    this._touch(parent);
  }

  /**
   * Move/rename a node. If `src` is a symlink, the LINK is moved — the
   * target stays where it is (spec008a §3.14, POSIX `mv`).
   *
   * Destination handling:
   *  - `dest` resolves to a directory → `src` becomes a child of it.
   *  - `dest` is anything else (file, link, broken link) → replaces
   *    whatever is at `dest`. If `dest` was a link, the link node is
   *    replaced by the moved node (target untouched).
   *  - `src` and `dest` resolve to the same node → `EINVAL`.
   *
   * @param {string} src
   * @param {string} dest
   * @param {string} [cwd='/']
   * @returns {void}
   * @throws {Error} EINVAL, EPERM, ENOENT, ENOTDIR, EEXIST, EISDIR
   */
  move(src, dest, cwd = '/') {
    this._validatePath(src);
    this._validatePath(dest);

    const srcAbs = this._normalize(src, cwd);
    if (srcAbs === '/') throw fsError('EPERM', src, 'move');

    const srcParent = this._resolveOrRethrow(this.dirname(srcAbs), src, 'move');
    const srcName = this.basename(srcAbs);
    if (!srcParent.children.has(srcName)) {
      throw fsError('ENOENT', src, 'move');
    }
    // `node` is the direct child at `src` — a link node if `src` is a
    // symlink. That is what gets moved (POSIX `mv` does not follow the
    // moved path).
    const node = srcParent.children.get(srcName);

    const destAbs = this._normalize(dest, cwd);
    const destNode = this._tryResolve(destAbs);

    // Same-file detection in BOTH directions (spec008a Patch 1 §3.14).
    // The error is reported against `src` (the original path, not the
    // resolved one), with message 'same file' — this is the POSIX
    // convention for `mv` on identical nodes.
    //
    //  1. `destNode === node` — dest resolves to the same node as the
    //     direct child at src. Covers `mv /A /link-to-A` and
    //     `mv /link-to-A /link-to-A`.
    //
    //  2. `srcResolved === destNode` — src is a link whose TARGET
    //     resolves to the same node as dest. Covers `mv /link-to-A /A`.
    //     Without this check, /A would be replaced by a link pointing
    //     at itself (a self-referential link that raises ELOOP on
    //     every subsequent read). POSIX `mv` rejects it.
    //
    // The reverse-direction check swallows resolution errors on src
    // (broken src link → ENOENT, circular src link → ELOOP): in those
    // cases there is no "same file" pair, and moving the LINK node
    // (whose target may be broken) is exactly the V1 `mv` semantics
    // for a broken link.
    if (destNode === node) {
      throw fsError('EINVAL', src, 'move', 'same file');
    }
    if (this.isLink(node) && destNode) {
      let srcResolved = null;
      try {
        srcResolved = this.resolve(srcAbs, '/');
      } catch {
        // Broken or circular src link — no same-file detection needed.
      }
      if (srcResolved === destNode) {
        throw fsError('EINVAL', src, 'move', 'same file');
      }
    }

    let finalDir;
    let finalName;
    if (destNode && this.isDir(destNode)) {
      finalDir = destNode;
      finalName = srcName;
    } else {
      finalDir = this._resolveOrRethrow(this.dirname(destAbs), dest, 'move');
      if (!this.isDir(finalDir)) throw fsError('ENOTDIR', dest, 'move');
      finalName = this.basename(destAbs);
    }

    if (this.isDir(node) && (node === finalDir || this._isDescendant(node, finalDir))) {
      throw fsError('EINVAL', dest, 'move');
    }

    const existing = finalDir.children.get(finalName);
    // Self-move: reject before any mutation so identity and mtime of
    // the source remain untouched.
    if (existing === node) {
      throw fsError('EINVAL', dest, 'move');
    }
    if (existing) {
      if (this.isDir(existing)) throw fsError('EEXIST', dest, 'move');
      if (this.isDir(node)) throw fsError('EISDIR', dest, 'move');
    }

    srcParent.children.delete(srcName);
    finalDir.children.set(finalName, node);
    node.name = finalName;
    this._touch(srcParent);
    this._touch(finalDir);
  }

  /**
   * Copy a file. `src` is FOLLOWED (a link's target content is copied);
   * `dest` is handled per spec008a §3.15 (Patch 1: same-file detection
   * via resolved nodes, reported against `src`).
   *
   *  - `dest` is a real directory → copy into it (basename of src).
   *    **Two V1 divergences from GNU cp in this branch:**
   *
   *    (a) **Child-symlink**: if the child at `basename(src)` is a
   *        symlink — whether pointing at `src` or elsewhere — V1
   *        REPLACES that symlink with a real file. GNU `cp` (without
   *        `-P`) would follow the child symlink and, if it resolves
   *        to `src`, error as "same file". V1 has NO child-level
   *        same-file detection.
   *
   *    (b) **Child-is-src**: if the child at `basename(src)` is the
   *        SAME node as `src` (i.e. `dest` is the parent directory of
   *        `src`, e.g. `cp /a /parent-of-a`), V1 replaces the child
   *        with a COPY of itself. GNU `cp` would error as "same file"
   *        (`stat`-based comparison on the resolved child).
   *
   *    Both are pinned by tests. Neither is caught by the early
   *    `destFollowed === srcNode` check below — that check compares
   *    `dest` itself with `srcNode`, not a child of `dest`.
   *
   *  - `dest` is a symlink to a file → write into the target file
   *    (link stays in place).
   *  - `dest` is a symlink to a directory → `EINVAL` (V1 does not
   *    support copying into a symlinked dir).
   *  - `dest` is a regular file / nonexistent → overwrite / create.
   *
   * If `src` and `dest` themselves resolve to the same file — directly
   * (`cp /a /a`) or via a symlink on either side (`cp /a /link-to-a`,
   * `cp /link-to-a /a`, `cp /link-to-a /link-to-a`) — the call fails
   * with `EINVAL`, `.path = src`, and `message: 'same file'`.
   *
   * The "copy into a directory" case is EXEMPT from this early
   * same-file check. See divergences (a) and (b) above.
   *
   * ## Cost note (V1)
   *
   * `dest` is resolved TWICE per call — once with `followLinks:true`
   * (for the same-file check and the dir-vs-link dispatch) and once
   * with `followLinks:false` (to distinguish "dest is a link" from
   * "dest resolves to a dir"). Both are full traversals from root,
   * i.e. O(path depth) each. Acceptable for V1 because `copy` is not
   * on a hot path; a future optimisation could add a
   * `_tryResolveBoth(abs)` helper that returns both values from a
   * single traversal.
   *
   * @param {string} src
   * @param {string} dest
   * @param {string} [cwd='/']
   * @returns {void}
   * @throws {Error} EINVAL, ENOENT, ENOTDIR, EISDIR, ELOOP
   */
  copy(src, dest, cwd = '/') {
    this._validatePath(src);
    this._validatePath(dest);

    // src follows: copy the target's content.
    const srcNode = this.resolve(src, cwd);
    if (!this.isFile(srcNode)) {
      // Directory copy (including link-to-dir) is not supported in V1.
      throw fsError('EINVAL', src, 'copy');
    }

    const destAbs = this._normalize(dest, cwd);

    // destFollowed: what dest resolves to (following links). Computed
    // ONCE, used for both the same-file check and the dest-shape
    // dispatch below. There is no separate "early" variable — the
    // same-file check is placed before the dispatch, but the value is
    // the same one used afterwards.
    //
    // Cost: this is a full traversal. `destDirect` (below) is a
    // second traversal — see the JSDoc "Cost note" for the rationale.
    const destFollowed = this._tryResolve(destAbs, true);

    // Same-file detection FIRST, before any dest-shape dispatch. Uses
    // resolved nodes on both sides — because `copy` follows `src`
    // (content of target) and, when dest is a link-to-file, writes
    // into the target — so "same file" means "same resolved node".
    //
    // Scope note: this compares `dest` ITSELF with `srcNode`, not a
    // child of `dest`. The "copy into a directory" case with a child
    // that is `srcNode` (e.g. `cp /a /parent-of-a`) is NOT caught
    // here — that is V1 divergence (b), documented in the JSDoc above
    // and pinned by its own test.
    if (destFollowed === srcNode) {
      throw fsError('EINVAL', src, 'copy', 'same file');
    }

    // destDirect: the node at dest WITHOUT following (link node if
    // dest is a link). Needed to differentiate link-to-file and
    // link-to-dir handling from "real dir" handling.
    const destDirect = this._tryResolve(destAbs, false);

    // dest is a link to a dir → EINVAL (V1 spec).
    if (
      destDirect &&
      this.isLink(destDirect) &&
      destFollowed &&
      this.isDir(destFollowed)
    ) {
      throw fsError('EINVAL', dest, 'copy');
    }

    // dest is a link to a file → write into the TARGET (link stays).
    // Same-file case for this branch is already caught by the early
    // check above (destFollowed would equal srcNode), so no guard
    // needed here.
    if (
      destDirect &&
      this.isLink(destDirect) &&
      destFollowed &&
      this.isFile(destFollowed)
    ) {
      destFollowed.content = srcNode.content;
      destFollowed.size = srcNode.content.length;
      this._touch(destFollowed);
      return;
    }

    // dest is a real dir → copy into (basename of src).
    // Otherwise (regular file, broken link, nonexistent) → replace
    // whatever is at dest.
    let finalDir;
    let finalName;
    if (destFollowed && this.isDir(destFollowed)) {
      finalDir = destFollowed;
      finalName = this.basename(this._normalize(src, cwd));
    } else {
      finalDir = this._resolveOrRethrow(this.dirname(destAbs), dest, 'copy');
      if (!this.isDir(finalDir)) throw fsError('ENOTDIR', dest, 'copy');
      finalName = this.basename(destAbs);
    }

    const existing = finalDir.children.get(finalName);

    // `existing === srcNode` CAN happen here — contrary to an earlier
    // version of this comment that claimed it was "caught by the
    // early check". The early check compares `dest` itself with
    // `srcNode`; this branch compares a CHILD of `dest` with `srcNode`.
    // The canonical case is `cp /a /parent-of-a`: `finalDir` is the
    // parent directory, `finalName === basename(src) === 'a'`, and
    // `existing === srcNode` (the child IS the source). V1 replaces
    // the child with a copy of itself — see JSDoc divergence (b).
    //
    // What this branch DOES catch is `existing && isDir(existing)`:
    // a subdirectory at `basename(src)` inside `finalDir` →
    // `EISDIR`. That is a distinct condition from same-file detection
    // and must not be removed as "redundant".
    if (existing && this.isDir(existing)) {
      throw fsError('EISDIR', dest, 'copy');
    }

    const copyNode = new Node({
      name: finalName,
      type: 'file',
      content: srcNode.content,
      mode: srcNode.mode,
      owner: srcNode.owner,
      group: srcNode.group,
    });
    finalDir.children.set(finalName, copyNode);
    this._touch(finalDir);
  }
  /**
   * Change the mode of a node, FOLLOWING symlinks (spec008a §3.12).
   * `mode` is set on the target, not on the link; the target's ctime is
   * bumped.
   *
   * @param {string} path
   * @param {number} mode        0 .. 0o7777
   * @param {string} [cwd='/']
   * @returns {void}
   * @throws {Error} EINVAL, ENOENT, ELOOP
   */
  chmod(path, mode, cwd = '/') {
    if (typeof mode !== 'number' || !Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
      throw fsError('EINVAL', path, 'chmod');
    }
    const node = this.resolve(path, cwd);
    node.mode = mode;
    node.ctime = Date.now();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** @param {Node} node @returns {boolean} */
  isFile(node) {
    return !!node && node.type === 'file';
  }

  /** @param {Node} node @returns {boolean} */
  isDir(node) {
    return !!node && node.type === 'dir';
  }

  /** @param {Node} node @returns {boolean} */
  isLink(node) {
    return !!node && node.type === 'link';
  }

  /**
   * @param {string} path
   * @returns {string}
   */
  dirname(path) {
    if (path === '/' || path === '') return '/';
    const cleaned = path.replace(/\/+$/, '');
    if (cleaned === '') return '/';
    const idx = cleaned.lastIndexOf('/');
    if (idx <= 0) return '/';
    return cleaned.slice(0, idx);
  }

  /**
   * @param {string} path
   * @returns {string}
   */
  basename(path) {
    if (path === '/' || path === '') return path;
    const cleaned = path.replace(/\/+$/, '');
    if (cleaned === '') return '/';
    const idx = cleaned.lastIndexOf('/');
    return idx === -1 ? cleaned : cleaned.slice(idx + 1);
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  /**
   * Extract the public stat fields from a Node.
   *
   * @param {Node} node
   * @returns {{name:string,type:string,size:number,mode:number,owner:string,group:string,mtime:number,atime:number,ctime:number}}
   */
  _statFields(node) {
    return {
      name: node.name,
      type: node.type,
      size: node.size,
      mode: node.mode,
      owner: node.owner,
      group: node.group,
      mtime: node.mtime,
      atime: node.atime,
      ctime: node.ctime,
    };
  }

  /**
   * @param {string} path
   * @returns {void}
   * @throws {Error} EINVAL
   */
  _validatePath(path) {
    if (typeof path !== 'string') {
      throw fsError('EINVAL', String(path), 'path');
    }
    if (path.length === 0) {
      throw fsError('EINVAL', path, 'path');
    }
    if (path.includes('\0')) {
      throw fsError('EINVAL', path, 'path');
    }
  }

  /**
   * Normalize a path relative to cwd. Resolves `.`, `..`, collapses `//`.
   *
   * @param {string} path
   * @param {string} cwd
   * @returns {string}
   */
  _normalize(path, cwd) {
    const base = path.startsWith('/') ? [] : cwd.split('/').filter(Boolean);
    for (const part of path.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (base.length > 0) base.pop();
        continue;
      }
      base.push(part);
    }
    return '/' + base.join('/');
  }

  /**
   * Resolve a path, re-attributing any thrown error to `originalPath`
   * and `syscall`. Always follows links (parent directories must be
   * resolved through links for correct traversal).
   *
   * @param {string} abs          Path to resolve.
   * @param {string} originalPath Path originally supplied by caller.
   * @param {string} syscall      Name of the calling operation.
   * @returns {Node}
   */
  _resolveOrRethrow(abs, originalPath, syscall) {
    try {
      return this.resolve(abs, '/');
    } catch (err) {
      if (err && typeof err === 'object' && err.code) {
        err.path = originalPath;
        err.syscall = syscall;
      }
      throw err;
    }
  }

  /**
   * Recursive path resolution with symlink following and a
   * resolution budget.
   *
   * @param {string} path
   * @param {string} cwd
   * @param {boolean} followLinks Whether to follow the FINAL link.
   * @param {{count: number}} budget Shared across recursion so the
   *   `MAX_LINK_RESOLUTIONS` limit applies to the whole `resolve()`
   *   call, not per-recursion-level.
   * @returns {Node}
   */
  _resolveInternal(path, cwd, followLinks, budget) {
    this._validatePath(path);
    const abs = this._normalize(path, cwd);
    const parts = abs.split('/').filter(Boolean);
    let node = this.root;
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
      if (!this.isDir(node)) throw fsError('ENOTDIR', path, 'resolve');
      const name = parts[i];
      if (!node.children.has(name)) throw fsError('ENOENT', path, 'resolve');
      const child = node.children.get(name);
      const isLast = i === parts.length - 1;

      if (child.type === 'link') {
        // Final-link handling: if this is the last component and the
        // caller asked NOT to follow, return the link node itself
        // (that is what lstat/readlink need).
        if (isLast && !followLinks) {
          return child;
        }

        // Follow the link (whether intermediate or final-with-follow).
        budget.count += 1;
        if (budget.count > MAX_LINK_RESOLUTIONS) {
          throw fsError(
            'ELOOP',
            path,
            'resolve',
            'too many levels of symbolic links',
          );
        }

        // Resolve the target relative to the link's directory (POSIX).
        const linkBase = currentPath || '/';
        const targetAbs = child.target.startsWith('/')
          ? this._normalize(child.target, '/')
          : this._normalize(child.target, linkBase);
        const remaining = parts.slice(i + 1).join('/');
        const next = remaining ? `${targetAbs}/${remaining}` : targetAbs;
        // Recurse with a fresh `cwd='/'` because `next` is absolute.
        // The `followLinks` flag and `budget` are passed through.
        return this._resolveInternal(next, '/', followLinks, budget);
      }

      node = child;
      currentPath = currentPath + '/' + name;
    }
    return node;
  }

  /**
   * Attempt to resolve a path. Returns `null` on ENOENT/ENOTDIR
   * (the "does not exist yet" cases); other codes propagate.
   *
   * `followLinks` defaults to `true` (the `dest is a directory?` check
   * needs following); `_runPipeline`'s copy path also calls this with
   * `false` to distinguish "dest is a link" from "dest resolves to a
   * dir".
   *
   * @param {string} abs
   * @param {boolean} [followLinks=true]
   * @returns {Node|null}
   * @throws {Error} EINVAL, ELOOP, and any non-ENOENT/ENOTDIR
   *   resolution error. **ELOOP propagates** (rather than mapping to
   *   `null`): a circular destination link is a real error, not a
   *   "does not exist yet" case — silently overwriting it would be
   *   surprising. This is called out for `copy`/`move` in particular,
   *   where the dest-node lookup uses `_tryResolve` and a circular
   *   dest surfaces as ELOOP to the caller.
   */
  _tryResolve(abs, followLinks = true) {
    try {
      return this.resolve(abs, '/', { followLinks });
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * @param {Node} ancestor
   * @param {Node} descendant
   * @returns {boolean}
   */
  _isDescendant(ancestor, descendant) {
    if (!this.isDir(ancestor)) return false;
    for (const child of ancestor.children.values()) {
      if (child === descendant) return true;
      if (this.isDir(child) && this._isDescendant(child, descendant)) return true;
    }
    return false;
  }

  /**
   * @param {Node} node
   * @returns {void}
   */
  _touch(node) {
    const now = Date.now();
    node.mtime = now;
    node.ctime = now;
  }
}