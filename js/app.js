import { createInitialFS } from './vfs/initial-fs.js';
import { Env } from './shell/env.js';
import { Executor } from './shell/executor.js';
import { createCommandRegistry } from './shell/commands/index.js';
import { LineEditor } from './terminal/line-editor.js';
import { TerminalUI } from './terminal/terminal.js';
import { loadQuests } from './quests/loader.js';
import { QuestEngine } from './quests/quest-engine.js';
import { QuestValidator } from './quests/validator.js';
import { QuestPanel } from './ui/quest-panel.js';
import { XP } from './gamification/xp.js';
import { BadgeTracker } from './gamification/badges.js';
import { Notifications } from './ui/notifications.js';
import { Sidebar } from './ui/sidebar.js';
import { Storage } from './storage/storage.js';
import {
  saveAppState,
  restoreEnv,
  restoreHistory,
  restoreQuests,
  restoreVFS,
  deriveXp,
  deriveBadges,
} from './storage/persistence.js';

/**
 * Default environment for a freshly booted shell session.
 * Values are strings per POSIX convention; `?` is initialized to '0'.
 */
const DEFAULT_ENV = {
  PWD: '/home/user',
  OLDPWD: '/home/user',
  HOME: '/home/user',
  USER: 'user',
  SHELL: '/bin/bash',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  '?': '0',
};

/**
 * Build the shell prompt string, including ANSI SGR colour codes.
 *
 * @param {import('./shell/env.js').Env} env
 * @returns {string}
 */
function buildPrompt(env) {
  const user = env.get('USER') || 'user';
  const pwd = env.get('PWD') || '/';
  const shown =
    pwd === '/home/user'
      ? '~'
      : pwd.startsWith('/home/user/')
        ? '~' + pwd.slice('/home/user'.length)
        : pwd;
  return (
    `\x1b[32m${user}\x1b[0m@\x1b[32mbashquest\x1b[0m:` +
    `\x1b[34m${shown}\x1b[0m$ `
  );
}

/**
 * Boot sequence — synchronous for the terminal, asynchronous for the
 * quests (and the gamification stack that depends on them).
 *
 * ## Persistence (spec006a + spec006b)
 *
 * Persisted:
 *   - `env`            via `restoreEnv` / `saveAppState`
 *   - `history`        via `restoreHistory` / `saveAppState`
 *   - `quests.solved`  via `restoreQuests` / `saveAppState`
 *   - `vfs`            via `restoreVFS` / `saveAppState`
 *
 * Derived on load (NOT persisted):
 *   - XP    via `deriveXp(questEngine)`
 *   - Badges via `deriveBadges(badgeTracker, questEngine)`
 *
 * ## Ordering constraints
 *
 *   - `restoreEnv` MUST run before `Executor` is created. The executor
 *     holds a REFERENCE to `env` and writes `?` into it on every
 *     command; two divergent env instances would desync.
 *   - `restoreVFS` MUST run BEFORE `Executor` is created (the executor
 *     closes over the vfs too) and AFTER `restoreEnv`. Env-first is
 *     spec006b §5's order: a fresh VFS (from fallback) still has
 *     `/home/user`, and a restored VFS matches the restored PWD
 *     because both share a save timestamp.
 *   - `restoreQuests` MUST run before `xpTracker` / `badgeTracker`
 *     creation, so the derived totals see the full solved state.
 *   - The initial save runs INSIDE the `.then` block, AFTER
 *     `restoreQuests` and `restoreVFS`, so a fresh boot never
 *     overwrites previously-saved data with an empty engine.
 *
 * ## Services wiring (spec009a §5.2 + spec009b §7)
 *
 * TerminalUI owns its `services` object (constructor default:
 * `{ terminal: this, lineEditor }`). `app.js` calls
 * `terminal.setServices({ terminal, lineEditor, registry })` after
 * `terminal.mount()` — the registry only exists at that point, and the
 * setter avoids a Henne-Ei problem in the constructor. Commands that
 * need `services.registry` (`which`) then find it.
 *
 * ## Contract summary
 *
 * - `boot()` is intentionally synchronous. Do not make it async.
 * - Exactly two `console.error` calls, both on the boot path.
 * - `terminal.mount()` is called WITHOUT a try/catch; `resolveXtermGlobals`
 *   errors propagate as uncaught throws.
 * - The `onCommand` save runs on EVERY submitted command, whether or
 *   not quests have loaded and whether or not a solve happened.
 *
 * ## Testing gaps (manually verified, automated tests deferred)
 *
 * - "Testing gap: EQUEST_PANEL_MISSING"
 * - "Testing gap: XP attribution"
 *
 * ## Errors
 *
 * Exactly two `console.error` calls are permitted in this file:
 *   (1) missing `#terminal-container` (spec003c §1),
 *   (2) any quest-bootstrap failure (spec005b §5). Failure class is
 *       chosen by `err.code === 'EQUEST_PANEL_MISSING'`.
 *
 * ## Warnings
 *
 * **Do NOT make `boot()` async.** The synchronous-`boot` guarantee is
 * load-bearing: `terminal.mount()` must throw as a true uncaught error,
 * not as an unhandled promise rejection.
 *
 * @returns {void}
 */
function boot() {
  const container = document.getElementById('terminal-container');
  if (!container) {
    console.error('BashQuest: Terminal container not found', {
      selector: '#terminal-container',
      hint: 'index.html must contain <section id="terminal-container"></section>',
    });
    return;
  }

  // Persistence — restore Env, then VFS, both BEFORE the Executor is
  // created. Order per spec006b §5: Env first, then VFS.
  const storage = new Storage();
  const env = restoreEnv(storage, DEFAULT_ENV);
  const vfs = restoreVFS(storage, createInitialFS);

  const registry = createCommandRegistry();
  const executor = new Executor({ vfs, env, registry });
  const lineEditor = new LineEditor({ historyLimit: 100 });
  restoreHistory(storage, lineEditor);

  /** @type {QuestEngine|null} */
  let questEngine = null;
  /** @type {QuestValidator|null} */
  let validator = null;
  /** @type {QuestPanel|null} */
  let panel = null;
  /** @type {XP|null} */
  let xpTracker = null;
  /** @type {BadgeTracker|null} */
  let badgeTracker = null;
  /** @type {Notifications|null} */
  let notifications = null;
  /** @type {Sidebar|null} */
  let sidebar = null;

  const terminal = new TerminalUI({
    container,
    executor,
    env,
    lineEditor,
    prompt: () => buildPrompt(env),
    onCommand: (input, result) => {
      // Save ALWAYS — env/history/vfs mutate on every command (cd,
      // input history, mkdir/touch/rm/etc.), and this save must run
      // even before `loadQuests` resolves. `saveAppState` skips the
      // `quests.solved` write when `questEngine` is null, so nothing
      // is lost — the pre-quests window only skips quest-progress
      // persistence, which cannot have changed yet.
      if (validator) {
        const beforeQuest = questEngine.getActiveQuest();
        const r = validator.check(input, result);
        if (r.solved) {
          xpTracker.add(beforeQuest.xp);
          notifications.show(`+${beforeQuest.xp} XP`, { type: 'success' });

          const state = {
            solvedQuests: questEngine
              .getSolvedIds()
              .map((id) => questEngine.getQuestById(id))
              .filter((q) => q),
            allQuests: questEngine.getAllQuests(),
          };
          const newBadges = badgeTracker.check(state);
          for (const badge of newBadges) {
            notifications.show(`Badge: ${badge.title}`, {
              type: 'badge',
              duration: 5000,
            });
          }

          panel.refresh();
          sidebar.refresh();
        }
      }

      saveAppState(storage, { env, lineEditor, questEngine, vfs });
    },
  });

  // Patch 1: NO try/catch around mount(). resolveXtermGlobals() errors
  // propagate as uncaught synchronous throws.
  terminal.mount();

  // spec009b §7: expose `registry` to commands via services, so that
  // `which` can report command paths. The constructor default only has
  // `{ terminal, lineEditor }`; the registry is created above but
  // hasn't been wired into `services` yet. Setting it here (after
  // mount) is the `setServices`-pattern preferred by the spec — no
  // Henne-Ei problem at construction time.
  terminal.setServices({ terminal, lineEditor, registry });

  /** @type {any} */ (window).__terminal = terminal;
  /** @type {any} */ (window).__env = env;
  /** @type {any} */ (window).__quests = null;

  // Load quests asynchronously via promise chaining (not `await`) so
  // `boot()` stays synchronous — see the "Warnings" section.
  loadQuests('./data/quests.json')
    .then((quests) => {
      const panelEl = document.getElementById('quest-panel');
      if (!panelEl) {
        const err = new Error(
          'Quest-panel container not found ' +
          '(#quest-panel missing in DOM — index.html must contain ' +
          '<section id="quest-panel"></section>)',
        );
        /** @type {any} */ (err).code = 'EQUEST_PANEL_MISSING';
        throw err;
      }

      questEngine = new QuestEngine(quests);
      validator = new QuestValidator({ vfs, env, questEngine });
      panel = new QuestPanel({
        container: panelEl,
        questEngine,
      });
      panel.mount();

      // Persistence ordering (spec006a §4):
      // 1. Restore solved quests BEFORE deriving XP/badges.
      restoreQuests(storage, questEngine);

      // 2. Derive XP (NOT persisted, computed from solved quests).
      xpTracker = new XP(deriveXp(questEngine));

      // 3. Derive badges (silent — no toasts on restore).
      badgeTracker = new BadgeTracker();
      deriveBadges(badgeTracker, questEngine);

      notifications = new Notifications({
        container: document.getElementById('toast-container'),
      });

      // Sidebar with reset handler. The handler is only wired in
      // app.js — Sidebar itself just renders the button and forwards
      // clicks.
      sidebar = new Sidebar({
        container: document.getElementById('sidebar'),
        questEngine,
        xpTracker,
        badgeTracker,
        resetHandler: () => {
          if (!confirm('Allen Fortschritt zurücksetzen?')) return;
          storage.clear();
          location.reload();
        },
      });
      sidebar.mount();

      // Initial save — AFTER restoreQuests and AFTER restoreVFS, so we
      // never overwrite previously-stored data with an empty state.
      // Writes the full state (VFS included); a future spec can add a
      // dirty-flag optimisation if the VFS grows beyond V1 scale.
      saveAppState(storage, { env, lineEditor, questEngine, vfs });

      /** @type {any} */ (window).__quests = questEngine;
    })
    .catch((err) => {
      const isPanelMissing = !!(err && err.code === 'EQUEST_PANEL_MISSING');
      const prefix = isPanelMissing
        ? 'BashQuest: Quest-Panel konnte nicht gemountet werden:'
        : 'BashQuest: Quests konnten nicht geladen werden:';
      console.error(prefix, err);
    });
}

// Module scripts at the end of <body> normally run after DOMContentLoaded,
// but HMR, deferred navigation and some bundler-less setups can execute
// them earlier. Guard both branches so mount happens exactly once.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// --- Service Worker ---
// Aktiviert in spec013a. Fehler werden still geschluckt — die App
// funktioniert auch ohne SW (dann ohne Offline-Cache).
//
// Der Pfad './sw.js' ist RELATIV (nicht '/sw.js'): er bindet den
// SW-Scope an die URL von index.html. Auf einer GitHub-Pages-
// Projekt-Seite (user.github.io/repo/) ergibt das einen Scope von
// /repo/ — absolut '/sw.js' würde dort mit SecurityError
// ("scope not allowed") scheitern. Bitte nicht auf einen absoluten
// Pfad ändern.
if ('serviceWorker' in navigator) {
  // Reload at most ONCE per SW takeover. Two guards combine:
  //
  //  1. `hadController` (captured once, at module load): if the page
  //     had NO controller before, this is the first-ever install.
  //     The page was already served fresh from the network, so a
  //     reload would just flash the UI without benefit.
  //
  //  2. `sessionStorage` flag: survives reloads. If we've already
  //     reloaded for the current takeover, don't reload again. This
  //     breaks out of any potential loop, even if the browser
  //     somehow fires controllerchange more often than expected.
  const hadController = !!navigator.serviceWorker.controller;
  const RELOAD_FLAG = 'bashquest-sw-reloaded';

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Guard 1: first-ever control — nothing to reload for.
    if (!hadController) return;
    // Guard 2: already reloaded this session — break any loop.
    if (sessionStorage.getItem(RELOAD_FLAG) === '1') return;

    sessionStorage.setItem(RELOAD_FLAG, '1');
    window.location.reload();
  });

  navigator.serviceWorker.register('./sw.js', {
    updateViaCache: 'none',
  }).then(() => {
    // Allow a future takeover (weeks later, after another deploy) to
    // trigger a fresh reload. 5 s is plenty: an update either fires
    // controllerchange within the current tick or not at all.
    setTimeout(() => sessionStorage.removeItem(RELOAD_FLAG), 5000);
  }).catch(() => {
    // silent
  });
}