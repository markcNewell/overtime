/** What the boss can do to the worker. */

import type {
  BossAction,
  BossActionType,
  ChatRequest,
  ChatTone,
  GameEvent,
  GameState,
  Worker,
} from '../shared/types';
import { todayKey } from './lifecycle';
import { plantBug } from './sabotage';
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
  backToWork,
  nudge,
  pruneRecent,
  refreshAttitude,
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
  switch (action.type) {
    case 'coffee':
      if (worker.activity === 'coffee') return 'Already on a coffee break';
      if (worker.activity === 'arriving') return 'Still arriving';
      return undefined;
    case 'bonus':
      if (worker.lastBonusDay === todayKey(now)) return 'Already had a bonus today';
      return undefined;
    case 'sabotage':
      if (!state.project) return 'There is no code to mess up yet';
      if (worker.activity === 'arriving') return "They haven't even logged in yet";
      return undefined;
    default:
      return undefined;
  }
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
      return chat(ctx, action.tone, action.request);
    case 'sabotage':
      return sabotage(ctx);
    case 'fire':
      return startEnding(ctx.worker, 'fired', ctx.now, ctx.events);
  }
}

function sabotage(ctx: Ctx): void {
  // The refusal check guarantees a project; this keeps TypeScript sure too.
  if (!ctx.state.project) return;
  plantBug(ctx.state.project, ctx.worker, ctx.now, ctx.events);
}

/** A jolt back to work: no faster, just awake and at the desk. */
function shock(ctx: Ctx): void {
  const { worker, now, events } = ctx;
  worker.ledger.shocks += 1;
  worker.recentShocks.push(now);
  nudge(worker.stats, { mood: SHOCK.mood, sanity: SHOCK.sanity });
  backToWork(worker, ctx.state.project, now, events);

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

/** Can a coffee break start without being refused? */
function canTakeCoffee(worker: Worker): boolean {
  return worker.activity !== 'coffee' && worker.activity !== 'arriving';
}

function bonus(ctx: Ctx): void {
  const { worker, now } = ctx;
  worker.ledger.bonuses += 1;
  worker.lastBonusDay = todayKey(now);
  nudge(worker.stats, { mood: BONUS.mood, sanity: BONUS.sanity });
}

/**
 * The tone always lands; a request is something they agreed to in their
 * reply, so it happens if it can and is quietly dropped if not.
 */
function chat(ctx: Ctx, tone: ChatTone, request: ChatRequest | undefined): void {
  const { worker } = ctx;
  if (tone === 'kind') {
    worker.ledger.kindChats += 1;
    nudge(worker.stats, { mood: CHAT_KIND_MOOD });
  } else if (tone === 'cruel') {
    worker.ledger.cruelChats += 1;
    nudge(worker.stats, { mood: CHAT_CRUEL.mood, sanity: CHAT_CRUEL.sanity });
  }
  if (request === 'coffee' && canTakeCoffee(worker)) coffee(ctx);
  // Like a shock, minus the pain.
  if (request === 'work') backToWork(worker, ctx.state.project, ctx.now, ctx.events);
}
