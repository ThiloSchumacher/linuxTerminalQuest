import { describe, it, expect } from '../runner.js';
import { Storage } from '../../js/storage/storage.js';
import {
  saveAppState,
  restoreEnv,
  restoreHistory,
  restoreQuests,
  deriveXp,
  deriveBadges,
} from '../../js/storage/persistence.js';
import { Env } from '../../js/shell/env.js';
import { LineEditor } from '../../js/terminal/line-editor.js';
import { QuestEngine } from '../../js/quests/quest-engine.js';
import { BadgeTracker } from '../../js/gamification/badges.js';

/**
 * Unique prefix per test to avoid cross-test localStorage pollution.
 *
 * @returns {string}
 */
function uniquePrefix() {
  return 'test-' + Math.random().toString(36).slice(2);
}

/**
 * @param {string} id
 * @param {number} [xp=10]
 * @param {string} [module='basics']
 * @returns {object}
 */
function makeQuest(id, xp = 10, module = 'basics') {
  return {
    id,
    module,
    title: `Quest ${id}`,
    description: 'D',
    hint: 'H',
    goal: { type: 'command-executed', command: 'pwd' },
    xp,
  };
}

/**
 * @param {string[]} [ids=['q1','q2','q3']]
 * @returns {object[]}
 */
function makeThreeQuests(ids = ['q1', 'q2', 'q3']) {
  return [
    makeQuest(ids[0], 10),
    makeQuest(ids[1], 20),
    makeQuest(ids[2], 30),
  ];
}

// ---------------------------------------------------------------------------
// saveAppState + restoreEnv
// ---------------------------------------------------------------------------

describe('saveAppState + restoreEnv', () => {
  it('round-trips a customised env value', () => {
    const prefix = uniquePrefix();
    const storage = new Storage({ prefix });
    try {
      const env = new Env({ PWD: '/home/user', HOME: '/home/user' });
      env.set('PWD', '/etc');
      const lineEditor = new LineEditor();
      const engine = new QuestEngine([]);
      saveAppState(storage, { env, lineEditor, questEngine: engine });

      const restored = restoreEnv(storage, { PWD: '/home/user', HOME: '/home/user' });
      expect(restored.get('PWD')).toBe('/etc');
    } finally {
      storage.clear();
    }
  });

  it('returns only the defaults when storage is empty', () => {
    const prefix = uniquePrefix();
    const storage = new Storage({ prefix });
    try {
      const restored = restoreEnv(storage, { PWD: '/home/user', HOME: '/home/user' });
      expect(restored.get('PWD')).toBe('/home/user');
      expect(restored.get('HOME')).toBe('/home/user');
    } finally {
      storage.clear();
    }
  });

  it('ignores a stored non-object env value', () => {
    // Guards the `typeof saved !== 'object' || Array.isArray(saved)` in
    // restoreEnv. Without that guard, `{ ...defaultEnv, ...'not-an-object' }`
    // would spread string character indices into the env keys.
    const prefix = uniquePrefix();
    const version = 1;
    const storage = new Storage({ prefix, version });
    try {
      localStorage.setItem(`${prefix}-v${version}.env`, '"not-an-object"');
      const restored = restoreEnv(storage, { PWD: '/home/user', HOME: '/home/user' });
      expect(restored.get('PWD')).toBe('/home/user');
      expect(restored.get('HOME')).toBe('/home/user');
      // Sanity: no numeric-key character entries from a bad spread.
      expect(restored.get('0')).toBeUndefined();
    } finally {
      storage.clear();
    }
  });

    it('skips quests.solved write when questEngine is null', () => {
    // Pre-quests window contract: `saveAppState` is called on every
    // command, including before `loadQuests` resolves. During that
    // window `questEngine === null`, and `quests.solved` must NOT be
    // written — otherwise a pre-quests save with the "no engine" state
    // would overwrite previously-solved quests with an empty list.
    // env/history still get written — that is the whole point of the
    // null-tolerance.
    const prefix = uniquePrefix();
    const storage = new Storage({ prefix });
    try {
      const env = new Env({ PWD: '/home/user' });
      env.set('PWD', '/etc');
      const lineEditor = new LineEditor();
      lineEditor.pushHistory('pwd');

      saveAppState(storage, { env, lineEditor, questEngine: null });

      // quests.solved: no write → load falls back.
      expect(storage.load('quests.solved', 'MISSING')).toBe('MISSING');
      // env: written.
      expect(storage.load('env', null)).toEqual({ PWD: '/etc' });
      // history: written.
      expect(storage.load('history', null)).toEqual(['pwd']);
    } finally {
      storage.clear();
    }
  });

  it('skips quests.solved write when questEngine is undefined', () => {
    // Same contract, second falsy variant — `app.js` uses `null` for
    // the initial value, but callers could plausibly omit the key.
    const prefix = uniquePrefix();
    const storage = new Storage({ prefix });
    try {
      const env = new Env({ PWD: '/home/user' });
      const lineEditor = new LineEditor();

      saveAppState(storage, { env, lineEditor, questEngine: undefined });

      expect(storage.load('quests.solved', 'MISSING')).toBe('MISSING');
      expect(storage.load('env', null)).not.toBe(null);
    } finally {
      storage.clear();
    }
  });

  it('skips vfs write when vfs is null', () => {
    // Parameter guard (not a state guard) — see saveAppState JSDoc.
    // app.js always passes a VFS, but tests and potential CLI-only
    // boots may not. The guard skips the vfs write while still
    // persisting env and history.
    const prefix = uniquePrefix();
    const storage = new Storage({ prefix });
    try {
      const env = new Env({ PWD: '/home/user' });
      const lineEditor = new LineEditor();
      const engine = new QuestEngine([]);

      saveAppState(storage, {
        env,
        lineEditor,
        questEngine: engine,
        vfs: null,
      });

      expect(storage.load('vfs', 'MISSING')).toBe('MISSING');
      expect(storage.load('env', null)).not.toBe(null);
      expect(storage.load('history', null)).not.toBe(null);
      // questEngine present → quests.solved written (empty array).
      expect(storage.load('quests.solved', 'MISSING')).toEqual([]);
    } finally {
      storage.clear();
    }
  });
});

// ---------------------------------------------------------------------------
// saveAppState + restoreHistory
// ---------------------------------------------------------------------------

describe('saveAppState + restoreHistory', () => {
  it('round-trips history entries in order', () => {
    const prefix = uniquePrefix();
    const storage = new Storage({ prefix });
    try {
      const env = new Env({ PWD: '/home/user' });
      const lineEditor = new LineEditor();
      lineEditor.pushHistory('ls');
      lineEditor.pushHistory('pwd');
      const engine = new QuestEngine([]);
      saveAppState(storage, { env, lineEditor, questEngine: engine });

      const freshEditor = new LineEditor();
      restoreHistory(storage, freshEditor);
      expect(freshEditor.getHistory()).toEqual(['ls', 'pwd']);
    } finally {
      storage.clear();
    }
  });

  it('does nothing when the stored value is not an array', () => {
    const prefix = uniquePrefix();
    const version = 1;
    const storage = new Storage({ prefix, version });
    try {
      localStorage.setItem(`${prefix}-v${version}.history`, '"not-an-array"');
      const freshEditor = new LineEditor();
      // Must not throw.
      restoreHistory(storage, freshEditor);
      expect(freshEditor.getHistory()).toEqual([]);
    } finally {
      storage.clear();
    }
  });

  it('ignores a stored non-object env value', () => {
    // Guards the `typeof saved !== 'object' || Array.isArray(saved)` in
    // restoreEnv. Without that guard, `{ ...defaultEnv, ...'not-an-object' }`
    // would spread string character indices into the env keys.
    const prefix = uniquePrefix();
    const version = 1;
    const storage = new Storage({ prefix, version });
    try {
      localStorage.setItem(`${prefix}-v${version}.env`, '"not-an-object"');
      const restored = restoreEnv(storage, { PWD: '/home/user', HOME: '/home/user' });
      expect(restored.get('PWD')).toBe('/home/user');
      expect(restored.get('HOME')).toBe('/home/user');
      // Sanity: no numeric-key character entries from a bad spread.
      expect(restored.get('0')).toBeUndefined();
    } finally {
      storage.clear();
    }
  });
});

// ---------------------------------------------------------------------------
// saveAppState + restoreQuests
// ---------------------------------------------------------------------------

describe('saveAppState + restoreQuests', () => {
  it('restores solved IDs in stored order', () => {
    const prefix = uniquePrefix();
    const storage = new Storage({ prefix });
    try {
      const quests = makeThreeQuests();
      const env = new Env({ PWD: '/home/user' });
      const lineEditor = new LineEditor();
      const engine = new QuestEngine(quests);
      engine.solveQuest('q1');
      engine.solveQuest('q3');
      saveAppState(storage, { env, lineEditor, questEngine: engine });

      const freshEngine = new QuestEngine(quests);
      restoreQuests(storage, freshEngine);
      expect(freshEngine.getSolvedIds()).toEqual(['q1', 'q3']);
    } finally {
      storage.clear();
    }
  });

  it('silently drops unknown IDs', () => {
    const prefix = uniquePrefix();
    const version = 1;
    const storage = new Storage({ prefix, version });
    try {
      const quests = makeThreeQuests(['q1', 'q2']);
      // Manually write an array with one valid and one unknown ID.
      localStorage.setItem(
        `${prefix}-v${version}.quests.solved`,
        JSON.stringify(['q1', 'unknown-quest']),
      );
      const freshEngine = new QuestEngine(quests);
      restoreQuests(storage, freshEngine);
      expect(freshEngine.getSolvedIds()).toEqual(['q1']);
    } finally {
      storage.clear();
    }
  });

  it('restoring duplicate IDs is idempotent', () => {
    const prefix = uniquePrefix();
    const version = 1;
    const storage = new Storage({ prefix, version });
    try {
      const quests = makeThreeQuests();
      localStorage.setItem(
        `${prefix}-v${version}.quests.solved`,
        JSON.stringify(['q1', 'q1', 'q3']),
      );
      const freshEngine = new QuestEngine(quests);
      restoreQuests(storage, freshEngine);
      expect(freshEngine.getSolvedIds()).toEqual(['q1', 'q3']);
    } finally {
      storage.clear();
    }
  });
});

// ---------------------------------------------------------------------------
// deriveXp
// ---------------------------------------------------------------------------

describe('deriveXp', () => {
  it('sums xp over solved quests', () => {
    const quests = makeThreeQuests();
    const engine = new QuestEngine(quests);
    engine.solveQuest('q1'); // xp 10
    engine.solveQuest('q2'); // xp 20
    expect(deriveXp(engine)).toBe(30);
  });

  it('returns 60 when all three are solved (10 + 20 + 30)', () => {
    const engine = new QuestEngine(makeThreeQuests());
    engine.solveQuest('q1');
    engine.solveQuest('q2');
    engine.solveQuest('q3');
    expect(deriveXp(engine)).toBe(60);
  });

  it('ignores unknown IDs (not in the current catalogue)', () => {
    // Uses a stub engine rather than QuestEngine: solveQuest rejects
    // unknown IDs, so a real engine cannot produce the "solved ID with
    // no matching quest" state that deriveXp is supposed to defend
    // against. The stub exercises the `if (quest) total += quest.xp`
    // guard directly — remove it and this test fails with a
    // `Cannot read xp of undefined` throw.
    const stubEngine = {
      getSolvedIds: () => ['q1', 'unknown-quest'],
      getQuestById: (id) => (id === 'q1' ? makeQuest('q1', 10) : undefined),
    };
    expect(deriveXp(stubEngine)).toBe(10);
  });

  it('returns 0 when no quests are solved', () => {
    const engine = new QuestEngine(makeThreeQuests());
    expect(deriveXp(engine)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveBadges
// ---------------------------------------------------------------------------

describe('deriveBadges', () => {
  it('unlocks "first-quest" after one solved quest', () => {
    const engine = new QuestEngine(makeThreeQuests());
    engine.solveQuest('q1');
    const tracker = new BadgeTracker();
    deriveBadges(tracker, engine);
    const ids = tracker.getUnlocked().map((b) => b.id);
    expect(ids.includes('first-quest')).toBe(true);
  });

  it('unlocks all three badges after solving everything', () => {
    const engine = new QuestEngine(makeThreeQuests());
    engine.solveQuest('q1');
    engine.solveQuest('q2');
    engine.solveQuest('q3');
    const tracker = new BadgeTracker();
    deriveBadges(tracker, engine);
    const ids = tracker.getUnlocked().map((b) => b.id);
    expect(ids.includes('first-quest')).toBe(true);
    expect(ids.includes('basics-complete')).toBe(true);
    expect(ids.includes('all-quests')).toBe(true);
  });
});

import { createInitialFS } from '../../js/vfs/initial-fs.js';
import { restoreVFS } from '../../js/storage/persistence.js';
// ---------------------------------------------------------------------------
// saveAppState + restoreVFS
// ---------------------------------------------------------------------------

describe('saveAppState + restoreVFS', () => {
  it('round-trips a created file', () => {
    const prefix = uniquePrefix();
    const storage = new Storage({ prefix });
    try {
      const vfs = createInitialFS();
      vfs.createFile('/tmp/x', '/', 'hi');

      const env = new Env({ PWD: '/home/user' });
      const lineEditor = new LineEditor();
      saveAppState(storage, {
        env,
        lineEditor,
        questEngine: null,
        vfs,
      });

      const restored = restoreVFS(storage, createInitialFS);
      expect(restored.readFile('/tmp/x', '/')).toBe('hi');
    } finally {
      storage.clear();
    }
  });

  it('falls back to fallbackFactory when storage is empty', () => {
    const prefix = uniquePrefix();
    const storage = new Storage({ prefix });
    try {
      const vfs = restoreVFS(storage, createInitialFS);
      expect(vfs.exists('/etc/passwd', '/')).toBe(true);
      expect(vfs.exists('/tmp/x', '/')).toBe(false);
    } finally {
      storage.clear();
    }
  });

  it('falls back to fallbackFactory on corrupt VFS JSON', () => {
    const prefix = uniquePrefix();
    const version = 1;
    const storage = new Storage({ prefix, version });
    try {
      localStorage.setItem(`${prefix}-v${version}.vfs`, 'not-json');
      // Must not throw — falls back silently.
      const vfs = restoreVFS(storage, createInitialFS);
      expect(vfs.exists('/etc/passwd', '/')).toBe(true);
    } finally {
      storage.clear();
    }
  });

  it('falls back to fallbackFactory on unsupported schemaVersion', () => {
    const prefix = uniquePrefix();
    const version = 1;
    const storage = new Storage({ prefix, version });
    try {
      // A payload with schemaVersion 2 must be rejected by deserializeVFS
      // and fall back silently — no throw, no console.error.
      localStorage.setItem(
        `${prefix}-v${version}.vfs`,
        JSON.stringify({ schemaVersion: 2, root: { name: '/', type: 'dir' } }),
      );
      const vfs = restoreVFS(storage, createInitialFS);
      // Fallback was used → standard initial-fs is present.
      expect(vfs.exists('/etc/passwd', '/')).toBe(true);
    } finally {
      storage.clear();
    }
  });

  it('falls back to fallbackFactory on an invalid v1 payload (EINVAL from validation)', () => {
    // Distinct from the "corrupt JSON" and "schemaVersion: 2" cases:
    // here the JSON parses, the schemaVersion is supported, but a node
    // fails per-node validation (bogus `type`). The same try/catch in
    // restoreVFS catches the deserializeVFS EINVAL and falls back —
    // this test pins that path.
    const prefix = uniquePrefix();
    const version = 1;
    const storage = new Storage({ prefix, version });
    try {
      localStorage.setItem(
        `${prefix}-v${version}.vfs`,
        JSON.stringify({
          schemaVersion: 1,
          root: {
            name: '/', type: 'bogus', mode: 493,
            owner: 'root', group: 'root',
            mtime: 0, atime: 0, ctime: 0,
          },
        }),
      );
      const vfs = restoreVFS(storage, createInitialFS);
      // Fallback was used → standard initial-fs.
      expect(vfs.exists('/etc/passwd', '/')).toBe(true);
      // No partial/corrupt tree survived.
      expect(vfs.exists('/nonexistent', '/')).toBe(false);
    } finally {
      storage.clear();
    }
  });
});