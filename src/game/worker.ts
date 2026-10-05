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
  COFFEE_MAKING_MINUTES,
  COFFEE_TIMER,
  MAX_MEMORIES,
  MS_PER_MINUTE,
  RECENT_WINDOW_MINUTES,
  WAKE_ENERGY,
} from './tuning';

/** A source of numbers in [0, 1); the app passes Math.random. */
export type Rng = () => number;

/** The default for every `rng` parameter, so tests stay deterministic. */
export const MIDDLE_RNG: Rng = () => 0.5;

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
 * Off to the machine to make a coffee. Any pending ask is answered by it,
 * and a mug still being sipped is abandoned for the fresh one.
 *
 * @param worker - Changed in place.
 * @param t - Epoch ms the run starts.
 */
export function startCoffeeRun(worker: Worker, t: number): void {
  worker.activity = 'coffee';
  worker.activitySince = t;
  worker.coffeeUntil = t + COFFEE_MAKING_MINUTES * MS_PER_MINUTE;
  delete worker.drinkingFor;
  clearAsk(worker);
}

/**
 * A fresh coffee timer: 20-30 minutes until the next run.
 *
 * @param rng - Picks where in the range.
 * @returns Minutes.
 */
export function freshCoffeeTimer(rng: Rng): number {
  return COFFEE_TIMER.base + rng() * COFFEE_TIMER.spread;
}

/**
 * Wind the coffee timer back up.
 *
 * @param worker - Changed in place.
 * @param rng - Picks where in the range.
 */
export function restartCoffeeTimer(worker: Worker, rng: Rng): void {
  worker.coffeeTimer = freshCoffeeTimer(rng);
}

/**
 * Forget a pending request for coffee.
 *
 * @param worker - Changed in place.
 */
export function clearAsk(worker: Worker): void {
  delete worker.wantsCoffeeSince;
  delete worker.coffeeAsks;
  delete worker.nextAskIn;
}

/**
 * A scared worker takes back their request (after being shocked or shouted
 * at) and waits a whole timer before trying again.
 *
 * @param worker - Changed in place.
 * @param rng - For the restarted timer.
 */
export function withdrawAsk(worker: Worker, rng: Rng): void {
  if (worker.wantsCoffeeSince === undefined) return;
  clearAsk(worker);
  restartCoffeeTimer(worker, rng);
}

/**
 * Get them back to the desk: wake a sleeper, or pull them away from the
 * coffee machine empty-handed. Anyone already at the desk (or arriving) is
 * left as they are.
 *
 * @param worker - Changed in place.
 * @param project - The current project, if any.
 * @param t - Epoch ms.
 * @param events - `woke-up` is pushed here when they were asleep.
 * @param rng - For the coffee timer, restarted when a run is cut short.
 */
export function backToWork(
  worker: Worker,
  project: Project | undefined,
  t: number,
  events: GameEvent[],
  rng: Rng,
): void {
  if (worker.activity === 'asleep') {
    nudge(worker.stats, { energy: WAKE_ENERGY });
    resume(worker, project, t);
    events.push({ type: 'woke-up' });
    return;
  }
  if (worker.activity !== 'coffee') return;
  delete worker.coffeeUntil;
  restartCoffeeTimer(worker, rng);
  resume(worker, project, t);
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
  delete worker.drinkingFor;
  delete worker.boost;
  clearAsk(worker);
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
 * Apply a speed boost, replacing any current one.
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
 * Drop shock, praise and sabotage times that no longer matter.
 *
 * @param worker - Changed in place.
 * @param now - Epoch ms.
 */
export function pruneRecent(worker: Worker, now: number): void {
  const cutoff = now - RECENT_WINDOW_MINUTES * MS_PER_MINUTE;
  const keep = (times: number[] | undefined): number[] =>
    (times ?? []).filter((at) => at >= cutoff);
  worker.recentShocks = keep(worker.recentShocks);
  worker.recentPraises = keep(worker.recentPraises);
  // Saves from before sabotage existed have no list yet.
  worker.recentSabotages = keep(worker.recentSabotages);
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
