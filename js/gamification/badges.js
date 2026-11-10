/**
 * Badges — V1 has exactly three, defined as plain objects with a
 * `check(state)` predicate.
 *
 * Pure logic: no DOM, no timers, no persistence. Unlocking is decided by
 * `BadgeTracker`; the caller (app.js) is responsible for showing a toast.
 *
 * **Presentation note:** `title` is the canonical display name for a
 * badge. The caller formats the toast (e.g. `'Badge: ' + badge.title`);
 * that prefix is an app-layer presentation detail, NOT part of the
 * badge definition. Do not add a `toastPrefix` field here — if
 * localization or a different visual style is needed later, that
 * belongs in the UI layer (spec005d's badge inventory), not in this
 * domain module.
 *
 * @module gamification/badges
 */

/**
 * @typedef {object} BadgeState
 * @property {object[]} solvedQuests Quest objects (already solved),
 *   in solve order.
 * @property {object[]} allQuests    All quest objects, in definition order.
 */

/**
 * @typedef {object} BadgeDefinition
 * @property {string} id
 * @property {string} title        Canonical display name (see module note).
 * @property {string} description
 * @property {(state: BadgeState) => boolean} check
 */

/**
 * The three V1 badges, in definition order.
 *
 * @type {ReadonlyArray<BadgeDefinition>}
 */
export const BADGES = [
  {
    id: 'first-quest',
    title: 'Erste Schritte',
    description: 'Deine erste Quest abgeschlossen.',
    check: (state) => state.solvedQuests.length >= 1,
  },
  {
    id: 'basics-complete',
    title: 'Grundlagen gemeistert',
    description: 'Alle Quests im Modul "basics" abgeschlossen.',
    check: (state) => {
      const basics = state.allQuests.filter((q) => q.module === 'basics');
      if (basics.length === 0) return false;
      const solvedIds = new Set(state.solvedQuests.map((q) => q.id));
      return basics.every((q) => solvedIds.has(q.id));
    },
  },
  {
    id: 'all-quests',
    title: 'BashQuest-Champion',
    description: 'Alle Quests abgeschlossen.',
    check: (state) =>
      state.allQuests.length > 0 &&
      state.solvedQuests.length === state.allQuests.length,
  },
];

/**
 * Tracks which badges have been unlocked and returns newly unlocked ones
 * on each `check` call.
 */
export class BadgeTracker {
  /**
   * @param {object} [opts]
   * @param {ReadonlyArray<BadgeDefinition>} [opts.badges=BADGES] Alternative
   *   badge list (used by tests for ordering cases).
   */
  constructor({ badges = BADGES } = {}) {
    this._badges = badges;
    /** @type {Set<string>} */
    this._unlockedIds = new Set();
    /** @type {BadgeDefinition[]} */
    this._unlocked = [];
  }

  /**
   * Evaluate every not-yet-unlocked badge against `state`. Badges that
   * pass are marked unlocked and returned.
   *
   * Returned badges are in BADGES-array order (definition order), NOT in
   * the order they happened to be triggered by `state`. Across calls,
   * `getUnlocked()` reports chronological unlock order.
   *
   * Idempotent: badges already unlocked are not evaluated again and are
   * never returned a second time.
   *
   * @param {BadgeState} state
   * @returns {BadgeDefinition[]} Newly unlocked badges in this call.
   */
  check(state) {
    /** @type {BadgeDefinition[]} */
    const newly = [];
    for (const badge of this._badges) {
      if (this._unlockedIds.has(badge.id)) continue;
      if (badge.check(state)) {
        this._unlockedIds.add(badge.id);
        this._unlocked.push(badge);
        newly.push(badge);
      }
    }
    return newly;
  }

  /**
   * Copy of the unlocked badges, in the order they were unlocked (not
   * in definition order, though they often coincide for the V1 set).
   *
   * @returns {BadgeDefinition[]}
   */
  getUnlocked() {
    return this._unlocked.slice();
  }

  /**
   * Clear unlocked state — used by the future "Neustart" button and by
   * persistence (spec006) on a clean session.
   *
   * @returns {void}
   */
  reset() {
    this._unlockedIds = new Set();
    this._unlocked = [];
  }
}