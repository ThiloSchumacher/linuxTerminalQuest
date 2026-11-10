import { Node } from './node.js';
import { VFS } from './filesystem.js';

/**
 * Recursively set owner/group on a node and its subtree.
 *
 * @param {Node} node
 * @param {string} owner
 * @returns {void}
 */
function setOwner(node, owner) {
  node.owner = owner;
  node.group = owner;
  if (node.children) {
    for (const child of node.children.values()) {
      setOwner(child, owner);
    }
  }
}

/**
 * Build the initial virtual file system shipped with BashQuest.
 *
 * @returns {VFS}
 */
export function createInitialFS() {
  const root = new Node({
    name: '/',
    type: 'dir',
    mode: 0o755,
    owner: 'root',
    group: 'root',
  });
  const vfs = new VFS(root);

  // createDir already applies 0o755 by default — no chmod needed.
  vfs.createDir('/bin', '/');

  vfs.createDir('/etc', '/');
  vfs.createFile(
    '/etc/passwd',
    '/',
    'root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:User:/home/user:/bin/bash\n',
  );
  vfs.createFile('/etc/hosts', '/', '127.0.0.1 localhost\n');
  vfs.createFile('/etc/motd', '/', 'Willkommen bei BashQuest\n');

  vfs.createDir('/home', '/');
  vfs.createDir('/home/user', '/');
  vfs.createFile('/home/user/.bashrc', '/', "export PS1='$ '\n");
  vfs.createFile('/home/user/notes.txt', '/', 'Meine Notizen\n');
  vfs.createDir('/home/user/projects', '/');

  vfs.createDir('/tmp', '/');
  vfs.chmod('/tmp', 0o1777);

  vfs.createDir('/var', '/');
  vfs.createDir('/var/log', '/');
  vfs.createFile('/var/log/auth.log', '/', 'user login: ok\n');

  setOwner(vfs.resolve('/home/user', '/'), 'user');

  return vfs;
}