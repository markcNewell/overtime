/** tick: the clock, activities, hard parts, finishing and the tick-time endings. */

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
import {
  act,
  ARRIVE_MS,
  assign,
  hire,
  newGameState,
  setBubble,
  tick,
  xpFor,
} from '../src/game';

const T0 = new Date(2026, 9, 5, 9, 0).getTime();
const MIN = 60_000;

const SETTINGS: Settings = {
  alwaysOnTop: true,
  hideFromScreenShare: false,
  claudePath: '',
  model: 'haiku',
  filesDir: '/tmp/overtime',
};

function candidate(patch: Partial<Candidate> = {}): Candidate {
  return {
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
    ...patch,
  };
}

function part(at: number, severity: HardPart['severity'] = 2): HardPart {
  return { at, severity, title: `Part at ${at}`, detail: 'It breaks' };
}

function pitch(patch: Partial<Pitch> = {}): Pitch {
  return {
    id: 'p1',
    title: 'Toaster Chat',
    tagline: 'Talk to your toast',
    difficulty: 3,
    description: 'A messenger for kitchen appliances.',
    hardParts: [part(0.3), part(0.6)],
    ...patch,
  };
}

/** Pat, hired at T0 and already settled at the desk. */
function hired(patch: Partial<Candidate> = {}): GameState {
  const empty = newGameState(SETTINGS, T0);
  const state = hire({ ...empty, candidates: [candidate(patch)] }, 'c1', T0);
  return patchWorker(state, { activity: 'idle' });
}

function working(
  pitchPatch: Partial<Pitch> = {},
  who: Partial<Candidate> = {},
): GameState {
  const state = hired(who);
  return assign({ ...state, pitches: [pitch(pitchPatch)] }, 'p1', T0);
}

function patchWorker(state: GameState, patch: Partial<Worker>): GameState {
  return { ...state, worker: { ...state.worker!, ...patch } };
}

function patchStats(state: GameState, stats: Partial<Worker['stats']>): GameState {
  return patchWorker(state, { stats: { ...state.worker!.stats, ...stats } });
}

function patchProject(state: GameState, patch: Partial<Project>): GameState {
  return { ...state, project: { ...state.project!, ...patch } };
}

interface Timed {
  at: number;
  event: GameEvent;
}

/** Tick every 5 s from the state's last tick, for `minutes` or until `stop`. */
function run(
  start: GameState,
  minutes: number,
  stop?: (e: GameEvent) => boolean,
): { state: GameState; events: Timed[]; now: number } {
  let state = start;
  const events: Timed[] = [];
  const end = start.lastTickAt + minutes * MIN;
  let now = start.lastTickAt;
  while (now < end) {
    now += 5000;
    const r = tick(state, now);
    state = r.state;
    events.push(...r.events.map((event) => ({ at: now, event })));
    if (stop && r.events.some(stop)) break;
  }
  return { state, events, now };
}

function types(events: Timed[]): string[] {
  return events.map((t) => t.event.type);
}

describe('the clock', () => {
  it('integrates at most one minute however long the gap', () => {
    const state = working();
    const oneMinute = tick(state, T0 + MIN).state;
    const threeHours = tick(state, T0 + 3 * 60 * MIN).state;
    expect(threeHours.worker!.stats).toEqual(oneMinute.worker!.stats);
    expect(threeHours.project!.progress).toBeCloseTo(oneMinute.project!.progress, 12);
    expect(threeHours.lastTickAt).toBe(T0 + 3 * 60 * MIN);
  });

  it('a clock going backwards changes nothing but lastTickAt', () => {
    const state = working();
    const r = tick(state, T0 - MIN);
    expect(r.state.worker).toEqual(state.worker);
    expect(r.state.lastTickAt).toBe(T0 - MIN);
  });

  it('clears an expired bubble and keeps a live one', () => {
    const state = setBubble(working(), 'Hello', 'say', T0);
    const until = state.bubble!.until;
    expect(tick(state, until - 1).state.bubble).toBeDefined();
    expect(tick(state, until).state.bubble).toBeUndefined();
  });

  it('with no worker only moves lastTickAt', () => {
    const state = newGameState(SETTINGS, T0);
    const r = tick(state, T0 + 30_000);
    expect(r.events).toEqual([]);
    expect(r.state).toEqual({ ...state, lastTickAt: T0 + 30_000 });
  });

  it('freezes a worker who is leaving', () => {
    const state = patchWorker(working(), { activity: 'leaving', ending: 'fired' });
    const r = run(state, 10);
    expect(r.events).toEqual([]);
    expect(r.state.worker!.stats).toEqual(state.worker!.stats);
    expect(r.state.project!.progress).toBe(0);
  });

  it('does not mutate its input', () => {
    const state = working();
    const before = structuredClone(state);
    tick(state, T0 + MIN);
    expect(state).toEqual(before);
  });
});

describe('arriving', () => {
  function arriving(withProject: boolean): GameState {
    const empty = newGameState(SETTINGS, T0);
    let state = hire({ ...empty, candidates: [candidate()] }, 'c1', T0);
    if (withProject) state = assign({ ...state, pitches: [pitch()] }, 'p1', T0);
    return state;
  }

  it('lasts ARRIVE_MS, then they start on the project', () => {
    const state = arriving(true);
    expect(state.worker!.activity).toBe('arriving');
    expect(tick(state, T0 + ARRIVE_MS - 1).state.worker!.activity).toBe('arriving');
    const r = tick(state, T0 + ARRIVE_MS);
    expect(r.state.worker!.activity).toBe('working');
    expect(r.events).toContainEqual({ type: 'arrived' });
  });

  it('goes idle when there is nothing to do', () => {
    const r = tick(arriving(false), T0 + ARRIVE_MS);
    expect(r.state.worker!.activity).toBe('idle');
  });
});

describe('hard parts', () => {
  it('bite at exactly their progress, once each, in order', () => {
    const state = working({ hardParts: [part(0.6), part(0.3)] });
    const first = run(state, 300, (e) => e.type === 'hard-part-hit');
    expect(first.events.at(-1)!.event).toEqual({ type: 'hard-part-hit', index: 0 });
    expect(first.state.project!.progress).toBe(0.3);
    expect(first.state.worker!.activity).toBe('stuck');
    // mid on difficulty 3: gap 0, talent 1, severity 2 -> 20 minutes.
    expect(first.state.project!.stuckMinutesLeft).toBeCloseTo(20, 6);

    const rest = run(first.state, 600, (e) => e.type === 'project-finished');
    const hits = rest.events.filter((t) => t.event.type === 'hard-part-hit');
    expect(hits.map((t) => t.event)).toEqual([{ type: 'hard-part-hit', index: 1 }]);
    const cleared = rest.events.filter((t) => t.event.type === 'hard-part-cleared');
    expect(cleared.map((t) => t.event)).toEqual([
      { type: 'hard-part-cleared', index: 0 },
      { type: 'hard-part-cleared', index: 1 },
    ]);
    expect((cleared[0]!.at - first.now) / MIN).toBeCloseTo(20, 1);
    expect(types(rest.events)).toContain('project-finished');
  });

  it('crawl on while stuck but never past the next hard part', () => {
    const state = patchProject(working(), {
      progress: 0.3,
      hardPartsHit: [0],
      stuckOn: 0,
      stuckMinutesLeft: 500,
      hardParts: [part(0.3), part(0.4)],
    });
    const stuck = patchWorker(state, { activity: 'stuck' });
    const after = run(stuck, 10).state.project!;
    // A quarter of mid-on-3 speed: about 0.003 a minute.
    expect(after.progress).toBeGreaterThan(0.32);
    expect(after.progress).toBeLessThan(0.34);
    const later = run(stuck, 120).state.project!;
    expect(later.progress).toBe(0.4);
    expect(later.hardPartsHit).toEqual([0]);
  });

  it('take longer for someone out of their depth', () => {
    const junior = { level: 'junior' } as const;
    const state = working({ difficulty: 5, hardParts: [part(0.01, 3)] }, junior);
    const r = run(state, 120, (e) => e.type === 'hard-part-hit');
    // 10 x 3 x (1 + 0.3 x 3) = 57 minutes.
    expect(r.state.project!.stuckMinutesLeft).toBeCloseTo(57, 6);
  });
});

describe('finishing a project', () => {
  function nearlyDone(xp: number): GameState {
    const state = working({ difficulty: 1, hardParts: [] }, { level: 'junior' });
    // 100 minutes averaging 0.7 so far: one more minute stays "Solid".
    const ready = patchProject(state, {
      progress: 0.999,
      workMinutes: 100,
      qualitySum: 70,
    });
    return patchWorker(ready, { xp, activity: 'working' });
  }

  it('ships a release, earns XP and levels up', () => {
    const r = run(nearlyDone(35), 2, (e) => e.type === 'project-finished');
    const finished = r.events.find((t) => t.event.type === 'project-finished')!.event;
    expect(finished).toMatchObject({ type: 'project-finished', grade: 'Solid' });
    const quality = (finished as { quality: number }).quality;
    expect(quality).toBeCloseTo(0.7, 2);

    const worker = r.state.worker!;
    expect(worker.xp).toBeCloseTo(35 + 1 * 10 * (0.5 + quality), 6);
    expect(worker.level).toBe('mid');
    const levelUp = { type: 'level-up', level: 'mid' };
    expect(r.events.map((t) => t.event)).toContainEqual(levelUp);
    expect(worker.projectsDone).toBe(1);
    expect(worker.activity).toBe('idle');
    expect(worker.memories.at(-1)).toMatchObject({
      kind: 'work',
      text: 'Shipped Toaster Chat (Solid)',
    });
    expect(r.state.project).toBeUndefined();
    expect(r.state.releases).toEqual([
      {
        projectId: 'p1',
        title: 'Toaster Chat',
        workerName: 'Pat',
        finishedAt: r.now,
        quality,
        grade: 'Solid',
      },
    ]);
  });

  it('does not level up below the next threshold', () => {
    const r = run(nearlyDone(xpFor('junior')), 2, (e) => e.type === 'project-finished');
    expect(r.state.worker!.level).toBe('junior');
    expect(types(r.events)).not.toContain('level-up');
  });
});

describe('energy, sleep and coffee', () => {
  it('fall asleep at 0 energy and make no progress until shocked', () => {
    const state = patchStats(working(), { energy: 0.05 });
    const dozed = run(state, 1);
    expect(types(dozed.events)).toContain('fell-asleep');
    expect(dozed.state.worker!.activity).toBe('asleep');

    const later = run(dozed.state, 30).state;
    expect(later.project!.progress).toBe(dozed.state.project!.progress);
    expect(later.worker!.activity).toBe('asleep');

    const woken = act(later, { type: 'shock' }, later.lastTickAt);
    expect(woken.events).toContainEqual({ type: 'woke-up' });
    expect(woken.state.worker!.activity).toBe('working');
    expect(woken.state.worker!.stats.energy).toBeCloseTo(15, 6);
  });

  it('coffee refills energy for seven minutes then they go back to work', () => {
    const tired = patchStats(working(), { energy: 10 });
    const sent = act(tired, { type: 'coffee' }, T0).state;
    expect(sent.worker!.activity).toBe('coffee');
    const r = run(sent, 8, (e) => e.type === 'coffee-done');
    expect(types(r.events)).toEqual(['coffee-done']);
    expect((r.now - T0) / MIN).toBeCloseTo(7, 6);
    expect(r.state.worker!.stats.energy).toBeCloseTo(10 + 7 * 12, 6);
    expect(r.state.worker!.activity).toBe('working');
  });

  it('coffee pulled off a hard part goes back to being stuck on it', () => {
    const state = working({ hardParts: [part(0.01)] });
    const hit = run(state, 30, (e) => e.type === 'hard-part-hit').state;
    const sent = act(hit, { type: 'coffee' }, hit.lastTickAt).state;
    const back = run(sent, 8, (e) => e.type === 'coffee-done').state;
    expect(back.worker!.activity).toBe('stuck');
    expect(back.project!.stuckOn).toBe(0);
  });

  it('ask for coffee once when energy drops below 50', () => {
    const state = patchStats(working(), { energy: 50.2 });
    const r = run(state, 4);
    expect(types(r.events).filter((t) => t === 'wants-coffee')).toHaveLength(1);
    expect(r.state.worker!.wantsCoffeeSince).toBeDefined();
  });

  it('go anyway 5 minutes after asking, whatever their mood', () => {
    const state = patchStats(working(), { energy: 49, mood: 90 });
    const r = run(state, 10, (e) => e.type === 'took-coffee-anyway');
    const asked = r.events.find((t) => t.event.type === 'wants-coffee')!.at;
    const went = r.events.find((t) => t.event.type === 'took-coffee-anyway')!.at;
    expect((went - asked) / MIN).toBeCloseTo(5, 6);
    expect(r.state.worker!.activity).toBe('coffee');
    expect(r.state.worker!.ledger.coffees).toBe(0);
  });

  it('take a break of their own after 60 / stamina work minutes', () => {
    const state = working({ difficulty: 5, hardParts: [] }, {
      level: 'lead',
      traits: { stamina: 1.2, resilience: 1, talent: 1 },
    });
    const r = run(state, 60, (e) => e.type === 'took-break');
    expect(types(r.events)).toEqual(['took-break']);
    expect((r.now - T0) / MIN).toBeCloseTo(50, 6);
    expect(r.state.worker!.activity).toBe('coffee');
    expect(r.state.worker!.minutesSinceBreak).toBe(0);
    expect(r.state.worker!.ledger.coffees).toBe(0);
  });

  it('only count working and stuck minutes towards a break', () => {
    const idle = run(hired(), 90).state.worker!;
    expect(idle.minutesSinceBreak).toBe(0);
    const asleep = patchWorker(working(), { activity: 'asleep', minutesSinceBreak: 10 });
    expect(run(asleep, 30).state.worker!.minutesSinceBreak).toBe(10);
  });

  it('scared workers never dare take a break', () => {
    const state = working();
    const ledger = { ...state.worker!.ledger, shocks: 3 };
    const scared = patchWorker(patchStats(state, { energy: 49 }), {
      ledger,
      attitude: 'scared',
      minutesSinceBreak: 59,
    });
    const r = run(scared, 30);
    expect(types(r.events)).toContain('wants-coffee');
    expect(types(r.events)).not.toContain('took-coffee-anyway');
    expect(types(r.events)).not.toContain('took-break');
    expect(r.state.worker!.minutesSinceBreak).toBeCloseTo(89, 6);
  });

  it('copes with saves from before breaks and sabotage', () => {
    const state = working();
    const old = structuredClone(state) as unknown as {
      worker: Record<string, unknown> & { ledger: Record<string, unknown> };
    };
    delete old.worker.minutesSinceBreak;
    delete old.worker.recentSabotages;
    delete old.worker.ledger.sabotages;
    const ticked = run(old as unknown as GameState, 2).state;
    expect(ticked.worker!.minutesSinceBreak).toBeCloseTo(2, 6);
    expect(ticked.worker!.recentSabotages).toEqual([]);
    const broken = act(ticked, { type: 'sabotage' }, ticked.lastTickAt);
    expect(broken.state.worker!.ledger.sabotages).toBe(1);
    expect(broken.events[0]).toEqual({ type: 'code-broken', index: 0 });
  });
});

describe('endings in tick', () => {
  it('lose their mind when sanity hits 0', () => {
    const state = patchStats(working(), { sanity: 0.01, mood: 0 });
    const r = tick(state, T0 + 5000);
    expect(r.events).toContainEqual({ type: 'ending', kind: 'lost-mind' });
    expect(r.state.worker!.activity).toBe('leaving');
    expect(r.state.worker!.ending).toBe('lost-mind');
  });

  function rockBottom(shocks: number): GameState {
    // Stuck on a severity-3 part keeps mood pinned at 0 against the drift.
    const state = working({ difficulty: 5, hardParts: [part(0, 3)] }, {
      level: 'junior',
      traits: { stamina: 1.3, resilience: 1.3, talent: 1 },
    });
    const stuck = patchProject(state, {
      hardPartsHit: [0],
      stuckOn: 0,
      stuckMinutesLeft: 500,
    });
    const ledger = { ...stuck.worker!.ledger, shocks };
    const pinned = patchWorker(stuck, { activity: 'stuck', ledger });
    return patchStats(pinned, { mood: 0, energy: 80 });
  }

  it('rage-quit after 20 minutes at rock bottom', () => {
    const r = run(rockBottom(0), 30, (e) => e.type === 'ending');
    expect(r.events.at(-1)!.event).toEqual({ type: 'ending', kind: 'rage-quit' });
    expect((r.now - T0) / MIN).toBeGreaterThanOrEqual(20 - 1e-6);
    expect((r.now - T0) / MIN).toBeLessThanOrEqual(20.1);
  });

  it('scared workers do not rage-quit', () => {
    const r = run(rockBottom(3), 30);
    expect(r.state.worker!.attitude).toBe('scared');
    expect(types(r.events)).not.toContain('ending');
    expect(r.state.worker!.lowMoodMinutes).toBeGreaterThanOrEqual(29);
  });

  it('the low-mood count resets once mood recovers', () => {
    const recovered = patchStats(working(), { mood: 50 });
    const state = patchWorker(recovered, { lowMoodMinutes: 19 });
    expect(tick(state, T0 + 5000).state.worker!.lowMoodMinutes).toBe(0);
  });
});
