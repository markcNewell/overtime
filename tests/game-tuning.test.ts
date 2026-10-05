/**
 * Whole-project simulations: how long a project takes in real minutes and
 * what a mismatched or abused worker turns out.
 */

import { describe, expect, it } from 'vitest';
import type {
  Candidate,
  Difficulty,
  GameEvent,
  GameState,
  HardPart,
  Level,
  Pitch,
  Settings,
} from '../src/shared/types';
import { act, assign, hire, newGameState, tick } from '../src/game';

const T0 = new Date(2026, 9, 5, 9, 0).getTime();
const MIN = 60_000;
const TICK_MS = 5000;
const DAY_MINUTES = 8 * 60;

const SETTINGS: Settings = {
  alwaysOnTop: true,
  hideFromScreenShare: false,
  claudePath: '',
  model: 'haiku',
  filesDir: '/tmp/overtime',
};

function candidate(level: Level): Candidate {
  return {
    id: 'c1',
    name: 'Pat',
    age: 30,
    pronouns: 'they/them',
    level,
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
}

function hardParts(count: number): HardPart[] {
  return Array.from({ length: count }, (_, i) => ({
    at: (i + 1) / (count + 1),
    severity: 2,
    title: `Part ${i + 1}`,
    detail: 'It breaks',
  }));
}

function pitch(difficulty: Difficulty, parts: number): Pitch {
  return {
    id: 'p1',
    title: 'Toaster Chat',
    tagline: 'Talk to your toast',
    difficulty,
    description: 'A messenger for kitchen appliances.',
    hardParts: hardParts(parts),
  };
}

function startProject(level: Level, difficulty: Difficulty, parts: number): GameState {
  let state = newGameState(SETTINGS, T0);
  state = { ...state, candidates: [candidate(level)] };
  state = hire(state, 'c1', T0);
  state = { ...state, pitches: [pitch(difficulty, parts)] };
  return assign(state, 'p1', T0);
}

interface Run {
  minutes?: number;
  quality?: number;
  grade?: string;
  ending?: string;
  endedAt?: number;
  asleepAt?: number;
  minEnergy: number;
  events: GameEvent[];
}

interface Boss {
  /** How the boss answers a scared worker asking for coffee. */
  answer: 'yes' | 'no' | 'ignore';
  shockEveryMinutes?: number;
  limitMinutes?: number;
  stopOnSleep?: boolean;
}

/**
 * Tick every 5 s until the project ships, an ending starts or the limit
 * passes, reacting to events like a boss would.
 */
function simulate(start: GameState, boss: Boss): Run {
  let state = start;
  const run: Run = { events: [], minEnergy: 100 };
  const limit = T0 + (boss.limitMinutes ?? 12 * 60) * MIN;
  const every = boss.shockEveryMinutes;
  let nextShock = every ? T0 + every * MIN : Infinity;
  for (let now = T0 + TICK_MS; now <= limit; now += TICK_MS) {
    const ticked = tick(state, now);
    state = ticked.state;
    const events = [...ticked.events];
    const asked = events.some((e) => e.type === 'wants-coffee');
    if (asked && boss.answer !== 'ignore') {
      const type = boss.answer === 'yes' ? 'coffee' : 'deny-coffee';
      const r = act(state, { type }, now);
      state = r.state;
      events.push(...r.events);
    }
    if (now >= nextShock) {
      const r = act(state, { type: 'shock' }, now);
      state = r.state;
      events.push(...r.events);
      nextShock += (every ?? 0) * MIN;
    }
    run.events.push(...events);
    run.minEnergy = Math.min(run.minEnergy, state.worker?.stats.energy ?? 100);
    const minutes = (now - T0) / MIN;
    if (events.some((e) => e.type === 'fell-asleep')) run.asleepAt ??= minutes;
    if (boss.stopOnSleep && run.asleepAt !== undefined) return run;
    for (const e of events) {
      if (e.type === 'project-finished') {
        return { ...run, minutes: (now - T0) / MIN, quality: e.quality, grade: e.grade };
      }
      if (e.type === 'ending') {
        return { ...run, ending: e.kind, endedAt: (now - T0) / MIN };
      }
    }
  }
  return run;
}

const PAIRINGS: [Level, Difficulty][] = [
  ['junior', 1],
  ['mid', 3],
  ['senior', 4],
  ['lead', 5],
];

describe('project duration for a sensible pairing', () => {
  for (const [level, difficulty] of PAIRINGS) {
    for (const parts of [2, 3]) {
      it(`${level} on d${difficulty} with ${parts} hard parts takes 1-3.5 h`, () => {
        const run = simulate(startProject(level, difficulty, parts), { answer: 'yes' });
        expect(run.ending).toBeUndefined();
        expect(run.minutes).toBeGreaterThanOrEqual(60);
        expect(run.minutes).toBeLessThanOrEqual(210);
        // A coffee run every 20-30 minutes keeps them going.
        const breaks = run.events.filter((e) => e.type === 'took-break');
        expect(breaks.length).toBeGreaterThan(1);
        expect(run.minEnergy).toBeGreaterThan(50);
        expect(run.asleepAt).toBeUndefined();
      });
    }
  }
});

describe('the mismatch', () => {
  it('a junior on difficulty 5 ships much worse work', () => {
    const good = simulate(startProject('junior', 1, 3), { answer: 'yes' });
    const bad = simulate(startProject('junior', 5, 3), { answer: 'ignore' });
    expect(bad.ending).toBeUndefined();
    expect(bad.quality).toBeDefined();
    expect(good.quality! - bad.quality!).toBeGreaterThan(0.2);
    expect(bad.grade).not.toBe(good.grade);
  });

  it('a junior on difficulty 5 shocked every few minutes ends within a day', () => {
    const run = simulate(startProject('junior', 5, 3), {
      answer: 'ignore',
      shockEveryMinutes: 3,
      limitMinutes: DAY_MINUTES,
    });
    expect(run.ending).toBeDefined();
    expect(run.endedAt).toBeLessThanOrEqual(DAY_MINUTES);
  });
});

describe('a scared worker', () => {
  function scared(): GameState {
    const state = startProject('lead', 5, 3);
    const worker = state.worker!;
    const ledger = { ...worker.ledger, shocks: 3 };
    return { ...state, worker: { ...worker, ledger, attitude: 'scared' } };
  }

  it('always denied coffee runs down and falls asleep within a few hours', () => {
    const run = simulate(scared(), { answer: 'no', stopOnSleep: true });
    expect(run.asleepAt).toBeDefined();
    expect(run.asleepAt).toBeLessThanOrEqual(4 * 60);
    expect(run.events.filter((e) => e.type === 'coffee-done')).toEqual([]);
  });

  it('ignored, they go anyway and keep their energy up', () => {
    const run = simulate(scared(), { answer: 'ignore' });
    expect(run.minutes).toBeDefined();
    expect(run.events.map((e) => e.type)).toContain('took-coffee-anyway');
    expect(run.events.map((e) => e.type)).not.toContain('took-break');
    expect(run.minEnergy).toBeGreaterThan(50);
  });
});
