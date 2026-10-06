/** The clock: advances the worker and their project through real time. */

import type { GameEvent, GameState, Project, Worker } from '../shared/types';
import {
  baseMinutes,
  clamp,
  energyFactor,
  minuteQuality,
  moodFactor,
  moodTarget,
  paranoiaFactor,
  projectQuality,
  sanityFactor,
  sanityRate,
  skillFactor,
  workDrain,
  xpGain,
} from './formulas';
import { ageComplaints, feelsPersecuted } from './complaints';
import { gapFor, grade, levelFor, levelRank } from './levels';
import { hitHardPart, nextHardPart } from './project';
import {
  ARRIVE_MS,
  COFFEE_ASK_EVERY_MINUTES,
  COFFEE_DRINKING_ENERGY,
  COFFEE_DRINKING_MINUTES,
  COFFEE_DRINKING_MOOD,
  COFFEE_MAKING_ENERGY,
  COFFEE_MAX_ASKS,
  COFFEE_TIMER_FALLBACK,
  IDLE_DRAIN,
  MAX_TICK_MINUTES,
  MOOD_DRIFT,
  MS_PER_MINUTE,
  MYSTERY_SANITY_DRAIN,
  RAGE_MINUTES,
  RECENT_WINDOW_MINUTES,
  RAGE_MOOD,
  STUCK_MOOD_PER_SEVERITY,
  STUCK_SPEED,
  SUB_STEP_MINUTES,
} from './tuning';
import {
  boostAt,
  MIDDLE_RNG,
  nudge,
  pruneRecent,
  refreshAttitude,
  restartCoffeeTimer,
  resume,
  startCoffeeRun,
  startEnding,
  withMemory,
  type Rng,
} from './worker';

/** Slack for float sums of sub-steps, so a 20-minute timer ends at 20. */
const EPSILON = 1e-9;

/** One slice of simulated time. */
interface Step {
  state: GameState;
  worker: Worker;
  /** Length in minutes. */
  minutes: number;
  /** Epoch ms at the end of the slice. */
  t: number;
  events: GameEvent[];
  rng: Rng;
}

/**
 * Advance the game to `now`.
 *
 * At most one minute is integrated per call, so waking a laptop never makes
 * a whole afternoon pass at once. The minute is cut into sub-steps so hard
 * parts and thresholds are caught where they happen.
 *
 * @param state - The current state (not changed).
 * @param now - Epoch ms.
 * @param rng - Randomness for the coffee timer; the app passes Math.random.
 * @returns The new state and what happened.
 */
export function tick(
  state: GameState,
  now: number,
  rng: Rng = MIDDLE_RNG,
): { state: GameState; events: GameEvent[] } {
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const minutes = clamp((now - next.lastTickAt) / MS_PER_MINUTE, 0, MAX_TICK_MINUTES);
  next.lastTickAt = now;
  if (next.bubble && next.bubble.until <= now) delete next.bubble;

  const worker = next.worker;
  if (!worker || worker.activity === 'leaving') return { state: next, events };

  const count = Math.ceil(minutes / SUB_STEP_MINUTES);
  const start = now - minutes * MS_PER_MINUTE;
  for (let i = 1; i <= count; i++) {
    const t = i === count ? now : start + (i / count) * minutes * MS_PER_MINUTE;
    step({ state: next, worker, minutes: minutes / count, t, events, rng });
    if (hasLeft(worker)) break;
  }
  if (!hasLeft(worker)) ageComplaints(next, worker, minutes, now, events);
  pruneRecent(worker, now);
  return { state: next, events };
}

/** A separate call so TypeScript doesn't keep the narrowing from above. */
function hasLeft(worker: Worker): boolean {
  return worker.activity === 'leaving';
}

/** Advance one sub-step: the activity first, then the shared bookkeeping. */
function step(s: Step): void {
  if (s.worker.boost && s.worker.boost.until <= s.t) delete s.worker.boost;
  if (s.worker.activity === 'arriving') {
    stepArriving(s);
    return;
  }
  // The slice they walk back from the machine was spent at the machine.
  const wasAtDesk = AT_DESK.has(s.worker.activity);
  ACTIVITY_STEPS[s.worker.activity]?.(s);
  if (wasAtDesk) sipCoffee(s);
  updateMood(s);
  updateSanity(s);
  fallAsleepIfSpent(s);
  if (wasAtDesk) runCoffeeClock(s);
  refreshAttitude(s.worker, s.events);
  checkEndings(s);
}

const ACTIVITY_STEPS: Partial<Record<Worker['activity'], (s: Step) => void>> = {
  working: stepWorking,
  stuck: stepStuck,
  coffee: stepCoffee,
  idle: (s) => nudge(s.worker.stats, { energy: -IDLE_DRAIN * s.minutes }),
};

function stepArriving(s: Step): void {
  if (s.t < s.worker.activitySince + ARRIVE_MS) return;
  resume(s.worker, s.state.project, s.t);
  s.events.push({ type: 'arrived' });
}

/** At the machine making it; then back to the desk with a full mug. */
function stepCoffee(s: Step): void {
  const { worker } = s;
  const until = worker.coffeeUntil ?? s.t;
  const stepStart = s.t - s.minutes * MS_PER_MINUTE;
  // Only count the part of the slice still at the machine.
  const making = clamp((until - stepStart) / MS_PER_MINUTE, 0, s.minutes);
  nudge(worker.stats, { energy: COFFEE_MAKING_ENERGY * making });
  if (s.t < until) return;
  delete worker.coffeeUntil;
  worker.drinkingFor = COFFEE_DRINKING_MINUTES;
  restartCoffeeTimer(worker, s.rng);
  resume(worker, s.state.project, s.t);
  s.events.push({ type: 'coffee-done' });
}

/** Sipping at the desk: they work as normal and perk up. */
function sipCoffee(s: Step): void {
  const { worker } = s;
  const left = worker.drinkingFor ?? 0;
  if (left <= 0 || !AT_DESK.has(worker.activity)) return;
  const sip = Math.min(left, s.minutes);
  nudge(worker.stats, {
    energy: COFFEE_DRINKING_ENERGY * sip,
    mood: COFFEE_DRINKING_MOOD * sip,
  });
  worker.drinkingFor = left - sip;
  if (worker.drinkingFor <= EPSILON) delete worker.drinkingFor;
}

function stepWorking(s: Step): void {
  const project = s.state.project;
  if (!project) {
    resume(s.worker, project, s.t);
    return;
  }
  const gap = gapFor(s.worker.level, project.difficulty);
  const reach = project.progress + progressPerMinute(s, project, gap) * s.minutes;
  doDeskWork(s, project, gap);

  const next = nextHardPart(project);
  const part = next === undefined ? undefined : project.hardParts[next];
  if (next !== undefined && part && part.at <= reach) {
    // Land exactly on the hard part so it bites where the brief says.
    project.progress = Math.max(project.progress, part.at);
    hitHardPart(project, s.worker, next, s.t, s.events);
    return;
  }
  project.progress = Math.min(1, reach);
  if (project.progress >= 1) finishProject(s, project);
}

function stepStuck(s: Step): void {
  const project = s.state.project;
  if (!project || project.stuckOn === undefined) {
    resume(s.worker, project, s.t);
    return;
  }
  const gap = gapFor(s.worker.level, project.difficulty);
  const rate = progressPerMinute(s, project, gap) * STUCK_SPEED;
  // Slow going, not a wall: they can creep past later parts, which then
  // bite once this one is solved. Finishing waits until they're unstuck.
  project.progress = Math.min(1, project.progress + rate * s.minutes);
  doDeskWork(s, project, gap);

  const part = project.hardParts[project.stuckOn];
  const severity = part?.severity ?? 1;
  nudge(s.worker.stats, { mood: -STUCK_MOOD_PER_SEVERITY * severity * s.minutes });
  // A bug that came from nowhere is worse for the nerves than an honest one.
  if (part?.mystery) {
    nudge(s.worker.stats, { sanity: -MYSTERY_SANITY_DRAIN * s.minutes });
  }
  project.stuckMinutesLeft = (project.stuckMinutesLeft ?? 0) - s.minutes;
  if (project.stuckMinutesLeft > EPSILON) return;

  const index = project.stuckOn;
  delete project.stuckOn;
  delete project.stuckMinutesLeft;
  resume(s.worker, project, s.t);
  s.events.push({ type: 'hard-part-cleared', index });
  // Straight on to any part they crept past while stuck on this one.
  const next = nextHardPart(project);
  const passed = next === undefined ? undefined : project.hardParts[next];
  if (next !== undefined && passed && passed.at <= project.progress) {
    hitHardPart(project, s.worker, next, s.t, s.events);
  }
}

/** Score the minute's quality and pay for it in energy. */
function doDeskWork(s: Step, project: Project, gap: number): void {
  const { worker } = s;
  const rushed = boostAt(worker, s.t) > 1;
  project.qualitySum += minuteQuality(gap, worker.stats, rushed) * s.minutes;
  project.workMinutes += s.minutes;
  const drain = workDrain(project.difficulty, worker.traits.stamina);
  nudge(worker.stats, { energy: -drain * s.minutes });
}

function progressPerMinute(s: Step, project: Project, gap: number): number {
  const { worker } = s;
  const { stats } = worker;
  const speed =
    skillFactor(gap) *
    energyFactor(stats.energy) *
    sanityFactor(stats.sanity) *
    moodFactor(stats.mood) *
    paranoia(s) *
    boostAt(worker, s.t);
  return speed / baseMinutes(project.difficulty);
}

function paranoia(s: Step): number {
  const { worker } = s;
  const since = s.t - RECENT_WINDOW_MINUTES * MS_PER_MINUTE;
  const sabotages = (worker.recentSabotages ?? []).filter((at) => at >= since).length;
  const persecuted = feelsPersecuted(s.state, worker);
  return paranoiaFactor(sabotages, persecuted, worker.stats.sanity);
}

function finishProject(s: Step, project: Project): void {
  const { worker, state } = s;
  const quality = projectQuality(project);
  const words = grade(quality);
  s.events.push({ type: 'project-finished', quality, grade: words });

  worker.xp += xpGain(project.difficulty, quality, worker.traits.talent);
  const level = levelFor(worker.xp);
  if (levelRank(level) > levelRank(worker.level)) {
    worker.level = level;
    s.events.push({ type: 'level-up', level });
  }
  worker.projectsDone += 1;
  worker.memories = withMemory(worker.memories, {
    at: s.t,
    kind: 'work',
    text: `Shipped ${project.title} (${words})`,
  });
  state.releases.push({
    projectId: project.id,
    title: project.title,
    workerName: worker.name,
    finishedAt: s.t,
    quality,
    grade: words,
  });
  delete state.project;
  resume(worker, undefined, s.t);
}

function updateMood(s: Step): void {
  const { worker, state } = s;
  const project = state.project;
  const gap = project ? gapFor(worker.level, project.difficulty) : undefined;
  const target = moodTarget(worker.activity, gap, worker.stats.energy);
  const drift = (target - worker.stats.mood) * MOOD_DRIFT * s.minutes;
  nudge(worker.stats, { mood: drift });
  const rockBottom = worker.stats.mood <= RAGE_MOOD;
  worker.lowMoodMinutes = rockBottom ? worker.lowMoodMinutes + s.minutes : 0;
}

function updateSanity(s: Step): void {
  const { stats, traits } = s.worker;
  nudge(stats, { sanity: sanityRate(stats.mood, traits.resilience) * s.minutes });
}

/** At the desk and awake: the only states that tire, doze or run the coffee clock. */
const AT_DESK = new Set<Worker['activity']>(['working', 'stuck', 'idle']);

function fallAsleepIfSpent(s: Step): void {
  const { worker } = s;
  if (worker.stats.energy > 0 || !AT_DESK.has(worker.activity)) return;
  worker.activity = 'asleep';
  worker.activitySince = s.t;
  s.events.push({ type: 'fell-asleep' });
}

/**
 * The coffee timer runs while they're at the desk. When it goes off they
 * just go, unless they're scared of the boss: then they ask, up to three
 * times a few minutes apart, and go anyway if nobody answers.
 */
function runCoffeeClock(s: Step): void {
  const { worker } = s;
  if (!AT_DESK.has(worker.activity)) return;
  if (worker.wantsCoffeeSince !== undefined) {
    waitForAnswer(s);
    return;
  }
  // Saves from before the timer existed start it mid-range.
  const left = (worker.coffeeTimer ?? COFFEE_TIMER_FALLBACK) - s.minutes;
  worker.coffeeTimer = Math.max(0, left);
  if (left > EPSILON) return;
  if (worker.attitude === 'scared') {
    ask(s, 1);
    return;
  }
  startCoffeeRun(worker, s.t);
  s.events.push({ type: 'took-break' });
}

function ask(s: Step, attempt: number): void {
  const { worker } = s;
  worker.wantsCoffeeSince ??= s.t;
  worker.coffeeAsks = attempt;
  worker.nextAskIn = COFFEE_ASK_EVERY_MINUTES;
  s.events.push({ type: 'wants-coffee', attempt });
}

function waitForAnswer(s: Step): void {
  const { worker } = s;
  const left = (worker.nextAskIn ?? COFFEE_ASK_EVERY_MINUTES) - s.minutes;
  worker.nextAskIn = Math.max(0, left);
  if (left > EPSILON) return;
  const asks = worker.coffeeAsks ?? 1;
  if (asks < COFFEE_MAX_ASKS) {
    ask(s, asks + 1);
    return;
  }
  startCoffeeRun(worker, s.t);
  s.events.push({ type: 'took-coffee-anyway' });
}

function checkEndings(s: Step): void {
  const { worker } = s;
  if (worker.stats.sanity <= 0) {
    startEnding(worker, 'lost-mind', s.t, s.events);
    return;
  }
  // Scared people break instead of quitting.
  const fedUp = worker.lowMoodMinutes >= RAGE_MINUTES - EPSILON;
  if (fedUp && worker.attitude !== 'scared') {
    startEnding(worker, 'rage-quit', s.t, s.events);
  }
}
