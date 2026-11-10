/**
 * Represents a single node (file, directory or symlink) in the virtual
 * file system. Plain data holder — mutation of timestamps and sizes is the
 * responsibility of the VFS, not the Node.
 */
export class Node {
  /**
   * @param {object} [options]
   * @param {string} [options.name='']            Name without path component.
   * @param {'file'|'dir'|'link'} [options.type='file']
   * @param {string|null} [options.content=null]  Only used for 'file'.
   * @param {Map<string,Node>|null} [options.children=null] Only for 'dir'.
   * @param {string|null} [options.target=null]   Only for 'link'.
   * @param {number} [options.mode]               Defaults: dir 0o755, else 0o644.
   * @param {string} [options.owner='user']
   * @param {string} [options.group='user']
   */
  constructor(options = {}) {
    const {
      name = '',
      type = 'file',
      content = null,
      children = null,
      target = null,
      mode,
      owner = 'user',
      group = 'user',
    } = options;

    this.name = name;
    this.type = type;
    this.content = type === 'file' ? String(content ?? '') : null;
    this.children = type === 'dir' ? (children ?? new Map()) : null;
    this.target = type === 'link' ? target : null;
    this.mode = mode ?? (type === 'dir' ? 0o755 : 0o644);
    this.owner = owner;
    this.group = group;
    this.size = type === 'file' ? this.content.length : 0;

    const now = Date.now();
    this.mtime = now;
    this.atime = now;
    this.ctime = now;
  }
}