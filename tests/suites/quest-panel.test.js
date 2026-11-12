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

// ===========================================================================
// spec016b — Collapsible hint tests
//
// The fixtures below are self-contained (local `makeHintQuest` /
// `setupHintPanel`) so this block does not depend on the pre-existing
// `makeQuest` / `setup` helpers of this file. That keeps the diff
// independent of the file's other fixtures — a refactor of the
// existing setup in a future round cannot silently break these tests.
// ===========================================================================

/**
 * @param {object} [overrides]
 * @returns {object}
 */
function makeHintQuest(overrides = {}) {
  return {
    id: 'quest-001',
    module: 'basics',
    difficulty: 'easy',
    title: 'Test Quest',
    description: 'Test description',
    hint: 'The full instructional sentence.',
    goal: { type: 'command-executed', command: 'ls' },
    xp: 10,
    ...overrides,
  };
}

/**
 * @param {object[]} quests
 * @returns {{
 *   container: HTMLElement,
 *   engine: QuestEngine,
 *   panel: QuestPanel,
 *   cleanup: () => void,
 * }}
 */
function setupHintPanel(quests) {
  const container = document.createElement('section');
  document.body.appendChild(container);
  const engine = new QuestEngine(quests);
  const panel = new QuestPanel({ container, questEngine: engine });
  return {
    container,
    engine,
    panel,
    cleanup: () => {
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

// ---------------------------------------------------------------------------
// QuestPanel — Hinweis-Rendering (spec016b §2.2)
// ---------------------------------------------------------------------------

describe('QuestPanel — Hinweis-Rendering', () => {
  it('renders the derived command list in .quest-panel__hint-commands', () => {
    const { container, panel, cleanup } = setupHintPanel([makeHintQuest()]);
    try {
      panel.mount();
      const commands = container.querySelector('.quest-panel__hint-commands');
      expect(commands).toBeTruthy();
      // Goal: command-executed with command 'ls' → derived ['ls'].
      expect(commands.textContent).toBe('ls');
    } finally {
      cleanup();
    }
  });

  it('renders the toggle button with aria-expanded="false"', () => {
    const { container, panel, cleanup } = setupHintPanel([makeHintQuest()]);
    try {
      panel.mount();
      const toggle = container.querySelector('.quest-panel__hint-toggle');
      expect(toggle).toBeTruthy();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    } finally {
      cleanup();
    }
  });

  it('renders the detail block hidden by default', () => {
    const { container, panel, cleanup } = setupHintPanel([makeHintQuest()]);
    try {
      panel.mount();
      const detail = container.querySelector('.quest-panel__hint-detail');
      expect(detail).toBeTruthy();
      expect(detail.hidden).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('renders the full hint text as detail content', () => {
    const { container, panel, cleanup } = setupHintPanel([
      makeHintQuest({ hint: 'Custom hint sentence.' }),
    ]);
    try {
      panel.mount();
      const detail = container.querySelector('.quest-panel__hint-detail');
      expect(detail.textContent).toBe('Custom hint sentence.');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// QuestPanel — commands-Feld gewinnt (spec016b §2.2 / spec016a §2)
// ---------------------------------------------------------------------------

describe('QuestPanel — commands-Feld gewinnt', () => {
  it('renders the explicit commands list instead of a derived single command', () => {
    const { container, panel, cleanup } = setupHintPanel([
      makeHintQuest({
        commands: ['chmod', 'stat'],
        goal: { type: 'file-mode', path: '/tmp/x', mode: 384 },
      }),
    ]);
    try {
      panel.mount();
      const commands = container.querySelector('.quest-panel__hint-commands');
      expect(commands.textContent).toBe('chmod, stat');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// QuestPanel — Fallback "?" (spec016b §2.2)
// ---------------------------------------------------------------------------

describe('QuestPanel — Fallback "?"', () => {
  it('renders "?" when the quest exposes no command', () => {
    const { container, panel, cleanup } = setupHintPanel([
      makeHintQuest({
        goal: { type: 'file-exists', path: '/tmp/x' },
      }),
    ]);
    try {
      panel.mount();
      const commands = container.querySelector('.quest-panel__hint-commands');
      expect(commands.textContent).toBe('?');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// QuestPanel — Aufklappen (spec016b §2.3)
// ---------------------------------------------------------------------------

describe('QuestPanel — Aufklappen', () => {
  it('toggles detail visibility and aria-expanded on click', () => {
    const { container, panel, cleanup } = setupHintPanel([makeHintQuest()]);
    try {
      panel.mount();
      const toggle = container.querySelector('.quest-panel__hint-toggle');
      const detail = container.querySelector('.quest-panel__hint-detail');

      // Initial: collapsed.
      expect(detail.hidden).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      // First click: expand.
      toggle.click();
      expect(detail.hidden).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      // Second click: collapse.
      toggle.click();
      expect(detail.hidden).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// QuestPanel — State-Reset bei refresh (spec016b §2.4)
// ---------------------------------------------------------------------------

describe('QuestPanel — State-Reset bei refresh', () => {
  it('collapses the detail block again on refresh after solving', () => {
    const { container, engine, panel, cleanup } = setupHintPanel([
      makeHintQuest({ id: 'quest-001' }),
      makeHintQuest({ id: 'quest-002', title: 'Second' }),
    ]);
    try {
      panel.mount();

      // Expand the first quest's hint.
      let toggle = container.querySelector('.quest-panel__hint-toggle');
      toggle.click();
      let detail = container.querySelector('.quest-panel__hint-detail');
      expect(detail.hidden).toBe(false);

      // Solve the active quest → next quest becomes active.
      engine.solveQuest('quest-001');
      panel.refresh();

      // New active quest starts collapsed.
      toggle = container.querySelector('.quest-panel__hint-toggle');
      detail = container.querySelector('.quest-panel__hint-detail');
      expect(detail.hidden).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    } finally {
      cleanup();
    }
  });

  it('the toggle handler still works after refresh (regression guard)', () => {
    // Guards the BLOCKER requirement "toggle handler must be
    // registered in refresh(), not only in mount()". A refactor that
    // dropped the addEventListener block from refresh() would leave
    // the previous test green — `detail.hidden` is initially `true`
    // even without a listener. Only a post-refresh `.click()` proves
    // the freshly-created toggle is wired. See review SHOULD to
    // spec016b.
    const { container, engine, panel, cleanup } = setupHintPanel([
      makeHintQuest({ id: 'quest-001' }),
      makeHintQuest({ id: 'quest-002', title: 'Second' }),
    ]);
    try {
      panel.mount();

      // Solve quest-001 → panel refreshes with quest-002 as active.
      engine.solveQuest('quest-001');
      panel.refresh();

      // The newly created toggle must still expand on click.
      const toggle = container.querySelector('.quest-panel__hint-toggle');
      const detail = container.querySelector('.quest-panel__hint-detail');
      expect(detail.hidden).toBe(true);

      toggle.click();
      expect(detail.hidden).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      // And collapse again — proves the listener handles both directions.
      toggle.click();
      expect(detail.hidden).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// QuestPanel — Zustand B (spec016b §2.5)
// ---------------------------------------------------------------------------

describe('QuestPanel — Zustand B (all solved, no hint block)', () => {
  it('renders "Alle Quests gelöst!" without any hint elements', () => {
    const { container, engine, panel, cleanup } = setupHintPanel([
      makeHintQuest({ id: 'quest-001' }),
    ]);
    try {
      // Solve before mount → engine has no active quest.
      engine.solveQuest('quest-001');
      panel.mount();

      // Done-state title present.
      const title = container.querySelector('.quest-panel__title');
      expect(title.textContent).toBe('Alle Quests gelöst!');

      // No hint elements at all.
      expect(container.querySelector('.quest-panel__hint')).toBe(null);
      expect(container.querySelector('.quest-panel__hint-toggle')).toBe(null);
      expect(container.querySelector('.quest-panel__hint-detail')).toBe(null);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// QuestPanel — XSS-Schutz (spec016b §2.2)
// ---------------------------------------------------------------------------

describe('QuestPanel — XSS-Schutz im Detail-Block', () => {
  it('renders a script-shaped hint as textContent, not as an element', () => {
    const { container, panel, cleanup } = setupHintPanel([
      makeHintQuest({ hint: '<script>alert(1)</script>' }),
    ]);
    try {
      panel.mount();
      const detail = container.querySelector('.quest-panel__hint-detail');
      // The literal string is preserved as text.
      expect(detail.textContent).toBe('<script>alert(1)</script>');
      // No <script> element was injected into the container.
      expect(container.querySelector('script')).toBe(null);
    } finally {
      cleanup();
    }
  });
});