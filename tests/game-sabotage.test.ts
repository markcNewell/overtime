/** Sabotage: the boss secretly messes up the worker's code. */

import { describe, expect, it } from 'vitest';
import type {
  Candidate,
  GameEvent,
  GameState,
  HardPart,
  Pitch,
  Project,
  Settings,
  Worker,
} from '../src/shared/types';
import { act, assign, hire, newGameState, tick } from '../src/game';

const T0 = new Date(2026, 9, 5, 9, 0).getTime();
const MIN = 60_000;
const SABOTAGE = { type: 'sabotage' } as const;

const SETTINGS: Settings = {
  alwaysOnTop: true,
  hideFromScreenShare: false,
  claudePath: '',
  model: 'haiku',
  filesDir: '/tmp/overtime',
};

const CANDIDATE: Candidate = {
  id: 'c1',
  name: 'Pat',
  age: 30,
  pronouns: 'they/them',
  level: 'mid',
  personality: 'Average in every way',
  specialty: 'Spreadsheets',
  quirk: 'Hums',
  redFlag: 'None yet',
  backstory: 'Came from a bank',
  traits: { stamina: 1, resilience: 1, talent: 1 },
  look: {
    skin: '#c99',
    hair: '#222',
    hairStyle: 'short',
    shirt: '#36c',
    glasses: false,
  },
};

function part(at: number): HardPart {
  return { at, severity: 2, title: `Part at ${at}`, detail: 'It breaks' };
}

const PITCH: Pitch = {
  id: 'p1',
  title: 'Toaster Chat',
  tagline: 'Talk to your toast',
  difficulty: 3,
  description: 'A messenger for kitchen appliances.',
  hardParts: [part(0.3), part(0.6)],
};

/** Pat working on Toaster Chat at the given progress, hard parts behind it hit. */
function at(progress: number, patch: Partial<Worker> = {}): GameState {
  const empty = newGameState(SETTINGS, T0);
  let state = hire({ ...empty, candidates: [CANDIDATE] }, 'c1', T0);
  state = assign({ ...state, pitches: [PITCH] }, 'p1', T0);
  const project = state.project!;
  const hit = project.hardParts.flatMap((p, i) => (p.at <= progress ? [i] : []));
  return {
    ...state,
    project: { ...project, progress, hardPartsHit: hit },
    worker: {
      ...state.worker!,
      activity: 'working',
      stats: { energy: 80, mood: 60, sanity: 80 },
      ...patch,
    },
  };
}

function stuckOn(state: GameState, index: number, minutes = 15): GameState {
  const project: Project = {
    ...state.project!,
    stuckOn: index,
    stuckMinutesLeft: minutes,
  };
  return { ...state, project, worker: { ...state.worker!, activity: 'stuck' } };
}

function titles(project: Project): string[] {
  return project.hardParts.map((p) => p.title);
}

/** Tick every 5 s for `minutes`, or until `stop` matches an event. */
function run(
  start: GameState,
  minutes: number,
  stop?: (e: GameEvent) => boolean,
): { state: GameState; events: GameEvent[] } {
  let state = start;
  const events: GameEvent[] = [];
  const end = start.lastTickAt + minutes * MIN;
  for (let now = start.lastTickAt + 5000; now <= end; now += 5000) {
    const r = tick(state, now);
    state = r.state;
    events.push(...r.events);
    if (stop && r.events.some(stop)) break;
  }
  return { state, events };
}

describe('refusals', () => {
  it('refuses without a project, while arriving or while leaving', () => {
    const noProject = { ...at(0.5) };
    delete noProject.project;
    const cases: [GameState, string][] = [
      [noProject, 'There is no code to mess up yet'],
      [at(0.5, { activity: 'arriving' }), "They haven't even logged in yet"],
      [
        at(0.5, { activity: 'leaving', ending: 'fired' }),
        "They're already on their way out",
      ],
    ];
    for (const [state, reason] of cases) {
      const r = act(state, SABOTAGE, T0);
      expect(r.events).toEqual([{ type: 'action-refused', action: 'sabotage', reason }]);
      expect(r.state).toEqual(state);
    }
  });
});

describe('planting a bug', () => {
  it('knocks progress back and they hit the bug at once if working', () => {
    const r = act(at(0.5), SABOTAGE, T0);
    const project = r.state.project!;
    const worker = r.state.worker!;
    expect(project.progress).toBeCloseTo(0.47, 9);
    expect(titles(project)).toEqual([
      'Part at 0.3',
      'Semicolons became Greek question marks',
      'Part at 0.6',
    ]);
    const bug = project.hardParts[1]!;
    expect(bug).toMatchObject({ severity: 1, mystery: true });
    expect(bug.at).toBeCloseTo(0.47, 9);
    expect(r.events).toEqual([
      { type: 'code-broken', index: 1 },
      { type: 'hard-part-hit', index: 1 },
    ]);
    expect(project.hardPartsHit).toEqual([0, 1]);
    expect(project.stuckOn).toBe(1);
    expect(project.stuckMinutesLeft).toBeCloseTo(10, 9);
    expect(worker.activity).toBe('stuck');
    expect(worker.stats).toMatchObject({ mood: 56, sanity: 76 });
    expect(worker.ledger.sabotages).toBe(1);
    expect(worker.recentSabotages).toEqual([T0]);
  });

  it('never knocks progress below 0 or behind a hard part already met', () => {
    const start = act(at(0.01), SABOTAGE, T0).state.project!;
    expect(start.progress).toBe(0);
    expect(start.hardParts[0]).toMatchObject({ at: 0, mystery: true });

    const justPast = act(at(0.31), SABOTAGE, T0).state.project!;
    expect(justPast.progress).toBe(0.3);
    expect(titles(justPast)[0]).toBe('Part at 0.3');
    expect(justPast.hardParts[1]).toMatchObject({ at: 0.3, mystery: true });
  });

  it('while stuck, keeps them on the same part and makes the bug next', () => {
    const state = stuckOn(at(0.32), 0);
    const r = act(state, SABOTAGE, T0);
    const project = r.state.project!;
    expect(r.events).toEqual([{ type: 'code-broken', index: 1 }]);
    expect(project.hardParts[project.stuckOn!]!.title).toBe('Part at 0.3');
    expect(project.hardPartsHit).toEqual([0]);
    expect(r.state.worker!.activity).toBe('stuck');

    const after = run(r.state, 20, (e) => e.type === 'hard-part-hit');
    expect(after.events.filter((e) => e.type.startsWith('hard-part'))).toEqual([
      { type: 'hard-part-cleared', index: 0 },
      { type: 'hard-part-hit', index: 1 },
    ]);
    expect(after.state.project!.hardParts[1]!.mystery).toBe(true);
  });

  it('a stuck worker deep in the list keeps pointing at the right parts', () => {
    // Already past the part at 0.3 and stuck on the one at 0.6.
    const state = stuckOn(at(0.6), 1);
    const r = act(state, SABOTAGE, T0);
    const project = r.state.project!;
    expect(titles(project)).toEqual([
      'Part at 0.3',
      'Part at 0.6',
      'Semicolons became Greek question marks',
    ]);
    expect(project.stuckOn).toBe(1);
    expect(project.hardPartsHit).toEqual([0, 1]);
    expect(project.progress).toBe(0.6);
  });

  it('on coffee or asleep, they hit it when they get back', () => {
    const onCoffee = act(at(0.5), { type: 'coffee' }, T0).state;
    const r = act(onCoffee, SABOTAGE, T0 + MIN);
    expect(r.events).toEqual([{ type: 'code-broken', index: 1 }]);
    expect(r.state.worker!.activity).toBe('coffee');
    const back = run(r.state, 10, (e) => e.type === 'hard-part-hit');
    expect(back.events).toContainEqual({ type: 'coffee-done' });
    expect(back.events.at(-1)).toEqual({ type: 'hard-part-hit', index: 1 });

    const asleep = act(at(0.5, { activity: 'asleep' }), SABOTAGE, T0).state;
    expect(asleep.worker!.activity).toBe('asleep');
    const woken = act(asleep, { type: 'shock' }, T0 + MIN).state;
    const hit = run(woken, 1, (e) => e.type === 'hard-part-hit');
    expect(hit.events.at(-1)).toEqual({ type: 'hard-part-hit', index: 1 });
  });

  it('gets nastier in quick succession and calms down after 30 minutes', () => {
    let state = at(0.9);
    const severities: number[] = [];
    for (const minute of [0, 1, 2, 3, 34]) {
      const r = act(state, SABOTAGE, T0 + minute * MIN);
      state = r.state;
      const broken = r.events.find((e) => e.type === 'code-broken');
      const index = broken?.type === 'code-broken' ? broken.index : -1;
      severities.push(state.project!.hardParts[index]!.severity);
    }
    expect(severities).toEqual([1, 2, 3, 3, 1]);
    expect(state.worker!.recentSabotages).toEqual([T0 + 34 * MIN]);
    expect(state.worker!.ledger.sabotages).toBe(5);
  });

  it('picks bug names in turn from the list', () => {
    let state = at(0.9);
    for (let i = 0; i < 13; i++) {
      state = act(state, SABOTAGE, T0 + i * 40 * MIN).state;
    }
    const bugs = state.project!.hardParts.filter((p) => p.mystery);
    expect(bugs).toHaveLength(13);
    const names = new Set(bugs.map((b) => b.title));
    expect(names.size).toBe(12);
    expect(names).toContain('Tabs and spaces swapped');
    expect(names).toContain('Every variable renamed to x');
  });

  it('keeps the list sorted and the indices honest after many bugs', () => {
    let state = stuckOn(at(0.45), 0);
    for (let i = 0; i < 5; i++) {
      state = act(state, SABOTAGE, state.lastTickAt).state;
      state = run(state, 3).state;
    }
    const project = state.project!;
    const ats = project.hardParts.map((p) => p.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    for (const i of project.hardPartsHit) {
      expect(project.hardParts[i]!.at).toBeLessThanOrEqual(project.progress);
    }
    expect(new Set(project.hardPartsHit).size).toBe(project.hardPartsHit.length);
    if (project.stuckOn !== undefined) {
      expect(project.hardPartsHit).toContain(project.stuckOn);
    }
  });
});

describe('being stuck on a planted bug', () => {
  it('costs an extra 0.25 sanity a minute', () => {
    const normal = stuckOn(at(0.3), 0, 60);
    const planted = act(at(0.33), SABOTAGE, T0).state;
    const mystery = {
      ...planted,
      project: { ...planted.project!, stuckMinutesLeft: 60 },
      worker: { ...planted.worker!, stats: normal.worker!.stats },
    };
    // Same severity as the planted bug, so only the mystery differs.
    const [first, ...rest] = normal.project!.hardParts;
    const hardParts = [{ ...first!, severity: 1 as const }, ...rest];
    const plain = { ...normal, project: { ...normal.project!, hardParts } };
    const after = (s: GameState): number => run(s, 10).state.worker!.stats.sanity;
    expect(after(plain) - after(mystery)).toBeCloseTo(2.5, 6);
  });
});
