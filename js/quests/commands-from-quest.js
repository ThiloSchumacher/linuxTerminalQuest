import { isProvided } from './loader.js';

/**
 * Extract the list of shell commands a user should try for a quest.
 *
 * This is the helper the quest panel (spec016b) uses to show a
 * short "Tipp: <cmd1> [<cmd2> …]" line next to the full hint text.
 *
 * ## Source priority
 *
 * 1. If the quest has a **non-empty** `commands` array, that is
 *    returned (as a fresh copy — caller mutation does not leak back
 *    into the quest object).
 * 2. Otherwise, the commands are **derived** from the goal:
 *    - `command-executed` with `command`     → `[command]`
 *    - `command-executed` with `pipeline`    → stages' command names
 *    - `output-contains` with `command`      → `[command]`
 *    - everything else (file-exists, file-mode, file-owner,
 *      file-not-exists, output-contains without command) → `[]`
 *
 * The `commands` field **wins over derivation** even when the goal
 * would produce a non-empty list. This lets a quest author override
 * an automated-looking list with a curated one (e.g. show "chmod"
 * and "stat" together for a two-step permission task whose goal is
 * a `file-mode` check).
 *
 * ## `commands: []` behaves like "not set"
 *
 * The spec's test list (§4.1) says `commands: []` is legal but has
 * "no effect": the helper falls through to goal derivation. This
 * mirrors the null-vs-empty reasoning used across the schema:
 * authors who explicitly want to show *no* commands should omit
 * the field and write a path-only goal without a `command` field.
 *
 * ## Purity
 *
 * No VFS, no DOM, no imports beyond `isProvided`. The helper does
 * not mutate the quest object; the returned array is always a fresh
 * allocation (either a slice of `quest.commands` or a newly built
 * array). Caller mutation of the return value cannot corrupt the
 * engine's view of the quest.
 *
 * @param {object} quest Already-validated quest (see loader.js).
 * @returns {string[]} Non-empty list of command names, or `[]`.
 */
export function getQuestCommands(quest) {
  if (
    quest &&
    Array.isArray(quest.commands) &&
    quest.commands.length > 0
  ) {
    return quest.commands.slice();
  }

  const goal = quest && quest.goal;
  if (!goal) return [];

  if (goal.type === 'command-executed') {
    if (isProvided(goal.command)) {
      return [goal.command];
    }
    if (isProvided(goal.pipeline) && Array.isArray(goal.pipeline)) {
      // Defensive guard: validateQuest guarantees each stage has a
      // non-empty `command`, but a hand-constructed quest in a test
      // might not. Filter silently rather than putting `undefined`
      // into the return array.
      const names = [];
      for (const stage of goal.pipeline) {
        if (
          stage &&
          typeof stage.command === 'string' &&
          stage.command.length > 0
        ) {
          names.push(stage.command);
        }
      }
      return names;
    }
    return [];
  }

  if (goal.type === 'output-contains' && isProvided(goal.command)) {
    return [goal.command];
  }

  return [];
}