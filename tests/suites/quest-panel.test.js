import { describe, it, expect } from '../runner.js';
import { QuestEngine } from '../../js/quests/quest-engine.js';
import { QuestPanel } from '../../js/ui/quest-panel.js';

/**
 * QuestPanel is DOM-based but has no xterm.js dependency, so it can be
 * exercised against a real (headless) DOM in the browser test runner.
 * Every test creates a fresh container div and a fresh QuestEngine.
 */

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function makeQuest(overrides = {}) {
  return {
    id: 'quest-001',
    module: 'basics',
    title: 'Test-Titel',
    description: 'Test-Beschreibung',
    hint: 'Test-Hinweis',
    goal: { type: 'command-executed', command: 'pwd' },
    xp: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Zustand A: aktive Quest
// ---------------------------------------------------------------------------

describe('QuestPanel — active quest state', () => {
  it('renders title, description and hint for the active quest', () => {
    const container = document.createElement('div');
    const engine = new QuestEngine([makeQuest()]);
    const panel = new QuestPanel({ container, questEngine: engine });
    panel.mount();

    expect(container.children.length).toBe(1);
    const root = container.children[0];
    expect(root.className).toBe('quest-panel');

    const title = root.querySelector('.quest-panel__title');
    const desc = root.querySelector('.quest-panel__desc');
    const hint = root.querySelector('.quest-panel__hint');

    expect(title).toBeTruthy();
    expect(desc).toBeTruthy();
    expect(hint).toBeTruthy();

    expect(title.textContent).toBe('Quest 1: Test-Titel');
    expect(desc.textContent).toBe('Test-Beschreibung');
    expect(hint.textContent).toBe('Tipp: Test-Hinweis');
  });

  it('uses 1-based index for the active quest within the constructor order', () => {
    const container = document.createElement('div');
    const engine = new QuestEngine([
      makeQuest({ id: 'quest-001', title: 'Erste' }),
      makeQuest({ id: 'quest-002', title: 'Zweite' }),
    ]);
    engine.solveQuest('quest-001');
    const panel = new QuestPanel({ container, questEngine: engine });
    panel.mount();

    const title = container.querySelector('.quest-panel__title');
    expect(title.textContent).toBe('Quest 2: Zweite');
  });
});

// ---------------------------------------------------------------------------
// Zustand B: keine aktive Quest
// ---------------------------------------------------------------------------

describe('QuestPanel — done state', () => {
  it('renders the "done" panel when all quests are solved', () => {
    const container = document.createElement('div');
    const engine = new QuestEngine([makeQuest()]);
    engine.solveQuest('quest-001');
    const panel = new QuestPanel({ container, questEngine: engine });
    panel.mount();

    expect(container.children.length).toBe(1);
    const root = container.children[0];
    expect(root.className).toBe('quest-panel quest-panel--done');
    // Nur der Titel, kein desc/hint:
    expect(root.querySelector('.quest-panel__desc')).toBe(null);
    expect(root.querySelector('.quest-panel__hint')).toBe(null);
    expect(root.querySelector('.quest-panel__title').textContent)
      .toBe('Alle Quests gelöst!');
  });

  it('renders the "done" panel when the engine is empty', () => {
    const container = document.createElement('div');
    const engine = new QuestEngine([]);
    const panel = new QuestPanel({ container, questEngine: engine });
    panel.mount();

    expect(container.children.length).toBe(1);
    expect(container.children[0].className).toBe('quest-panel quest-panel--done');
  });
});

// ---------------------------------------------------------------------------
// refresh / mount / unmount
// ---------------------------------------------------------------------------

describe('QuestPanel — lifecycle', () => {
  it('refresh re-renders on state change (active → done)', () => {
    const container = document.createElement('div');
    const engine = new QuestEngine([makeQuest()]);
    const panel = new QuestPanel({ container, questEngine: engine });
    panel.mount();

    expect(container.querySelector('.quest-panel--done')).toBe(null);

    engine.solveQuest('quest-001');
    panel.refresh();

    expect(container.querySelector('.quest-panel--done')).toBeTruthy();
  });

  it('refresh replaces existing children (no accumulation)', () => {
    const container = document.createElement('div');
    const engine = new QuestEngine([makeQuest()]);
    const panel = new QuestPanel({ container, questEngine: engine });
    panel.mount();
    panel.refresh();
    panel.refresh();
    // Always exactly one rendered panel, not three.
    expect(container.children.length).toBe(1);
  });

  it('unmount clears the container', () => {
    const container = document.createElement('div');
    const engine = new QuestEngine([makeQuest()]);
    const panel = new QuestPanel({ container, questEngine: engine });
    panel.mount();
    expect(container.children.length).toBe(1);
    panel.unmount();
    expect(container.children.length).toBe(0);
  });

  it('accepts an onSolved callback without calling it (spec005c will)', () => {
    // Regression brake: if a future spec starts calling _onSolved from
    // the panel itself, this test would still pass unless we also assert
    // the call-site is in app.js. The absence of an onSolved call here
    // is the current contract.
    const container = document.createElement('div');
    const engine = new QuestEngine([makeQuest()]);
    let called = false;
    const panel = new QuestPanel({
      container,
      questEngine: engine,
      onSolved: () => { called = true; },
    });
    panel.mount();
    engine.solveQuest('quest-001');
    panel.refresh();
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QuestPanel — nach solveQuest + refresh (spec013c)
// ---------------------------------------------------------------------------

describe('QuestPanel — nach solveQuest + refresh', () => {
  it('re-renders the new active quest after solveQuest + refresh', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    try {
      const quests = [
        { id: 'quest-001', title: 'Q1', description: 'D1', hint: 'H1', goal: { type: 'command-executed', command: 'pwd' }, xp: 10, module: 'basics', difficulty: 'easy' },
        { id: 'quest-002', title: 'Q2', description: 'D2', hint: 'H2', goal: { type: 'command-executed', command: 'pwd' }, xp: 10, module: 'basics', difficulty: 'easy' },
        { id: 'quest-003', title: 'Q3', description: 'D3', hint: 'H3', goal: { type: 'command-executed', command: 'pwd' }, xp: 10, module: 'basics', difficulty: 'easy' },
      ];
      const engine = new QuestEngine(quests);
      const panel = new QuestPanel({ container, questEngine: engine });

      panel.mount();
      expect(
        container.querySelector('.quest-panel__title').textContent.includes('Quest 1:'),
      ).toBe(true);
      expect(
        container.querySelector('.quest-panel__title').textContent.includes('Q1'),
      ).toBe(true);

      engine.solveQuest('quest-001');
      panel.refresh();

      const title = container.querySelector('.quest-panel__title').textContent;
      expect(title.includes('Quest 1:')).toBe(false);
      expect(title.includes('Quest 2:')).toBe(true);
      expect(title.includes('Q2')).toBe(true);
      expect(container.querySelector('.quest-panel__desc').textContent).toBe('D2');
    } finally {
      if (container.parentNode) container.parentNode.removeChild(container);
    }
  });
});

// ---------------------------------------------------------------------------
// QuestPanel — externe State-Änderung vor mount (spec013c)
// ---------------------------------------------------------------------------

describe('QuestPanel — externe State-Änderung vor mount', () => {
  it('reads the active quest at mount() time, not at construction time', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    try {
      const quests = [
        { id: 'quest-001', title: 'Q1', description: 'D1', hint: 'H1', goal: { type: 'command-executed', command: 'pwd' }, xp: 10, module: 'basics', difficulty: 'easy' },
        { id: 'quest-002', title: 'Q2', description: 'D2', hint: 'H2', goal: { type: 'command-executed', command: 'pwd' }, xp: 10, module: 'basics', difficulty: 'easy' },
        { id: 'quest-003', title: 'Q3', description: 'D3', hint: 'H3', goal: { type: 'command-executed', command: 'pwd' }, xp: 10, module: 'basics', difficulty: 'easy' },
      ];
      const engine = new QuestEngine(quests);
      // Solve BEFORE the panel is constructed — simulates the
      // restoreQuests() → panel.mount() ordering in production
      // (spec013c boot order).
      engine.solveQuest('quest-001');

      const panel = new QuestPanel({ container, questEngine: engine });
      panel.mount();

      const title = container.querySelector('.quest-panel__title').textContent;
      expect(title.includes('Quest 1:')).toBe(false);
      expect(title.includes('Quest 2:')).toBe(true);
      expect(title.includes('Q2')).toBe(true);
    } finally {
      if (container.parentNode) container.parentNode.removeChild(container);
    }
  });
});