import { difficultyLabel, difficultyAriaLabel } from './sidebar.js';

/**
 * QuestPanel — narrow banner above the terminal showing the current quest.
 *
 * Renders exactly one of two states (spec005b §4.1):
 *  A. An active quest → title / description / hint.
 *  B. No active quest (all solved or empty) → "Alle Quests gelöst!".
 *
 * `refresh()` replaces the container's children on every call. No diffing,
 * no subtree updates — V1 simplicity.
 *
 * The panel is a pure renderer. Solving is done by `QuestValidator`;
 * `onSolved` is invoked by app.js, never by the panel itself. The
 * callback is stored now and first called from app.js in spec005c
 * (after XP + toast wiring lands). Do not add an `_onSolved` call inside
 * this class in spec005b — the contract is "panel renders, app
 * coordinates".
 *
 * Difficulty badge (spec012d §4): the title carries a small coloured
 * chip with the single-letter label from `difficultyLabel`. The mapping
 * helpers live in `./sidebar.js` and are imported here to keep one
 * source of truth across the two UI modules. State B ("Alle Quests
 * gelöst!") renders NO badge.
 *
 * @module ui/quest-panel
 */

export class QuestPanel {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container  Element the panel should live in.
   * @param {import('../quests/quest-engine.js').QuestEngine} opts.questEngine
   * @param {(quest: object) => void} [opts.onSolved] Stored for spec005c;
   *   NOT invoked by this class in spec005b. `app.js` calls it when the
   *   QuestValidator reports a solve.
   */
  constructor({ container, questEngine, onSolved }) {
    this._container = container;
    this._questEngine = questEngine;
    // Unused in spec005b — reserved for spec005c where app.js will call
    // this._onSolved(...) after a solve. Kept in the constructor to fix
    // the parameter contract now, not add it later.
    this._onSolved = typeof onSolved === 'function' ? onSolved : null;
  }

  /**
   * Render the initial state. Equivalent to a first `refresh()`.
   *
   * @returns {void}
   */
  mount() {
    this.refresh();
  }

  /**
   * Re-render from the current engine state.
   *
   * @returns {void}
   */
  refresh() {
    this._container.innerHTML = '';

    const active = this._questEngine.getActiveQuest();
    if (!active) {
      const panel = document.createElement('div');
      panel.className = 'quest-panel quest-panel--done';

      const title = document.createElement('div');
      title.className = 'quest-panel__title';
      title.textContent = 'Alle Quests gelöst!';
      panel.appendChild(title);

      this._container.appendChild(panel);
      return;
    }

    const allQuests = this._questEngine.getAllQuests();
    const idx = allQuests.findIndex((q) => q.id === active.id) + 1;

    const panel = document.createElement('div');
    panel.className = 'quest-panel';

    const title = document.createElement('div');
    title.className = 'quest-panel__title';
    title.textContent = `Quest ${idx}: ${active.title}`;

    // Difficulty badge (spec012d §4). Skipped for unknown difficulty so
    // a malformed quest renders "title only". The visible gap between
    // the title text and the chip is provided by
    // `.quest-panel__difficulty { margin-left: 8px; }` (spec §5.2) —
    // one source of spacing, not two. A JS-side `append(' ', badge)`
    // would stack on top of that margin and exceed the "one space"
    // the spec calls for (see review to spec012d, NICE 1).
    const diffLabel = difficultyLabel(active.difficulty);
    if (diffLabel !== null) {
      const badge = document.createElement('span');
      badge.className =
        `quest-panel__difficulty ` +
        `quest-panel__difficulty--${active.difficulty}`;
      badge.textContent = diffLabel;
      badge.setAttribute('aria-label', difficultyAriaLabel(active.difficulty));
      title.appendChild(badge);
    }

    panel.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'quest-panel__desc';
    desc.textContent = active.description;
    panel.appendChild(desc);

    const hint = document.createElement('div');
    hint.className = 'quest-panel__hint';
    hint.textContent = 'Tipp: ' + active.hint;
    panel.appendChild(hint);

    this._container.appendChild(panel);
  }

  /**
   * Remove rendered children from the container.
   *
   * @returns {void}
   */
  unmount() {
    this._container.innerHTML = '';
  }
}