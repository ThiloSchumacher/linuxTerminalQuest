import { Node } from './node.js';
import { VFS } from './filesystem.js';

/**
 * VFS serialization layer.
 *
 * Converts an entire VFS tree to a JSON-safe plain object and back.
 * `size` is deliberately NOT serialized: it is always derivable from
 * `content.length` for files and from `target.length` for links.
 *
 * @module vfs/serialize
 */

/**
 * Build an EINVAL error with a `.path` pointing into the JSON payload.
 *
 * @param {string} path
 * @param {string} message
 * @returns {Error}
 */
function einval(path, message) {
  const err = new Error(message);
  err.code = 'EINVAL';
  err.path = path;
  return err;
}

/**
 * Recursively convert a Node to its JSON-safe representation.
 *
 * @param {import('./node.js').Node} node
 * @returns {object}
 */
function serializeNode(node) {
  const out = {
    name: node.name,
    type: node.type,
    mode: node.mode,
    owner: node.owner,
    group: node.group,
    mtime: node.mtime,
    atime: node.atime,
    ctime: node.ctime,
  };
  if (node.type === 'file') {
    out.content = node.content;
  } else if (node.type === 'dir') {
    out.children = [];
    for (const child of node.children.values()) {
      out.children.push(serializeNode(child));
    }
  } else if (node.type === 'link') {
    out.target = node.target;
  }
  return out;
}

/**
 * Validate a NodeJSON payload recursively.
 *
 * @param {unknown} json
 * @param {string} path Base path for error reporting.
 * @returns {void}
 */
function validateNodeJSON(json, path) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw einval(path, 'node must be an object');
  }
  if (json.type !== 'file' && json.type !== 'dir' && json.type !== 'link') {
    throw einval(path + '.type', 'type must be one of: file, dir, link');
  }
  if (typeof json.name !== 'string' || json.name.length === 0) {
    throw einval(path + '.name', 'name must be a non-empty string');
  }
  if (!Number.isInteger(json.mode) || json.mode < 0 || json.mode > 0o7777) {
    throw einval(path + '.mode', 'mode must be an integer in [0, 0o7777]');
  }
  if (typeof json.owner !== 'string') {
    throw einval(path + '.owner', 'owner must be a string');
  }
  if (typeof json.group !== 'string') {
    throw einval(path + '.group', 'group must be a string');
  }
  if (typeof json.mtime !== 'number' || json.mtime < 0) {
    throw einval(path + '.mtime', 'mtime must be a non-negative number');
  }
  if (typeof json.atime !== 'number' || json.atime < 0) {
    throw einval(path + '.atime', 'atime must be a non-negative number');
  }
  if (typeof json.ctime !== 'number' || json.ctime < 0) {
    throw einval(path + '.ctime', 'ctime must be a non-negative number');
  }
  if (json.type === 'file') {
    if (typeof json.content !== 'string') {
      throw einval(path + '.content', 'file node must have string content');
    }
  } else if (json.type === 'dir') {
    if (!Array.isArray(json.children)) {
      throw einval(path + '.children', 'dir node must have array children');
    }
    for (let i = 0; i < json.children.length; i++) {
      validateNodeJSON(json.children[i], path + '.children[' + i + ']');
    }
  } else if (json.type === 'link') {
    if (typeof json.target !== 'string' || json.target.length === 0) {
      throw einval(path + '.target', 'link node must have non-empty string target');
    }
  }
}

/**
 * Build a Node from an already-validated NodeJSON payload.
 *
 * `size` is intentionally NOT read from JSON. For files it is derived
 * from `content.length`; for links, from `target.length` (Linux
 * semantics, spec008a §3.9). The Node constructor sets size=0 for
 * non-file types, so link size is overridden here.
 *
 * @param {object} json
 * @returns {import('./node.js').Node}
 */
function buildNode(json) {
  /** @type {object} */
  const attrs = {
    name: json.name,
    type: json.type,
    mode: json.mode,
    owner: json.owner,
    group: json.group,
  };
  if (json.type === 'file') {
    attrs.content = json.content;
  } else if (json.type === 'dir') {
    /** @type {Map<string, import('./node.js').Node>} */
    const children = new Map();
    for (const childJson of json.children) {
      children.set(childJson.name, buildNode(childJson));
    }
    attrs.children = children;
  } else if (json.type === 'link') {
    attrs.target = json.target;
  }
  const node = new Node(attrs);
  node.mtime = json.mtime;
  node.atime = json.atime;
  node.ctime = json.ctime;
  // Link size = target.length (spec008a §3.9, Linux behaviour). The
  // Node constructor computed 0 for non-file types, so override here
  // to keep `lstat().size === target.length` after deserialize.
  if (json.type === 'link') {
    node.size = json.target.length;
  }
  return node;
}

/**
 * Serialize a VFS to a JSON-safe plain object.
 *
 * @param {import('./filesystem.js').VFS} vfs
 * @returns {{schemaVersion: 1, root: object}}
 */
export function serializeVFS(vfs) {
  return {
    schemaVersion: 1,
    root: serializeNode(vfs.root),
  };
}

/**
 * Deserialize a plain object into a fresh VFS.
 *
 * @param {unknown} data
 * @returns {import('./filesystem.js').VFS}
 */
export function deserializeVFS(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw einval('root', 'data must be an object');
  }
  if (data.schemaVersion !== 1) {
    throw einval('schemaVersion', 'unsupported schema version');
  }
  if (!data.root) {
    throw einval('root', 'root node is required');
  }
  validateNodeJSON(data.root, 'root');
  const rootNode = buildNode(data.root);
  return new VFS(rootNode);
}