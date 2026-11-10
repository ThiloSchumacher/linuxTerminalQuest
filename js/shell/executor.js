import { parse } from './parser.js';
import { mapFsError } from './commands/_helpers.js';

/**
 * Synchronous shell executor.
 *
 * V1 handles pipelines (`cmd1 | cmd2 | cmd3`) with per-command
 * redirects (`<`, `>`, `>>`). Commands receive a plain `stdin` string
 * (or `null`) and return `{ stdout, stderr, exitCode }` — the executor
 * is the only place that reads/writes files and threads stdout into
 * the next command's stdin.
 *
 * ## Services (spec009a §5.2)
 *
 * `execute(input, services = {})` forwards `services` unchanged to
 * every command. `services` is a plain object; `TerminalUI` passes
 * `{ terminal, lineEditor }`. Tests may pass `{}` (commands that
 * require a service must check and return a user-facing error). The
 * executor itself does not touch `services`.
 *
 * ## V1 redirect limitations (spec007b §5, unchanged by spec007c/009a)
 *
 * - At most ONE input redirect (`<`) and ONE output redirect
 *   (`>`/`>>`) per command. Multiple → exit 2.
 * - `>` writes the command's stdout to the target AFTER the command
 *   runs; it does NOT truncate the file before the command starts. If
 *   the command fails (exit != 0) the file is left untouched.
 * - Redirect targets are only resolved if the command exists —
 *   `nope > /tmp/x` exits 127 with NO file created.
 * - `2>` (stderr redirect) and `&>` (both streams) are not supported.
 *
 * ## V1 pipeline limitations (spec007c §2.5)
 *
 * - No `pipefail`: only the LAST command's exit code is the pipeline's
 *   exit code.
 * - All commands run, even if an intermediate command fails; only a
 *   redirect error or a malformed command result aborts the pipeline.
 * - `cd` in the middle of a pipeline mutates `env.PWD`.
 * - No parallelism: stdout is fully buffered.
 * - stderr is aggregated in command-execution order.
 * - `2>&1` not supported.
 *
 * ## Command-result contract (spec007c §2.5, supersedes spec002b §3)
 *
 * Commands MUST return `{ stdout: string, stderr: string, exitCode:
 * number }`. A malformed result is a PROGRAMMER error; `_runPipeline`
 * catches it (or any exception from `command.run`) and converts into
 * `bash: <name>: internal error\n` with exit 1. The message leaks no
 * details (no `err.message`, no stack trace, no internal paths): (1)
 * security — no internal structures in user-facing stderr; (2)
 * consistency with the XSS-safe UI contract from spec005c §9; (3)
 * debugging remains possible via DevTools breakpoints. The `throw`
 * paths in `execute()` are only non-EPARSE errors from `parse()` and
 * bugs in `_runPipeline()` itself.
 *
 * @module shell/executor
 */
export class Executor {
  /**
   * @param {object} opts
   * @param {import('../vfs/filesystem.js').VFS} opts.vfs
   * @param {import('./env.js').Env} opts.env
   * @param {Map<string, import('./commands/index.js').CommandObject>} opts.registry
   */
  constructor({ vfs, env, registry }) {
    this.vfs = vfs;
    this.env = env;
    this.registry = registry;
  }

  /**
   * Execute a single line of shell input.
   *
   * Order (spec007c §2.1):
   *  1. Parse → AST; `EPARSE` → error return (no `?` update).
   *  2. No pipelines → empty result (no `?` update).
   *  3. `_runPipeline(pipeline, services)` computes the pipeline
   *     result.
   *  4. `env.set('?', String(result.exitCode))`.
   *  5. Return the pipeline result.
   *
   * ## `?` invariant (spec007c)
   *
   * `env.get('?')` is set from the FINAL exit code of the line, once,
   * in step 4. Only empty input and `EPARSE` leave `?` UNCHANGED
   * (they return before step 3).
   *
   * @param {string} input
   * @param {import('./commands/index.js').CommandServices} [services={}]
   * @returns {import('./commands/index.js').CommandResult}
   * @throws {Error} Only for programmer errors (never for user input):
   *   (a) a non-EPARSE error from `parse()` (propagated unchanged, NOT
   *       reinterpreted as a syntax error), (b) an internal bug in
   *       `_runPipeline()`.
   */
  execute(input, services = {}) {
    // 1. Parse
    let ast;
    try {
      ast = parse(input);
    } catch (err) {
      if (err && err.code === 'EPARSE') {
        return {
          stdout: '',
          stderr: 'bash: syntax error: ' + err.message + '\n',
          exitCode: 2,
        };
      }
      throw err;
    }

    // 2. Empty input — `?` unchanged.
    if (ast.pipelines.length === 0) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    const pipeline = ast.pipelines[0];

    // 3. Run the pipeline (with services; forwards to every command).
    const result = this._runPipeline(pipeline, services);

    // 4. Update `?` from the pipeline's final exit code.
    this.env.set('?', String(result.exitCode));

    return result;
  }

  /**
   * Run a pipeline (`cmd1 | cmd2 | …`). Returns the pipeline result.
   *
   * `services` is forwarded unchanged to every command's `run()` call.
   * See `execute()`'s JSDoc for the per-command evaluation order and
   * the V1 limitations.
   *
   * @private
   * @param {{commands: Array<{argv: string[], redirects: Array<{op: string, fd: number, target: string}>}>}} pipeline
   * @param {import('./commands/index.js').CommandServices} services
   * @returns {import('./commands/index.js').CommandResult}
   */
  _runPipeline(pipeline, services) {
    const commands = pipeline.commands;
    /** @type {string[]} */
    const stderrParts = [];
    /** @type {string|null} */
    let stdinValue = null;
    /** @type {{stdout: string, stderr: string, exitCode: number}|null} */
    let lastResult = null;

    for (let i = 0; i < commands.length; i++) {
      const cmdNode = commands[i];
      const isLast = i === commands.length - 1;

      // 3a. Redirect counts
      const inputRedirects = cmdNode.redirects.filter((r) => r.op === '<');
      const outputRedirects = cmdNode.redirects.filter(
        (r) => r.op === '>' || r.op === '>>',
      );
      if (inputRedirects.length > 1) {
        return {
          stdout: '',
          stderr: 'bash: multiple input redirects not supported\n',
          exitCode: 2,
        };
      }
      if (outputRedirects.length > 1) {
        return {
          stdout: '',
          stderr: 'bash: multiple output redirects not supported\n',
          exitCode: 2,
        };
      }
      const inputRedirect = inputRedirects[0] || null;
      const outputRedirect = outputRedirects[0] || null;

      // 3b. Resolve `<` — overrides previous stage's stdout.
      if (inputRedirect) {
        try {
          stdinValue = this.vfs.readFile(
            inputRedirect.target,
            this.env.get('PWD'),
          );
        } catch (err) {
          return {
            stdout: '',
            stderr: `bash: ${inputRedirect.target}: ${mapFsError(err)}\n`,
            exitCode: 1,
          };
        }
      }

      // 3c. Command lookup — unknown command is NOT a pipeline abort.
      const name = cmdNode.argv[0];
      const command = this.registry.get(name);
      if (!command) {
        stderrParts.push(`bash: ${name}: command not found\n`);
        stdinValue = '';
        lastResult = { stdout: '', stderr: '', exitCode: 127 };
        continue;
      }

      // 3d. Run the command (with services).
      let result;
      try {
        result = command.run({
          argv: cmdNode.argv.slice(1),
          name,
          env: this.env,
          vfs: this.vfs,
          stdin: stdinValue,
          services,
        });
        if (
          !result ||
          typeof result.stdout !== 'string' ||
          typeof result.stderr !== 'string' ||
          typeof result.exitCode !== 'number'
        ) {
          throw new Error('command returned incomplete result');
        }
      } catch (err) {
        return {
          stdout: '',
          stderr: `bash: ${name}: internal error\n`,
          exitCode: 1,
        };
      }

      stderrParts.push(result.stderr);

      // 3e. `>`/`>>` — write to file, blank stdout.
      if (outputRedirect) {
        try {
          const pwd = this.env.get('PWD');
          const exists = this.vfs.exists(outputRedirect.target, pwd);
          if (outputRedirect.op === '>') {
            if (exists) {
              this.vfs.writeFile(outputRedirect.target, pwd, result.stdout);
            } else {
              this.vfs.createFile(outputRedirect.target, pwd, result.stdout);
            }
          } else {
            if (exists) {
              const prev = this.vfs.readFile(outputRedirect.target, pwd);
              this.vfs.writeFile(
                outputRedirect.target,
                pwd,
                prev + result.stdout,
              );
            } else {
              this.vfs.createFile(outputRedirect.target, pwd, result.stdout);
            }
          }
          result.stdout = '';
        } catch (err) {
          return {
            stdout: '',
            stderr: `bash: ${outputRedirect.target}: ${mapFsError(err)}\n`,
            exitCode: 1,
          };
        }
      }

      // 3f. Feed the next stage or capture the final result
      if (isLast) {
        lastResult = result;
      } else {
        stdinValue = result.stdout;
      }
    }

    return {
      stdout: lastResult ? lastResult.stdout : '',
      stderr: stderrParts.join(''),
      exitCode: lastResult ? lastResult.exitCode : 0,
    };
  }
}