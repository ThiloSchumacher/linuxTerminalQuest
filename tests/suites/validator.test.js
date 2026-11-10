import { describe, it, expect } from '../runner.js';
import { createInitialFS } from '../../js/vfs/initial-fs.js';
import { Env } from '../../js/shell/env.js';
import { QuestEngine } from '../../js/quests/quest-engine.js';
import { QuestValidator } from '../../js/quests/validator.js';

/**
 * Build a valid quest fixture with optional overrides.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
function makeQuest(overrides = {}) {
  return {
    id: 'quest-001',
    module: 'basics',
    difficulty: 'easy',
    title: 'Test',
    description: 'Test desc',
    hint: 'Test hint',
    goal: { type: 'command-executed', command: 'pwd' },
    xp: 10,
    ...overrides,
  };
}

/**
 * Fresh vfs + env + engine + validator for one test.
 *
 * @param {object[]} [quests]
 * @returns {{
 *   vfs: import('../../js/vfs/filesystem.js').VFS,
 *   env: Env,
 *   engine: QuestEngine,
 *   validator: QuestValidator,
 * }}
 */
function setup(quests = [makeQuest()]) {
  const vfs = createInitialFS();
  const env = new Env({
    PWD: '/home/user',
    HOME: '/home/user',
    USER: 'user',
    '?': '0',
  });
  const engine = new QuestEngine(quests);
  const validator = new QuestValidator({ vfs, env, questEngine: engine });
  return { vfs, env, engine, validator };
}

/**
 * Convenience: a result object matching a "clean" command.
 *
 * @param {string} [stdout]
 * @returns {{stdout: string, stderr: string, exitCode: number}}
 */
function okResult(stdout = '') {
  return { stdout, stderr: '', exitCode: 0 };
}

// ---------------------------------------------------------------------------
// command-executed
// ---------------------------------------------------------------------------

describe('QuestValidator — command-executed', () => {
  it('solves when the command matches and exitCode is 0', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'command-executed', command: 'pwd' } }),
    ]);
    const r = validator.check('pwd', okResult('/home/user\n'));
    expect(r.solved).toBe(true);
    expect(r.questId).toBe('quest-001');
  });

  it('does not solve when the command differs', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'command-executed', command: 'pwd' } }),
    ]);
    const r = validator.check('ls', okResult());
    expect(r.solved).toBe(false);
    expect(r.questId).toBe(null);
  });

  it('does not solve when exitCode is non-zero', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'command-executed', command: 'pwd' } }),
    ]);
    const r = validator.check('pwd', { stdout: '', stderr: 'x', exitCode: 1 });
    expect(r.solved).toBe(false);
  });

  it('solves with an exact args match', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'command-executed', command: 'ls', args: ['/etc'] } }),
    ]);
    const r = validator.check('ls /etc', okResult());
    expect(r.solved).toBe(true);
  });

  it('does not solve with different args', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'command-executed', command: 'ls', args: ['/etc'] } }),
    ]);
    const r = validator.check('ls /var', okResult());
    expect(r.solved).toBe(false);
  });

  it('does not solve with missing args when args are specified', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'command-executed', command: 'ls', args: ['/etc'] } }),
    ]);
    const r = validator.check('ls', okResult());
    expect(r.solved).toBe(false);
  });

  it('does not solve on a parse error (unclosed quote)', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'command-executed', command: 'pwd' } }),
    ]);
    const r = validator.check("pwd 'x", okResult());
    expect(r.solved).toBe(false);
  });

  it('does not solve on empty input (_parseArgv null path)', () => {
    // _parseArgv returns null for empty/whitespace input because
    // parser.parse('') yields zero pipelines. Without a command to
    // match, the goal cannot be met.
    const { validator } = setup([
      makeQuest({ goal: { type: 'command-executed', command: 'pwd' } }),
    ]);
    const r = validator.check('', okResult());
    expect(r.solved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// file-exists
// ---------------------------------------------------------------------------

describe('QuestValidator — file-exists', () => {
  it('does not solve while the file is missing', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'file-exists', path: '/tmp/x' } }),
    ]);
    const r = validator.check('touch /tmp/x', okResult());
    expect(r.solved).toBe(false);
  });

  it('solves after the file is created', () => {
    const { vfs, validator } = setup([
      makeQuest({ goal: { type: 'file-exists', path: '/tmp/x' } }),
    ]);
    vfs.createFile('/tmp/x', '/');
    const r = validator.check('touch /tmp/x', okResult());
    expect(r.solved).toBe(true);
  });

  it('is independent of the command that produced the state', () => {
    const { vfs, validator } = setup([
      makeQuest({ goal: { type: 'file-exists', path: '/tmp/x' } }),
    ]);
    vfs.createFile('/tmp/x', '/');
    const r = validator.check('ls', okResult());
    expect(r.solved).toBe(true);
  });

  it('resolves a relative path against PWD', () => {
    const { vfs, env, validator } = setup([
      makeQuest({ goal: { type: 'file-exists', path: 'x' } }),
    ]);
    env.set('PWD', '/tmp');
    vfs.createFile('/tmp/x', '/');
    const r = validator.check('touch x', okResult());
    expect(r.solved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// output-contains
// ---------------------------------------------------------------------------

describe('QuestValidator — output-contains', () => {
  it('solves when the substring is present in stdout', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'output-contains', substring: 'passwd' } }),
    ]);
    const r = validator.check('ls /etc', okResult('hosts\nmotd\npasswd\n'));
    expect(r.solved).toBe(true);
  });

  it('does not solve when the substring is missing', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'output-contains', substring: 'passwd' } }),
    ]);
    const r = validator.check('ls /etc', okResult('hosts\n'));
    expect(r.solved).toBe(false);
  });

  it('does not solve when goal.command is set but the invoked command differs', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'output-contains', command: 'ls', substring: 'passwd' } }),
    ]);
    const r = validator.check('cat /etc/hosts', okResult('passwd'));
    expect(r.solved).toBe(false);
  });

  it('solves when goal.command matches and the substring is present', () => {
    const { validator } = setup([
      makeQuest({ goal: { type: 'output-contains', command: 'ls', substring: 'passwd' } }),
    ]);
    const r = validator.check('ls /etc', okResult('passwd'));
    expect(r.solved).toBe(true);
  });

  it('does not solve on a pipeline input (_parseArgv null path)', () => {
    // A pipeline parses to a single pipeline with more than one command;
    // _parseArgv requires exactly one command and returns null. The
    // substring match must not fire even if stdout happens to contain it.
    const { validator } = setup([
      makeQuest({ goal: { type: 'output-contains', command: 'ls', substring: 'passwd' } }),
    ]);
    const r = validator.check('ls | grep x', okResult('passwd'));
    expect(r.solved).toBe(false);
  });

  it('command: null is treated as wildcard (no command restriction)', () => {
    // Null-as-absent: `command: null` means "no command restriction",
    // so any input whose stdout contains the substring matches —
    // regardless of the invoked command. Guards against the pre-fix
    // path where `argv[0] !== null` was always true (never solved).
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'output-contains',
          command: null,
          substring: 'passwd',
        },
      }),
    ]);
    // `ls /etc` stdout contains 'passwd':
    expect(
      validator.check('ls /etc', okResult('hosts\nmotd\npasswd\n')).solved,
    ).toBe(true);
    // `cat /etc/passwd` stdout contains 'passwd' — command restriction
    // absent, so it also matches:
    expect(
      validator.check('cat /etc/passwd', okResult('root:x:0:0\n')).solved,
    ).toBe(false); // stdout doesn't contain 'passwd' literally
    // Sanity: `ls /` with no 'passwd' in stdout → not solved:
    expect(
      validator.check('ls /', okResult('bin\netc\n')).solved,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// keine aktive Quest
// ---------------------------------------------------------------------------

describe('QuestValidator — no active quest', () => {
  it('returns {solved:false, questId:null} when all quests are solved', () => {
    const quests = [makeQuest()];
    const { engine, validator } = setup(quests);
    engine.solveQuest('quest-001');
    const r = validator.check('ls', okResult());
    expect(r.solved).toBe(false);
    expect(r.questId).toBe(null);
  });

  it('returns {solved:false, questId:null} when the engine is empty', () => {
    const { validator } = setup([]);
    const r = validator.check('ls', okResult());
    expect(r.solved).toBe(false);
    expect(r.questId).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// solveQuest integration
// ---------------------------------------------------------------------------

describe('QuestValidator — solveQuest integration', () => {
  it('marks the quest as solved in the engine when solved=true', () => {
    const { engine, validator } = setup([makeQuest()]);
    const r = validator.check('pwd', okResult());
    expect(r.solved).toBe(true);
    expect(engine.isSolved('quest-001')).toBe(true);
  });

  it('second check on the same input does not re-solve; next quest is active', () => {
    const quests = [
      makeQuest({ id: 'quest-001', goal: { type: 'command-executed', command: 'pwd' } }),
      makeQuest({ id: 'quest-002', goal: { type: 'command-executed', command: 'ls' } }),
    ];
    const { validator } = setup(quests);

    const r1 = validator.check('pwd', okResult());
    expect(r1.solved).toBe(true);
    expect(r1.questId).toBe('quest-001');

    // The next check runs against quest-002 (goal=ls), so the same
    // 'pwd' input no longer matches.
    const r2 = validator.check('pwd', okResult());
    expect(r2.solved).toBe(false);
    expect(r2.questId).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// QuestValidator — command-executed mit redirects (spec012b §2.2)
// ---------------------------------------------------------------------------

describe('QuestValidator — command-executed mit redirects', () => {
  it('solves when the single redirect matches', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: ['x'],
          redirects: [{ op: '>', target: '/tmp/f' }],
        },
      }),
    ]);
    const r = validator.check('echo x > /tmp/f', okResult(''));
    expect(r.solved).toBe(true);
    expect(r.questId).toBe('quest-001');
  });

  it('does not solve when the redirect target differs', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: ['x'],
          redirects: [{ op: '>', target: '/tmp/f' }],
        },
      }),
    ]);
    const r = validator.check('echo x > /tmp/g', okResult(''));
    expect(r.solved).toBe(false);
  });

  it('does not solve when the redirect is missing', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: ['x'],
          redirects: [{ op: '>', target: '/tmp/f' }],
        },
      }),
    ]);
    const r = validator.check('echo x', okResult(''));
    expect(r.solved).toBe(false);
  });

  it('does not solve when extra redirects are present (multiset mismatch)', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: ['x'],
          redirects: [{ op: '>', target: '/tmp/f' }],
        },
      }),
    ]);
    const r = validator.check('echo x > /tmp/f > /tmp/h', okResult(''));
    expect(r.solved).toBe(false);
  });

  it('solves when the redirect op is the append form (>> vs >)', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: ['y'],
          redirects: [{ op: '>>', target: '/tmp/f' }],
        },
      }),
    ]);
    // Wrong op: > rather than >>.
    expect(validator.check('echo y > /tmp/f', okResult('')).solved).toBe(false);
    // Right op:
    expect(validator.check('echo y >> /tmp/f', okResult('')).solved).toBe(true);
  });

  it("solves when the redirect op is '<' (input redirect)", () => {
    // Companion to the `>`/`>>` tests: `<` is a valid op and must
    // match the AST's input redirect. Pinned so a refactor of
    // `redirectsMatch` or of `ALLOWED_REDIRECT_OPS` that drops `<`
    // would break this test.
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'cat',
          redirects: [{ op: '<', target: '/etc/passwd' }],
        },
      }),
    ]);
    const r = validator.check('cat < /etc/passwd', okResult(''));
    expect(r.solved).toBe(true);
    expect(r.questId).toBe('quest-001');
  });

  it('redirects: null is treated as "don\'t care about redirects" (wildcard, no crash)', () => {
    // Null-as-absent convention (loader.js JSDoc): `redirects: null`
    // = "not set" = wildcard, exactly like `redirects: undefined`.
    // The redirect multiset check is skipped; any redirect in the
    // input is fine.
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: ['x'],
          redirects: null,
        },
      }),
    ]);
    // No redirect in input — matches (wildcard):
    expect(validator.check('echo x', okResult('')).solved).toBe(true);
    // Redirect in input — still matches (wildcard):
    expect(validator.check('echo x > /tmp/f', okResult('')).solved).toBe(true);
  });

  it('redirects: [] means "no redirects expected" (strict)', () => {
    // Empty array = provided → redirectsMatch runs against `[]`.
    // Input with no redirect → multiset `[]` === `[]` → solved.
    // Input with any redirect → multiset mismatch → not solved.
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'echo',
          args: ['x'],
          redirects: [],
        },
      }),
    ]);
    expect(validator.check('echo x', okResult('')).solved).toBe(true);
    expect(validator.check('echo x > /tmp/f', okResult('')).solved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QuestValidator — command-executed mit pipeline (spec012b §2.3)
// ---------------------------------------------------------------------------

describe('QuestValidator — command-executed mit pipeline', () => {
  it('solves when the pipeline matches stage-by-stage', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          pipeline: [
            { command: 'ls', args: ['/etc'] },
            { command: 'sort' },
          ],
        },
      }),
    ]);
    const r = validator.check('ls /etc | sort', okResult(''));
    expect(r.solved).toBe(true);
    expect(r.questId).toBe('quest-001');
  });

  it('does not solve when the pipeline length differs', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          pipeline: [
            { command: 'ls', args: ['/etc'] },
            { command: 'sort' },
          ],
        },
      }),
    ]);
    // Only one command → length 1 vs 2.
    expect(validator.check('ls /etc', okResult('')).solved).toBe(false);
    // Three commands → length 3 vs 2.
    expect(validator.check('ls /etc | sort | head', okResult('')).solved).toBe(false);
  });

  it('does not solve when a stage argument differs', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          pipeline: [
            { command: 'ls', args: ['/etc'] },
            { command: 'sort' },
          ],
        },
      }),
    ]);
    const r = validator.check('ls /var | sort', okResult(''));
    expect(r.solved).toBe(false);
  });

  it('does not solve when a stage command differs', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          pipeline: [
            { command: 'ls', args: ['/etc'] },
            { command: 'sort' },
          ],
        },
      }),
    ]);
    const r = validator.check('ls /etc | head', okResult(''));
    expect(r.solved).toBe(false);
  });

  it('does not solve when exitCode is non-zero', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          pipeline: [{ command: 'ls' }, { command: 'sort' }],
        },
      }),
    ]);
    const r = validator.check('ls | sort', {
      stdout: '',
      stderr: 'err',
      exitCode: 1,
    });
    expect(r.solved).toBe(false);
  });

  it('a stage without args matches any args (args-omitted = wildcard)', () => {
    // The args-omitted semantics from spec012b §2.3: if
    // goal.pipeline[i].args is undefined, the stage matches with ANY
    // args (including no args, one arg, many args). The `rev` stage
    // has no goal-args, so both `rev` and `rev -n` must solve.
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          pipeline: [
            { command: 'echo', args: ['hallo'] },
            { command: 'rev' },
          ],
        },
      }),
    ]);
    // No args on the wildcard stage:
    expect(validator.check('echo hallo | rev', okResult('')).solved).toBe(true);
    // Extra args on the wildcard stage — still matches:
    expect(validator.check('echo hallo | rev -n', okResult('')).solved).toBe(true);
    // Sanity: args on the STRICT stage must still match exactly.
    expect(validator.check('echo goodbye | rev -n', okResult('')).solved).toBe(false);
  });

  it('stage args: null is treated as wildcard (no crash)', () => {
    // Same convention as command.args: `null` means "not set" →
    // wildcard. Without the validator-side guard, `null.length`
    // would throw. With the guard, the stage matches any args.
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          pipeline: [
            { command: 'echo', args: ['hallo'] },
            { command: 'rev', args: null },
          ],
        },
      }),
    ]);
    expect(validator.check('echo hallo | rev', okResult('')).solved).toBe(true);
    expect(validator.check('echo hallo | rev -n', okResult('')).solved).toBe(true);
  });

  it('dispatches to pipeline when command: null and pipeline is set', () => {
    // With `command: null` (placeholder) + pipeline, the validator
    // must dispatch to the pipeline check, NOT to the single-command
    // check (which would compare `cmd.argv[0] !== null` → false).
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: null,
          pipeline: [{ command: 'ls' }],
        },
      }),
    ]);
    const r = validator.check('ls', okResult(''));
    expect(r.solved).toBe(true);
  });

  it('dispatches to single-command when pipeline: null and command is set', () => {
    const { validator } = setup([
      makeQuest({
        goal: {
          type: 'command-executed',
          command: 'ls',
          pipeline: null,
        },
      }),
    ]);
    const r = validator.check('ls', okResult(''));
    expect(r.solved).toBe(true);
  });
});