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
  const about = subject.trim().toLowerCase() || 'what happened';
  next.worker = addMemory(worker, { at: now, ...c.memory(about) });
  refreshAttitude(next.worker, events);
  return { state: next, events };
}
