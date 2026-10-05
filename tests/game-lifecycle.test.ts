/** Hiring, assigning, endings, going home and the small helpers. */

import { describe, expect, it } from 'vitest';
import type {
  Candidate,
  GameState,
  HardPart,
  Memory,
  Pitch,
  Settings,
  Worker,
} from '../src/shared/types';
import {
  addMemory,
  ARRIVE_MS,
  assign,
  AWAY_MINUTES,
  beginEnding,
  capacity,
  describeCondition,
  goHome,
  grade,
  hire,
  levelFor,
  newGameState,
  projectQuality,
  retire,
  setBubble,
  todayKey,
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

function candidate(id: string, patch: Partial<Candidate> = {}): Candidate {
  return {
    id,
    name: 'Pat',
    age: 30,
    pronouns: 'they/them',
    level: 'senior',
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

function part(at: number, title: string): HardPart {
  return { at, severity: 2, title, detail: 'It breaks' };
}

function pitch(id: string): Pitch {
  return {
    id,
    title: `Project ${id}`,
    tagline: 'Pointless',
    difficulty: 3,
    description: 'Does nothing, slowly.',
    hardParts: [part(0.7, 'Late'), part(0.2, 'Early')],
  };
}

function shortlist(): GameState {
  const state = newGameState(SETTINGS, T0);
  return { ...state, candidates: [candidate('c1'), candidate('c2', { name: 'Sam' })] };
}

function hiredWith(patch: Partial<Worker> = {}): GameState {
  const state = hire(shortlist(), 'c2', T0);
  return { ...state, worker: { ...state.worker!, activity: 'idle', ...patch } };
}

describe('newGameState', () => {
  it('starts an empty office', () => {
    const state = newGameState(SETTINGS, T0);
    expect(state).toMatchObject({
      version: 1,
      pitches: [],
      candidates: [],
      pastWorkers: [],
      deskLeftovers: [],
      releases: [],
      chat: [],
      lastTickAt: T0,
      settings: SETTINGS,
    });
    expect(state.worker).toBeUndefined();
  });
});

describe('hire', () => {
  it('turns the candidate into a fresh worker who is arriving', () => {
    const state = hire(shortlist(), 'c2', T0);
    const w = state.worker!;
    expect(w).toMatchObject({
      id: 'c2',
      name: 'Sam',
      level: 'senior',
      hiredAt: T0,
      stats: { energy: 100, mood: 70, sanity: 100 },
      xp: xpFor('senior'),
      attitude: 'neutral',
      projectsDone: 0,
      activity: 'arriving',
      activitySince: T0,
      recentShocks: [],
      recentPraises: [],
      recentSabotages: [],
      minutesSinceBreak: 0,
      lowMoodMinutes: 0,
    });
    expect(Object.values(w.ledger).every((n) => n === 0)).toBe(true);
    expect(state.candidates).toEqual([]);
  });

  it('finds what the last worker left on the desk', () => {
    const from = 'Dave';
    const state: GameState = {
      ...shortlist(),
      deskLeftovers: [
        { kind: 'mug', text: "World's okayest dev", fromWorker: from },
        { kind: 'sticky-note', text: 'Never trust the toaster', fromWorker: from },
        {
          kind: 'half-finished-project',
          text: 'Toaster Chat, 40% done',
          fromWorker: from,
        },
      ],
    };
    const next = hire(state, 'c1', T0);
    const memories = next.worker!.memories;
    expect(memories.every((m) => m.kind === 'desk' && m.at === T0)).toBe(true);
    expect(memories.map((m) => m.text)).toEqual([
      "Found a mug on the desk from Dave: 'World's okayest dev'",
      "Found a sticky note from Dave: 'Never trust the toaster'",
      "Found Dave's half-finished project: Toaster Chat, 40% done",
    ]);
    expect(next.deskLeftovers).toEqual(state.deskLeftovers);
  });

  it('throws for an unknown candidate or a taken desk', () => {
    expect(() => hire(shortlist(), 'nobody', T0)).toThrow();
    const taken = { ...hiredWith(), candidates: [candidate('c3')] };
    expect(() => hire(taken, 'c3', T0)).toThrow();
  });
});

describe('assign', () => {
  function offered(patch: Partial<Worker> = {}): GameState {
    return { ...hiredWith(patch), pitches: [pitch('a'), pitch('b'), pitch('c')] };
  }

  it('starts the project with its hard parts in order and clears the pitches', () => {
    const state = assign(offered(), 'b', T0 + MIN);
    expect(state.project).toMatchObject({
      id: 'b',
      title: 'Project b',
      startedAt: T0 + MIN,
      progress: 0,
      workMinutes: 0,
      qualitySum: 0,
      hardPartsHit: [],
    });
    expect(state.project!.hardParts.map((p) => p.title)).toEqual(['Early', 'Late']);
    expect(state.pitches).toEqual([]);
    expect(state.worker!.activity).toBe('working');
  });

  it('uses an edited hard-parts list when given one', () => {
    const edited = [part(0.9, 'Edited late'), part(0.5, 'Edited middle')];
    const state = assign(offered(), 'a', T0, edited);
    const titles = state.project!.hardParts.map((p) => p.title);
    expect(titles).toEqual(['Edited middle', 'Edited late']);
    expect(edited[0]!.title).toBe('Edited late');
  });

  it('leaves someone away from the desk to pick it up later', () => {
    for (const activity of ['arriving', 'coffee', 'asleep'] as const) {
      const state = assign(offered({ activity }), 'a', T0);
      expect(state.worker!.activity).toBe(activity);
    }
  });

  it('throws for a pitch that is not on offer', () => {
    expect(() => assign(offered(), 'zzz', T0)).toThrow();
  });
});

describe('beginEnding', () => {
  it('sets the ending once', () => {
    const first = beginEnding(hiredWith(), 'rage-quit', T0);
    expect(first.events).toEqual([{ type: 'ending', kind: 'rage-quit' }]);
    expect(first.state.worker).toMatchObject({
      ending: 'rage-quit',
      activity: 'leaving',
    });

    const again = beginEnding(first.state, 'fired', T0 + MIN);
    expect(again.events).toEqual([]);
    expect(again.state.worker!.ending).toBe('rage-quit');
  });
});

describe('retire', () => {
  const farewell = {
    lastWords: 'Tell my plant',
    stickyNote: 'Run',
    mugText: 'Ctrl+Z my life',
  };

  it('archives the worker and leaves a mug, a note and the unfinished project', () => {
    let state = assign({ ...hiredWith(), pitches: [pitch('a')] }, 'a', T0);
    state = { ...state, project: { ...state.project!, progress: 0.427 } };
    state = setBubble(state, 'Bye', 'say', T0);
    state = beginEnding(state, 'lost-mind', T0).state;
    const next = retire(state, T0 + MIN, farewell);

    expect(next.worker).toBeUndefined();
    expect(next.project).toBeUndefined();
    expect(next.bubble).toBeUndefined();
    expect(next.pitches).toEqual([]);
    expect(next.pastWorkers).toEqual([
      {
        id: 'c2',
        name: 'Sam',
        level: 'senior',
        hiredAt: T0,
        endedAt: T0 + MIN,
        ending: 'lost-mind',
        projectsDone: 0,
        lastWords: 'Tell my plant',
      },
    ]);
    expect(next.deskLeftovers).toEqual([
      { kind: 'mug', text: 'Ctrl+Z my life', fromWorker: 'Sam' },
      { kind: 'sticky-note', text: 'Run', fromWorker: 'Sam' },
      { kind: 'half-finished-project', text: 'Project a, 42% done', fromWorker: 'Sam' },
    ]);
  });

  it('leaves just the mug and note when nothing was in progress', () => {
    const state = beginEnding(hiredWith(), 'fired', T0).state;
    const next = retire(state, T0, farewell);
    expect(next.deskLeftovers.map((l) => l.kind)).toEqual(['mug', 'sticky-note']);
  });

  it('the next hire inherits the leftovers as memories', () => {
    const gone = retire(beginEnding(hiredWith(), 'fired', T0).state, T0, farewell);
    const next = hire({ ...gone, candidates: [candidate('c9')] }, 'c9', T0 + MIN);
    expect(next.worker!.memories.map((m) => m.text)).toEqual([
      "Found a mug on the desk from Sam: 'Ctrl+Z my life'",
      "Found a sticky note from Sam: 'Run'",
    ]);
  });
});

describe('goHome', () => {
  it('rests them, clears breaks and boosts, and wakes them', () => {
    const tired = hiredWith({
      activity: 'asleep',
      stats: { energy: 10, mood: 15, sanity: 40 },
      boost: { multiplier: 1.3, until: T0 + 5 * MIN },
      wantsCoffeeSince: T0 - MIN,
      minutesSinceBreak: 50,
    });
    const later = T0 + 14 * 60 * MIN;
    const state = goHome(tired, later);
    const w = state.worker!;
    expect(w.stats.energy).toBe(70);
    expect(w.stats.mood).toBeCloseTo(15 + (55 - 15) * 0.3, 6);
    expect(w.stats.sanity).toBe(45);
    expect(w.boost).toBeUndefined();
    expect(w.wantsCoffeeSince).toBeUndefined();
    expect(w.minutesSinceBreak).toBe(0);
    expect(w.activity).toBe('idle');
    expect(state.lastTickAt).toBe(later);
  });

  it('ends a coffee break and puts them back on the project', () => {
    let state = assign({ ...hiredWith(), pitches: [pitch('a')] }, 'a', T0);
    const worker: Worker = {
      ...state.worker!,
      activity: 'coffee',
      coffeeUntil: T0 + MIN,
    };
    state = { ...state, worker };
    const w = goHome(state, T0 + 60 * MIN).worker!;
    expect(w.activity).toBe('working');
    expect(w.coffeeUntil).toBeUndefined();
    expect(w.stats.energy).toBe(100);
  });

  it('does nothing without a worker or while leaving', () => {
    const empty = newGameState(SETTINGS, T0);
    expect(goHome(empty, T0 + 60 * MIN)).toEqual(empty);
    const leaving = beginEnding(hiredWith(), 'fired', T0).state;
    expect(goHome(leaving, T0 + 60 * MIN)).toEqual(leaving);
  });

  it('exports the thresholds the app needs', () => {
    expect(AWAY_MINUTES).toBe(30);
    expect(ARRIVE_MS).toBe(6000);
  });
});

describe('bubbles and memories', () => {
  it('shows a bubble for 5-12 s depending on length', () => {
    const state = hiredWith();
    expect(setBubble(state, 'Hi', 'say', T0).bubble).toEqual({
      text: 'Hi',
      kind: 'say',
      until: T0 + 5000,
    });
    expect(setBubble(state, 'x'.repeat(100), 'think', T0).bubble!.until).toBe(T0 + 9000);
    expect(setBubble(state, 'x'.repeat(500), 'think', T0).bubble!.until).toBe(T0 + 12000);
  });

  it('keeps the newest 40 memories without mutating the worker', () => {
    const worker = hiredWith().worker!;
    let w = worker;
    for (let i = 0; i < 45; i++) {
      const memory: Memory = { at: T0 + i, kind: 'self', text: `Thought ${i}` };
      w = addMemory(w, memory);
    }
    expect(w.memories).toHaveLength(40);
    expect(w.memories[0]!.text).toBe('Thought 5');
    expect(w.memories.at(-1)!.text).toBe('Thought 44');
    expect(worker.memories).toEqual([]);
  });
});

describe('levels and grades', () => {
  it('capacity, thresholds and levels line up', () => {
    const levels = ['junior', 'mid', 'senior', 'lead'] as const;
    expect(levels.map((level) => capacity(level))).toEqual([2, 3, 4, 5]);
    expect(xpFor('mid')).toBe(40);
    expect(xpFor('senior')).toBe(120);
    expect(xpFor('lead')).toBe(260);
    expect(levelFor(0)).toBe('junior');
    expect(levelFor(39.9)).toBe('junior');
    expect(levelFor(40)).toBe('mid');
    expect(levelFor(259)).toBe('senior');
    expect(levelFor(1000)).toBe('lead');
  });

  it('grades quality', () => {
    expect(grade(0.8)).toBe('Masterpiece');
    expect(grade(0.79)).toBe('Solid');
    expect(grade(0.5)).toBe('Buggy');
    expect(grade(0.35)).toBe('Barely compiles');
    expect(grade(0.2)).toBe('Cursed garbage');
  });

  it('projectQuality averages the minutes', () => {
    const state = assign({ ...hiredWith(), pitches: [pitch('a')] }, 'a', T0);
    expect(projectQuality(state.project!)).toBe(0);
    const worked = { ...state.project!, workMinutes: 10, qualitySum: 6 };
    expect(projectQuality(worked)).toBeCloseTo(0.6);
  });
});

describe('describeCondition', () => {
  it('is empty with nobody hired', () => {
    expect(describeCondition(newGameState(SETTINGS, T0))).toEqual([]);
  });

  it('puts a struggling worker into words', () => {
    let state = assign({ ...hiredWith(), pitches: [pitch('a')] }, 'a', T0);
    state = {
      ...state,
      project: { ...state.project!, difficulty: 5, stuckOn: 0, hardPartsHit: [0] },
      worker: {
        ...state.worker!,
        activity: 'stuck',
        stats: { energy: 20, mood: 5, sanity: 10 },
        attitude: 'scared',
      },
    };
    expect(describeCondition(state)).toEqual([
      'exhausted',
      'miserable',
      'barely holding it together',
      'stuck on: Early',
      'out of their depth',
      'terrified of the boss',
    ]);
  });

  it('says little about a happy idle worker', () => {
    const state = hiredWith({
      stats: { energy: 95, mood: 85, sanity: 100 },
      attitude: 'loyal',
    });
    expect(describeCondition(state)).toEqual([
      'full of energy',
      'in a great mood',
      'nothing to work on',
      'loyal to the boss',
    ]);
  });
});

describe('todayKey', () => {
  it('uses the local calendar day', () => {
    expect(todayKey(new Date(2026, 0, 2, 23, 59).getTime())).toBe('2026-01-02');
    expect(todayKey(new Date(2026, 0, 3, 0, 1).getTime())).toBe('2026-01-03');
  });
});
