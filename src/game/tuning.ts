/**
 * Every number the simulation runs on, in one place.
 *
 * Rates are per real minute unless the name says otherwise. The "Tuning"
 * subsection of docs/design.md mirrors these; change both together.
 */

import type { Level, Stats } from '../shared/types';

export const MS_PER_MINUTE = 60_000;

// --- Levels -----------------------------------------------------------

/** Ordered lowest to highest. */
export const LEVELS: readonly Level[] = ['junior', 'mid', 'senior', 'lead'];

/** The hardest project difficulty a level takes on without strain. */
export const CAPACITY: Readonly<Record<Level, number>> = {
  junior: 2,
  mid: 3,
  senior: 4,
  lead: 5,
};

/** XP at which each level starts; a new hire starts at their threshold. */
export const LEVEL_XP: Readonly<Record<Level, number>> = {
  junior: 0,
  mid: 40,
  senior: 120,
  lead: 260,
};

export const START_STATS: Readonly<Stats> = {
  energy: 100,
  mood: 70,
  sanity: 100,
};

// --- Clock ------------------------------------------------------------

/** Longest stretch one tick integrates, so a laptop sleep never jumps. */
export const MAX_TICK_MINUTES = 1;
/** Small enough to catch hard parts and thresholds where they happen. */
export const SUB_STEP_MINUTES = 0.25;
/** How long the walk-in after hiring lasts. */
export const ARRIVE_MS = 6000;
/** A gap this long between sessions counts as having gone home. */
export const AWAY_MINUTES = 30;

// --- Progress ---------------------------------------------------------

/** baseMinutes = BASE + PER_DIFFICULTY x (difficulty - 1): 45 to 105. */
export const BASE_MINUTES = 45;
export const BASE_MINUTES_PER_DIFFICULTY = 15;
/** Speed bonus per level of slack below capacity, capped. */
export const OVER_SKILL_BONUS = 0.1;
export const OVER_SKILL_CAP = 2;
/** Speed divisor per point of gap above capacity. */
export const UNDER_SKILL_PENALTY = 0.35;
/** energyF = FLOOR + (1 - FLOOR) x energy / 100. */
export const ENERGY_FACTOR_FLOOR = 0.5;
/** sanityF = FLOOR + (1 - FLOOR) x sanity / 100. */
export const SANITY_FACTOR_FLOOR = 0.7;
/** Speed multiplier while stuck on a hard part. */
export const STUCK_SPEED = 0.25;

// --- Energy -----------------------------------------------------------

export const WORK_DRAIN = 0.45;
/** Harder projects tire them faster: x (1 + this x (difficulty - 1)). */
export const DRAIN_PER_DIFFICULTY = 0.1;
export const IDLE_DRAIN = 0.15;
export const COFFEE_REFILL = 12;

// --- Mood -------------------------------------------------------------

/** Fraction of the distance to the target covered per minute. */
export const MOOD_DRIFT = 0.01;
export const MOOD_TARGET_WORKING = 65;
export const MOOD_TARGET_RESTING = 70;
/** Target drop per point of positive gap (overload). */
export const MOOD_OVERLOAD_PENALTY = 12;
export const MOOD_TIRED_PENALTY = 15;
export const TIRED_ENERGY = 20;
export const STUCK_MOOD_PER_SEVERITY = 0.3;

// --- Sanity -----------------------------------------------------------

/** Below this mood sanity drains, scaled by how far below. */
export const SANITY_LOW_MOOD = 30;
export const SANITY_LOSS = 0.5;
/** Above this mood sanity slowly recovers. */
export const SANITY_HIGH_MOOD = 60;
export const SANITY_GAIN = 0.03;

// --- Hard parts -------------------------------------------------------

/** stuck = PER_SEVERITY x severity x (1 + GAP x max(0, gap)) / talent. */
export const STUCK_MINUTES_PER_SEVERITY = 10;
export const STUCK_GAP_FACTOR = 0.3;

// --- Coffee -----------------------------------------------------------

export const COFFEE_ASK_ENERGY = 25;
export const COFFEE_IGNORED_MINUTES = 15;
/** Ignored and this unhappy (or bitter), they go anyway. */
export const COFFEE_ANYWAY_MOOD = 30;
export const COFFEE_BREAK_MINUTES = 6;
export const COFFEE_MOOD = 3;

// --- Boss actions -----------------------------------------------------

export const SHOCK = {
  multiplier: 1.8,
  minutes: 10,
  mood: -10,
  sanity: -3,
  wakeEnergy: 15,
} as const;

export const SHOUT = {
  multiplier: 1.3,
  minutes: 5,
  mood: -6,
  sanity: -1,
} as const;

/** Halved for each praise already given inside the window. */
export const PRAISE_MOOD = 8;
export const BONUS = { mood: 25, sanity: 10 } as const;
export const CHAT_KIND_MOOD = 4;
export const CHAT_CRUEL = { mood: -6, sanity: -1 } as const;

/** recentShocks / recentPraises older than this are dropped. */
export const RECENT_WINDOW_MINUTES = 30;

// --- Endings ----------------------------------------------------------

export const FRY_WINDOW_MINUTES = 10;
export const FRY_WARNING_SHOCKS = 4;
export const FRY_SHOCKS = 6;
export const RAGE_MOOD = 5;
export const RAGE_MINUTES = 20;

// --- Attitude ---------------------------------------------------------

export const ATTITUDE = {
  fearPerShock: 2,
  fearPerShout: 1,
  warmthPerBonus: 3,
  warmthPerCoffee: 0.5,
  scaredMinFear: 4,
  /** Scared needs fear above warmth x this ... */
  scaredOverWarmth: 1.5,
  /** ... and at least cruelty x this. */
  scaredOverCruelty: 2,
  bitterBelowMood: 35,
  warmMin: 5,
  /** Loyal or sucking-up needs warmth above (fear + cruelty) x this. */
  warmOverHarm: 2,
  /** Sucking-up when bonus warmth is at least this share of all warmth. */
  bribedShare: 0.5,
} as const;

// --- Quality and XP ---------------------------------------------------

export const QUALITY_WEIGHTS = {
  skillMatch: 0.35,
  sanity: 0.35,
  energy: 0.2,
  mood: 0.1,
} as const;
export const QUALITY_GAP_PENALTY = 0.3;
/** Quality multiplier while boosted by a shock or shout (rushed work). */
export const RUSHED_QUALITY = 0.85;

/** Highest first; the first band the quality reaches wins. */
export const GRADES: readonly (readonly [number, string])[] = [
  [0.8, 'Masterpiece'],
  [0.65, 'Solid'],
  [0.5, 'Buggy'],
  [0.35, 'Barely compiles'],
];
export const LOWEST_GRADE = 'Cursed garbage';

/** xp = difficulty x PER_DIFFICULTY x (OFFSET + quality) x talent. */
export const XP_PER_DIFFICULTY = 10;
export const XP_QUALITY_OFFSET = 0.5;

// --- Going home -------------------------------------------------------

export const HOME = {
  energy: 60,
  moodTarget: 55,
  /** Fraction of the way to the mood target. */
  moodPull: 0.3,
  sanity: 5,
} as const;

// --- Bubbles and memory -----------------------------------------------

export const BUBBLE_MS = {
  base: 3000,
  perChar: 60,
  min: 5000,
  max: 12000,
} as const;

export const MAX_MEMORIES = 40;
