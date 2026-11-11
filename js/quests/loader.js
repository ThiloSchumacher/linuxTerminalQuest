/**
 * Quest loader and validator.
 *
 * Reads a `quests.json`-shaped document (an object with a `quests` array),
 * validates every quest against the schema in spec005a §1 (+ spec012a
 * `difficulty`, + spec012b `goal.redirects` / `goal.pipeline`), checks
 * that all `id`s are unique, and returns the array.
 *
 * No VFS, no DOM, no UI, no shell — this module is pure logic. `fetch`
 * is only used as the default value of the `fetchFn` parameter; callers
 * (and tests) inject their own implementation.
 *
 * ## Null-as-absent convention
 *
 * Every optional quest field (`command`, `pipeline`, `redirects`,
 * `args`, and the per-stage `args`) uses a uniform rule:
 *
 *     "provided" ⇔ value is neither `undefined` nor `null`.
 *
 * This lets hand-written `quests.json` files use `field: null` as an
 * explicit placeholder for "not set" without triggering schema errors,
 * while `undefined` remains the standard default for omitted fields.
 * The rule is applied via the exported `isProvided` helper so it stays
 * visible at every use site (validator.js imports it). Required fields
 * (`redirect.op`, `redirect.target`, `pipeline[i].command`) do NOT
 * follow the rule — `null` there is a genuine schema error.
 *
 * **Distinction from "empty":** to express "no redirects allowed
 * (strict)", use `redirects: []` — an empty array is a *provided*
 * value, so the multiset comparison runs against an empty expectation.
 * `redirects: null` means "not set" = wildcard (no redirect check).
 *
 * ## Error contract (spec005a §2 + spec012a §1 + spec012b §1)
 *
 * Every failure carries a `.code`:
 *  - `EQUEST_LOAD`     → HTTP error, missing `quests` array, bad JSON.
 *  - `EQUEST_INVALID`  → schema violation or duplicate `id`.
 * There is no error path that escapes without a `.code`.
 *
 * @module quests/loader
 */

/**
 * Allowed `goal.type` values in V1.
 *
 * @type {ReadonlyArray<string>}
 */
const ALLOWED_GOAL_TYPES = Object.freeze([
  'command-executed',
  'file-exists',
  'file-mode',
  'file-owner',
  'output-contains',
]);

/**
 * Allowed `difficulty` values (spec012a §1).
 *
 * @type {ReadonlyArray<string>}
 */
const ALLOWED_DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

/**
 * Allowed `redirect.op` values (spec012b §1, aligned with spec007b).
 *
 * @type {ReadonlyArray<string>}
 */
const ALLOWED_REDIRECT_OPS = Object.freeze(['>', '>>', '<']);

/**
 * Test whether an optional field is "provided" per the null-as-absent
 * convention (see module JSDoc). Exported so `quests/validator.js`
 * uses the exact same rule — the convention is centralised here.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isProvided(value) {
  return value !== undefined && value !== null;
}

/**
 * Validate a single quest against the spec005a + spec012a + spec012b schema.
 *
 * @param {unknown} quest
 * @param {number} index Used only to build the `.path` in error messages.
 * @returns {void}
 * @throws {Error} with `.code = 'EQUEST_INVALID'` and `.path` set.
 */
export function validateQuest(quest, index) {
  /**
   * @param {string|null} pathSuffix
   * @param {string} message
   * @returns {never}
   */
  const fail = (pathSuffix, message) => {
    const err = new Error(message);
    err.code = 'EQUEST_INVALID';
    err.path = pathSuffix === null
      ? `quests[${index}]`
      : `quests[${index}].${pathSuffix}`;
    throw err;
  };

  if (!quest || typeof quest !== 'object' || Array.isArray(quest)) {
    fail(null, 'quest must be an object');
  }

  if (typeof quest.id !== 'string' || quest.id.length === 0) {
    fail('id', 'id must be a non-empty string');
  }
  if (typeof quest.module !== 'string' || quest.module.length === 0) {
    fail('module', 'module must be a non-empty string');
  }
  if (typeof quest.title !== 'string' || quest.title.length === 0) {
    fail('title', 'title must be a non-empty string');
  }
  if (quest.title.length > 60) {
    fail('title', 'title must be at most 60 characters');
  }
  if (typeof quest.description !== 'string' || quest.description.length === 0) {
    fail('description', 'description must be a non-empty string');
  }
  if (typeof quest.hint !== 'string' || quest.hint.length === 0) {
    fail('hint', 'hint must be a non-empty string');
  }
  if (typeof quest.difficulty !== 'string' || quest.difficulty.length === 0) {
    fail('difficulty', 'difficulty must be a non-empty string');
  }
  if (!ALLOWED_DIFFICULTIES.includes(quest.difficulty)) {
    fail(
      'difficulty',
      `invalid difficulty: ${quest.difficulty} (allowed: easy, medium, hard)`,
    );
  }
  if (!Number.isInteger(quest.xp) || quest.xp <= 0) {
    fail('xp', 'xp must be a positive integer');
  }

  if (!quest.goal || typeof quest.goal !== 'object' || Array.isArray(quest.goal)) {
    fail('goal', 'goal must be an object');
  }
  const goal = quest.goal;
  if (!ALLOWED_GOAL_TYPES.includes(goal.type)) {
    fail(
      'goal.type',
      `goal.type must be one of: ${ALLOWED_GOAL_TYPES.join(', ')}`,
    );
  }

  if (goal.type === 'command-executed') {
    validateCommandExecutedGoal(goal, fail);
  } else if (goal.type === 'file-exists') {
    if (typeof goal.path !== 'string' || goal.path.length === 0) {
      fail('goal.path', 'goal.path must be a non-empty string');
    }
  } else if (goal.type === 'file-mode') {
    // spec014b §1: mode is stored as an integer in JSON (e.g. 384
    // for 0o600 — JSON has no octal literals). Range 0..0o7777
    // covers permission bits plus setuid/setgid/sticky, matching the
    // VFS.chmod validation.
    if (typeof goal.path !== 'string' || goal.path.length === 0) {
      fail('goal.path', 'goal.path must be a non-empty string');
    }
    if (
      !Number.isInteger(goal.mode) ||
      goal.mode < 0 ||
      goal.mode > 0o7777
    ) {
      fail(
        'goal.mode',
        'goal.mode must be an integer between 0 and 0o7777 (4095)',
      );
    }
  } else if (goal.type === 'file-owner') {
    // spec014b §1: owner and group are both optional, but at least
    // one must be set — otherwise the goal would always be solved on
    // any existing file, which is never the intent of a quest.
    if (typeof goal.path !== 'string' || goal.path.length === 0) {
      fail('goal.path', 'goal.path must be a non-empty string');
    }
    const hasOwner = isProvided(goal.owner);
    const hasGroup = isProvided(goal.group);
    if (!hasOwner && !hasGroup) {
      fail('goal.owner', 'file-owner requires at least one of owner or group');
    }
    if (
      hasOwner &&
      (typeof goal.owner !== 'string' || goal.owner.length === 0)
    ) {
      fail('goal.owner', 'goal.owner must be a non-empty string');
    }
    if (
      hasGroup &&
      (typeof goal.group !== 'string' || goal.group.length === 0)
    ) {
      fail('goal.group', 'goal.group must be a non-empty string');
    }
  } else if (goal.type === 'output-contains') {
    if (typeof goal.substring !== 'string' || goal.substring.length === 0) {
      fail('goal.substring', 'goal.substring must be a non-empty string');
    }
    if (isProvided(goal.command)) {
      if (typeof goal.command !== 'string' || goal.command.length === 0) {
        fail('goal.command', 'goal.command must be a non-empty string');
      }
    }
  }
}

/**
 * Validate the `command-executed` goal (spec005a + spec012b §1).
 *
 * @param {object} goal
 * @param {(suffix: string|null, message: string) => never} fail
 * @returns {void}
 */
function validateCommandExecutedGoal(goal, fail) {
  const hasCommand = isProvided(goal.command);
  const hasPipeline = isProvided(goal.pipeline);

  if (hasCommand && hasPipeline) {
    fail(
      'goal.command',
      'command-executed requires either command or pipeline (not both)',
    );
  }
  if (!hasCommand && !hasPipeline) {
    fail('goal.pipeline', 'command-executed requires command or pipeline');
  }

  if (hasCommand) {
    if (typeof goal.command !== 'string' || goal.command.length === 0) {
      fail('goal.command', 'goal.command must be a non-empty string');
    }
    if (isProvided(goal.args)) {
      if (!Array.isArray(goal.args)) {
        fail('goal.args', 'goal.args must be an array of strings');
      }
      for (const arg of goal.args) {
        if (typeof arg !== 'string') {
          fail('goal.args', 'goal.args must be an array of strings');
        }
      }
    }
    if (isProvided(goal.redirects)) {
      if (!Array.isArray(goal.redirects)) {
        fail('goal.redirects', 'goal.redirects must be an array');
      }
      for (const r of goal.redirects) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
          fail(
            'goal.redirects',
            'goal.redirects[i] must be an object with op/target',
          );
        }
        if (!ALLOWED_REDIRECT_OPS.includes(r.op)) {
          fail(
            'goal.redirects',
            'goal.redirects[i].op must be one of >, >>, <',
          );
        }
        if (typeof r.target !== 'string' || r.target.length === 0) {
          fail(
            'goal.redirects',
            'goal.redirects[i].target must be a non-empty string',
          );
        }
      }
      // spec007b §5: executor allows at most ONE `<` and ONE `>`/`>>`
      // per command. More would be unsolvable. Reject at load time.
      const inputCount = goal.redirects.filter((r) => r.op === '<').length;
      const outputCount = goal.redirects.filter(
        (r) => r.op === '>' || r.op === '>>',
      ).length;
      if (inputCount > 1) {
        fail(
          'goal.redirects',
          'at most one "<" redirect supported in V1 (executor limitation)',
        );
      }
      if (outputCount > 1) {
        fail(
          'goal.redirects',
          'at most one ">"/">>" redirect supported in V1 (executor limitation)',
        );
      }
    }
    return;
  }

  // Variant B: pipeline.
  if (isProvided(goal.redirects)) {
    fail('goal.redirects', 'redirects not supported with pipeline');
  }
  if (!Array.isArray(goal.pipeline) || goal.pipeline.length === 0) {
    fail('goal.pipeline', 'goal.pipeline must be a non-empty array');
  }
  for (const stage of goal.pipeline) {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
      fail('goal.pipeline', 'goal.pipeline[i] must be an object with command');
    }
    if (typeof stage.command !== 'string' || stage.command.length === 0) {
      fail('goal.pipeline', 'goal.pipeline[i].command must be a non-empty string');
    }
    if (isProvided(stage.args)) {
      if (!Array.isArray(stage.args)) {
        fail('goal.pipeline', 'goal.pipeline[i].args must be an array of strings');
      }
      for (const arg of stage.args) {
        if (typeof arg !== 'string') {
          fail('goal.pipeline', 'goal.pipeline[i].args must be an array of strings');
        }
      }
    }
  }
}

/**
 * Load and validate a quests file.
 *
 * @param {string} url
 * @param {typeof fetch} [fetchFn=fetch]
 * @returns {Promise<object[]>}
 * @throws {Error} with `.code = 'EQUEST_LOAD'` or `'EQUEST_INVALID'`.
 */
export async function loadQuests(url, fetchFn = fetch) {
  const res = await fetchFn(url);
  if (!res || !res.ok) {
    const err = new Error(
      'failed to load quests: HTTP ' + (res ? res.status : 'unknown'),
    );
    err.code = 'EQUEST_LOAD';
    throw err;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const err = new Error('invalid JSON in quests file: ' + msg);
    err.code = 'EQUEST_LOAD';
    throw err;
  }

  if (!data || !Array.isArray(data.quests)) {
    const err = new Error('quests.json must contain a "quests" array');
    err.code = 'EQUEST_LOAD';
    throw err;
  }

  for (let i = 0; i < data.quests.length; i++) {
    validateQuest(data.quests[i], i);
  }

  /** @type {Set<string>} */
  const seen = new Set();
  for (let i = 0; i < data.quests.length; i++) {
    const id = data.quests[i].id;
    if (seen.has(id)) {
      const err = new Error('duplicate id: ' + id);
      err.code = 'EQUEST_INVALID';
      err.path = `quests[${i}].id`;
      throw err;
    }
    seen.add(id);
  }

  return data.quests;
}