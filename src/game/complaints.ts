/**
 * What answering an HR complaint does to the worker. Claude decides how the
 * reply landed; this applies the consequences.
 */

import type {
  ComplaintOutcome,
  GameEvent,
  GameState,
  Memory,
  Stats,
  Worker,
} from '../shared/types';
import { addMemory } from './lifecycle';
import { nudge, refreshAttitude } from './worker';

interface Consequence {
  stats: Partial<Stats>;
  kindChats?: number;
  cruelChats?: number;
  memory: (subject: string) => Pick<Memory, 'kind' | 'text'>;
}

const CONSEQUENCES: Record<ComplaintOutcome, Consequence> = {
  apology: {
    stats: { mood: 10 },
    // A real apology counts like a couple of kind words.
    kindChats: 2,
    memory: (s) => ({ kind: 'boss', text: `The boss apologised about ${s}` }),
  },
  gaslit: {
    stats: { sanity: -10, mood: -3 },
    memory: (s) => ({ kind: 'self', text: `Maybe I imagined ${s}?` }),
  },
  unconvinced: {
    stats: { mood: -2 },
    memory: (s) => ({ kind: 'boss', text: `The boss brushed off my complaint about ${s}` }),
  },
  backfired: {
    stats: { mood: -8, sanity: -2 },
    cruelChats: 1,
    memory: (s) => ({ kind: 'boss', text: `Complaining about ${s} only made the boss worse` }),
  },
};

/**
 * What a complaint is about, for memories: "Formal Complaint: The Shocks"
 * becomes "the shocks".
 */
function topic(subject: string): string {
  const bare = subject
    .trim()
    .replace(/^((re|fw|fwd):\s*|(formal\s+)?complaint\s*(re|about)?\s*[:\-–]?\s*)+/i, '')
    .trim()
    .toLowerCase();
  return bare || 'what happened';
}

/**
 * Whether the worker thinks the whole company is against them: one of their
 * complaints was ignored and no apology has come since. Same rule as the
 * brain's persona uses.
 *
 * @param state - For the complaints.
 * @param worker - The worker.
 * @returns True while they feel persecuted.
 */
export function feelsPersecuted(
  state: Pick<GameState, 'complaints'>,
  worker: Pick<Worker, 'id'>,
): boolean {
  const mine = (state.complaints ?? []).filter((c) => c.workerId === worker.id);
  const snubs = mine.flatMap((c) => (c.ignoredAt === undefined ? [] : [c.ignoredAt]));
  if (snubs.length === 0) return false;
  const lastSnub = Math.max(...snubs);
  // A late apology on the ignored complaint itself counts, even unstamped.
  const apologised = mine.some((c) => {
    const when = c.repliedAt ?? c.ignoredAt ?? c.filedAt;
    return c.outcome === 'apology' && when >= lastSnub;
  });
  return !apologised;
}

/** Unanswered for this long (app-open minutes) and the complaint is ignored. */
export const COMPLAINT_IGNORED_MINUTES = 30;

/**
 * Age the current worker's unanswered complaints. One left too long makes
 * them decide the whole company is against them.
 *
 * @param state - Changed in place (called from inside `tick`).
 * @param worker - The worker in `state`, changed in place.
 * @param minutes - App-open minutes since the last tick, so closed time
 *   never counts.
 * @param now - Epoch ms.
 * @param events - Receives `complaint-ignored`.
 */
export function ageComplaints(
  state: GameState,
  worker: Worker,
  minutes: number,
  now: number,
  events: GameEvent[],
): void {
  for (const c of state.complaints ?? []) {
    if (c.workerId !== worker.id || c.reply || c.ignoredAt) continue;
    c.openMinutes = (c.openMinutes ?? 0) + minutes;
    if (c.openMinutes < COMPLAINT_IGNORED_MINUTES) continue;
    c.ignoredAt = now;
    nudge(worker.stats, { mood: -6, sanity: -4 });
    const text = `Nobody answered my complaint about ${topic(c.subject)}. The whole company is against me.`;
    worker.memories = addMemory(worker, { at: now, kind: 'self', text }).memories;
    events.push({ type: 'complaint-ignored', id: c.id });
  }
}

/**
 * Apply the outcome of the boss's reply to an HR complaint.
 *
 * @param state - The current state (not changed).
 * @param outcome - How the reply landed, as judged by Claude.
 * @param subject - What the complaint was about, for their memory.
 * @param now - Epoch ms.
 * @returns The new state and any attitude change.
 */
export function resolveComplaint(
  state: GameState,
  outcome: ComplaintOutcome,
  subject: string,
  now: number,
): { state: GameState; events: GameEvent[] } {
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const worker = next.worker;
  if (!worker || worker.activity === 'leaving') return { state: next, events };
  const c = CONSEQUENCES[outcome];
  nudge(worker.stats, c.stats);
  worker.ledger.kindChats += c.kindChats ?? 0;
  worker.ledger.cruelChats += c.cruelChats ?? 0;
  const about = topic(subject);
  next.worker = addMemory(worker, { at: now, ...c.memory(about) });
  refreshAttitude(next.worker, events);
  return { state: next, events };
}
