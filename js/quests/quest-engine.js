/**
 * Quest engine — progression state for a set of quests.
 *
 * Tracks which quests have been solved (in solve order) and exposes
 * read-only views for callers and the UI. Pure logic: no persistence,
 * no events, no UI, no VFS.
 *
 * The constructor keeps the original array order; that order defines
 * progression (spec005a §3.1). `getActiveQuest()` returns the first
 * unsolved quest in that order.
 *
 * @module quests/quest-engine
 */

export class QuestEngine {
  /**
   * @param {object[]} quests Already-validated quests. The engine keeps
   *   its own copy of the array (constructor order preserved); external
   *   mutation of the caller's array does not affect the engine.
   */
  constructor(quests) {
    /** @type {object[]} */
    this._quests = (quests || []).slice();
    /** @type {string[]} */
    this._solved = [];
  }

  /**
   * Return the first unsolved quest in constructor order, or `null` when
   * everything is solved.
   *
   * @returns {object|null}
   */
  getActiveQuest() {
    for (const quest of this._quests) {
      if (!this._solved.includes(quest.id)) return quest;
    }
    return null;
  }

  /**
   * Look up a quest by id.
   *
   * @param {string} id
   * @returns {object|undefined}
   */
  getQuestById(id) {
    return this._quests.find((q) => q.id === id);
  }

  /**
   * Shallow copy of the quest list: the returned array is independent
   * (mutating it, e.g. via push/splice, does not affect the engine), but
   * the quest objects inside are shared by reference. That matches V1's
   * assumption that validated quests from loadQuests are treated as
   * immutable data — callers are expected to read, not mutate, them.
   *
   * @returns {object[]}
   */
  getAllQuests() {
    return this._quests.slice();
  }

  /**
   * Shallow copy of the solved ids, in the order they were solved (NOT
   * in definition order).
   *
   * @returns {string[]}
   */
  getSolvedIds() {
    return this._solved.slice();
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  isSolved(id) {
    return this._solved.includes(id);
  }

  /**
   * Mark a quest as solved. Idempotent: solving an already-solved id is
   * a no-op.
   *
   * @param {string} id
   * @returns {void}
   * @throws {Error} with `.code = 'EQUEST_UNKNOWN'` and `.questId = id`
   *   when the id does not correspond to any quest.
   */
  solveQuest(id) {
    const quest = this.getQuestById(id);
    if (!quest) {
      const err = new Error('unknown quest id: ' + id);
      err.code = 'EQUEST_UNKNOWN';
      err.questId = id;
      throw err;
    }
    if (this._solved.includes(id)) return;
    this._solved.push(id);
  }

  /**
   * @returns {{solved: number, total: number}}
   */
  getProgress() {
    return { solved: this._solved.length, total: this._quests.length };
  }
}