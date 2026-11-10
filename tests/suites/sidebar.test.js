import { describe, it, expect } from '../runner.js';
import { QuestEngine } from '../../js/quests/quest-engine.js';
import { XP } from '../../js/gamification/xp.js';
import { BadgeTracker } from '../../js/gamification/badges.js';
import {
  Sidebar,
  getQuestStatus,
  difficultyLabel,
  difficultyAriaLabel,
} from '../../js/ui/sidebar.js';
import { QuestPanel } from '../../js/ui/quest-panel.js';

/**
 * Minimal valid quest fixture.
 *
 * @param {string} id
 * @param {string} [title]
 * @param {'easy'|'medium'|'hard'|string} [difficulty='easy']
 * @returns {object}
 */
function makeQuest(id, title = `Quest ${id}`, difficulty = 'easy') {
  return {
    id,
    module: 'basics',
    difficulty,
    title,
    description: 'D',
    hint: 'H',
    goal: { type: 'command-executed', command: 'pwd' },
    xp: 10,
  };
}

/**
 * Setup: attach a fresh `<aside id="sidebar">` to the DOM plus a fresh
 * engine/tracker stack. Returns a cleanup function that removes the
 * element.
 *
 * @param {object[]} quests
 * @returns {{
 *   aside: HTMLElement,
 *   engine: QuestEngine,
 *   xp: XP,
 *   badges: BadgeTracker,
 *   cleanup: () => void,
 * }}
 */
function setup(quests) {
  const aside = document.createElement('aside');
  aside.id = 'sidebar';
  document.body.appendChild(aside);
  return {
    aside,
    engine: new QuestEngine(quests),
    xp: new XP(0),
    badges: new BadgeTracker(),
    cleanup: () => {
      if (aside.parentNode) aside.parentNode.removeChild(aside);
    },
  };
}

/**
 * Like `setup`, but also attaches a `#sidebar-toggle` button to the DOM
 * so the toggle-wiring paths can be tested.
 *
 * @param {object[]} quests
 * @returns {{
 *   aside: HTMLElement,
 *   toggleBtn: HTMLButtonElement,
 *   engine: QuestEngine,
 *   xp: XP,
 *   badges: BadgeTracker,
 *   cleanup: () => void,
 * }}
 */
function setupWithToggle(quests) {
  const base = setup(quests);
  const btn = document.createElement('button');
  btn.id = 'sidebar-toggle';
  document.body.appendChild(btn);
  return {
    ...base,
    toggleBtn: btn,
    cleanup: () => {
      base.cleanup();
      if (btn.parentNode) btn.parentNode.removeChild(btn);
    },
  };
}

// ---------------------------------------------------------------------------
// getQuestStatus
// ---------------------------------------------------------------------------

describe('getQuestStatus', () => {
  it('returns "solved" for a solved quest', () => {
    const q1 = makeQuest('q1');
    const engine = new QuestEngine([q1]);
    engine.solveQuest('q1');
    expect(getQuestStatus(q1, engine)).toBe('solved');
  });

  it('returns "active" for the current active quest', () => {
    const q1 = makeQuest('q1');
    const engine = new QuestEngine([q1]);
    expect(getQuestStatus(q1, engine)).toBe('active');
  });

  it('returns "locked" for a quest neither solved nor active', () => {
    const q1 = makeQuest('q1');
    const q2 = makeQuest('q2');
    const engine = new QuestEngine([q1, q2]);
    // q1 is active; q2 is locked.
    expect(getQuestStatus(q2, engine)).toBe('locked');
  });

  it('three quests — correct status for each', () => {
    const q1 = makeQuest('q1');
    const q2 = makeQuest('q2');
    const q3 = makeQuest('q3');
    const engine = new QuestEngine([q1, q2, q3]);
    engine.solveQuest('q1');
    engine.solveQuest('q2');
    expect(getQuestStatus(q1, engine)).toBe('solved');
    expect(getQuestStatus(q2, engine)).toBe('solved');
    expect(getQuestStatus(q3, engine)).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// difficultyLabel / difficultyAriaLabel (spec012d §3.3 / §6)
// ---------------------------------------------------------------------------

describe('difficultyLabel / difficultyAriaLabel', () => {
  it('difficultyLabel maps easy/medium/hard to E/M/S', () => {
    expect(difficultyLabel('easy')).toBe('E');
    expect(difficultyLabel('medium')).toBe('M');
    expect(difficultyLabel('hard')).toBe('S');
  });

  it('difficultyAriaLabel returns null for an unknown difficulty', () => {
    expect(difficultyAriaLabel('bogus')).toBe(null);
  });

  it('difficultyAriaLabel returns null for undefined', () => {
    // Symmetric to `difficultyLabel(undefined)` above — both helpers
    // fall through to `return null`, so both edge cases should be
    // pinned. Guards against a future refactor that unifies the two
    // functions and accidentally drops one of the null branches.
    expect(difficultyAriaLabel(undefined)).toBe(null);
  });

  it('difficultyLabel returns null for undefined', () => {
    expect(difficultyLabel(undefined)).toBe(null);
  });

  it('difficultyAriaLabel maps easy/medium/hard to German words', () => {
    expect(difficultyAriaLabel('easy')).toBe('Schwierigkeit: Einfach');
    expect(difficultyAriaLabel('medium')).toBe('Schwierigkeit: Mittel');
    expect(difficultyAriaLabel('hard')).toBe('Schwierigkeit: Schwer');
  });

  it('difficultyAriaLabel returns null for an unknown difficulty', () => {
    expect(difficultyAriaLabel('bogus')).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Sidebar — Rendering
// ---------------------------------------------------------------------------

describe('Sidebar — Rendering', () => {
  it('renders exactly one <li> per quest with correct status classes', () => {
    const { aside, engine, xp, badges, cleanup } = setup([
      makeQuest('q1'),
      makeQuest('q2'),
      makeQuest('q3'),
    ]);
    try {
      engine.solveQuest('q1');
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      const items = aside.querySelectorAll('.sidebar__quest');
      expect(items.length).toBe(3);
      expect(items[0].classList.contains('sidebar__quest--solved')).toBe(true);
      expect(items[1].classList.contains('sidebar__quest--active')).toBe(true);
      expect(items[2].classList.contains('sidebar__quest--locked')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('progress bar width reflects solved/total ratio', () => {
    const { aside, engine, xp, badges, cleanup } = setup([
      makeQuest('q1'),
      makeQuest('q2'),
      makeQuest('q3'),
    ]);
    try {
      engine.solveQuest('q1');
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      const fill = aside.querySelector('.sidebar__progress-fill');
      expect(fill.style.width).toBe('33%');
    } finally {
      cleanup();
    }
  });

  it('progress text contains "X / Y Quests"', () => {
    const { aside, engine, xp, badges, cleanup } = setup([
      makeQuest('q1'),
      makeQuest('q2'),
      makeQuest('q3'),
    ]);
    try {
      engine.solveQuest('q1');
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      const count = aside.querySelector('.sidebar__progress-count');
      expect(count.textContent).toBe('1 / 3 Quests');
    } finally {
      cleanup();
    }
  });

  it('XP display shows xpTracker total', () => {
    const { aside, engine, xp, badges, cleanup } = setup([makeQuest('q1')]);
    try {
      xp.add(42);
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      const xpEl = aside.querySelector('.sidebar__xp');
      expect(xpEl.textContent).toBe('42 XP');
    } finally {
      cleanup();
    }
  });

  it('badge display shows "0 / 3 Badges" initially', () => {
    const { aside, engine, xp, badges, cleanup } = setup([makeQuest('q1')]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      const badgeEl = aside.querySelector('.sidebar__badges');
      expect(badgeEl.textContent).toBe('0 / 3 Badges');
    } finally {
      cleanup();
    }
  });

  it('quest title is set via textContent (XSS-safe)', () => {
    const { aside, engine, xp, badges, cleanup } = setup([
      makeQuest('q1', '<script>alert(1)</script>'),
    ]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      const title = aside.querySelector('.sidebar__quest-title');
      expect(title.textContent).toBe('<script>alert(1)</script>');
      // No injected script element:
      expect(aside.querySelector('script')).toBe(null);
    } finally {
      cleanup();
    }
  });

  it('refresh() updates classes when a quest is solved', () => {
    const { aside, engine, xp, badges, cleanup } = setup([
      makeQuest('q1'),
      makeQuest('q2'),
    ]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      // Initially: q1 active, q2 locked.
      let items = aside.querySelectorAll('.sidebar__quest');
      expect(items[0].classList.contains('sidebar__quest--active')).toBe(true);
      expect(items[1].classList.contains('sidebar__quest--locked')).toBe(true);

      engine.solveQuest('q1');
      sidebar.refresh();

      // After refresh: q1 solved, q2 active.
      items = aside.querySelectorAll('.sidebar__quest');
      expect(items[0].classList.contains('sidebar__quest--solved')).toBe(true);
      expect(items[1].classList.contains('sidebar__quest--active')).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar — Toggle
// ---------------------------------------------------------------------------

describe('Sidebar — Toggle', () => {
  it('initial isOpen() is false', () => {
    const { aside, engine, xp, badges, cleanup } = setup([makeQuest('q1')]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();
      expect(sidebar.isOpen()).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('toggle() sets sidebar--open and isOpen() returns true', () => {
    const { aside, engine, xp, badges, cleanup } = setup([makeQuest('q1')]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();
      sidebar.toggle();
      expect(sidebar.isOpen()).toBe(true);
      expect(aside.classList.contains('sidebar--open')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('toggling twice returns to closed', () => {
    const { aside, engine, xp, badges, cleanup } = setup([makeQuest('q1')]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();
      sidebar.toggle();
      sidebar.toggle();
      expect(sidebar.isOpen()).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('unmount() removes the toggle button listener', () => {
    const { aside, toggleBtn, engine, xp, badges, cleanup } =
      setupWithToggle([makeQuest('q1')]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      // Sanity: click works while mounted.
      toggleBtn.click();
      expect(sidebar.isOpen()).toBe(true);

      // Unmount, then click again — state must NOT change.
      sidebar.unmount();
      toggleBtn.click();
      expect(sidebar.isOpen()).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar — Leerzustand
// ---------------------------------------------------------------------------

describe('Sidebar — Leerzustand', () => {
  it('empty engine renders an empty list, "0 / 0" count, "0%" bar', () => {
    const { aside, engine, xp, badges, cleanup } = setup([]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      expect(aside.querySelectorAll('.sidebar__quest').length).toBe(0);
      expect(
        aside.querySelector('.sidebar__progress-count').textContent,
      ).toBe('0 / 0 Quests');
      expect(
        aside.querySelector('.sidebar__progress-fill').style.width,
      ).toBe('0%');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar — Reset-Button (spec006a §5/§7)
// ---------------------------------------------------------------------------

describe('Sidebar — Reset-Button', () => {
  it('without resetHandler: no <footer> in DOM', () => {
    const { aside, engine, xp, badges, cleanup } = setup([makeQuest('q1')]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
        // resetHandler intentionally omitted
      });
      sidebar.mount();
      expect(aside.querySelector('footer')).toBe(null);
      expect(aside.querySelector('#sidebar-reset')).toBe(null);
    } finally {
      cleanup();
    }
  });

  it('with resetHandler: <button id="sidebar-reset"> exists', () => {
    const { aside, engine, xp, badges, cleanup } = setup([makeQuest('q1')]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
        resetHandler: () => {},
      });
      sidebar.mount();
      const footer = aside.querySelector('footer.sidebar__footer');
      expect(footer).toBeTruthy();
      const btn = footer.querySelector('#sidebar-reset');
      expect(btn).toBeTruthy();
      expect(btn.textContent.includes('Fortschritt')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('clicking the reset button calls resetHandler', () => {
    const { aside, engine, xp, badges, cleanup } = setup([makeQuest('q1')]);
    try {
      let calls = 0;
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
        resetHandler: () => { calls += 1; },
      });
      sidebar.mount();
      aside.querySelector('#sidebar-reset').click();
      expect(calls).toBe(1);
      aside.querySelector('#sidebar-reset').click();
      expect(calls).toBe(2);
    } finally {
      cleanup();
    }
  });

  it('after unmount(): click does not call resetHandler', () => {
    const { aside, engine, xp, badges, cleanup } = setup([makeQuest('q1')]);
    try {
      let calls = 0;
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
        resetHandler: () => { calls += 1; },
      });
      sidebar.mount();

      // Sanity: click works while mounted.
      const btn = aside.querySelector('#sidebar-reset');
      btn.click();
      expect(calls).toBe(1);

      // Unmount, then click on the detached button reference —
      // the listener must be gone.
      sidebar.unmount();
      btn.click();
      expect(calls).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('survives refresh() — the button is re-created and still wired', () => {
    const { aside, engine, xp, badges, cleanup } = setup([
      makeQuest('q1'),
      makeQuest('q2'),
    ]);
    try {
      let calls = 0;
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
        resetHandler: () => { calls += 1; },
      });
      sidebar.mount();

      engine.solveQuest('q1');
      sidebar.refresh();

      // Button exists in the freshly rebuilt footer and still works.
      const btn = aside.querySelector('#sidebar-reset');
      expect(btn).toBeTruthy();
      btn.click();
      expect(calls).toBe(1);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar — Difficulty-Badge (spec012d §3 / §6)
// ---------------------------------------------------------------------------

describe('Sidebar — Difficulty-Badge', () => {
  it('renders one badge per quest with correct class, text, aria-label', () => {
    const { aside, engine, xp, badges, cleanup } = setup([
      makeQuest('q1', 'Quest 1', 'easy'),
      makeQuest('q2', 'Quest 2', 'medium'),
      makeQuest('q3', 'Quest 3', 'hard'),
    ]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      const badgeEls = aside.querySelectorAll('.sidebar__quest-difficulty');
      expect(badgeEls.length).toBe(3);
      expect(
        badgeEls[0].classList.contains('sidebar__quest-difficulty--easy'),
      ).toBe(true);
      expect(
        badgeEls[1].classList.contains('sidebar__quest-difficulty--medium'),
      ).toBe(true);
      expect(
        badgeEls[2].classList.contains('sidebar__quest-difficulty--hard'),
      ).toBe(true);
      expect(badgeEls[0].textContent).toBe('E');
      expect(badgeEls[1].textContent).toBe('M');
      expect(badgeEls[2].textContent).toBe('S');
      expect(badgeEls[0].getAttribute('aria-label')).toBe(
        'Schwierigkeit: Einfach',
      );
      expect(badgeEls[1].getAttribute('aria-label')).toBe(
        'Schwierigkeit: Mittel',
      );
      expect(badgeEls[2].getAttribute('aria-label')).toBe(
        'Schwierigkeit: Schwer',
      );
    } finally {
      cleanup();
    }
  });

  it('badge is present for solved quests too (status does not hide it)', () => {
    const { aside, engine, xp, badges, cleanup } = setup([
      makeQuest('q1', 'Quest 1', 'easy'),
      makeQuest('q2', 'Quest 2', 'medium'),
    ]);
    try {
      engine.solveQuest('q1');
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      const items = aside.querySelectorAll('.sidebar__quest');
      expect(items[0].classList.contains('sidebar__quest--solved')).toBe(true);
      const solvedBadge = items[0].querySelector('.sidebar__quest-difficulty');
      expect(solvedBadge).toBeTruthy();
      expect(solvedBadge.textContent).toBe('E');
    } finally {
      cleanup();
    }
  });

  it('no badge span for unknown difficulty (defensive, no crash)', () => {
    const { aside, engine, xp, badges, cleanup } = setup([
      makeQuest('q1', 'Quest 1', 'extreme'),
    ]);
    try {
      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      // The quest item still renders, but without a difficulty badge.
      expect(aside.querySelectorAll('.sidebar__quest').length).toBe(1);
      expect(
        aside.querySelectorAll('.sidebar__quest-difficulty').length,
      ).toBe(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// QuestPanel — Difficulty-Badge (spec012d §4 / §6)
// ---------------------------------------------------------------------------

describe('QuestPanel — Difficulty-Badge', () => {
  /**
   * Setup: a fresh `<section id="quest-panel">` plus a fresh engine.
   *
   * @param {object[]} quests
   * @returns {{
   *   container: HTMLElement,
   *   engine: QuestEngine,
   *   cleanup: () => void,
   * }}
   */
  function setupPanel(quests) {
    const container = document.createElement('section');
    container.id = 'quest-panel';
    document.body.appendChild(container);
    return {
      container,
      engine: new QuestEngine(quests),
      cleanup: () => {
        if (container.parentNode) container.parentNode.removeChild(container);
      },
    };
  }

  it('renders "S" badge with hard class and German aria-label', () => {
    const { container, engine, cleanup } = setupPanel([
      makeQuest('q1', 'Quest 1', 'hard'),
    ]);
    try {
      const panel = new QuestPanel({ container, questEngine: engine });
      panel.mount();

      const badge = container.querySelector('.quest-panel__difficulty');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('S');
      expect(
        badge.classList.contains('quest-panel__difficulty--hard'),
      ).toBe(true);
      expect(badge.getAttribute('aria-label')).toBe('Schwierigkeit: Schwer');
    } finally {
      cleanup();
    }
  });

  it('renders "E" badge for an easy active quest', () => {
    const { container, engine, cleanup } = setupPanel([
      makeQuest('q1', 'Quest 1', 'easy'),
    ]);
    try {
      const panel = new QuestPanel({ container, questEngine: engine });
      panel.mount();

      const badge = container.querySelector('.quest-panel__difficulty');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('E');
      expect(
        badge.classList.contains('quest-panel__difficulty--easy'),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('state B ("all solved") renders no badge', () => {
    const { container, engine, cleanup } = setupPanel([
      makeQuest('q1', 'Quest 1', 'easy'),
    ]);
    try {
      engine.solveQuest('q1');
      const panel = new QuestPanel({ container, questEngine: engine });
      panel.mount();

      expect(container.querySelector('.quest-panel--done')).toBeTruthy();
      expect(container.querySelector('.quest-panel__difficulty')).toBe(null);
    } finally {
      cleanup();
    }
  });

  it('no badge for unknown difficulty (defensive, no crash)', () => {
    const { container, engine, cleanup } = setupPanel([
      makeQuest('q1', 'Quest 1', 'extreme'),
    ]);
    try {
      const panel = new QuestPanel({ container, questEngine: engine });
      panel.mount();

      expect(container.querySelector('.quest-panel__difficulty')).toBe(null);
      // Sanity: title text still rendered.
      const title = container.querySelector('.quest-panel__title');
      expect(title.textContent.includes('Quest 1')).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration — Badge-Wechsel (spec012d §6)
// ---------------------------------------------------------------------------

describe('Integration — Badge-Wechsel', () => {
  it('panel badge follows the active quest through easy → medium → hard → done', () => {
    const quests = [
      makeQuest('q1', 'Quest 1', 'easy'),
      makeQuest('q2', 'Quest 2', 'medium'),
      makeQuest('q3', 'Quest 3', 'hard'),
    ];

    const aside = document.createElement('aside');
    aside.id = 'sidebar';
    document.body.appendChild(aside);

    const panelContainer = document.createElement('section');
    panelContainer.id = 'quest-panel';
    document.body.appendChild(panelContainer);

    try {
      const engine = new QuestEngine(quests);
      const xp = new XP(0);
      const badges = new BadgeTracker();

      const sidebar = new Sidebar({
        container: aside,
        questEngine: engine,
        xpTracker: xp,
        badgeTracker: badges,
      });
      sidebar.mount();

      const panel = new QuestPanel({
        container: panelContainer,
        questEngine: engine,
      });
      panel.mount();

      // Initial state: q1 (easy) is active. Sidebar shows 3 badges,
      // panel shows "E".
      expect(aside.querySelectorAll('.sidebar__quest-difficulty').length).toBe(3);
      let panelBadge = panelContainer.querySelector('.quest-panel__difficulty');
      expect(panelBadge).toBeTruthy();
      expect(panelBadge.textContent).toBe('E');

      // Solve q1 → q2 (medium) active. Panel shows "M".
      engine.solveQuest('q1');
      panel.refresh();
      panelBadge = panelContainer.querySelector('.quest-panel__difficulty');
      expect(panelBadge.textContent).toBe('M');
      expect(
        panelBadge.classList.contains('quest-panel__difficulty--medium'),
      ).toBe(true);

      // Solve q2 → q3 (hard) active. Panel shows "S".
      engine.solveQuest('q2');
      panel.refresh();
      panelBadge = panelContainer.querySelector('.quest-panel__difficulty');
      expect(panelBadge.textContent).toBe('S');
      expect(
        panelBadge.classList.contains('quest-panel__difficulty--hard'),
      ).toBe(true);

      // Solve q3 → done state. No badge, "Alle Quests gelöst!".
      engine.solveQuest('q3');
      panel.refresh();
      expect(panelContainer.querySelector('.quest-panel__difficulty')).toBe(null);
      expect(panelContainer.querySelector('.quest-panel--done')).toBeTruthy();
      expect(
        panelContainer.textContent.includes('Alle Quests gelöst!'),
      ).toBe(true);
    } finally {
      if (aside.parentNode) aside.parentNode.removeChild(aside);
      if (panelContainer.parentNode) {
        panelContainer.parentNode.removeChild(panelContainer);
      }
    }
  });
});