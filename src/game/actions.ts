/** What the boss can do to the worker. */

import type {
  BossAction,
  BossActionType,
  ChatTone,
  GameEvent,
  GameState,
  Worker,
} from '../shared/types';
import { todayKey } from './lifecycle';
import {
  BONUS,
  CHAT_CRUEL,
  CHAT_KIND_MOOD,
  FRY_SHOCKS,
  FRY_WARNING_SHOCKS,
  FRY_WINDOW_MINUTES,
  MS_PER_MINUTE,
  PRAISE_MOOD,
  SHOCK,
  SHOUT,
} from './tuning';
import {
  applyBoost,
  nudge,
  pruneRecent,
  refreshAttitude,
  resume,
  startCoffee,
  startEnding,
} from './worker';

/** Everything an action handler needs; it changes `state` in place. */
interface Ctx {
  state: GameState;
  worker: Worker;
  now: number;
  events: GameEvent[];
}

/**
 * Apply a boss action.
 *
 * Refused actions come back as a single `action-refused` event and leave
 * the state as it was. Every applied action is counted in the ledger and
 * may change the worker's attitude.
 *
 * @param state - The current state (not changed).
 * @param action - What the boss did.
 * @param now - Epoch ms.
 * @returns The new state and what happened.
 */
export function act(
  state: GameState,
  action: BossAction,
  now: number,
): { state: GameState; events: GameEvent[] } {
  const next = structuredClone(state);
  const reason = refusal(next, action, now);
  const worker = next.worker;
  if (reason !== undefined || !worker) {
    const why = reason ?? 'Nobody works here';
    return { state: next, events: [refused(action.type, why)] };
  }

  const ctx: Ctx = { state: next, worker, now, events: [] };
  pruneRecent(worker, now);
  applyAction(ctx, action);
  refreshAttitude(worker, ctx.events);
  return { state: next, events: ctx.events };
}

function refused(action: BossActionType, reason: string): GameEvent {
  return { type: 'action-refused', action, reason };
}

/** Why the action can't happen right now, or undefined if it can. */
function refusal(state: GameState, action: BossAction, now: number): string | undefined {
  const worker = state.worker;
  if (!worker) return 'Nobody works here';
  if (worker.activity === 'leaving') return "They're already on their way out";
  if (action.type === 'coffee' && worker.activity === 'coffee') {
    return 'Already on a coffee break';
  }
  if (action.type === 'coffee' && worker.activity === 'arriving') {
    return 'Still arriving';
  }
  if (action.type === 'bonus' && worker.lastBonusDay === todayKey(now)) {
    return 'Already had a bonus today';
  }
  return undefined;
}

function applyAction(ctx: Ctx, action: BossAction): void {
  switch (action.type) {
    case 'shock':
      return shock(ctx);
    case 'shout':
      return shout(ctx);
    case 'praise':
      return praise(ctx);
    case 'coffee':
      return coffee(ctx);
    case 'bonus':
      return bonus(ctx);
    case 'chat':
      return chat(ctx, action.tone);
    case 'fire':
      return startEnding(ctx.worker, 'fired', ctx.now, ctx.events);
  }
}

function shock(ctx: Ctx): void {
  const { worker, now, events } = ctx;
  worker.ledger.shocks += 1;
  worker.recentShocks.push(now);
  applyBoost(worker, SHOCK.multiplier, SHOCK.minutes, now);
  nudge(worker.stats, { mood: SHOCK.mood, sanity: SHOCK.sanity });

  if (worker.activity === 'asleep') {
    nudge(worker.stats, { energy: SHOCK.wakeEnergy });
    resume(worker, ctx.state.project, now);
    events.push({ type: 'woke-up' });
  } else if (worker.activity === 'coffee') {
    // Dragged back to the desk mid-sip.
    delete worker.coffeeUntil;
    resume(worker, ctx.state.project, now);
  }

  const windowStart = now - FRY_WINDOW_MINUTES * MS_PER_MINUTE;
  const recent = worker.recentShocks.filter((at) => at > windowStart).length;
  if (recent >= FRY_SHOCKS) {
    startEnding(worker, 'fried', now, events);
  } else if (recent >= FRY_WARNING_SHOCKS) {
    events.push({ type: 'shock-warning' });
  }
}

function shout(ctx: Ctx): void {
  const { worker, now } = ctx;
  worker.ledger.shouts += 1;
  applyBoost(worker, SHOUT.multiplier, SHOUT.minutes, now);
  nudge(worker.stats, { mood: SHOUT.mood, sanity: SHOUT.sanity });
}

function praise(ctx: Ctx): void {
  const { worker, now } = ctx;
  // recentPraises is already pruned to the diminishing-returns window.
  const already = worker.recentPraises.length;
  worker.ledger.praises += 1;
  worker.recentPraises.push(now);
  nudge(worker.stats, { mood: PRAISE_MOOD / 2 ** already });
}

function coffee(ctx: Ctx): void {
  ctx.worker.ledger.coffees += 1;
  startCoffee(ctx.worker, ctx.now);
}

function bonus(ctx: Ctx): void {
  const { worker, now } = ctx;
  worker.ledger.bonuses += 1;
  worker.lastBonusDay = todayKey(now);
  nudge(worker.stats, { mood: BONUS.mood, sanity: BONUS.sanity });
}

function chat(ctx: Ctx, tone: ChatTone): void {
  const { worker } = ctx;
  if (tone === 'kind') {
    worker.ledger.kindChats += 1;
    nudge(worker.stats, { mood: CHAT_KIND_MOOD });
  } else if (tone === 'cruel') {
    worker.ledger.cruelChats += 1;
    nudge(worker.stats, { mood: CHAT_CRUEL.mood, sanity: CHAT_CRUEL.sanity });
  }
}
