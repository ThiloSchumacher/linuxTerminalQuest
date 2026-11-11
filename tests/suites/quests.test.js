import { describe, it, expect } from '../runner.js';
import { validateQuest, loadQuests } from '../../js/quests/loader.js';
import { QuestEngine } from '../../js/quests/quest-engine.js';
import { deriveXp, deriveBadges } from '../../js/storage/persistence.js';
import { BadgeTracker } from '../../js/gamification/badges.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a valid quest, with optional overrides.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
function makeQuest(overrides = {}) {
  return {
    id: 'quest-001',
    module: 'basics',
    difficulty: 'easy',
    title: 'Erster Befehl',
    description: 'Führe pwd aus.',
    hint: 'pwd zeigt das aktuelle Verzeichnis.',
    goal: { type: 'command-executed', command: 'pwd' },
    xp: 10,
    ...overrides,
  };
}

/**
 * Three valid quests with distinct ids.
 *
 * @returns {object[]}
 */
function makeThreeQuests() {
  return [
    makeQuest({ id: 'quest-001', title: 'Erster Befehl' }),
    makeQuest({ id: 'quest-002', title: 'Zweiter Befehl' }),
    makeQuest({ id: 'quest-003', title: 'Dritter Befehl' }),
  ];
}

/**
 * Minimal fetch stub.
 *
 * @param {unknown} body
 * @param {number} [status=200]
 * @param {boolean} [ok=true]
 * @returns {(url: string) => Promise<{ok: boolean, status: number, json: () => Promise<unknown>}>}
 */
function makeFetch(body, status = 200, ok = true) {
  return async (_url) => ({
    ok,
    status,
    json: async () => body,
  });
}

/**
 * Fetch stub whose `res.json()` rejects.
 *
 * @returns {(url: string) => Promise<{ok: boolean, status: number, json: () => Promise<unknown>}>}
 */
function makeFetchWithBrokenJson() {
  return async (_url) => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  });
}

/**
 * Assert that `fn` (synchronous) throws with the given `.code`/`.path`.
 *
 * @param {() => void} fn
 * @param {string} code
 * @param {string} [path]
 * @returns {Error}
 */
function expectThrowSync(fn, code, path) {
  if (Object.prototype.toString.call(fn) === '[object AsyncFunction]') {
    throw new Error(
      'expectThrowSync called with async fn; use expectReject instead',
    );
  }
  try {
    fn();
  } catch (err) {
    expect(err.code).toBe(code);
    if (path !== undefined) expect(err.path).toBe(path);
    return err;
  }
  throw new Error(`Expected throw with code ${code}`);
}

/**
 * Await `promise` and assert it rejects with the given code/path.
 *
 * @param {Promise<unknown>} promise
 * @param {string} code
 * @param {string} [path]
 * @returns {Promise<Error>}
 */
async function expectReject(promise, code, path) {
  try {
    await promise;
  } catch (err) {
    expect(err.code).toBe(code);
    if (path !== undefined) expect(err.path).toBe(path);
    return err;
  }
  throw new Error(`Expected rejection with code ${code}`);
}

// ---------------------------------------------------------------------------
// validateQuest
// ---------------------------------------------------------------------------

describe('validateQuest', () => {
  it('accepts a well-formed quest', () => {
    validateQuest(makeQuest(), 0);
  });

  it('rejects a missing id', () => {
    const q = makeQuest();
    delete q.id;
    expectThrowSync(() => validateQuest(q, 0), 'EQUEST_INVALID', 'quests[0].id');
  });

  it('rejects an empty title', () => {
    expectThrowSync(
      () => validateQuest(makeQuest({ title: '' }), 0),
      'EQUEST_INVALID',
      'quests[0].title',
    );
  });

  it('rejects a title longer than 60 characters', () => {
    expectThrowSync(
      () => validateQuest(makeQuest({ title: 'a'.repeat(61) }), 0),
      'EQUEST_INVALID',
      'quests[0].title',
    );
  });

  it('rejects xp = 0', () => {
    expectThrowSync(
      () => validateQuest(makeQuest({ xp: 0 }), 0),
      'EQUEST_INVALID',
      'quests[0].xp',
    );
  });

  it('rejects xp = -5', () => {
    expectThrowSync(
      () => validateQuest(makeQuest({ xp: -5 }), 0),
      'EQUEST_INVALID',
      'quests[0].xp',
    );
  });

  it('rejects xp = 1.5 (non-integer)', () => {
    expectThrowSync(
      () => validateQuest(makeQuest({ xp: 1.5 }), 0),
      'EQUEST_INVALID',
      'quests[0].xp',
    );
  });

  it('rejects goal.type = "bogus"', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'bogus' } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.type',
    );
  });

  it('rejects "command-executed" without command', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'command-executed' } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.command',
    );
  });

  it('rejects "file-exists" without path', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'file-exists' } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.path',
    );
  });

  it('rejects "output-contains" without substring', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'output-contains' } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.substring',
    );
  });

  it('ignores unknown top-level fields', () => {
    const q = makeQuest();
    q.foo = 'bar';
    validateQuest(q, 0);
  });

  it('rejects goal.args that is not an array', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({
          goal: { type: 'command-executed', command: 'ls', args: 'string' },
        }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.args',
    );
  });

  it('rejects goal.args with a non-string element', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({
          goal: { type: 'command-executed', command: 'ls', args: ['a', 42] },
        }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.args',
    );
  });
});

// ---------------------------------------------------------------------------
// validateQuest — difficulty (spec012a §1)
// ---------------------------------------------------------------------------

describe('validateQuest — difficulty', () => {
  it('rejects a missing difficulty', () => {
    const q = makeQuest();
    delete q.difficulty;
    expectThrowSync(
      () => validateQuest(q, 0),
      'EQUEST_INVALID',
      'quests[0].difficulty',
    );
  });

  it('accepts each valid difficulty value', () => {
    validateQuest(makeQuest({ difficulty: 'easy' }), 0);
    validateQuest(makeQuest({ difficulty: 'medium' }), 0);
    validateQuest(makeQuest({ difficulty: 'hard' }), 0);
  });

  it('rejects an unknown difficulty with a descriptive message', () => {
    try {
      validateQuest(makeQuest({ difficulty: 'schwer' }), 0);
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EQUEST_INVALID');
      expect(err.path).toBe('quests[0].difficulty');
      expect(err.message.includes('invalid difficulty')).toBe(true);
      expect(err.message.includes('schwer')).toBe(true);
    }
  });

  it('rejects difficulty = null', () => {
    expectThrowSync(
      () => validateQuest(makeQuest({ difficulty: null }), 0),
      'EQUEST_INVALID',
      'quests[0].difficulty',
    );
  });

  it('rejects difficulty = 42 (non-string)', () => {
    expectThrowSync(
      () => validateQuest(makeQuest({ difficulty: 42 }), 0),
      'EQUEST_INVALID',
      'quests[0].difficulty',
    );
  });
});

// ---------------------------------------------------------------------------
// loadQuests
// ---------------------------------------------------------------------------

describe('loadQuests', () => {
  it('returns three quests from a valid document', async () => {
    const result = await loadQuests(
      '/quests.json',
      makeFetch({ quests: makeThreeQuests() }),
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
    expect(result[0].id).toBe('quest-001');
  });

  it('returns the exact array reference from the parsed body (no clone)', async () => {
    const body = { quests: makeThreeQuests() };
    const result = await loadQuests('/quests.json', makeFetch(body));
    expect(result).toBe(body.quests);
  });

  it('rejects with EQUEST_LOAD on HTTP 404', async () => {
    await expectReject(
      loadQuests('/quests.json', makeFetch({}, 404, false)),
      'EQUEST_LOAD',
    );
  });

  it('rejects with EQUEST_LOAD when the body has no quests array', async () => {
    await expectReject(
      loadQuests('/quests.json', makeFetch({})),
      'EQUEST_LOAD',
    );
  });

  it('rejects with EQUEST_LOAD when res.json() throws a SyntaxError', async () => {
    await expectReject(
      loadQuests('/quests.json', makeFetchWithBrokenJson()),
      'EQUEST_LOAD',
    );
  });

  it('rejects with EQUEST_INVALID when a quest is malformed', async () => {
    const bad = makeQuest({ title: '' });
    await expectReject(
      loadQuests('/quests.json', makeFetch({ quests: [bad] })),
      'EQUEST_INVALID',
      'quests[0].title',
    );
  });

  it('rejects with EQUEST_INVALID when two quests share an id', async () => {
    const dup = makeThreeQuests();
    dup[1] = makeQuest({ id: 'quest-001', title: 'Duplikat' });
    await expectReject(
      loadQuests('/quests.json', makeFetch({ quests: dup })),
      'EQUEST_INVALID',
      'quests[1].id',
    );
  });
});

// ---------------------------------------------------------------------------
// data/quests.json — integration test on the real file (spec012c)
// ---------------------------------------------------------------------------

describe('data/quests.json — nach spec014b', () => {
  // Absolute URL computed from this module's URL, so the test works
  // regardless of where the project is served (local dev server,
  // GitHub Pages user/project site, custom domain).
  const QUESTS_URL = new URL('../../data/quests.json', import.meta.url).href;

  it('loads 58 quests from the real file (22 easy + 15 medium + 21 hard)', async () => {
    const quests = await loadQuests(QUESTS_URL);
    expect(quests.length).toBe(58);
  });

  it('every quest has difficulty "easy", "medium", or "hard"', async () => {
    const quests = await loadQuests(QUESTS_URL);
    expect(
      quests.every((q) => ['easy', 'medium', 'hard'].includes(q.difficulty)),
    ).toBe(true);
  });

  it('quest-023 to quest-037 all have difficulty "medium"', async () => {
    const quests = await loadQuests(QUESTS_URL);
    const mediumRange = quests.filter((q) => {
      const n = parseInt(q.id.slice('quest-'.length), 10);
      return n >= 23 && n <= 37;
    });
    expect(mediumRange.length).toBe(15);
    expect(mediumRange.every((q) => q.difficulty === 'medium')).toBe(true);
  });

  it('quest-038 to quest-058 all have difficulty "hard"', async () => {
    const quests = await loadQuests(QUESTS_URL);
    const hardRange = quests.filter((q) => {
      const n = parseInt(q.id.slice('quest-'.length), 10);
      return n >= 38 && n <= 58;
    });
    expect(hardRange.length).toBe(21);
    expect(hardRange.every((q) => q.difficulty === 'hard')).toBe(true);
  });

  it('quest-053 to quest-058 are in module "permissions"', async () => {
    const quests = await loadQuests(QUESTS_URL);
    const range = quests.filter((q) => {
      const n = parseInt(q.id.slice('quest-'.length), 10);
      return n >= 53 && n <= 58;
    });
    expect(range.length).toBe(6);
    expect(range.every((q) => q.module === 'permissions')).toBe(true);
  });

  it('quest-005 is in basics (moved from text in spec012a)', async () => {
    const quests = await loadQuests(QUESTS_URL);
    const q5 = quests.find((q) => q.id === 'quest-005');
    expect(q5.module).toBe('basics');
  });

  it('all IDs are unique and follow the quest-NNN pattern (001..058)', async () => {
    const quests = await loadQuests(QUESTS_URL);
    const ids = quests.map((q) => q.id);
    expect(new Set(ids).size).toBe(58);
    for (let i = 1; i <= 58; i++) {
      const expected = `quest-${String(i).padStart(3, '0')}`;
      expect(ids.includes(expected)).toBe(true);
    }
  });

  it('module distribution matches spec014b (10 modules, total 58)', async () => {
    const quests = await loadQuests(QUESTS_URL);
    const counts = {};
    for (const q of quests) counts[q.module] = (counts[q.module] ?? 0) + 1;
    expect(counts.basics).toBe(16);
    expect(counts.files).toBe(4);
    expect(counts.explore).toBe(2);
    expect(counts.text).toBe(5);
    expect(counts.search).toBe(5);
    expect(counts.pipes).toBe(5);
    expect(counts['text-processing']).toBe(5);
    expect(counts.filesystem).toBe(5);
    expect(counts.detect).toBe(5);
    expect(counts.permissions).toBe(6);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(58);
  });

  it('total XP across all quests is 1225 (270 + 300 + 655)', async () => {
    // The spec's §2 breakdown: 22 easy = 270, 15 medium = 300,
    // 21 hard = 655. The test computes the sum from the actual `xp`
    // fields, not from a hard-coded list.
    const quests = await loadQuests(QUESTS_URL);
    const totalXP = quests.reduce((sum, q) => sum + q.xp, 0);
    expect(totalXP).toBe(1225);
  });

  it('per-difficulty XP sums: easy=270, medium=300, hard=655', async () => {
    // Guard against unknown difficulty values before the `+=` so a
    // future quest with e.g. difficulty 'extreme' produces a clear
    // diagnosis instead of a silent NaN.
    const quests = await loadQuests(QUESTS_URL);
    const sums = { easy: 0, medium: 0, hard: 0 };
    for (const q of quests) {
      if (!Object.prototype.hasOwnProperty.call(sums, q.difficulty)) {
        throw new Error(
          `unexpected difficulty "${q.difficulty}" on quest ${q.id}`,
        );
      }
      sums[q.difficulty] += q.xp;
    }
    expect(sums.easy).toBe(270);
    expect(sums.medium).toBe(300);
    expect(sums.hard).toBe(655);
  });

  it('basics-complete is NOT unlocked after only quest-005 (1/16 basics)', async () => {
    const quests = await loadQuests(QUESTS_URL);
    const engine = new QuestEngine(quests);
    engine.solveQuest('quest-005');
    const tracker = new BadgeTracker();
    deriveBadges(tracker, engine);
    const unlockedIds = tracker.getUnlocked().map((b) => b.id);
    expect(unlockedIds.includes('basics-complete')).toBe(false);
    expect(unlockedIds.includes('first-quest')).toBe(true);
  });

  it("basics-complete IS unlocked after all 16 quests with module='basics'", async () => {
    const quests = await loadQuests(QUESTS_URL);
    const engine = new QuestEngine(quests);
    const basicsQuests = quests.filter((q) => q.module === 'basics');
    expect(basicsQuests.length).toBe(16);
    for (const q of basicsQuests) {
      engine.solveQuest(q.id);
    }
    const tracker = new BadgeTracker();
    deriveBadges(tracker, engine);
    const unlockedIds = tracker.getUnlocked().map((b) => b.id);
    expect(unlockedIds.includes('basics-complete')).toBe(true);
    // all-quests is NOT unlocked — only 16 of 52 solved.
    expect(unlockedIds.includes('all-quests')).toBe(false);
  });

  it('deriveXp matches the true sum after solving every quest (1225 XP)', async () => {
    const quests = await loadQuests(QUESTS_URL);
    const engine = new QuestEngine(quests);
    for (const q of quests) {
      engine.solveQuest(q.id);
    }
    expect(deriveXp(engine)).toBe(1225);
  });
});

// ---------------------------------------------------------------------------
// data/quests.json — neue hard Quests (spec012c §3.2)
// ---------------------------------------------------------------------------

describe('data/quests.json — neue hard Quests', () => {
  const QUESTS_URL = new URL('../../data/quests.json', import.meta.url).href;

  /**
   * Fetch a quest by id from the real file, asserting it exists.
   *
   * @param {string} id
   * @returns {Promise<object>}
   */
  async function getQuest(id) {
    const quests = await loadQuests(QUESTS_URL);
    const q = quests.find((x) => x.id === id);
    expect(q).toBeTruthy();
    return q;
  }

  it('each new hard quest has exactly one of command/pipeline set', async () => {
    const quests = await loadQuests(QUESTS_URL);
    for (let i = 38; i <= 52; i++) {
      const id = `quest-${String(i).padStart(3, '0')}`;
      const q = quests.find((x) => x.id === id);
      expect(q).toBeTruthy();
      expect(q.goal.type).toBe('command-executed');
      const hasCmd = q.goal.command !== undefined && q.goal.command !== null;
      const hasPipe = q.goal.pipeline !== undefined && q.goal.pipeline !== null;
      expect(hasCmd !== hasPipe).toBe(true);
    }
  });

  it('quest-038: command=sed, args=[s/root/admin/g, /etc/passwd]', async () => {
    const q = await getQuest('quest-038');
    expect(q.module).toBe('text-processing');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('sed');
    expect(q.goal.args).toEqual(['s/root/admin/g', '/etc/passwd']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-039: command=sed with -i, args=[-i, s/Meine Notizen/Geänderte Notizen/, ...]', async () => {
    // Review SHOULD: /home/user/notes.txt contains "Meine Notizen\n"
    // (capital N, no substring 'notes'). Original goal
    // `s/notes/notizen/` never matched and left the file unchanged,
    // so the user saw no effect. The goal now matches the actual
    // file content and produces a visible edit.
    // Review NICE (this round): the previous fix used
    // `s/Notizen/Notizen geändert/` — the replacement contained the
    // search string, so repeating the command accumulated suffixes
    // (`Notizen geändert geändert …`). Pattern and replacement are
    // now decoupled, making the edit idempotent.
    const q = await getQuest('quest-039');
    expect(q.module).toBe('text-processing');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('sed');
    expect(q.goal.args).toEqual([
      '-i',
      's/Meine Notizen/Geänderte Notizen/',
      '/home/user/notes.txt',
    ]);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-040: command=cut, args=[-d, :, -f, 1, /etc/passwd]', async () => {
    // Review BLOCKER: cut (spec010a) only accepts SEPARATE `-d X` /
    // `-f N` arguments. `-d:` and `-f1` (combined short form) hit
    // `cut: unsupported option` and exit 2, so the original goal was
    // unsolvable. Fixed to the separate-arg form.
    const q = await getQuest('quest-040');
    expect(q.module).toBe('text-processing');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('cut');
    expect(q.goal.args).toEqual(['-d', ':', '-f', '1', '/etc/passwd']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-041: 2-command pipeline (echo hello | tr a-z A-Z)', async () => {
    const q = await getQuest('quest-041');
    expect(q.module).toBe('text-processing');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.pipeline).toBeTruthy();
    expect(q.goal.pipeline.length).toBe(2);
    expect(q.goal.pipeline[0].command).toBe('echo');
    expect(q.goal.pipeline[0].args).toEqual(['hello']);
    expect(q.goal.pipeline[1].command).toBe('tr');
    expect(q.goal.pipeline[1].args).toEqual(['a-z', 'A-Z']);
    expect(q.goal.command === undefined || q.goal.command === null).toBe(true);
  });

  it('quest-042: 3-command pipeline (cat | grep root | cut -d : -f 1)', async () => {
    // Review BLOCKER: same cut short-form issue as quest-040,
    // present in the third pipeline stage.
    const q = await getQuest('quest-042');
    expect(q.module).toBe('text-processing');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.pipeline).toBeTruthy();
    expect(q.goal.pipeline.length).toBe(3);
    expect(q.goal.pipeline[0].command).toBe('cat');
    expect(q.goal.pipeline[0].args).toEqual(['/etc/passwd']);
    expect(q.goal.pipeline[1].command).toBe('grep');
    expect(q.goal.pipeline[1].args).toEqual(['root']);
    expect(q.goal.pipeline[2].command).toBe('cut');
    expect(q.goal.pipeline[2].args).toEqual(['-d', ':', '-f', '1']);
    expect(q.goal.command === undefined || q.goal.command === null).toBe(true);
  });

  it('quest-043: command=ln, args=[-s, /etc/hosts, /tmp/hosts-link]', async () => {
    const q = await getQuest('quest-043');
    expect(q.module).toBe('filesystem');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('ln');
    expect(q.goal.args).toEqual(['-s', '/etc/hosts', '/tmp/hosts-link']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-044: command=chmod, args=[600, /etc/hosts]', async () => {
    const q = await getQuest('quest-044');
    expect(q.module).toBe('filesystem');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('chmod');
    expect(q.goal.args).toEqual(['600', '/etc/hosts']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-045: command=stat, args=[/etc/passwd]', async () => {
    const q = await getQuest('quest-045');
    expect(q.module).toBe('filesystem');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('stat');
    expect(q.goal.args).toEqual(['/etc/passwd']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-046: command=basename, args=[/home/user/notes.txt, .txt]', async () => {
    // Review NICE: `basename /etc/passwd .passwd` runs with exit 0
    // but the suffix never matches (`passwd` has no `.passwd`
    // extension), so the user sees no strip. Fixed to a path that
    // actually HAS the stated suffix — didactically correct.
    const q = await getQuest('quest-046');
    expect(q.module).toBe('filesystem');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('basename');
    expect(q.goal.args).toEqual(['/home/user/notes.txt', '.txt']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-047: command=dirname, args=[/etc/passwd]', async () => {
    const q = await getQuest('quest-047');
    expect(q.module).toBe('filesystem');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('dirname');
    expect(q.goal.args).toEqual(['/etc/passwd']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-048: command=file, args=[/etc]', async () => {
    const q = await getQuest('quest-048');
    expect(q.module).toBe('detect');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('file');
    expect(q.goal.args).toEqual(['/etc']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-049: command=tree, args=[-L, 1, /home/user]', async () => {
    const q = await getQuest('quest-049');
    expect(q.module).toBe('detect');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('tree');
    expect(q.goal.args).toEqual(['-L', '1', '/home/user']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-050: command=find with combined filters', async () => {
    const q = await getQuest('quest-050');
    expect(q.module).toBe('detect');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('find');
    expect(q.goal.args).toEqual(['/etc', '-name', 'pass*', '-type', 'f']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-051: command=ls, args=[-l, /etc]', async () => {
    const q = await getQuest('quest-051');
    expect(q.module).toBe('detect');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('ls');
    expect(q.goal.args).toEqual(['-l', '/etc']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });

  it('quest-052: command=wc, args=[-lw, /etc/passwd]', async () => {
    const q = await getQuest('quest-052');
    expect(q.module).toBe('detect');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.command).toBe('wc');
    expect(q.goal.args).toEqual(['-lw', '/etc/passwd']);
    expect(q.goal.pipeline === undefined || q.goal.pipeline === null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// QuestEngine
// ---------------------------------------------------------------------------

describe('QuestEngine', () => {
  it('getActiveQuest returns the first quest when none are solved', () => {
    const engine = new QuestEngine(makeThreeQuests());
    const active = engine.getActiveQuest();
    expect(active).toBeTruthy();
    expect(active.id).toBe('quest-001');
  });

  it('after solving quest-001, getActiveQuest returns quest-002', () => {
    const engine = new QuestEngine(makeThreeQuests());
    engine.solveQuest('quest-001');
    expect(engine.getActiveQuest().id).toBe('quest-002');
  });

  it('isSolved is true after solving', () => {
    const engine = new QuestEngine(makeThreeQuests());
    expect(engine.isSolved('quest-001')).toBe(false);
    engine.solveQuest('quest-001');
    expect(engine.isSolved('quest-001')).toBe(true);
  });

  it('solveQuest with an unknown id throws EQUEST_UNKNOWN', () => {
    const engine = new QuestEngine(makeThreeQuests());
    expectThrowSync(
      () => engine.solveQuest('quest-999'),
      'EQUEST_UNKNOWN',
    );
  });

  it('solveQuest is idempotent — no duplicate entries', () => {
    const engine = new QuestEngine(makeThreeQuests());
    engine.solveQuest('quest-001');
    engine.solveQuest('quest-001');
    expect(engine.getSolvedIds()).toEqual(['quest-001']);
  });

  it('getActiveQuest returns null when all quests are solved', () => {
    const engine = new QuestEngine(makeThreeQuests());
    engine.solveQuest('quest-001');
    engine.solveQuest('quest-002');
    engine.solveQuest('quest-003');
    expect(engine.getActiveQuest()).toBe(null);
  });

  it('getProgress reflects solves', () => {
    const engine = new QuestEngine(makeThreeQuests());
    engine.solveQuest('quest-001');
    expect(engine.getProgress()).toEqual({ solved: 1, total: 3 });
  });

  it('getAllQuests returns a copy — mutating it does not affect engine state', () => {
    const engine = new QuestEngine(makeThreeQuests());
    const copy = engine.getAllQuests();
    copy.push(makeQuest({ id: 'quest-999' }));
    expect(engine.getAllQuests().length).toBe(3);
  });

  it('getSolvedIds returns a copy — mutating it does not affect engine state', () => {
    const engine = new QuestEngine(makeThreeQuests());
    engine.solveQuest('quest-001');
    const copy = engine.getSolvedIds();
    copy.push('quest-999');
    expect(engine.getSolvedIds()).toEqual(['quest-001']);
  });

  it('getSolvedIds preserves solve order, not definition order', () => {
    const engine = new QuestEngine(makeThreeQuests());
    engine.solveQuest('quest-003');
    engine.solveQuest('quest-001');
    expect(engine.getSolvedIds()[0]).toBe('quest-003');
    expect(engine.getSolvedIds()[1]).toBe('quest-001');
  });

  it('getQuestById returns undefined for an unknown id', () => {
    const engine = new QuestEngine(makeThreeQuests());
    expect(engine.getQuestById('quest-999')).toBeUndefined();
  });

  it('isSolved is false for an unknown or unsolved id', () => {
    const engine = new QuestEngine(makeThreeQuests());
    expect(engine.isSolved('quest-001')).toBeFalsy();
    expect(engine.isSolved('quest-999')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// validateQuest — command-executed mit redirects (spec012b §1)
// ---------------------------------------------------------------------------

describe('validateQuest — command-executed mit redirects', () => {
  it('accepts a valid command-executed goal with redirects', () => {
    validateQuest(
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: ['x'],
          redirects: [{ op: '>', target: '/tmp/f' }],
        },
      }),
      0,
    );
  });

  it('rejects a goal with neither command nor pipeline', () => {
    expectThrowSync(
      () => validateQuest(makeQuest({ goal: { type: 'command-executed' } }), 0),
      'EQUEST_INVALID',
      'quests[0].goal.pipeline',
    );
  });

  it('rejects redirects combined with pipeline', () => {
    try {
      validateQuest(
        makeQuest({
          goal: {
            type: 'command-executed',
            pipeline: [{ command: 'ls' }],
            redirects: [{ op: '>', target: '/tmp/f' }],
          },
        }),
        0,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EQUEST_INVALID');
      expect(err.path).toBe('quests[0].goal.redirects');
      expect(err.message.includes('not supported with pipeline')).toBe(true);
    }
  });

  it('rejects redirects that is not an array', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({
          goal: {
            type: 'command-executed',
            command: 'echo',
            redirects: 'oops',
          },
        }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.redirects',
    );
  });

  it('rejects a redirect with an invalid op', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({
          goal: {
            type: 'command-executed',
            command: 'echo',
            redirects: [{ op: '2>', target: '/tmp/f' }],
          },
        }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.redirects',
    );
  });

  it("accepts a redirect with op '<'", () => {
    // `<` is a valid op (spec007b/012b). The existing tests only
    // exercise `>` and `>>`; this pins the third op explicitly.
    validateQuest(
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'cat',
          redirects: [{ op: '<', target: '/etc/passwd' }],
        },
      }),
      0,
    );
  });

  it('accepts one input + one output redirect (combination)', () => {
    // spec007b §5 allows one `<` AND one `>`/`>>` per command. A goal
    // combining both is solvable and therefore schema-valid.
    validateQuest(
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'cat',
          redirects: [
            { op: '<', target: '/etc/passwd' },
            { op: '>', target: '/tmp/out' },
          ],
        },
      }),
      0,
    );
  });

  it('rejects two input redirects (unsolvable per spec007b §5)', () => {
    // Two `<` redirects: schema-invalid because the executor would
    // reject the input with exit 2, so the quest could never solve.
    // The error is a clear "at load time" message instead of a
    // silent-never-solvable state.
    try {
      validateQuest(
        makeQuest({
          goal: {
            type: 'command-executed',
            command: 'cat',
            redirects: [
              { op: '<', target: '/etc/passwd' },
              { op: '<', target: '/etc/hosts' },
            ],
          },
        }),
        0,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EQUEST_INVALID');
      expect(err.path).toBe('quests[0].goal.redirects');
      expect(err.message.includes('at most one')).toBe(true);
      expect(err.message.includes('<')).toBe(true);
    }
  });

  it('rejects two output redirects (unsolvable per spec007b §5)', () => {
    try {
      validateQuest(
        makeQuest({
          goal: {
            type: 'command-executed',
            command: 'echo',
            args: ['x'],
            redirects: [
              { op: '>', target: '/tmp/a' },
              { op: '>', target: '/tmp/b' },
            ],
          },
        }),
        0,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EQUEST_INVALID');
      expect(err.path).toBe('quests[0].goal.redirects');
      expect(err.message.includes('at most one')).toBe(true);
    }
  });

  it('accepts command: null as "absent" (variant B via pipeline)', () => {
    // `command: null` is a common hand-written placeholder when the
    // author only provides `pipeline`. Treating it as "set" would
    // produce a misleading "not both" error. Only non-null values
    // count as provided.
    validateQuest(
      makeQuest({
        goal: {
          type: 'command-executed',
          command: null,
          pipeline: [{ command: 'ls' }],
        },
      }),
      0,
    );
  });

  it('accepts pipeline: null as "absent" (variant A via command)', () => {
    validateQuest(
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'ls',
          pipeline: null,
        },
      }),
      0,
    );
  });

  it('accepts redirects: null as "absent" (variant A)', () => {
    // null-as-absent convention (module JSDoc): `redirects: null`
    // is a placeholder for "no redirects", not a schema error.
    // Contrast: `redirects: 'oops'` still fails (covered above).
    validateQuest(
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: ['x'],
          redirects: null,
        },
      }),
      0,
    );
  });

  it('accepts args: null as "absent" (variant A, wildcard)', () => {
    validateQuest(
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: null,
        },
      }),
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// validateQuest — command-executed mit pipeline (spec012b §1)
// ---------------------------------------------------------------------------

describe('validateQuest — command-executed mit pipeline', () => {
  it('accepts a valid command-executed goal with pipeline', () => {
    validateQuest(
      makeQuest({
        goal: {
          type: 'command-executed',
          pipeline: [{ command: 'ls' }, { command: 'sort' }],
        },
      }),
      0,
    );
  });

  it('rejects an empty pipeline', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'command-executed', pipeline: [] } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.pipeline',
    );
  });

  it('rejects a non-array pipeline', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'command-executed', pipeline: 'ls' } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.pipeline',
    );
  });

  it('rejects a pipeline stage without command', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({
          goal: { type: 'command-executed', pipeline: [{ args: ['x'] }] },
        }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.pipeline',
    );
  });

  it('rejects both command and pipeline set', () => {
    try {
      validateQuest(
        makeQuest({
          goal: {
            type: 'command-executed',
            command: 'ls',
            pipeline: [{ command: 'ls' }],
          },
        }),
        0,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EQUEST_INVALID');
      expect(err.path).toBe('quests[0].goal.command');
      expect(err.message.includes('not both')).toBe(true);
    }
  });

  it('rejects neither command nor pipeline set', () => {
    expectThrowSync(
      () => validateQuest(makeQuest({ goal: { type: 'command-executed' } }), 0),
      'EQUEST_INVALID',
      'quests[0].goal.pipeline',
    );
  });

  it('accepts valid args in a pipeline stage', () => {
    validateQuest(
      makeQuest({
        goal: {
          type: 'command-executed',
          pipeline: [
            { command: 'ls', args: ['/etc'] },
            { command: 'sort' },
          ],
        },
      }),
      0,
    );
  });

  it('rejects stage.args that is not an array', () => {
    try {
      validateQuest(
        makeQuest({
          goal: {
            type: 'command-executed',
            pipeline: [{ command: 'ls', args: 'not-an-array' }],
          },
        }),
        0,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EQUEST_INVALID');
      expect(err.path).toBe('quests[0].goal.pipeline');
      expect(err.message.includes('args must be an array')).toBe(true);
    }
  });

  it('rejects stage.args with a non-string element', () => {
    try {
      validateQuest(
        makeQuest({
          goal: {
            type: 'command-executed',
            pipeline: [{ command: 'ls', args: ['a', 42] }],
          },
        }),
        0,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err.code).toBe('EQUEST_INVALID');
      expect(err.path).toBe('quests[0].goal.pipeline');
      expect(err.message.includes('args must be an array of strings')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateQuest — file-mode (spec014b §1)
// ---------------------------------------------------------------------------

describe('validateQuest — file-mode', () => {
  it('accepts a valid file-mode goal', () => {
    validateQuest(
      makeQuest({
        goal: { type: 'file-mode', path: '/etc/hosts', mode: 384 },
      }),
      0,
    );
  });

  it('accepts mode = 0 (fully locked)', () => {
    validateQuest(
      makeQuest({ goal: { type: 'file-mode', path: '/etc/hosts', mode: 0 } }),
      0,
    );
  });

  it('accepts mode = 0o7777 (upper bound)', () => {
    validateQuest(
      makeQuest({
        goal: { type: 'file-mode', path: '/etc/hosts', mode: 0o7777 },
      }),
      0,
    );
  });

  it('rejects mode above 0o7777', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({
          goal: { type: 'file-mode', path: '/etc/hosts', mode: 0o10000 },
        }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.mode',
    );
  });

  it('rejects non-integer mode (1.5)', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({
          goal: { type: 'file-mode', path: '/etc/hosts', mode: 1.5 },
        }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.mode',
    );
  });

  it('rejects negative mode', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'file-mode', path: '/etc/hosts', mode: -1 } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.mode',
    );
  });

  it('rejects a missing path', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'file-mode', mode: 384 } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.path',
    );
  });
});

// ---------------------------------------------------------------------------
// validateQuest — file-owner (spec014b §1)
// ---------------------------------------------------------------------------

describe('validateQuest — file-owner', () => {
  it('accepts an owner-only goal', () => {
    validateQuest(
      makeQuest({
        goal: { type: 'file-owner', path: '/etc/hosts', owner: 'user' },
      }),
      0,
    );
  });

  it('accepts a group-only goal', () => {
    validateQuest(
      makeQuest({
        goal: { type: 'file-owner', path: '/etc/hosts', group: 'root' },
      }),
      0,
    );
  });

  it('accepts owner + group together', () => {
    validateQuest(
      makeQuest({
        goal: {
          type: 'file-owner',
          path: '/etc/hosts',
          owner: 'user',
          group: 'user',
        },
      }),
      0,
    );
  });

  it('rejects a goal with neither owner nor group', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'file-owner', path: '/etc/hosts' } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.owner',
    );
  });

  it('rejects a missing path', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({ goal: { type: 'file-owner', owner: 'user' } }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.path',
    );
  });

  it('rejects a non-string owner', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({
          goal: { type: 'file-owner', path: '/etc/hosts', owner: 42 },
        }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.owner',
    );
  });

  it('rejects an empty-string owner', () => {
    expectThrowSync(
      () => validateQuest(
        makeQuest({
          goal: { type: 'file-owner', path: '/etc/hosts', owner: '' },
        }),
        0,
      ),
      'EQUEST_INVALID',
      'quests[0].goal.owner',
    );
  });
});

// ---------------------------------------------------------------------------
// data/quests.json — neue permissions Quests (spec014b §2)
// ---------------------------------------------------------------------------

describe('data/quests.json — neue permissions Quests', () => {
  const QUESTS_URL = new URL('../../data/quests.json', import.meta.url).href;

  /**
   * @param {string} id
   * @returns {Promise<object>}
   */
  async function getQuest(id) {
    const quests = await loadQuests(QUESTS_URL);
    const q = quests.find((x) => x.id === id);
    expect(q).toBeTruthy();
    return q;
  }

  it('quest-053: command-executed chmod 600 /etc/hosts', async () => {
    const q = await getQuest('quest-053');
    expect(q.module).toBe('permissions');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.type).toBe('command-executed');
    expect(q.goal.command).toBe('chmod');
    expect(q.goal.args).toEqual(['600', '/etc/hosts']);
    expect(q.xp).toBe(30);
  });

  it('quest-054: file-mode /etc/hosts mode=384 (0o600)', async () => {
    const q = await getQuest('quest-054');
    expect(q.module).toBe('permissions');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.type).toBe('file-mode');
    expect(q.goal.path).toBe('/etc/hosts');
    expect(q.goal.mode).toBe(384);
    expect(q.xp).toBe(30);
  });

  it('quest-055: file-owner /etc/hosts owner=user', async () => {
    const q = await getQuest('quest-055');
    expect(q.module).toBe('permissions');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.type).toBe('file-owner');
    expect(q.goal.path).toBe('/etc/hosts');
    expect(q.goal.owner).toBe('user');
    expect(q.xp).toBe(30);
  });

  it('quest-056: file-owner /etc/hosts owner=user group=user', async () => {
    const q = await getQuest('quest-056');
    expect(q.module).toBe('permissions');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.type).toBe('file-owner');
    expect(q.goal.path).toBe('/etc/hosts');
    expect(q.goal.owner).toBe('user');
    expect(q.goal.group).toBe('user');
    expect(q.xp).toBe(35);
  });

  it('quest-057: chmod 755 notes.txt | stat notes.txt (pipeline)', async () => {
    const q = await getQuest('quest-057');
    expect(q.module).toBe('permissions');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.type).toBe('command-executed');
    expect(q.goal.pipeline).toBeTruthy();
    expect(q.goal.pipeline.length).toBe(2);
    expect(q.goal.pipeline[0].command).toBe('chmod');
    expect(q.goal.pipeline[0].args).toEqual(['755', '/home/user/notes.txt']);
    expect(q.goal.pipeline[1].command).toBe('stat');
    expect(q.goal.pipeline[1].args).toEqual(['/home/user/notes.txt']);
    expect(q.xp).toBe(40);
  });

  it('quest-058: file-mode /home/user/projects mode=493 (0o755)', async () => {
    // NOTE: `createInitialFS()` already sets /home/user/projects to
    // 0o755. This quest is therefore solved the moment it becomes
    // active — no user action required. Spec014b §2 specified 493
    // explicitly; the reviewer (spec014b round) should decide
    // whether to raise the goal (e.g. mode 448 = 0o700) so the user
    // must actually run `chmod`. Pinned here to make any change
    // visible as a diff in the test, not as a silent data update.
    const q = await getQuest('quest-058');
    expect(q.module).toBe('permissions');
    expect(q.difficulty).toBe('hard');
    expect(q.goal.type).toBe('file-mode');
    expect(q.goal.path).toBe('/home/user/projects');
    expect(q.goal.mode).toBe(493);
    expect(q.xp).toBe(40);
  });

  it('permissions-module XP sum is 205 (30+30+30+35+40+40)', async () => {
    const quests = await loadQuests(QUESTS_URL);
    const perms = quests.filter((q) => q.module === 'permissions');
    expect(perms.length).toBe(6);
    const sum = perms.reduce((a, q) => a + q.xp, 0);
    expect(sum).toBe(205);
  });
});