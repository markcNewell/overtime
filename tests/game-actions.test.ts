/** act: the boss's actions, their refusals and the attitude they build. */

import { describe, expect, it } from 'vitest';
import type {
  BossAction,
  Candidate,
  GameEvent,
  GameState,
  Ledger,
  Pitch,
  Settings,
  Worker,
} from '../src/shared/types';
import {
  act,
  assign,
  deriveAttitude,
  hire,
  newGameState,
  tick,
  todayKey,
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

const PITCH: Pitch = {
  id: 'p1',
  title: 'Toaster Chat',
  tagline: 'Talk to your toast',
  difficulty: 3,
  description: 'A messenger for kitchen appliances.',
  hardParts: [],
};

/** Pat at the desk working on Toaster Chat, mood 50 so changes show both ways. */
function office(patch: Partial<Worker> = {}): GameState {
  const empty = newGameState(SETTINGS, T0);
  let state = hire({ ...empty, candidates: [CANDIDATE] }, 'c1', T0);
  state = assign({ ...state, pitches: [PITCH] }, 'p1', T0);
  const worker = state.worker!;
  return {
    ...state,
    worker: {
      ...worker,
      activity: 'working',
      stats: { energy: 60, mood: 50, sanity: 80 },
      ...patch,
    },
  };
}

/** Apply actions in order, `gapMs` apart, collecting every event. */
function doAll(
  start: GameState,
  actions: BossAction[],
  gapMs = 0,
  from = T0,
): { state: GameState; events: GameEvent[] } {
  let state = start;
  const events: GameEvent[] = [];
  actions.forEach((action, i) => {
    const r = act(state, action, from + i * gapMs);
    state = r.state;
    events.push(...r.events);
  });
  return { state, events };
}

function ledger(patch: Partial<Ledger>): Ledger {
  return {
    shocks: 0,
    shouts: 0,
    praises: 0,
    bonuses: 0,
    kindChats: 0,
    cruelChats: 0,
    coffees: 0,
    ...patch,
  };
}

const STATS = { energy: 50, mood: 50, sanity: 50 };

describe('refusals', () => {
  it('refuses everything with nobody hired', () => {
    const r = act(newGameState(SETTINGS, T0), { type: 'praise' }, T0);
    expect(r.events).toEqual([
      { type: 'action-refused', action: 'praise', reason: 'Nobody works here' },
    ]);
  });

  it('refuses everything while they are leaving', () => {
    const leaving = office({ activity: 'leaving', ending: 'fired' });
    for (const type of ['shock', 'praise', 'coffee', 'bonus', 'fire'] as const) {
      const r = act(leaving, { type }, T0);
      expect(r.events).toHaveLength(1);
      expect(r.events[0]).toMatchObject({ type: 'action-refused', action: type });
      expect(r.state).toEqual(leaving);
    }
  });

  it('refuses coffee while on coffee or arriving', () => {
    const onCoffee = act(office(), { type: 'coffee' }, T0).state;
    const again = act(onCoffee, { type: 'coffee' }, T0 + MIN);
    expect(again.events).toEqual([
      { type: 'action-refused', action: 'coffee', reason: 'Already on a coffee break' },
    ]);
    expect(again.state.worker!.ledger.coffees).toBe(1);

    const arriving = office({ activity: 'arriving' });
    expect(act(arriving, { type: 'coffee' }, T0).events[0]).toMatchObject({
      type: 'action-refused',
      reason: 'Still arriving',
    });
  });
});

describe('shock', () => {
  it('boosts speed, hurts mood and sanity, and is counted', () => {
    const r = act(office(), { type: 'shock' }, T0);
    const w = r.state.worker!;
    expect(w.boost).toEqual({ multiplier: 1.8, until: T0 + 10 * MIN });
    expect(w.stats).toMatchObject({ mood: 40, sanity: 77 });
    expect(w.ledger.shocks).toBe(1);
    expect(w.recentShocks).toEqual([T0]);
  });

  it('warns from the 4th shock in 10 minutes and fries at the 6th', () => {
    const shocks = Array<BossAction>(6).fill({ type: 'shock' });
    const r = doAll(office(), shocks, MIN);
    const kinds = r.events
      .filter((e) => e.type !== 'attitude-changed')
      .map((e) => e.type);
    expect(kinds).toEqual(['shock-warning', 'shock-warning', 'ending']);
    expect(r.events.at(-1)).toEqual({ type: 'ending', kind: 'fried' });
    expect(r.state.worker!.activity).toBe('leaving');
  });

  it('spread-out shocks never fry', () => {
    const shocks = Array<BossAction>(8).fill({ type: 'shock' });
    const calm = office({ stats: { energy: 60, mood: 100, sanity: 100 } });
    const r = doAll(calm, shocks, 3 * MIN);
    expect(r.events.map((e) => e.type)).not.toContain('ending');
    expect(r.events.map((e) => e.type)).toContain('shock-warning');
  });

  it('drags them out of a coffee break', () => {
    const onCoffee = act(office(), { type: 'coffee' }, T0).state;
    const r = act(onCoffee, { type: 'shock' }, T0 + MIN);
    expect(r.state.worker!.activity).toBe('working');
    expect(r.state.worker!.coffeeUntil).toBeUndefined();
  });

  it('a later shout does not cut a shock boost short', () => {
    const r = doAll(office(), [{ type: 'shock' }, { type: 'shout' }], MIN);
    expect(r.state.worker!.boost).toEqual({ multiplier: 1.8, until: T0 + 10 * MIN });
  });
});

describe('the other actions', () => {
  it('shout: small boost, mood -6, sanity -1', () => {
    const w = act(office(), { type: 'shout' }, T0).state.worker!;
    expect(w.boost).toEqual({ multiplier: 1.3, until: T0 + 5 * MIN });
    expect(w.stats).toMatchObject({ mood: 44, sanity: 79 });
    expect(w.ledger.shouts).toBe(1);
  });

  it('praise halves for each praise in the last 30 minutes', () => {
    const praises = Array<BossAction>(4).fill({ type: 'praise' });
    const r = doAll(office(), praises, MIN);
    expect(r.state.worker!.stats.mood).toBeCloseTo(50 + 8 + 4 + 2 + 1, 6);
    expect(r.state.worker!.ledger.praises).toBe(4);

    const fresh = act(r.state, { type: 'praise' }, T0 + 40 * MIN).state;
    expect(fresh.worker!.stats.mood).toBeCloseTo(65 + 8, 6);
    expect(fresh.worker!.recentPraises).toEqual([T0 + 40 * MIN]);
  });

  it('bonus once per local calendar day', () => {
    const first = act(office(), { type: 'bonus' }, T0);
    expect(first.state.worker!.stats).toMatchObject({ mood: 75, sanity: 90 });
    expect(first.state.worker!.lastBonusDay).toBe(todayKey(T0));

    const evening = act(first.state, { type: 'bonus' }, T0 + 10 * 60 * MIN);
    expect(evening.events).toEqual([
      { type: 'action-refused', action: 'bonus', reason: 'Already had a bonus today' },
    ]);
    expect(evening.state.worker!.ledger.bonuses).toBe(1);

    const tomorrow = new Date(2026, 9, 6, 9, 0).getTime();
    const next = act(first.state, { type: 'bonus' }, tomorrow);
    expect(next.state.worker!.ledger.bonuses).toBe(2);
  });

  it('coffee starts a 6-minute break with a mood lift', () => {
    const tired = office({ wantsCoffeeSince: T0 - MIN });
    const w = act(tired, { type: 'coffee' }, T0).state.worker!;
    expect(w.activity).toBe('coffee');
    expect(w.coffeeUntil).toBe(T0 + 6 * MIN);
    expect(w.stats.mood).toBe(53);
    expect(w.wantsCoffeeSince).toBeUndefined();
    expect(w.ledger.coffees).toBe(1);
  });

  it('coffee wakes a sleeper', () => {
    const w = act(office({ activity: 'asleep' }), { type: 'coffee' }, T0).state.worker!;
    expect(w.activity).toBe('coffee');
  });

  it('chat applies the tone', () => {
    const kind = act(office(), { type: 'chat', tone: 'kind' }, T0).state.worker!;
    expect(kind.stats.mood).toBe(54);
    expect(kind.ledger.kindChats).toBe(1);

    const cruel = act(office(), { type: 'chat', tone: 'cruel' }, T0).state.worker!;
    expect(cruel.stats).toMatchObject({ mood: 44, sanity: 79 });
    expect(cruel.ledger.cruelChats).toBe(1);

    const plain = act(office(), { type: 'chat', tone: 'neutral' }, T0);
    expect(plain.state.worker).toEqual(office().worker);
    expect(plain.events).toEqual([]);
  });

  it('fire starts the fired ending', () => {
    const r = act(office(), { type: 'fire' }, T0);
    expect(r.events).toEqual([{ type: 'ending', kind: 'fired' }]);
    expect(r.state.worker).toMatchObject({ activity: 'leaving', ending: 'fired' });
  });

  it('never mutates its input', () => {
    const actions: BossAction[] = [
      { type: 'shock' },
      { type: 'shout' },
      { type: 'praise' },
      { type: 'coffee' },
      { type: 'bonus' },
      { type: 'chat', tone: 'cruel' },
      { type: 'fire' },
    ];
    for (const action of actions) {
      const state = office({ activity: 'asleep' });
      const before = structuredClone(state);
      act(state, action, T0);
      expect(state).toEqual(before);
    }
  });

  it('drops shock and praise times older than 30 minutes', () => {
    const old = office({ recentShocks: [T0 - 40 * MIN], recentPraises: [T0 - 31 * MIN] });
    const w = act(old, { type: 'chat', tone: 'kind' }, T0).state.worker!;
    expect(w.recentShocks).toEqual([]);
    expect(w.recentPraises).toEqual([]);
  });
});

describe('attitude', () => {
  it('starts neutral', () => {
    expect(deriveAttitude(ledger({}), STATS)).toBe('neutral');
  });

  it('scared when fear dominates', () => {
    expect(deriveAttitude(ledger({ shocks: 2 }), STATS)).toBe('scared');
    // Warmth can outweigh it ...
    expect(deriveAttitude(ledger({ shocks: 2, praises: 3 }), STATS)).not.toBe('scared');
    // ... and so can matching cruelty: shouts are fear and cruelty at once.
    expect(deriveAttitude(ledger({ shouts: 5 }), { ...STATS, mood: 60 })).toBe('neutral');
  });

  it('bitter when harmed and unhappy', () => {
    const cruel = ledger({ cruelChats: 2 });
    expect(deriveAttitude(cruel, { ...STATS, mood: 30 })).toBe('bitter');
    expect(deriveAttitude(cruel, { ...STATS, mood: 40 })).toBe('neutral');
  });

  it('loyal when treated warmly', () => {
    expect(deriveAttitude(ledger({ praises: 3, kindChats: 2 }), STATS)).toBe('loyal');
    expect(deriveAttitude(ledger({ praises: 4, coffees: 2 }), STATS)).toBe('loyal');
  });

  it('sucking-up when the warmth was mostly bonuses', () => {
    expect(deriveAttitude(ledger({ bonuses: 2 }), STATS)).toBe('sucking-up');
    expect(deriveAttitude(ledger({ bonuses: 1, praises: 3 }), STATS)).toBe('sucking-up');
    expect(deriveAttitude(ledger({ bonuses: 1, praises: 4 }), STATS)).toBe('loyal');
  });

  it('warmth must clearly outweigh the harm', () => {
    expect(deriveAttitude(ledger({ praises: 6, cruelChats: 3 }), STATS)).toBe('neutral');
  });

  it('act reports the change', () => {
    const r = doAll(office(), [{ type: 'shock' }, { type: 'shock' }]);
    expect(r.events).toContainEqual({
      type: 'attitude-changed',
      from: 'neutral',
      to: 'scared',
    });
    expect(r.state.worker!.attitude).toBe('scared');
  });

  it('tick reports a change driven by mood', () => {
    // Cruelty only turns them bitter once mood sinks below 35; tired and
    // overloaded, it drifts down past the line on the first step.
    const state = office({
      ledger: ledger({ cruelChats: 2 }),
      stats: { energy: 15, mood: 35.001, sanity: 80 },
    });
    const project = { ...state.project!, difficulty: 5 as const };
    const overloaded = { ...state, project };
    const r = tick(overloaded, T0 + 5000);
    expect(r.events).toContainEqual({
      type: 'attitude-changed',
      from: 'neutral',
      to: 'bitter',
    });
  });
});
