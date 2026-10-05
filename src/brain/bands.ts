/**
 * The three difficulty bands a set of pitches must cover.
 */

import type { Difficulty } from '../shared/types';

export type Band = 'easy' | 'medium' | 'hard';

/** Pitch slots in the order they are offered. */
export const BANDS: readonly Band[] = ['easy', 'medium', 'hard'];

/**
 * Which band a difficulty belongs to.
 *
 * @param difficulty - 1-5.
 * @returns easy (1-2), medium (3) or hard (4-5).
 */
export function bandOf(difficulty: number): Band {
  if (difficulty <= 2) return 'easy';
  if (difficulty >= 4) return 'hard';
  return 'medium';
}

/**
 * Force a difficulty into a band, moving it as little as possible.
 *
 * @param difficulty - Any 1-5 value.
 * @param band - The band it must land in.
 * @returns A difficulty inside `band`.
 */
export function clampToBand(difficulty: number, band: Band): Difficulty {
  if (band === 'medium') return 3;
  if (band === 'easy') return difficulty <= 1 ? 1 : 2;
  return difficulty >= 5 ? 5 : 4;
}

/**
 * The fewest hard parts a pitch in this band should have.
 *
 * @param band - The band.
 * @returns 3 for hard projects, else 2.
 */
export function minHardParts(band: Band): number {
  return band === 'hard' ? 3 : 2;
}
