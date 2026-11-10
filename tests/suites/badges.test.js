import { describe, it, expect } from '../runner.js';
import { BADGES, BadgeTracker } from '../../js/gamification/badges.js';

/**
 * Minimal valid quest fixture for state construction.
 *
 * @param {string} id
 * @param {string} [module='basics']
 * @returns {object}
 */
function makeQuest(id, module = 'basics') {
  return {
    id,
    module,
    title: 'T',
    description: 'D',
    hint: 'H',
    goal: { type: 'command-executed', command: 'pwd' },
    xp: 10,
  };
}

/**
 * @param {object[]} solved
 * @param {object[]} all
 * @returns {{solvedQuests: object[], allQuests: object[]}}
 */
function stateOf(solved, all) {
  return { solvedQuests: solved, allQuests: all };
}

/**
 * @param {object[]} badges
 * @returns {string[]}
 */
function ids(badges) {
  return badges.map((b) => b.id);
}

// ---------------------------------------------------------------------------
// BADGES definition
// ---------------------------------------------------------------------------

describe('BADGES definition', () => {
  it('has exactly 3 badges', () => {
    expect(BADGES.length).toBe(3);
  });

  it('has unique ids', () => {
    const seen = new Set(BADGES.map((b) => b.id));
    expect(seen.size).toBe(BADGES.length);
  });

  it('every badge has id, title, description and check', () => {
    for (const b of BADGES) {
      expect(typeof b.id).toBe('string');
      expect(typeof b.title).toBe('string');
      expect(typeof b.description).toBe('string');
      expect(typeof b.check).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// BadgeTracker
// ---------------------------------------------------------------------------

describe('BadgeTracker', () => {
  it('returns [] when nothing is solved', () => {
    const t = new BadgeTracker();
    const q = makeQuest('q1');
    expect(ids(t.check(stateOf([], [q])))).toEqual([]);
  });

  it('unlocks "first-quest" when at least one quest is solved', () => {
    const t = new BadgeTracker();
    const q = makeQuest('q1');
    expect(ids(t.check(stateOf([q], [q])))).toEqual(['first-quest']);
  });

  it('is idempotent — a second call does not re-unlock', () => {
    const t = new BadgeTracker();
    const q = makeQuest('q1');
    t.check(stateOf([q], [q]));
    expect(ids(t.check(stateOf([q], [q])))).toEqual([]);
  });

  it('unlocks "basics-complete" when all basics quests are solved', () => {
    const t = new BadgeTracker();
    const q1 = makeQuest('q1', 'basics');
    const q2 = makeQuest('q2', 'basics');
    const q3 = makeQuest('q3', 'text');

    // First solve: only q1 — unlocks first-quest.
    t.check(stateOf([q1], [q1, q2, q3]));

    // Second solve: q2 as well — completes basics.
    const result = t.check(stateOf([q1, q2], [q1, q2, q3]));
    expect(ids(result)).toEqual(['basics-complete']);
  });

  it('does NOT unlock "basics-complete" when basics module is empty', () => {
    const t = new BadgeTracker();
    const q1 = makeQuest('q1', 'text');
    // Unlock first-quest first so the second call does not report it.
    t.check(stateOf([q1], [q1]));
    expect(ids(t.check(stateOf([q1], [q1])))).toEqual([]);
  });

  it('unlocks "all-quests" when every quest is solved', () => {
    const t = new BadgeTracker();
    const q1 = makeQuest('q1', 'basics');
    const q2 = makeQuest('q2', 'text');

    // q1 only → first-quest + basics-complete (all basics = just q1).
    t.check(stateOf([q1], [q1, q2]));

    // Both solved → all-quests.
    const result = t.check(stateOf([q1, q2], [q1, q2]));
    expect(ids(result)).toEqual(['all-quests']);
  });

  it('does NOT unlock "all-quests" when allQuests is empty', () => {
    const t = new BadgeTracker();
    expect(ids(t.check(stateOf([], [])))).toEqual([]);
    expect(t.getUnlocked().length).toBe(0);
  });

  it('getUnlocked() returns a copy — mutating it does not affect tracker state', () => {
    const t = new BadgeTracker();
    const q = makeQuest('q1');
    t.check(stateOf([q], [q]));
    const copy = t.getUnlocked();
    copy.push({ id: 'fake', title: '', description: '', check: () => true });
    expect(t.getUnlocked().length).toBe(1);
  });

  it('reset() clears both unlockedIds and unlocked', () => {
    const t = new BadgeTracker();
    const q = makeQuest('q1');
    t.check(stateOf([q], [q]));
    expect(t.getUnlocked().length).toBe(1);
    t.reset();
    expect(t.getUnlocked().length).toBe(0);
    // After reset, first-quest must unlock again.
    expect(ids(t.check(stateOf([q], [q])))).toEqual(['first-quest']);
  });

  it('within a single call, returns badges in BADGES-array order', () => {
    // Solve a single basics quest in a state where only the first two
    // badges apply: first-quest AND basics-complete. The return order
    // must follow BADGES (first-quest first), not the order the `state`
    // happens to make them true.
    const t = new BadgeTracker();
    const q = makeQuest('q1', 'basics');
    const result = t.check(stateOf([q], [q]));
    expect(ids(result)).toEqual(['first-quest', 'basics-complete']);
  });

  it('getUnlocked() reports unlock order, not definition order', () => {
    // Use custom badges to force a case where a later-defined badge
    // unlocks first. With the default three badges, chronological order
    // happens to coincide with definition order for all reachable states.
    const badgeA = {
      id: 'A',
      title: 'A',
      description: '',
      check: () => false, // never true on its own
    };
    const badgeB = {
      id: 'B',
      title: 'B',
      description: '',
      check: () => true, // always true
    };
    const t = new BadgeTracker({ badges: [badgeA, badgeB] });

    t.check(stateOf([], []));
    // Definition order is [A, B], but only B unlocked → getUnlocked
    // returns [B], not [A, B].
    expect(ids(t.getUnlocked())).toEqual(['B']);
  });
});