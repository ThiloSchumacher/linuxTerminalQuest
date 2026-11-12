import { difficultyLabel, difficultyAriaLabel } from './sidebar.js';
import { getQuestCommands } from '../quests/commands-from-quest.js';

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
 * ## Collapsible hint (spec016b)
 *
 * The visible hint is now a compact one-line summary — a label
 * ("Tipp:"), a command chip ("ls", "chmod, stat", or "?" when the
 * quest exposes no command), and a small "»" toggle. Clicking the
 * toggle reveals the full instructional sentence (the quest's `hint`
 * field) in a detail block below; clicking again collapses it. The
 * arrow rotates 90° via the `aria-expanded` attribute (CSS handles
 * the visual transform).
 *
 * The toggle and detail elements are re-created on every `refresh()`
 * because the panel rebuilds the whole DOM; the click listener dies
 * with the discarded elements. No `removeEventListener` needed.
 *
 * Collapse state is NOT persisted across refreshes — a new active
 * quest starts collapsed by design (see spec016b §2.4: "neue Quest =
 * neuer Hinweis, kein altes Detail klebt").
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
    // a malformed quest renders "title only". The gap between title
    // text and chip is provided by
    // `.quest-panel__difficulty { margin-left: 8px; }` (spec §5.2) —
    // one source of spacing, not two.
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

    // --- hint area (spec016b §2.2) ----------------------------------
    // Compact one-line view: label + command chip + toggle button.
    // The full instructional sentence lives in the collapsed detail
    // block below (hidden by default).
    const commands = getQuestCommands(active);
    const commandsText = commands.length > 0 ? commands.join(', ') : '?';

    const hintRow = document.createElement('div');
    hintRow.className = 'quest-panel__hint';

    const hintLabel = document.createElement('span');
    hintLabel.className = 'quest-panel__hint-label';
    hintLabel.textContent = 'Tipp:';
    hintRow.appendChild(hintLabel);

    const hintCommands = document.createElement('span');
    hintCommands.className = 'quest-panel__hint-commands';
    hintCommands.textContent = commandsText;
    hintRow.appendChild(hintCommands);

    const toggle = document.createElement('button');
    toggle.className = 'quest-panel__hint-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    // V1: fixed ID. Assumes a single QuestPanel instance in the DOM
    // (true today — app.js creates exactly one). If a future round
    // introduces a second panel (e.g. a preview in the sidebar), this
    // ID — and the `detail.id` below — must become instance-specific
    // (`quest-panel-hint-detail-${questId}` or an instance counter).
    // The asymmetry is intentional for V1 readability: a fixed
    // constant is easier to grep, and the alternative (generating a
    // per-instance ID) would need a class-level counter just to
    // support a scenario that does not exist. See review NICE 1 to
    // spec016b.
    toggle.setAttribute('aria-controls', 'quest-panel-hint-detail');

    const arrow = document.createElement('span');
    arrow.className = 'quest-panel__hint-arrow';
    arrow.textContent = '»';
    toggle.appendChild(arrow);
    hintRow.appendChild(toggle);

    panel.appendChild(hintRow);

    const detail = document.createElement('div');
    detail.className = 'quest-panel__hint-detail';
    detail.id = 'quest-panel-hint-detail';
    detail.hidden = true;
    detail.textContent = active.hint;
    panel.appendChild(detail);

    this._container.appendChild(panel);

    // spec016b §2.3: click toggles the detail block and rotates the
    // arrow. No listener cleanup needed — refresh() rebuilds the DOM
    // entirely, so the listener dies with `toggle`.
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        detail.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      } else {
        detail.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
      }
    });
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