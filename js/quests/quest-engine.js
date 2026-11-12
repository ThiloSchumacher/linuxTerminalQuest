/**
 * Quest engine — progression state for a set of quests.
 *
 * Tracks which quests have been solved (in solve order) and exposes
 * read-only views for callers and the UI. Pure logic: no persistence,
 * no events, no UI, no VFS.
 *
 * The constructor keeps the original array order; that order defines
 * progression (spec005a §3.1). `getActiveQuest()` returns the first
 * unsolved quest in that order unless an explicit selection has been
 * set via `setActiveQuest()` (spec015a §1).
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

    /**
     * Explicitly-selected active quest id (spec015a §1.1).
     *
     * Intentionally PUBLIC (no `_` prefix), unlike `_quests` and
     * `_solved`. `storage/persistence.js` reads and writes it directly
     * (`questEngine.activeQuestId`) as part of save/restore, per
     * spec015a §1.5's "V1: direkter Zugriff, Property ist öffentlich
     * dokumentiert." Adding a getter/setter pair here would be the
     * cleaner API, but it would also change every caller for no
     * functional benefit and diverge from the spec.
     *
     * `null` means "no explicit selection — fall back to the first
     * unsolved quest in constructor order." The value is auto-cleared
     * by `solveQuest` (when the active quest is solved) and by
     * `getActiveQuest` (when the active quest id resolves to a solved
     * or unknown quest — defensive cleanup, see §1.2).
     *
     * @type {string|null}
     */
    this.activeQuestId = null;
  }

  /**
   * Return the currently active quest.
   *
   * If `activeQuestId` is set AND refers to an unsolved, known quest,
   * that quest is returned. Otherwise the engine falls back to the
   * first unsolved quest in constructor order (spec005a §3.1) — and
   * silently clears any stale `activeQuestId` (spec015a §1.2).
   *
   * The auto-cleanup is defensive: a stale id can appear when
   * (a) a quest was solved outside `solveQuest` (not possible in V1,
   * but pinned for safety), or (b) the quest catalogue shrank between
   * sessions and the persisted active id no longer matches anything.
   * The restore path in `persistence.js` already filters these cases,
   * so the in-engine cleanup is belt-and-braces.
   *
   * @returns {object|null}
   */
  getActiveQuest() {
    if (this.activeQuestId) {
      const explicit = this.getQuestById(this.activeQuestId);
      if (explicit && !this.isSolved(explicit.id)) return explicit;
      this.activeQuestId = null;
    }
    for (const quest of this._quests) {
      if (!this._solved.includes(quest.id)) return quest;
    }
    return null;
  }

  /**
   * Explicitly select the active quest (spec015a §1.3).
   *
   * Only sets `activeQuestId` on the engine — does NOT mutate the
   * quest object, does NOT persist. Persistence is `app.js`'s
   * responsibility (`saveAppState` is called by the caller after a
   * successful selection).
   *
   * @param {string} id
   * @returns {void}
   * @throws {Error} with `.code = 'EQUEST_UNKNOWN'`, `.questId = id`
   *   when the id is not in the catalogue.
   * @throws {Error} with `.code = 'EQUEST_SOLVED'`, `.questId = id`
   *   when the id refers to an already-solved quest.
   */
  setActiveQuest(id) {
    const quest = this.getQuestById(id);
    if (!quest) {
      const err = new Error('unknown quest id: ' + id);
      err.code = 'EQUEST_UNKNOWN';
      err.questId = id;
      throw err;
    }
    if (this.isSolved(id)) {
      const err = new Error('quest already solved: ' + id);
      err.code = 'EQUEST_SOLVED';
      err.questId = id;
      throw err;
    }
    this.activeQuestId = id;
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
    // spec015a §1.4: solving the active quest clears the explicit
    // selection so the next `getActiveQuest()` returns the first
    // unsolved quest in constructor order — the "auto-mode" fallback.
    if (this.activeQuestId === id) {
      this.activeQuestId = null;
    }
  }

  /**
   * @returns {{solved: number, total: number}}
   */
  getProgress() {
    return { solved: this._solved.length, total: this._quests.length };
  }
}