import { Env } from '../shell/env.js';
import { serializeVFS, deserializeVFS } from '../vfs/serialize.js';

/**
 * Persistence helpers — save/restore the app state to/from storage.
 *
 * Persisted: `env`, `history`, `quests.solved`, `vfs`.
 * Derived on load (NOT persisted): XP, badges (from `quests.solved`).
 *
 * All helpers are synchronous. They never throw — Storage's silent
 * failure model propagates: a broken localStorage just means a fresh
 * boot every time.
 *
 * @module storage/persistence
 */

/**
 * Serialize the current app state into storage.
 *
 * `questEngine` and `vfs` are both OPTIONAL, but for DIFFERENT reasons:
 *
 *   - `questEngine` guard is a STATE guard: during the asynchronous
 *     quest-load window, `app.js` passes `null` because the engine has
 *     not been created yet. Skipping the `quests.solved` write in that
 *     window prevents overwriting existing stored solutions with an
 *     empty list — that is a correctness requirement, not just
 *     test-convenience.
 *
 *   - `vfs` guard is a PARAMETER guard: `app.js` always passes a VFS
 *     (created or restored before `Executor` construction), so in
 *     production this branch always fires. The guard exists so the
 *     helper is usable from narrower tests and from a future caller
 *     that legitimately has no VFS yet (e.g. a CLI-only boot). If you
 *     remove this guard, keep the `questEngine` guard — they look
 *     symmetric but serve different purposes.
 *
 * When `vfs` is present, the tree is serialized via `serializeVFS`
 * and stored under the `vfs` key. The VFS serialization drops `size` —
 * it is recomputed on load.
 *
 * @param {import('./storage.js').Storage} storage
 * @param {object} state
 * @param {Env} state.env
 * @param {import('../terminal/line-editor.js').LineEditor} state.lineEditor
 * @param {import('../quests/quest-engine.js').QuestEngine|null} [state.questEngine]
 * @param {import('../vfs/filesystem.js').VFS|null} [state.vfs]
 * @returns {void}
 */
export function saveAppState(storage, { env, lineEditor, questEngine, vfs }) {
  storage.save('env', env.toObject());
  storage.save('history', lineEditor.getHistory());
  if (questEngine) {
    storage.save('quests.solved', questEngine.getSolvedIds());
  }
  // Parameter guard — see the JSDoc above. Not the same purpose as the
  // questEngine state guard; do not collapse the two guards into one
  // "combined state" check without re-verifying the pre-quests window.
  if (vfs) {
    storage.save('vfs', serializeVFS(vfs));
  }
}

/**
 * Restore Env. If nothing is stored, returns a fresh Env over
 * `defaultEnv`. Otherwise the stored object is merged ON TOP of
 * `defaultEnv` (stored values override defaults; missing keys fall
 * back to the default). Non-object stored values (string, array, null)
 * are treated as "nothing stored" — defensive against corruption.
 *
 * @param {import('./storage.js').Storage} storage
 * @param {Record<string, string>} defaultEnv
 * @returns {Env}
 */
export function restoreEnv(storage, defaultEnv) {
  const saved = storage.load('env', null);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    return new Env(defaultEnv);
  }
  return new Env({ ...defaultEnv, ...saved });
}

/**
 * Restore history entries into `lineEditor`. Non-array stored values
 * are ignored entirely. Non-string entries inside the array are
 * skipped individually.
 *
 * @param {import('./storage.js').Storage} storage
 * @param {import('../terminal/line-editor.js').LineEditor} lineEditor
 * @returns {void}
 */
export function restoreHistory(storage, lineEditor) {
  const saved = storage.load('history', null);
  if (!Array.isArray(saved)) return;
  for (const line of saved) {
    if (typeof line === 'string') {
      lineEditor.pushHistory(line);
    }
  }
}

/**
 * Restore solved quest IDs.
 *
 * Unknown IDs (not present in the current quest catalogue) are dropped
 * silently. Valid IDs are marked solved in the stored order.
 * Idempotent, because QuestEngine.solveQuest is idempotent.
 *
 * @param {import('./storage.js').Storage} storage
 * @param {import('../quests/quest-engine.js').QuestEngine} questEngine
 * @returns {void}
 */
export function restoreQuests(storage, questEngine) {
  const saved = storage.load('quests.solved', null);
  if (!Array.isArray(saved)) return;
  const knownIds = new Set(questEngine.getAllQuests().map((q) => q.id));
  for (const id of saved) {
    if (typeof id === 'string' && knownIds.has(id)) {
      questEngine.solveQuest(id);
    }
  }
}

/**
 * Restore a VFS from storage, or fall back to `fallbackFactory()`.
 *
 * Silent on ALL errors — including `deserializeVFS`'s EINVAL (schema
 * mismatch, corrupt JSON, incompatible version, validation failure on
 * any node). No console.error, no user-facing message: the user simply
 * gets a fresh filesystem from `fallbackFactory()`. A migration UI for
 * schema-mismatch recovery would require its own spec (a future one,
 * not yet planned); until then, silent fallback is the V1 contract.
 *
 * ## Known V1 limitation — dangling PWD
 *
 * If the user deleted the directory that `PWD` (in Env) pointed to
 * before saving, the restored Env will have a PWD that no longer exists
 * in the restored VFS. This is NOT corrected here — a dangling PWD just
 * causes `pwd`/`ls` to fail (via the normal VFS error path) until the
 * user `cd`s somewhere valid. Out of scope for V1; a "reset PWD if
 * missing" fix could live in `restoreEnv` in a later spec, but only
 * once a user-visible recovery flow exists.
 *
 * @param {import('./storage.js').Storage} storage
 * @param {() => import('../vfs/filesystem.js').VFS} fallbackFactory
 * @returns {import('../vfs/filesystem.js').VFS}
 */
export function restoreVFS(storage, fallbackFactory) {
  const saved = storage.load('vfs', null);
  if (!saved) return fallbackFactory();
  try {
    return deserializeVFS(saved);
  } catch {
    return fallbackFactory();
  }
}

/**
 * Compute the XP total from currently-solved quests.
 *
 * Sums `quest.xp` over every solved quest that still exists in the
 * current catalogue. Unknown solved IDs contribute 0.
 *
 * @param {import('../quests/quest-engine.js').QuestEngine} questEngine
 * @returns {number}
 */
export function deriveXp(questEngine) {
  let total = 0;
  for (const id of questEngine.getSolvedIds()) {
    const quest = questEngine.getQuestById(id);
    if (quest) total += quest.xp;
  }
  return total;
}

/**
 * Derive badge unlocks from currently-solved quests. Silent — return
 * value of `check()` is ignored (no toasts on restore).
 *
 * @param {import('../gamification/badges.js').BadgeTracker} badgeTracker
 * @param {import('../quests/quest-engine.js').QuestEngine} questEngine
 * @returns {void}
 */
export function deriveBadges(badgeTracker, questEngine) {
  const state = {
    solvedQuests: questEngine
      .getSolvedIds()
      .map((id) => questEngine.getQuestById(id))
      .filter((q) => q),
    allQuests: questEngine.getAllQuests(),
  };
  badgeTracker.check(state);
}