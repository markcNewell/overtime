/** The clock: advances the worker and their project through real time. */

import type { GameEvent, GameState, Project, Worker } from '../shared/types';
import {
  baseMinutes,
  clamp,
  energyFactor,
  minuteQuality,
  moodTarget,
  projectQuality,
  sanityFactor,
  sanityRate,
  skillFactor,
  stuckMinutes,
  workDrain,
  xpGain,
} from './formulas';
import { gapFor, grade, levelFor, levelRank } from './levels';
import {
  ARRIVE_MS,
  COFFEE_ANYWAY_MOOD,
  COFFEE_ASK_ENERGY,
  COFFEE_IGNORED_MINUTES,
  COFFEE_REFILL,
  IDLE_DRAIN,
  MAX_TICK_MINUTES,
  MOOD_DRIFT,
  MS_PER_MINUTE,
  RAGE_MINUTES,
  RAGE_MOOD,
  STUCK_MOOD_PER_SEVERITY,
  STUCK_SPEED,
  SUB_STEP_MINUTES,
} from './tuning';
import {
  boostAt,
  nudge,
  pruneRecent,
  refreshAttitude,
  resume,
  startCoffee,
  startEnding,
  withMemory,
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
 * @returns The new state and what happened.
 */
export function tick(
  state: GameState,
  now: number,
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
    step({ state: next, worker, minutes: minutes / count, t, events });
    if (hasLeft(worker)) break;
  }
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
  ACTIVITY_STEPS[s.worker.activity]?.(s);
  updateMood(s);
  updateSanity(s);
  fallAsleepIfSpent(s);
  handleCoffeeCraving(s);
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

function stepCoffee(s: Step): void {
  const { worker } = s;
  const until = worker.coffeeUntil ?? s.t;
  const stepStart = s.t - s.minutes * MS_PER_MINUTE;
  // Only refill for the part of the slice still inside the break.
  const sipMinutes = clamp((until - stepStart) / MS_PER_MINUTE, 0, s.minutes);
  nudge(worker.stats, { energy: COFFEE_REFILL * sipMinutes });
  if (s.t < until) return;
  delete worker.coffeeUntil;
  resume(worker, s.state.project, s.t);
  s.events.push({ type: 'coffee-done' });
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
    hitHardPart(s, project, next, gap);
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
  // Crawl, but never past the next hard part or the finish line.
  const next = nextHardPart(project);
  const cap = Math.min(1, next === undefined ? 1 : (project.hardParts[next]?.at ?? 1));
  const reach = Math.min(project.progress + rate * s.minutes, cap);
  project.progress = Math.max(project.progress, reach);
  doDeskWork(s, project, gap);

  const severity = project.hardParts[project.stuckOn]?.severity ?? 1;
  nudge(s.worker.stats, { mood: -STUCK_MOOD_PER_SEVERITY * severity * s.minutes });
  project.stuckMinutesLeft = (project.stuckMinutesLeft ?? 0) - s.minutes;
  if (project.stuckMinutesLeft > EPSILON) return;

  const index = project.stuckOn;
  delete project.stuckOn;
  delete project.stuckMinutesLeft;
  resume(s.worker, project, s.t);
  s.events.push({ type: 'hard-part-cleared', index });
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
  const { stats } = s.worker;
  const speed =
    skillFactor(gap) *
    energyFactor(stats.energy) *
    sanityFactor(stats.sanity) *
    boostAt(s.worker, s.t);
  return speed / baseMinutes(project.difficulty);
}

/** The first hard part, in order, not yet reached. */
function nextHardPart(project: Project): number | undefined {
  const index = project.hardParts.findIndex(
    (_, i) => !project.hardPartsHit.includes(i),
  );
  return index < 0 ? undefined : index;
}

function hitHardPart(s: Step, project: Project, index: number, gap: number): void {
  const part = project.hardParts[index];
  if (!part) return;
  project.hardPartsHit.push(index);
  project.stuckOn = index;
  project.stuckMinutesLeft = stuckMinutes(part.severity, gap, s.worker.traits.talent);
  s.worker.activity = 'stuck';
  s.worker.activitySince = s.t;
  s.events.push({ type: 'hard-part-hit', index });
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

/** At the desk and awake: the only states that tire, doze or crave coffee. */
const AT_DESK = new Set<Worker['activity']>(['working', 'stuck', 'idle']);

function fallAsleepIfSpent(s: Step): void {
  const { worker } = s;
  if (worker.stats.energy > 0 || !AT_DESK.has(worker.activity)) return;
  worker.activity = 'asleep';
  worker.activitySince = s.t;
  s.events.push({ type: 'fell-asleep' });
}

/** Ask for coffee once when tired; go anyway if ignored and fed up. */
function handleCoffeeCraving(s: Step): void {
  const { worker } = s;
  if (!AT_DESK.has(worker.activity)) return;
  if (worker.wantsCoffeeSince === undefined) {
    if (worker.stats.energy >= COFFEE_ASK_ENERGY) return;
    worker.wantsCoffeeSince = s.t;
    s.events.push({ type: 'wants-coffee' });
    return;
  }
  const waited = (s.t - worker.wantsCoffeeSince) / MS_PER_MINUTE;
  if (waited < COFFEE_IGNORED_MINUTES) return;
  const fedUp =
    worker.stats.mood < COFFEE_ANYWAY_MOOD || worker.attitude === 'bitter';
  if (!fedUp) return;
  startCoffee(worker, s.t);
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
