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
  rng?: () => number,
): { state: GameState; events: Timed[]; now: number } {
  let state = start;
  const events: Timed[] = [];
  const end = start.lastTickAt + minutes * MIN;
  let now = start.lastTickAt;
  while (now < end) {
    now += 5000;
    const r = tick(state, now, rng);
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
    // No coffee runs, so the stuck timer isn't paused part-way.
    const state = patchWorker(working({ hardParts: [part(0.6), part(0.3)] }), {
      coffeeTimer: 1000,
    });
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

  it('a coffee run: 2 minutes at the machine, then 5 sipping at the desk', () => {
    const tired = patchStats(working(), { energy: 10 });
    const sent = act(tired, { type: 'coffee' }, T0).state;
    expect(sent.worker!.activity).toBe('coffee');

    const made = run(sent, 3, (e) => e.type === 'coffee-done', () => 0);
    expect(types(made.events)).toEqual(['coffee-done']);
    expect((made.now - T0) / MIN).toBeCloseTo(2, 6);
    const back = made.state.worker!;
    expect(back.stats.energy).toBeCloseTo(10 + 2 * 4, 6);
    expect(back.activity).toBe('working');
    expect(back.drinkingFor).toBe(5);
    expect(back.coffeeTimer).toBe(20);
    expect(made.state.project!.progress).toBe(0);

    const sipped = run(made.state, 5);
    const w = sipped.state.worker!;
    expect(w.drinkingFor).toBeUndefined();
    expect(w.activity).toBe('working');
    // +8 a minute from the mug, less the usual 0.54 a minute of work.
    expect(w.stats.energy).toBeCloseTo(18 + 5 * (8 - 0.54), 6);
    expect(w.stats.mood).toBeGreaterThan(back.stats.mood);
    expect(sipped.state.project!.progress).toBeGreaterThan(0);
  });

  it('coffee pulled off a hard part goes back to being stuck on it', () => {
    const state = working({ hardParts: [part(0.01)] });
    const hit = run(state, 30, (e) => e.type === 'hard-part-hit').state;
    const sent = act(hit, { type: 'coffee' }, hit.lastTickAt).state;
    const back = run(sent, 8, (e) => e.type === 'coffee-done').state;
    expect(back.worker!.activity).toBe('stuck');
    expect(back.project!.stuckOn).toBe(0);
  });
});

describe('the coffee timer', () => {
  /** Hired with this rng and already sat at the desk, nothing to do. */
  function settled(rng: number, patch: Partial<Worker> = {}): GameState {
    const empty = newGameState(SETTINGS, T0);
    const state = hire({ ...empty, candidates: [candidate()] }, 'c1', T0, () => rng);
    return patchWorker(state, { activity: 'idle', ...patch });
  }

  it('goes off 20-30 desk minutes after hiring, and they just go', () => {
    for (const [rng, minutes] of [[0, 20], [0.5, 25], [0.99, 29.9]] as const) {
      const r = run(settled(rng), 40, (e) => e.type === 'took-break');
      expect((r.now - T0) / MIN).toBeCloseTo(minutes, 1);
      expect(types(r.events)).toEqual(['took-break']);
      expect(r.state.worker!.activity).toBe('coffee');
      expect(r.state.worker!.ledger.coffees).toBe(0);
    }
  });

  it('restarts at 20-30 minutes when they sit back down with the mug', () => {
    const start = settled(0.5, { coffeeTimer: 0.01 });
    const r = run(start, 5, (e) => e.type === 'coffee-done', () => 0.3);
    expect(r.state.worker!.coffeeTimer).toBeCloseTo(23, 9);
  });

  it('is paused while asleep, making coffee or arriving', () => {
    for (const activity of ['asleep', 'arriving'] as const) {
      // activitySince in the future keeps an arrival from finishing.
      const since = T0 + 60 * MIN;
      const state = settled(0.5, { activity, coffeeTimer: 10, activitySince: since });
      expect(run(state, 30).state.worker!.coffeeTimer).toBe(10);
    }
    const making = act(settled(0.5, { coffeeTimer: 7 }), { type: 'coffee' }, T0).state;
    const halfway = run(making, 1).state.worker!;
    expect(halfway.activity).toBe('coffee');
    expect(halfway.coffeeTimer).toBe(7);
  });

  it('does not count time the app was closed', () => {
    const state = settled(0.5);
    const later = tick(state, T0 + 3 * 60 * MIN).state;
    expect(later.worker!.coffeeTimer).toBeCloseTo(24, 9);
  });

  it('scared workers ask three times, 3.5 minutes apart, then go anyway', () => {
    const state = settled(0.5, { coffeeTimer: 1 });
    const ledger = { ...state.worker!.ledger, shocks: 3 };
    const scared = patchWorker(state, { ledger, attitude: 'scared' });
    const r = run(scared, 20, (e) => e.type === 'took-coffee-anyway');
    const minutes = (type: string): number[] =>
      r.events.filter((t) => t.event.type === type).map((t) => (t.at - T0) / MIN);

    const wants = r.events.filter((t) => t.event.type === 'wants-coffee');
    const expected = [1, 2, 3].map((attempt) => ({ type: 'wants-coffee', attempt }));
    expect(wants.map((t) => t.event)).toEqual(expected);
    const asks = minutes('wants-coffee');
    expect(asks[0]).toBeCloseTo(1, 6);
    expect(asks[1]).toBeCloseTo(4.5, 6);
    expect(asks[2]).toBeCloseTo(8, 6);
    expect(minutes('took-coffee-anyway')[0]).toBeCloseTo(11.5, 6);
    expect(types(r.events)).not.toContain('took-break');

    const w = r.state.worker!;
    expect(w.activity).toBe('coffee');
    expect(w.wantsCoffeeSince).toBeUndefined();
    expect(w.coffeeAsks).toBeUndefined();
    expect(w.nextAskIn).toBeUndefined();
  });

  it('keeps one ask open while they work up the courage', () => {
    const state = settled(0.5, { coffeeTimer: 1, attitude: 'scared' });
    const ledger = { ...state.worker!.ledger, shocks: 3 };
    const r = run(patchWorker(state, { ledger }), 6);
    const w = r.state.worker!;
    expect(w.wantsCoffeeSince).toBe(T0 + MIN);
    expect(w.coffeeAsks).toBe(2);
    expect(w.nextAskIn).toBeCloseTo(2, 6);
    expect(w.coffeeTimer).toBe(0);
  });

  it('copes with saves from before the timer, sabotage and denials', () => {
    const state = working();
    const old = structuredClone(state) as unknown as {
      worker: Record<string, unknown> & { ledger: Record<string, unknown> };
    };
    delete old.worker.coffeeTimer;
    delete old.worker.recentSabotages;
    delete old.worker.ledger.sabotages;
    delete old.worker.ledger.coffeeDenials;
    const ticked = run(old as unknown as GameState, 2).state;
    expect(ticked.worker!.coffeeTimer).toBeCloseTo(23, 6);
    expect(ticked.worker!.recentSabotages).toEqual([]);
    const broken = act(ticked, { type: 'sabotage' }, ticked.lastTickAt);
    expect(broken.state.worker!.ledger.sabotages).toBe(1);
    expect(broken.events[0]).toEqual({ type: 'code-broken', index: 0 });

    const asking = patchWorker(ticked, { wantsCoffeeSince: T0, coffeeAsks: 1 });
    const denied = act(asking, { type: 'deny-coffee' }, ticked.lastTickAt);
    expect(denied.state.worker!.ledger.coffeeDenials).toBe(1);
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
