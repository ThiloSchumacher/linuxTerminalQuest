/**
 * `help` — show command documentation.
 *
 * ## Signature
 *
 *     help [COMMAND]
 *
 * - `help` (no argument): alphabetical overview of every registered
 *   command, one line per entry formatted as
 *   `'  ' + name.padEnd(14) + ' ' + description`, preceded by a
 *   header (`Verfügbare Befehle:` + blank line) and followed by a
 *   footer (`Für Details: help <befehl>` + blank line). Exit 0.
 *
 * - `help COMMAND`: for a registered command, prints
 *   `<name>: <description>`, a blank line, then
 *   `Verwendung: <usage>`. Exit 0.
 *
 * - `help NOPE`: `help: NOPE: command not found` on stderr, exit 1.
 *
 * ## Flags
 *
 * V1 has no flags. `help -a`, `help --all` and `help --help` are all
 * parsed as the command name (`-a` / `--all` / `--help`) and yield
 * `command not found` (spec011b §3.3).
 *
 * **`--help` is NOT a universal alias for `help` in V1** — it is
 * treated as the command name `--help` and reports `command not
 * found`. The overview is produced by bare `help` (no args), not by
 * `help --help`. This is the most common convention that V1 breaks,
 * so it is called out explicitly: a user coming from a normal CLI
 * would expect `--help` to work.
 *
 * ## Missing fields
 *
 * Commands are guaranteed to have both `usage` and `description` by
 * `createCommandRegistry()`'s `assertHasMetadata` check, so the
 * fallbacks below are defensive only:
 *
 *  - missing `description` (in `help COMMAND`): the first block
 *    becomes `Keine Beschreibung verfügbar.\n` (no `<name>:`
 *    prefix — full replacement, spec011b §3.2 literal reading).
 *  - missing `usage` (in `help COMMAND`): the usage line becomes
 *    `Verwendung: (nicht verfügbar)\n`.
 *  - missing `description` (in the overview): each affected entry's
 *    description becomes `Keine Beschreibung verfügbar.` — the row
 *    keeps its `name.padEnd(14)` layout so the column stays aligned.
 *
 * ## Services
 *
 * Requires `services.registry` (the `Map` from
 * `createCommandRegistry()`). Without it: `help: registry not
 * available`, exit 1 — same defensive pattern as `which`.
 *
 * @module shell/commands/help
 */

/**
 * @type {import('./index.js').CommandObject}
 */
export const help = {
  name: 'help',
  usage: 'help [COMMAND]',
  description: 'Zeigt Hilfe zu Befehlen an.',
  /**
   * @param {import('./index.js').CommandContext} ctx
   * @returns {import('./index.js').CommandResult}
   */
  run({ argv, name, env, vfs, services }) {
    if (!services || !services.registry) {
      return {
        stdout: '',
        stderr: `${name}: registry not available\n`,
        exitCode: 1,
      };
    }

    // `help COMMAND` — first arg only; extra args ignored (V1).
    // No flag stripping: `-a` is treated as a literal name and
    // reported as `command not found` (spec011b §3.3).
    if (argv.length > 0) {
      const target = argv[0];
      const cmdObj = services.registry.get(target);
      if (!cmdObj) {
        return {
          stdout: '',
          stderr: `${name}: ${target}: command not found\n`,
          exitCode: 1,
        };
      }

      const hasDescription =
        typeof cmdObj.description === 'string' && cmdObj.description.length > 0;
      const hasUsage =
        typeof cmdObj.usage === 'string' && cmdObj.usage.length > 0;

      let stdout = '';
      stdout += hasDescription
        ? `${cmdObj.name}: ${cmdObj.description}\n`
        : 'Keine Beschreibung verfügbar.\n';
      stdout += '\n';
      stdout += `Verwendung: ${hasUsage ? cmdObj.usage : '(nicht verfügbar)'}\n`;
      return { stdout, stderr: '', exitCode: 0 };
    }

    // `help` (no args) — alphabetical overview.
    const commands = Array.from(services.registry.values()).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    let stdout = 'Verfügbare Befehle:\n\n';
    for (const cmdObj of commands) {
      const desc =
        typeof cmdObj.description === 'string' && cmdObj.description.length > 0
          ? cmdObj.description
          : 'Keine Beschreibung verfügbar.';
      stdout += `  ${cmdObj.name.padEnd(14)} ${desc}\n`;
    }
    stdout += '\nFür Details: help <befehl>\n';
    return { stdout, stderr: '', exitCode: 0 };
  },
};