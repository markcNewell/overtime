/** The per-minute rates from the design doc, as small pure functions. */

import type { Activity, Project, Severity, Stats } from '../shared/types';
import {
  BASE_MINUTES,
  BASE_MINUTES_PER_DIFFICULTY,
  DRAIN_PER_DIFFICULTY,
  ENERGY_FACTOR_FLOOR,
  MOOD_FACTOR_FLOOR,
  MOOD_OVERLOAD_PENALTY,
  MOOD_TARGET_RESTING,
  MOOD_TARGET_WORKING,
  MOOD_TIRED_PENALTY,
  OVER_SKILL_BONUS,
  OVER_SKILL_CAP,
  PARANOIA,
  QUALITY_GAP_PENALTY,
  QUALITY_WEIGHTS as W,
  RUSHED_QUALITY,
  SANITY_FACTOR_FLOOR,
  SANITY_GAIN,
  SANITY_HIGH_MOOD,
  SANITY_LOSS,
  SANITY_LOW_MOOD,
  STUCK_GAP_FACTOR,
  STUCK_MINUTES_PER_SEVERITY,
  TIRED_ENERGY,
  UNDER_SKILL_PENALTY,
  WORK_DRAIN,
  XP_PER_DIFFICULTY,
  XP_QUALITY_OFFSET,
} from './tuning';

/**
 * Clamp a number into a range.
 *
 * @param value - The number.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @returns The value, pulled inside [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Minutes of full-speed work a project needs.
 *
 * @param difficulty - 1-5.
 * @returns The base minutes.
 */
export function baseMinutes(difficulty: number): number {
  return BASE_MINUTES + BASE_MINUTES_PER_DIFFICULTY * (difficulty - 1);
}

/**
 * Speed from skill: a bit faster with slack, much slower when overloaded.
 *
 * @param gap - difficulty minus capacity.
 * @returns The skill multiplier.
 */
export function skillFactor(gap: number): number {
  if (gap <= 0) return 1 + OVER_SKILL_BONUS * Math.min(OVER_SKILL_CAP, -gap);
  return 1 / (1 + UNDER_SKILL_PENALTY * gap);
}

/**
 * Speed from energy; tired people still type, just slower.
 *
 * @param energy - 0-100.
 * @returns The energy multiplier.
 */
export function energyFactor(energy: number): number {
  return ENERGY_FACTOR_FLOOR + (1 - ENERGY_FACTOR_FLOOR) * (energy / 100);
}

/**
 * Speed from sanity.
 *
 * @param sanity - 0-100.
 * @returns The sanity multiplier.
 */
export function sanityFactor(sanity: number): number {
  return SANITY_FACTOR_FLOOR + (1 - SANITY_FACTOR_FLOOR) * (sanity / 100);
}

/**
 * Speed from mood: unhappy people work slower, but never stop.
 *
 * @param mood - 0-100.
 * @returns The mood multiplier, 0.55-1.
 */
export function moodFactor(mood: number): number {
  return MOOD_FACTOR_FLOOR + (1 - MOOD_FACTOR_FLOOR) * (mood / 100);
}

/**
 * Speed lost to looking over their shoulder.
 *
 * @param recentSabotages - Times their code was broken in the last 30 min.
 * @param persecuted - True while they think the company is against them.
 * @param sanity - 0-100; a fraying mind is jumpier.
 * @returns The paranoia multiplier, 0.5-1.
 */
export function paranoiaFactor(
  recentSabotages: number,
  persecuted: boolean,
  sanity: number,
): number {
  const p = PARANOIA;
  const factor =
    1 -
    p.perSabotage * Math.min(p.maxSabotages, recentSabotages) -
    (persecuted ? p.persecuted : 0) -
    (sanity < p.lowSanity ? p.lowSanityPenalty : 0);
  return Math.max(p.floor, factor);
}

/**
 * Energy lost per minute at the desk on a project.
 *
 * @param difficulty - 1-5; harder work is more tiring.
 * @param stamina - Hidden trait, 0.7-1.3.
 * @returns A positive drain per minute.
 */
export function workDrain(difficulty: number, stamina: number): number {
  return (WORK_DRAIN * (1 + DRAIN_PER_DIFFICULTY * (difficulty - 1))) / stamina;
}

/**
 * Where mood drifts to right now.
 *
 * @param activity - What they're doing; desk work is a bit less pleasant.
 * @param gap - Overload of the current project, undefined without one.
 * @param energy - 0-100; being tired drags the target down.
 * @returns The target mood (may go below 0, which just pulls harder).
 */
export function moodTarget(
  activity: Activity,
  gap: number | undefined,
  energy: number,
): number {
  const atDesk = activity === 'working' || activity === 'stuck';
  let target = atDesk ? MOOD_TARGET_WORKING : MOOD_TARGET_RESTING;
  if (gap !== undefined) target -= MOOD_OVERLOAD_PENALTY * Math.max(0, gap);
  if (energy < TIRED_ENERGY) target -= MOOD_TIRED_PENALTY;
  return target;
}

/**
 * Sanity change per minute from the current mood.
 *
 * @param mood - 0-100.
 * @param resilience - Hidden trait, 0.7-1.3; slows the loss.
 * @returns Negative below the low-mood line, small positive when happy.
 */
export function sanityRate(mood: number, resilience: number): number {
  if (mood < SANITY_LOW_MOOD) {
    return -((SANITY_LOW_MOOD - mood) / SANITY_LOW_MOOD) * SANITY_LOSS / resilience;
  }
  return mood > SANITY_HIGH_MOOD ? SANITY_GAIN : 0;
}

/**
 * How long a hard part holds them up.
 *
 * @param severity - 1-3.
 * @param gap - Overload; out-of-their-depth workers stay stuck longer.
 * @param talent - Hidden trait, 0.7-1.3; shortens the struggle.
 * @returns Minutes stuck.
 */
export function stuckMinutes(
  severity: Severity,
  gap: number,
  talent: number,
): number {
  const overload = 1 + STUCK_GAP_FACTOR * Math.max(0, gap);
  return (STUCK_MINUTES_PER_SEVERITY * severity * overload) / talent;
}

/**
 * Quality of one minute of work.
 *
 * @param gap - Overload of the project.
 * @param stats - Current stats.
 * @param rushed - True while a shout boost is active.
 * @returns 0-1.
 */
export function minuteQuality(gap: number, stats: Stats, rushed: boolean): number {
  const skillMatch = gap <= 0 ? 1 : Math.max(0, 1 - QUALITY_GAP_PENALTY * gap);
  const score =
    W.skillMatch * skillMatch +
    W.sanity * (stats.sanity / 100) +
    W.energy * (stats.energy / 100) +
    W.mood * (stats.mood / 100);
  return rushed ? score * RUSHED_QUALITY : score;
}

/**
 * XP earned for shipping a project.
 *
 * @param difficulty - 1-5.
 * @param quality - 0-1.
 * @param talent - Hidden trait, 0.7-1.3.
 * @returns XP to add.
 */
export function xpGain(difficulty: number, quality: number, talent: number): number {
  return difficulty * XP_PER_DIFFICULTY * (XP_QUALITY_OFFSET + quality) * talent;
}

/**
 * A project's quality so far: the average of its per-minute scores.
 *
 * @param project - The project.
 * @returns 0-1, or 0 before any work has been done.
 */
export function projectQuality(project: Project): number {
  if (project.workMinutes <= 0) return 0;
  return project.qualitySum / project.workMinutes;
}
