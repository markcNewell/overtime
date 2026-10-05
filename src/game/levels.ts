/** Skill levels, XP thresholds and quality grades. */

import type { Level } from '../shared/types';
import {
  CAPACITY,
  GRADES,
  LEVEL_XP,
  LEVELS,
  LOWEST_GRADE,
} from './tuning';

/**
 * The hardest project difficulty a level handles without strain.
 *
 * @param level - The worker's skill level.
 * @returns 2 for junior up to 5 for lead.
 */
export function capacity(level: Level): number {
  return CAPACITY[level];
}

/**
 * How far a project is beyond the worker.
 *
 * @param level - The worker's skill level.
 * @param difficulty - The project's difficulty, 1-5.
 * @returns Positive when overloaded, zero or negative when comfortable.
 */
export function gapFor(level: Level, difficulty: number): number {
  return difficulty - capacity(level);
}

/**
 * The level reached with this much XP.
 *
 * @param xp - Total experience points.
 * @returns The highest level whose threshold the XP meets.
 */
export function levelFor(xp: number): Level {
  let reached: Level = 'junior';
  for (const level of LEVELS) {
    if (xp >= LEVEL_XP[level]) reached = level;
  }
  return reached;
}

/**
 * The XP at which a level starts.
 *
 * @param level - The skill level.
 * @returns Its threshold; candidates are hired with exactly this much.
 */
export function xpFor(level: Level): number {
  return LEVEL_XP[level];
}

/**
 * Position of a level in the ladder, for "is this a promotion?" checks.
 *
 * @param level - The skill level.
 * @returns 0 for junior up to 3 for lead.
 */
export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

/**
 * The words for a project's quality.
 *
 * @param quality - Average per-minute quality, 0-1.
 * @returns "Masterpiece" down to "Cursed garbage".
 */
export function grade(quality: number): string {
  const band = GRADES.find(([min]) => quality >= min);
  return band ? band[1] : LOWEST_GRADE;
}
