import { BADGES } from '../gamification/badges.js';

/**
 * Status of a single quest relative to the engine's current state.
 *
 * @param {object} quest
 * @param {import('../quests/quest-engine.js').QuestEngine} questEngine
 * @returns {'solved'|'active'|'available'}
 */
export function getQuestStatus(quest, questEngine) {
  if (questEngine.isSolved(quest.id)) return 'solved';
  const active = questEngine.getActiveQuest();
  if (active && active.id === quest.id) return 'active';
  return 'available';
}

/**
 * Map a quest difficulty to its single-letter badge label.
 *
 * German UI: E = Einfach, M = Mittel, S = Schwer. 'S' (not 'H') for
 * Schwer, so the letter matches the German UI language. The sidebar
 * logo ("BashQuest") and reset button ("Fortschritt zurücksetzen")
 * are German too; quest IDs are internal and not user-visible text.
 *
 * Unknown difficulties return `null` — callers must skip the badge
 * rather than render a letter that means nothing to the user. This
 * is defensive: the quest schema (spec012a) forbids unknown values,
 * so a non-`null` return only happens on malformed data.
 *
 * @param {string} difficulty One of 'easy' | 'medium' | 'hard'.
 * @returns {'E'|'M'|'S'|null}
 */
export function difficultyLabel(difficulty) {
  if (difficulty === 'easy') return 'E';
  if (difficulty === 'medium') return 'M';
  if (difficulty === 'hard') return 'S';
  return null;
}

/**
 * Map a quest difficulty to a screen-reader `aria-label`. The badge
 * label is a single letter; the aria-label spells the word out so a
 * screen reader announces the meaning, not the glyph.
 *
 * @param {string} difficulty One of 'easy' | 'medium' | 'hard'.
 * @returns {string|null}
 */
export function difficultyAriaLabel(difficulty) {
  if (difficulty === 'easy') return 'Schwierigkeit: Einfach';
  if (difficulty === 'medium') return 'Schwierigkeit: Mittel';
  if (difficulty === 'hard') return 'Schwierigkeit: Schwer';
  return null;
}

/**
 * Sidebar — right-hand navigation panel with progress, XP, badges, a
 * flat quest list, and an optional footer with a "reset progress"
 * button.
 *
 * V1 scope:
 *  - Flat list (no module grouping).
 *  - Click handler on `'available'` quests only (spec015a §3.3);
 *    selecting a quest is delegated to `onQuestSelect` if provided.
 *  - No badge-detail view — just a counter.
 *  - Reset button is optional (spec006a §5): rendered only when a
 *    `resetHandler` was supplied. Without it, no footer is rendered at
 *    all — backwards compatible with spec005d usage.
 *  - Difficulty badge per quest (spec012d §3): a small coloured chip
 *    with the single-letter label from `difficultyLabel`. Rendered
 *    after the title, pushed to the right by `margin-left: auto` in
 *    css/sidebar.css.
 *
 * The `#sidebar-toggle` button lives OUTSIDE the sidebar element in the
 * DOM (see spec005d §5/§7). `mount()` looks it up (if present) and wires
 * a click listener; `unmount()` removes that listener. If the button is
 * absent (e.g. in a unit test that only wants the rendering), `mount()`
 * still succeeds — only the toggle wiring is skipped.
 *
 * The reset button is INSIDE the sidebar (in the footer) and is
 * re-created on every `refresh()` — because `refresh()` rebuilds the
 * whole panel. Its listener is attached in `refresh()` (right after
 * button creation) and detached in `unmount()` from the current button
 * reference. Detaching from a button that is already detached from the
 * DOM is a no-op, which is exactly what we want after an in-between
 * refresh.
 *
 * Styling: `#sidebar` (id) and `.sidebar__*` (BEM elements). No
 * `.sidebar` class is added by this module — the id is the sole
 * styling hook.
 *
 * @module ui/sidebar
 */
export class Sidebar {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container       The `<aside id="sidebar">` element.
   * @param {import('../quests/quest-engine.js').QuestEngine} opts.questEngine
   * @param {import('../gamification/xp.js').XP} opts.xpTracker
   * @param {import('../gamification/badges.js').BadgeTracker} opts.badgeTracker
   * @param {(() => void)|null|undefined} [opts.resetHandler] Optional.
   *   If provided, a footer with a reset button is rendered. If absent
   *   or not a function, no footer appears (backwards compatible).
   * @param {((questId: string) => void)|null|undefined} [opts.onQuestSelect]
   *   Optional. If provided, clicking an `'available'` quest calls
   *   `onQuestSelect(quest.id)`. Solved and active quests are not
   *   clickable, so the callback never fires for them (the UI
   *   enforces the invariant; the callback does not need to
   *   re-check). Omitted → quests are not clickable (backwards
   *   compatible with spec005d).
   */
  constructor({
    container,
    questEngine,
    xpTracker,
    badgeTracker,
    resetHandler,
    onQuestSelect,
  }) {
    this._container = container;
    this._questEngine = questEngine;
    this._xpTracker = xpTracker;
    this._badgeTracker = badgeTracker;
    this._resetHandler =
      typeof resetHandler === 'function' ? resetHandler : null;
    this._onQuestSelect =
      typeof onQuestSelect === 'function' ? onQuestSelect : null;

    // Bind once so `removeEventListener` in unmount() uses the exact
    // same function reference as `addEventListener` in mount()/refresh().
    this._boundToggle = () => this.toggle();
    this._boundReset = () => {
      if (this._resetHandler) this._resetHandler();
    };
    /** @type {HTMLElement|null} */
    this._toggleButton = null;
    /** @type {HTMLElement|null} */
    this._resetButton = null;
  }

  /**
   * Render the initial state and wire the toggle button (if present).
   *
   * @returns {void}
   */
  mount() {
    this.refresh();

    const btn = document.getElementById('sidebar-toggle');
    if (btn) {
      this._toggleButton = btn;
      btn.addEventListener('click', this._boundToggle);
    }
  }

  /**
   * Re-render from the current engine/tracker state. Clears the container
   * completely on every call — no diffing.
   *
   * The reset button (if a resetHandler was provided) is created here,
   * along with its click listener. See the module JSDoc for the
   * listener lifecycle rationale.
   *
   * @returns {void}
   */
  refresh() {
    this._container.innerHTML = '';

    const progress = this._questEngine.getProgress();
    const total = progress.total;
    const solved = progress.solved;
    const percent = total === 0 ? 0 : Math.round((solved / total) * 100);

    // --- header -----------------------------------------------------
    const header = document.createElement('header');
    header.className = 'sidebar__header';

    const logo = document.createElement('h1');
    logo.className = 'sidebar__logo';
    logo.textContent = 'BashQuest';
    header.appendChild(logo);

    this._container.appendChild(header);

    // --- progress ---------------------------------------------------
    const progressSection = document.createElement('section');
    progressSection.className = 'sidebar__progress';

    const progressText = document.createElement('div');
    progressText.className = 'sidebar__progress-text';

    const countSpan = document.createElement('span');
    countSpan.className = 'sidebar__progress-count';
    countSpan.textContent = `${solved} / ${total} Quests`;
    progressText.appendChild(countSpan);

    const xpSpan = document.createElement('span');
    xpSpan.className = 'sidebar__xp';
    xpSpan.textContent = `${this._xpTracker.getTotal()} XP`;
    progressText.appendChild(xpSpan);

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'sidebar__badges';
    const unlockedCount = this._badgeTracker.getUnlocked().length;
    badgeSpan.textContent = `${unlockedCount} / ${BADGES.length} Badges`;
    progressText.appendChild(badgeSpan);

    progressSection.appendChild(progressText);

    const progressBar = document.createElement('div');
    progressBar.className = 'sidebar__progress-bar';

    const progressFill = document.createElement('div');
    progressFill.className = 'sidebar__progress-fill';
    progressFill.style.width = `${percent}%`;
    progressBar.appendChild(progressFill);

    progressSection.appendChild(progressBar);
    this._container.appendChild(progressSection);

    // --- quest list -------------------------------------------------
    const list = document.createElement('ul');
    list.className = 'sidebar__quests';

    for (const quest of this._questEngine.getAllQuests()) {
      const status = getQuestStatus(quest, this._questEngine);

      const li = document.createElement('li');
      li.className = `sidebar__quest sidebar__quest--${status}`;
      li.dataset.questId = quest.id;

      const icon = document.createElement('span');
      icon.className = 'sidebar__quest-icon';
      icon.textContent =
        status === 'solved' ? '✓' : status === 'active' ? '●' : '○';
      li.appendChild(icon);

      // textContent (not innerHTML) — quest title is user-facing data
      // that may come from quests.json and must not be interpreted as
      // markup.
      const title = document.createElement('span');
      title.className = 'sidebar__quest-title';
      title.textContent = quest.title;
      li.appendChild(title);

      // spec015a §3.3: click handler on available quests only. The
      // `available` status is set above via `getQuestStatus`, so the
      // click handler is attached only when the user can meaningfully
      // select this quest. Solved and active quests are rendered
      // without a handler — a future CSS refactor cannot accidentally
      // make them look interactive.
      //
      // The handler is re-created on every `refresh()` because
      // `refresh()` rebuilds the DOM from `innerHTML = ''`; the
      // listener is garbage-collected with the discarded `li`. No
      // explicit `removeEventListener` needed — see the module JSDoc
      // for the lifecycle rationale.
      if (status === 'available' && this._onQuestSelect) {
        li.addEventListener('click', () => {
          this._onQuestSelect(quest.id);
        });
      }

      // Difficulty badge (spec012d §3). Skipped entirely for unknown
      // difficulty so a malformed quest degrades to "title only"
      // instead of crashing the whole sidebar render.
      const diffLabel = difficultyLabel(quest.difficulty);
      if (diffLabel !== null) {
        const diffBadge = document.createElement('span');
        diffBadge.className =
          `sidebar__quest-difficulty ` +
          `sidebar__quest-difficulty--${quest.difficulty}`;
        diffBadge.textContent = diffLabel;
        diffBadge.setAttribute(
          'aria-label',
          difficultyAriaLabel(quest.difficulty),
        );
        li.appendChild(diffBadge);
      }

      list.appendChild(li);
    }

    this._container.appendChild(list);

    // --- footer (only if resetHandler was provided) -----------------
    if (this._resetHandler) {
      const footer = document.createElement('footer');
      footer.className = 'sidebar__footer';

      const btn = document.createElement('button');
      btn.className = 'sidebar__reset';
      btn.id = 'sidebar-reset';
      btn.type = 'button';
      btn.textContent = 'Fortschritt zurücksetzen';
      btn.addEventListener('click', this._boundReset);
      footer.appendChild(btn);

      this._container.appendChild(footer);
      this._resetButton = btn;
    } else {
      this._resetButton = null;
    }
  }

  /**
   * Detach from the DOM: remove both listeners (if mounted), clear the
   * rendered content.
   *
   * @returns {void}
   */
  unmount() {
    if (this._toggleButton) {
      this._toggleButton.removeEventListener('click', this._boundToggle);
      this._toggleButton = null;
    }
    if (this._resetButton) {
      // The reset button may have been replaced by an in-between
      // `refresh()`. Removing a listener from a detached node is a
      // no-op, so this is safe regardless.
      this._resetButton.removeEventListener('click', this._boundReset);
      this._resetButton = null;
    }
    this._container.innerHTML = '';
  }

  /**
   * Toggle the `sidebar--open` class on the sidebar element. On desktop
   * this has no visual effect (the sidebar is always visible); on mobile
   * (`<768px`) it switches between the off-screen overlay and the
   * visible state (see css/layout.css).
   *
   * @returns {void}
   */
  toggle() {
    this._container.classList.toggle('sidebar--open');
  }

  /**
   * @returns {boolean} `true` when the `sidebar--open` class is present.
   */
  isOpen() {
    return this._container.classList.contains('sidebar--open');
  }
}