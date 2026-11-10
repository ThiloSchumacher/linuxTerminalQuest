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
 *   - `restoreQuests` MUST ALSO run before `panel.mount()` — otherwise
 *     the panel renders the empty engine (quest-001 active) and never
 *     re-renders. The sidebar, mounted later, sees the correct
 *     post-restore state; that divergence is spec013c's bug ("panel
 *     shows Quest 1, sidebar shows Quest 1 as solved").
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
      // NOTE: panel.mount() is intentionally NOT called here. It must
      // run AFTER restoreQuests so that the panel's first render
      // reflects the restored state. See spec013c.

      // Persistence ordering (spec006a §4 + spec013c):
      // 1. Restore solved quests BEFORE mounting the panel and BEFORE
      //    deriving XP/badges. Otherwise the panel's first `refresh()`
      //    reads the empty engine (`quest-001` active) and never
      //    re-renders — while the sidebar, mounted later, sees the
      //    correct post-restore state. That divergence is exactly the
      //    "panel shows Quest 1, sidebar shows Quest 1 as solved" bug.
      restoreQuests(storage, questEngine);

      // Now mount the panel — `mount()` calls `refresh()`, which calls
      // `getActiveQuest()` fresh from the engine.
      panel.mount();

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

      // spec013c §Zusätzliche Absicherung: one final `panel.refresh()`
      // after the boot sequence completes. `panel.mount()` above
      // already rendered against the restored engine, so this is
      // belt-and-braces — if a future refactor moves `panel.mount()`
      // back above `restoreQuests`, this call still forces a correct
      // re-render. No `sidebar.refresh()` here: `sidebar.mount()`
      // was called immediately above and nothing between then and
      // now mutates engine/XP/badge state, so the sidebar's render
      // is already current.
      panel.refresh();

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
//
// Registered in PRODUCTION only. In local development the SW causes
// endless cache-invalidation pain: every code change requires a
// manual `about:serviceworkers`-deregistration or a CACHE_VERSION
// bump, and Firefox's controllerchange race means the update often
// doesn't reach the page anyway. None of that matters for
// development; the SW's value is offline capability, which we test
// against GitHub Pages, not against Live Server on 127.0.0.1.
//
// The path `'./sw.js'` is RELATIVE (not `/sw.js`): it binds the SW
// scope to the URL of index.html. On a GitHub-Pages project page
// (`user.github.io/repo/`) that yields a scope of `/repo/` — an
// absolute `/sw.js` would fail there with a SecurityError ("scope
// not allowed"). Do not change to an absolute path.
//
// `updateViaCache: 'none'` forces the browser to bypass its HTTP
// cache when checking sw.js for updates. Without it, Firefox (and
// Safari, and some Chrome configurations) may serve the OLD sw.js
// from the HTTP cache during the update check — meaning a new
// CACHE_VERSION is never seen, and users stay on the old
// bashquest-vX cache indefinitely.
//
// No `controllerchange`-triggered reload is needed: the SW uses
// network-first for the app shell (spec013a review round), so an
// ordinary page reload after a deploy pulls the fresh app.js / CSS /
// quests.json from the server. The reload-loop that a
// controllerchange handler once caused is structurally avoided.
const isDev =
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  location.hostname === '';

if ('serviceWorker' in navigator && !isDev) {
  navigator.serviceWorker.register('./sw.js', {
    updateViaCache: 'none',
  }).catch(() => {
    // silent
  });
}