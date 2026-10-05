/**
 * Internal helpers that change a worker in place.
 *
 * Only ever called on a worker inside a state the caller has already cloned,
 * so the public functions stay non-mutating.
 */

import type {
  EndingKind,
  GameEvent,
  Memory,
  Project,
  Stats,
  Worker,
} from '../shared/types';
import { deriveAttitude } from './attitude';
import { clamp } from './formulas';
import {
  COFFEE_BREAK_MINUTES,
  COFFEE_MOOD,
  MAX_MEMORIES,
  MS_PER_MINUTE,
  RECENT_WINDOW_MINUTES,
} from './tuning';

/**
 * Add deltas to the stats and keep them in 0-100.
 *
 * @param stats - Stats to change in place.
 * @param delta - Amounts to add.
 */
export function nudge(stats: Stats, delta: Partial<Stats>): void {
  stats.energy = clamp(stats.energy + (delta.energy ?? 0), 0, 100);
  stats.mood = clamp(stats.mood + (delta.mood ?? 0), 0, 100);
  stats.sanity = clamp(stats.sanity + (delta.sanity ?? 0), 0, 100);
}

/**
 * Put them back to what they'd naturally be doing at the desk.
 *
 * A worker who was pulled off a hard part (coffee, sleep) goes back to being
 * stuck on it rather than skipping it.
 *
 * @param worker - Changed in place.
 * @param project - The current project, if any.
 * @param t - Epoch ms of the change.
 */
export function resume(worker: Worker, project: Project | undefined, t: number): void {
  worker.activity = !project
    ? 'idle'
    : project.stuckOn !== undefined
      ? 'stuck'
      : 'working';
  worker.activitySince = t;
}

/**
 * Send them to the coffee station.
 *
 * @param worker - Changed in place.
 * @param t - Epoch ms the break starts.
 */
export function startCoffee(worker: Worker, t: number): void {
  worker.activity = 'coffee';
  worker.activitySince = t;
  worker.coffeeUntil = t + COFFEE_BREAK_MINUTES * MS_PER_MINUTE;
  delete worker.wantsCoffeeSince;
  nudge(worker.stats, { mood: COFFEE_MOOD });
}

/**
 * Start an ending unless one is already playing.
 *
 * @param worker - Changed in place.
 * @param kind - Which ending.
 * @param t - Epoch ms it starts.
 * @param events - The `ending` event is pushed here.
 */
export function startEnding(
  worker: Worker,
  kind: EndingKind,
  t: number,
  events: GameEvent[],
): void {
  if (worker.activity === 'leaving') return;
  worker.ending = kind;
  worker.activity = 'leaving';
  worker.activitySince = t;
  delete worker.coffeeUntil;
  delete worker.wantsCoffeeSince;
  delete worker.boost;
  events.push({ type: 'ending', kind });
}

/**
 * Recompute the attitude and report a change.
 *
 * @param worker - Changed in place.
 * @param events - `attitude-changed` is pushed here when it changes.
 */
export function refreshAttitude(worker: Worker, events: GameEvent[]): void {
  const to = deriveAttitude(worker.ledger, worker.stats);
  if (to === worker.attitude) return;
  events.push({ type: 'attitude-changed', from: worker.attitude, to });
  worker.attitude = to;
}

/**
 * Apply a speed boost; a weaker one never cuts short a stronger one.
 *
 * @param worker - Changed in place.
 * @param multiplier - Speed multiplier.
 * @param minutes - How long it lasts.
 * @param t - Epoch ms it starts.
 */
export function applyBoost(
  worker: Worker,
  multiplier: number,
  minutes: number,
  t: number,
): void {
  const current = worker.boost;
  if (current && current.until > t && current.multiplier > multiplier) return;
  worker.boost = { multiplier, until: t + minutes * MS_PER_MINUTE };
}

/**
 * Whether a boost is in force at time t.
 *
 * @param worker - The worker.
 * @param t - Epoch ms.
 * @returns The multiplier, 1 when none is active.
 */
export function boostAt(worker: Worker, t: number): number {
  const boost = worker.boost;
  return boost && t < boost.until ? boost.multiplier : 1;
}

/**
 * Drop shock and praise times that no longer matter.
 *
 * @param worker - Changed in place.
 * @param now - Epoch ms.
 */
export function pruneRecent(worker: Worker, now: number): void {
  const cutoff = now - RECENT_WINDOW_MINUTES * MS_PER_MINUTE;
  worker.recentShocks = worker.recentShocks.filter((at) => at >= cutoff);
  worker.recentPraises = worker.recentPraises.filter((at) => at >= cutoff);
}

/**
 * Append a memory, keeping only the newest MAX_MEMORIES.
 *
 * @param memories - The existing list (not changed).
 * @param memory - The new memory.
 * @returns A new list.
 */
export function withMemory(memories: Memory[], memory: Memory): Memory[] {
  return [...memories, memory].slice(-MAX_MEMORIES);
}
