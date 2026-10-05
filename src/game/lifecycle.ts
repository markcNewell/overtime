/** Starting, hiring, assigning, ending and the small state setters around them. */

import type {
  EndingKind,
  GameEvent,
  GameState,
  HardPart,
  Leftover,
  Memory,
  PastWorker,
  Settings,
  Worker,
} from '../shared/types';
import { clamp } from './formulas';
import { xpFor } from './levels';
import { BUBBLE_MS, HOME, START_STATS } from './tuning';
import {
  nudge,
  pruneRecent,
  refreshAttitude,
  resume,
  startEnding,
  withMemory,
} from './worker';

/**
 * An empty office: nobody hired, nothing on offer.
 *
 * @param settings - The user's settings.
 * @param now - Epoch ms.
 * @returns A fresh state.
 */
export function newGameState(settings: Settings, now: number): GameState {
  return {
    version: 1,
    pitches: [],
    candidates: [],
    pastWorkers: [],
    deskLeftovers: [],
    releases: [],
    complaints: [],
    chat: [],
    lastTickAt: now,
    settings: structuredClone(settings),
    brainStatus: 'ok',
  };
}

/**
 * Hire someone off the shortlist. They walk in and find whatever the last
 * worker left on the desk.
 *
 * @param state - The current state (not changed).
 * @param candidateId - Id of a candidate in `state.candidates`.
 * @param now - Epoch ms.
 * @returns The new state, with the worker arriving and the shortlist cleared.
 * @throws If the candidate isn't on the shortlist or someone already works here.
 */
export function hire(state: GameState, candidateId: string, now: number): GameState {
  const next = structuredClone(state);
  if (next.worker) throw new Error('Someone already works here');
  const candidate = next.candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error(`No candidate with id ${candidateId}`);

  next.worker = {
    ...candidate,
    hiredAt: now,
    stats: { ...START_STATS },
    xp: xpFor(candidate.level),
    ledger: {
      shocks: 0,
      shouts: 0,
      praises: 0,
      bonuses: 0,
      kindChats: 0,
      cruelChats: 0,
      coffees: 0,
      sabotages: 0,
    },
    attitude: 'neutral',
    memories: next.deskLeftovers.map((item) => deskMemory(item, now)),
    projectsDone: 0,
    activity: 'arriving',
    activitySince: now,
    recentShocks: [],
    recentPraises: [],
    recentSabotages: [],
    minutesSinceBreak: 0,
    lowMoodMinutes: 0,
  };
  next.candidates = [];
  return next;
}

function deskMemory(item: Leftover, at: number): Memory {
  const from = item.fromWorker;
  const text =
    item.kind === 'mug'
      ? `Found a mug on the desk from ${from}: '${item.text}'`
      : item.kind === 'sticky-note'
        ? `Found a sticky note from ${from}: '${item.text}'`
        : `Found ${from}'s half-finished project: ${item.text}`;
  return { at, kind: 'desk', text };
}

/**
 * Give the worker one of the pitched projects.
 *
 * @param state - The current state (not changed).
 * @param pitchId - Id of a pitch in `state.pitches`.
 * @param now - Epoch ms.
 * @param hardParts - The brief's hard parts as edited by the boss; defaults
 *   to the pitch's own.
 * @returns The new state with the project started and the pitches cleared.
 * @throws If the pitch isn't on offer.
 */
export function assign(
  state: GameState,
  pitchId: string,
  now: number,
  hardParts?: HardPart[],
): GameState {
  const next = structuredClone(state);
  const pitch = next.pitches.find((p) => p.id === pitchId);
  if (!pitch) throw new Error(`No pitch with id ${pitchId}`);

  const parts = structuredClone(hardParts ?? pitch.hardParts);
  next.project = {
    ...pitch,
    hardParts: [...parts].sort((a, b) => a.at - b.at),
    startedAt: now,
    progress: 0,
    workMinutes: 0,
    qualitySum: 0,
    hardPartsHit: [],
  };
  next.pitches = [];

  const worker = next.worker;
  // Arriving, on coffee or asleep: they pick it up when they get back.
  const atDesk =
    worker?.activity === 'idle' ||
    worker?.activity === 'working' ||
    worker?.activity === 'stuck';
  if (worker && atDesk) {
    worker.activity = 'working';
    worker.activitySince = now;
  }
  return next;
}

/**
 * Start one of the endings. Does nothing if they're already leaving.
 *
 * @param state - The current state (not changed).
 * @param kind - Which ending.
 * @param now - Epoch ms.
 * @returns The new state and an `ending` event (none if already leaving).
 */
export function beginEnding(
  state: GameState,
  kind: EndingKind,
  now: number,
): { state: GameState; events: GameEvent[] } {
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  if (next.worker) startEnding(next.worker, kind, now, events);
  return { state: next, events };
}

/**
 * Clear the desk after an ending has played: the worker joins the past
 * staff and leaves a mug, a sticky note and any unfinished project behind.
 *
 * @param state - The current state (not changed).
 * @param now - Epoch ms.
 * @param farewell - The departing worker's last words and leftovers' text.
 * @returns The new state with no worker, project, pitches or bubble.
 */
export function retire(
  state: GameState,
  now: number,
  farewell: { lastWords: string; stickyNote: string; mugText: string },
): GameState {
  const next = structuredClone(state);
  const worker = next.worker;
  if (!worker) return next;

  next.pastWorkers.push(pastWorker(worker, now, farewell.lastWords));
  const from = worker.name;
  next.deskLeftovers = [
    { kind: 'mug', text: farewell.mugText, fromWorker: from },
    { kind: 'sticky-note', text: farewell.stickyNote, fromWorker: from },
  ];
  if (next.project) {
    const percent = Math.floor(next.project.progress * 100);
    next.deskLeftovers.push({
      kind: 'half-finished-project',
      text: `${next.project.title}, ${percent}% done`,
      fromWorker: from,
    });
  }
  delete next.worker;
  delete next.project;
  delete next.bubble;
  next.pitches = [];
  return next;
}

function pastWorker(worker: Worker, endedAt: number, lastWords: string): PastWorker {
  return {
    id: worker.id,
    name: worker.name,
    level: worker.level,
    hiredAt: worker.hiredAt,
    endedAt,
    ending: worker.ending ?? 'fired',
    projectsDone: worker.projectsDone,
    lastWords,
  };
}

/**
 * The worker went home while the app was closed and is back, rested.
 * Call when the app opens after at least AWAY_MINUTES away.
 *
 * @param state - The current state (not changed).
 * @param now - Epoch ms.
 * @returns The new state; unchanged without a worker or while leaving.
 */
export function goHome(state: GameState, now: number): GameState {
  const next = structuredClone(state);
  const worker = next.worker;
  if (!worker || worker.activity === 'leaving') return next;

  const { stats } = worker;
  nudge(stats, {
    energy: HOME.energy,
    mood: (HOME.moodTarget - stats.mood) * HOME.moodPull,
    sanity: HOME.sanity,
  });
  delete worker.coffeeUntil;
  delete worker.boost;
  delete worker.wantsCoffeeSince;
  worker.lowMoodMinutes = 0;
  worker.minutesSinceBreak = 0;
  pruneRecent(worker, now);
  resume(worker, next.project, now);
  // Nobody is listening for events here; the next tick reports from scratch.
  refreshAttitude(worker, []);
  next.lastTickAt = now;
  return next;
}

/**
 * Show a speech or thought bubble long enough to read.
 *
 * @param state - The current state (not changed).
 * @param text - What they say or think.
 * @param kind - Speech or thought.
 * @param now - Epoch ms.
 * @returns The new state with the bubble set.
 */
export function setBubble(
  state: GameState,
  text: string,
  kind: 'say' | 'think',
  now: number,
): GameState {
  const next = structuredClone(state);
  const readingMs = BUBBLE_MS.base + BUBBLE_MS.perChar * text.length;
  const ms = clamp(readingMs, BUBBLE_MS.min, BUBBLE_MS.max);
  next.bubble = { text, kind, until: now + ms };
  return next;
}

/**
 * Give the worker a new memory, forgetting the oldest beyond the limit.
 *
 * @param worker - The worker (not changed).
 * @param memory - What they remember.
 * @returns A new worker.
 */
export function addMemory(worker: Worker, memory: Memory): Worker {
  return { ...worker, memories: withMemory(worker.memories, memory) };
}

/**
 * The local calendar day, used for once-a-day limits.
 *
 * @param now - Epoch ms.
 * @returns YYYY-MM-DD in the machine's time zone.
 */
export function todayKey(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
