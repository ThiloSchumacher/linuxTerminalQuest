/**
 * Command registry.
 *
 * Registers the V1 shell commands and re-exports the contract typedefs.
 * Every registered command MUST carry `usage` and `description` —
 * `createCommandRegistry()` validates this and throws a
 * programmer-error `Error` (not a user error) when a command is
 * missing one, message: `command <name> missing usage/description`.
 *
 * @module shell/commands/index
 */

import { pwd } from './pwd.js';
import { cd } from './cd.js';
import { echo } from './echo.js';
import { ls } from './ls.js';
import { cat } from './cat.js';
import { mkdir } from './mkdir.js';
import { touch } from './touch.js';
import { rm } from './rm.js';
import { cp } from './cp.js';
import { mv } from './mv.js';
import { chmod } from './chmod.js';
import { grep } from './grep.js';
import { head } from './head.js';
import { tail } from './tail.js';
import { wc } from './wc.js';
import { sort } from './sort.js';
import { ln } from './ln.js';
import { clear } from './clear.js';
import { history } from './history.js';
import { whoami } from './whoami.js';
import { date } from './date.js';
import { uname } from './uname.js';
import { which } from './which.js';
import { stat } from './stat.js';
import { file } from './file.js';
import { tree } from './tree.js';
import { sed } from './sed.js';
import { cut } from './cut.js';
import { tr } from './tr.js';
import { tee } from './tee.js';
import { seq } from './seq.js';
import { nl } from './nl.js';
import { rev } from './rev.js';
import { basename } from './basename.js';
import { dirname } from './dirname.js';
import { find } from './find.js';
import { help } from './help.js';

/**
 * Services passed to every command's `run()`.
 *
 * @typedef {object} CommandServices
 * @property {import('../../terminal/terminal.js').TerminalUI} [terminal]
 *   The TerminalUI instance; provides `.write(text)` and `.clear()`.
 *   Optional — commands must guard against it being absent.
 * @property {import('../../terminal/line-editor.js').LineEditor} [lineEditor]
 *   The LineEditor instance; provides `.getHistory()`. Optional —
 *   commands must guard against it being absent.
 */

/**
 * Context passed to a command when it runs.
 *
 * @typedef {object} CommandContext
 * @property {string[]} argv            Arguments *without* the program name.
 * @property {string} name              Program name as invoked.
 * @property {import('../env.js').Env} env
 * @property {import('../../vfs/filesystem.js').VFS} vfs
 * @property {string|null} stdin        Standard input, or `null` when
 *   there is none. `-` as a filename is NOT treated as stdin in V1.
 * @property {CommandServices} services Services object forwarded from
 *   the executor; may be `{}` when the caller has nothing to inject.
 */

/**
 * Result of a command execution.
 *
 * @typedef {object} CommandResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} exitCode
 */

/**
 * A registered command.
 *
 * @typedef {object} CommandObject
 * @property {string} name
 * @property {string} usage            One-line syntax summary. Required.
 * @property {string} description      One-sentence description. Required.
 * @property {(ctx: CommandContext) => CommandResult} run
 */

/**
 * Throw if a command lacks `usage` or `description`. Programmer error,
 * not user error — no catch upstream.
 *
 * @param {CommandObject} cmdObj
 * @returns {void}
 * @throws {Error} with message `command <name> missing usage/description`.
 */
function assertHasMetadata(cmdObj) {
  if (
    typeof cmdObj.usage !== 'string' || cmdObj.usage.length === 0 ||
    typeof cmdObj.description !== 'string' || cmdObj.description.length === 0
  ) {
    throw new Error(`command ${cmdObj.name} missing usage/description`);
  }
}

/**
 * Create a registry with all V1 commands pre-registered.
 *
 * @returns {Map<string, CommandObject>}
 */
export function createCommandRegistry() {
  const registry = new Map();

  const add = (cmdObj) => {
    assertHasMetadata(cmdObj);
    registry.set(cmdObj.name, cmdObj);
  };

  add(pwd);
  add(cd);
  add(echo);
  add(ls);
  add(cat);
  add(mkdir);
  add(touch);
  add(rm);
  add(cp);
  add(mv);
  add(chmod);
  add(grep);
  add(head);
  add(tail);
  add(wc);
  add(sort);
  add(ln);
  add(clear);
  add(history);
  add(whoami);
  add(date);
  add(uname);
  add(which);
  add(stat);
  add(file);
  add(tree);
  add(sed);
  add(cut);
  add(tr);
  add(tee);
  add(seq);
  add(nl);
  add(rev);
  add(basename);
  add(dirname);
  add(find);
  add(help);

  return registry;
}