import { describe, it, expect } from '../runner.js';
import { getQuestCommands } from '../../js/quests/commands-from-quest.js';

/**
 * Minimal valid quest fixture with overrides. Default goal is a
 * `command-executed` with `pwd` so per-describe overrides only need
 * to specify the field relevant to the test.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
function makeQuest(overrides = {}) {
  return {
    id: 'q1',
    module: 'basics',
    difficulty: 'easy',
    title: 'Q',
    description: 'D',
    hint: 'H',
    goal: { type: 'command-executed', command: 'pwd' },
    xp: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getQuestCommands — commands-Feld
// ---------------------------------------------------------------------------

describe('getQuestCommands — commands-Feld', () => {
  it('returns the explicit commands list for a single command', () => {
    const q = makeQuest({ commands: ['mkdir'] });
    expect(getQuestCommands(q)).toEqual(['mkdir']);
  });

  it('returns the explicit commands list for multiple commands', () => {
    const q = makeQuest({ commands: ['chmod', 'stat'] });
    expect(getQuestCommands(q)).toEqual(['chmod', 'stat']);
  });

  it('returns a fresh copy — mutating the result does not affect quest.commands', () => {
    const q = makeQuest({ commands: ['mkdir'] });
    const out = getQuestCommands(q);
    out.push('ls');
    expect(q.commands).toEqual(['mkdir']);
  });
});

// ---------------------------------------------------------------------------
// getQuestCommands — command-executed
// ---------------------------------------------------------------------------

describe('getQuestCommands — command-executed', () => {
  it('derives [command] from a command-executed goal', () => {
    const q = makeQuest({
      goal: { type: 'command-executed', command: 'ls' },
    });
    expect(getQuestCommands(q)).toEqual(['ls']);
  });

  it('derives [command] and ignores args', () => {
    const q = makeQuest({
      goal: {
        type: 'command-executed',
        command: 'grep',
        args: ['-i', 'root', '/etc/passwd'],
      },
    });
    expect(getQuestCommands(q)).toEqual(['grep']);
  });
});

// ---------------------------------------------------------------------------
// getQuestCommands — pipeline
// ---------------------------------------------------------------------------

describe('getQuestCommands — pipeline', () => {
  it('derives every stage command from a 2-stage pipeline', () => {
    const q = makeQuest({
      goal: {
        type: 'command-executed',
        pipeline: [{ command: 'ls' }, { command: 'sort' }],
      },
    });
    expect(getQuestCommands(q)).toEqual(['ls', 'sort']);
  });

  it('derives every stage command from a 3-stage pipeline', () => {
    const q = makeQuest({
      goal: {
        type: 'command-executed',
        pipeline: [
          { command: 'cat' },
          { command: 'grep' },
          { command: 'cut' },
        ],
      },
    });
    expect(getQuestCommands(q)).toEqual(['cat', 'grep', 'cut']);
  });
});

// ---------------------------------------------------------------------------
// getQuestCommands — output-contains
// ---------------------------------------------------------------------------

describe('getQuestCommands — output-contains', () => {
  it('derives [command] when output-contains has an explicit command', () => {
    const q = makeQuest({
      goal: { type: 'output-contains', substring: 'x', command: 'ls' },
    });
    expect(getQuestCommands(q)).toEqual(['ls']);
  });

  it('returns [] when output-contains has no command', () => {
    const q = makeQuest({
      goal: { type: 'output-contains', substring: 'x' },
    });
    expect(getQuestCommands(q)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getQuestCommands — nicht ableitbar
// ---------------------------------------------------------------------------

describe('getQuestCommands — nicht ableitbar', () => {
  it('returns [] for file-exists without commands', () => {
    const q = makeQuest({
      goal: { type: 'file-exists', path: '/tmp/x' },
    });
    expect(getQuestCommands(q)).toEqual([]);
  });

  it('returns [] for file-mode without commands', () => {
    const q = makeQuest({
      goal: { type: 'file-mode', path: '/tmp/x', mode: 384 },
    });
    expect(getQuestCommands(q)).toEqual([]);
  });

  it('returns [] for file-owner without commands', () => {
    const q = makeQuest({
      goal: { type: 'file-owner', path: '/tmp/x', owner: 'user' },
    });
    expect(getQuestCommands(q)).toEqual([]);
  });

  it('returns [] for file-not-exists without commands', () => {
    // Added for symmetry with the other path-only goals above; the
    // spec's §2 lists this type in the "sonst" branch but the test
    // matrix in §4.1 only enumerated file-exists/mode/owner. Pinned
    // explicitly so a future regression that treats file-not-exists
    // differently is caught.
    const q = makeQuest({
      goal: { type: 'file-not-exists', path: '/tmp/x' },
    });
    expect(getQuestCommands(q)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getQuestCommands — commands-Feld gewinnt
// ---------------------------------------------------------------------------

describe('getQuestCommands — commands-Feld gewinnt', () => {
  it('returns the explicit commands instead of the derived [ls]', () => {
    const q = makeQuest({
      commands: ['custom'],
      goal: { type: 'command-executed', command: 'ls' },
    });
    expect(getQuestCommands(q)).toEqual(['custom']);
  });

  it('returns the explicit commands even for a pipeline goal', () => {
    // Explicit commands override derivation regardless of goal type.
    // This is the case a quest author uses to point at a curated
    // multi-command approach (e.g. show "chmod" and "stat" for a
    // file-mode check).
    const q = makeQuest({
      commands: ['chmod', 'stat'],
      goal: {
        type: 'command-executed',
        pipeline: [{ command: 'ls' }, { command: 'sort' }],
      },
    });
    expect(getQuestCommands(q)).toEqual(['chmod', 'stat']);
  });
});

// ---------------------------------------------------------------------------
// getQuestCommands — commands: [] fällt auf Ableitung zurück (spec016a §1)
// ---------------------------------------------------------------------------

describe('getQuestCommands — commands: [] Fallthrough', () => {
  // Pins the JSDoc claim "commands: [] behaves like not set" against a
  // refactor that changes `quest.commands.length > 0` to
  // `Array.isArray(quest.commands)`: the latter would return `[]`
  // directly instead of falling through to goal derivation, silently
  // breaking the documented contract. See review NICE 2 to spec016a.
  it('falls through to command-executed derivation for commands: []', () => {
    const q = makeQuest({
      commands: [],
      goal: { type: 'command-executed', command: 'ls' },
    });
    expect(getQuestCommands(q)).toEqual(['ls']);
  });

  it('falls through to pipeline derivation for commands: []', () => {
    const q = makeQuest({
      commands: [],
      goal: {
        type: 'command-executed',
        pipeline: [{ command: 'cat' }, { command: 'grep' }],
      },
    });
    expect(getQuestCommands(q)).toEqual(['cat', 'grep']);
  });

  it('returns [] for commands: [] with a non-derivable goal', () => {
    // Endpoint of the fallthrough: `commands: []` is treated as
    // absent, goal is non-derivable → the helper still returns [].
    // The return value is the same as if `commands` were omitted,
    // which is the "no effect" contract from spec016a §1.
    const q = makeQuest({
      commands: [],
      goal: { type: 'file-exists', path: '/tmp/x' },
    });
    expect(getQuestCommands(q)).toEqual([]);
  });
});