import { parse } from '../shell/parser.js';
import { isProvided } from './loader.js';

/**
 * QuestValidator — turn shell input + executor result into quest progress.
 *
 * Called after every user command. Checks the currently active quest's
 * goal against the input string and the executor result. If the goal is
 * met, marks the quest as solved in the `QuestEngine` and reports the
 * solved quest id back to the caller.
 *
 * ## Null-as-absent (spec012b)
 *
 * Optional quest fields (`command`, `pipeline`, `args`, `redirects`,
 * per-stage `args`) follow the null-as-absent convention **imported
 * from `quests/loader.js`** — one shared `isProvided` helper ensures
 * both files use the exact same rule. See the loader module JSDoc for
 * the full rationale, including the distinction between `null`
 * (not set → wildcard / no redirect check) and `[]` (empty array →
 * strict, compared as multiset).
 *
 * @module quests/validator
 */
export class QuestValidator {
  /**
   * @param {object} opts
   * @param {import('../vfs/filesystem.js').VFS} opts.vfs
   * @param {import('../shell/env.js').Env} opts.env
   * @param {import('./quest-engine.js').QuestEngine} opts.questEngine
   */
  constructor({ vfs, env, questEngine }) {
    this._vfs = vfs;
    this._env = env;
    this._questEngine = questEngine;
  }

  /**
   * Check whether the active quest is solved by this command.
   *
   * @param {string} input
   * @param {{stdout: string, stderr: string, exitCode: number}} result
   * @returns {{solved: boolean, questId: string|null}}
   */
  check(input, result) {
    const active = this._questEngine.getActiveQuest();
    if (!active) return { solved: false, questId: null };

    const solved = this._checkGoal(active, input, result);
    if (!solved) return { solved: false, questId: null };

    this._questEngine.solveQuest(active.id);
    return { solved: true, questId: active.id };
  }

  /**
   * @param {object} quest
   * @param {string} input
   * @param {{stdout: string, stderr: string, exitCode: number}} result
   * @returns {boolean}
   */
  _checkGoal(quest, input, result) {
    const goal = quest.goal;
    switch (goal.type) {
      case 'command-executed':
        return this._checkCommandExecuted(goal, input, result);
      case 'file-exists':
        return this._checkFileExists(goal);
      case 'file-mode':
        return this._checkFileMode(goal);
      case 'file-owner':
        return this._checkFileOwner(goal);
      case 'output-contains':
        return this._checkOutputContains(goal, input, result);
      default:
        return false;
    }
  }

  /**
   * @param {object} goal
   * @param {string} input
   * @param {{stdout: string, stderr: string, exitCode: number}} result
   * @returns {boolean}
   */
  _checkCommandExecuted(goal, input, result) {
    if (typeof input !== 'string') return false;
    let ast;
    try {
      ast = parse(input);
    } catch {
      return false;
    }
    if (ast.pipelines.length === 0) return false;
    const pipeline = ast.pipelines[0];

    if (isProvided(goal.command)) {
      return this._checkSingleCommand(goal, pipeline, result);
    }
    if (isProvided(goal.pipeline)) {
      return this._checkPipeline(goal, pipeline, result);
    }
    return false;
  }

  /**
   * Variant A. `redirects: null` → wildcard (skip check);
   * `redirects: []` → strict (must match zero redirects).
   *
   * @param {object} goal
   * @param {{commands: Array<{argv: string[], redirects: Array<{op: string, fd: number, target: string}>}>}} pipeline
   * @param {{stdout: string, stderr: string, exitCode: number}} result
   * @returns {boolean}
   */
  _checkSingleCommand(goal, pipeline, result) {
    if (result.exitCode !== 0) return false;
    if (pipeline.commands.length !== 1) return false;
    const cmd = pipeline.commands[0];
    if (cmd.argv.length === 0) return false;
    if (cmd.argv[0] !== goal.command) return false;

    if (isProvided(goal.args)) {
      const actual = cmd.argv.slice(1);
      if (actual.length !== goal.args.length) return false;
      for (let i = 0; i < goal.args.length; i++) {
        if (actual[i] !== goal.args[i]) return false;
      }
    }

    if (isProvided(goal.redirects)) {
      if (!redirectsMatch(cmd.redirects, goal.redirects)) return false;
    }

    return true;
  }

  /**
   * @param {object} goal
   * @param {{commands: Array<{argv: string[], redirects: Array<object>}>}} pipeline
   * @param {{stdout: string, stderr: string, exitCode: number}} result
   * @returns {boolean}
   */
  _checkPipeline(goal, pipeline, result) {
    if (result.exitCode !== 0) return false;
    if (pipeline.commands.length !== goal.pipeline.length) return false;

    for (let i = 0; i < goal.pipeline.length; i++) {
      const expected = goal.pipeline[i];
      const cmd = pipeline.commands[i];
      if (cmd.argv.length === 0) return false;
      if (cmd.argv[0] !== expected.command) return false;
      if (isProvided(expected.args)) {
        const actualArgs = cmd.argv.slice(1);
        if (actualArgs.length !== expected.args.length) return false;
        for (let j = 0; j < expected.args.length; j++) {
          if (actualArgs[j] !== expected.args[j]) return false;
        }
      }
    }

    return true;
  }

  /**
   * @param {object} goal
   * @returns {boolean}
   */
  _checkFileExists(goal) {
    const cwd = this._env.get('PWD') || '/';
    return this._vfs.exists(goal.path, cwd);
  }

  /**
   * `file-mode` goal (spec014b §1): the node at `path` has exactly
   * the expected numeric mode.
   *
   * Uses `lstat`, NOT `stat` — the goal describes the node itself
   * (link metadata), not the target's. A broken symlink therefore
   * still has a mode; a `stat` call would throw ENOENT on it. This
   * matches the shell's `chmod` + `ls -l` semantics: `chmod` follows
   * symlinks but `ls -l` on a link shows the LINK's mode.
   *
   * Missing path / ELOOP / EINVAL → `false`, not throw. A quest
   * silently stays unsolved until the file exists; the UI has no
   * error channel for "target missing during goal check", and the
   * user can simply run the underlying command again.
   *
   * @param {object} goal
   * @returns {boolean}
   */
  _checkFileMode(goal) {
    const cwd = this._env.get('PWD') || '/';
    let meta;
    try {
      meta = this._vfs.lstat(goal.path, cwd);
    } catch {
      return false;
    }
    return meta.mode === goal.mode;
  }

  /**
   * `file-owner` goal (spec014b §1): the node at `path` has the
   * expected owner and/or group.
   *
   * `owner` and `group` are both optional in the goal (validated at
   * least one must be set — see loader.js). Fields that are `null` /
   * `undefined` are wildcards (skipped). `lstat`, not `stat`: same
   * link-vs-target reasoning as `_checkFileMode`.
   *
   * @param {object} goal
   * @returns {boolean}
   */
  _checkFileOwner(goal) {
    const cwd = this._env.get('PWD') || '/';
    let meta;
    try {
      meta = this._vfs.lstat(goal.path, cwd);
    } catch {
      return false;
    }
    if (isProvided(goal.owner) && meta.owner !== goal.owner) return false;
    if (isProvided(goal.group) && meta.group !== goal.group) return false;
    return true;
  }

  /**
   * `command: null` → wildcard (any command); `command: 'ls'` →
   * first-token match. See loader JSDoc for the null-as-absent rule.
   *
   * @param {object} goal
   * @param {string} input
   * @param {{stdout: string, stderr: string, exitCode: number}} result
   * @returns {boolean}
   */
  _checkOutputContains(goal, input, result) {
    if (isProvided(goal.command)) {
      const argv = this._parseArgv(input);
      if (!argv || argv.length === 0) return false;
      if (argv[0] !== goal.command) return false;
    }
    return (result.stdout || '').includes(goal.substring);
  }

  /**
   * @param {string} input
   * @returns {string[]|null}
   */
  _parseArgv(input) {
    if (typeof input !== 'string') return null;
    let ast;
    try {
      ast = parse(input);
    } catch {
      return null;
    }
    if (ast.pipelines.length === 0) return null;
    const pipeline = ast.pipelines[0];
    if (pipeline.commands.length !== 1) return null;
    return pipeline.commands[0].argv;
  }
}

/**
 * Compare two redirect arrays as multisets (`op` + `target` pairs).
 *
 * @param {Array<{op: string, target: string, fd?: number}>} actual
 * @param {Array<{op: string, target: string}>} expected
 * @returns {boolean}
 */
function redirectsMatch(actual, expected) {
  const norm = (arr) => arr.map((r) => `${r.op}:${r.target}`).sort().join('|');
  return norm(actual) === norm(expected);
}