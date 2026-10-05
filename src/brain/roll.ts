/**
 * Dice for everything the app decides rather than Claude: ids, hidden
 * traits and looks. Keeping these out of the prompt saves tokens and stops
 * Haiku from making everyone a 1.0 with brown hair.
 */

import type { HairStyle, Look, Traits } from '../shared/types';

/** A source of uniform numbers in [0, 1), like `Math.random`. */
export type Rng = () => number;

/** Realistic skin tones, light to deep. */
export const SKIN_TONES = [
  '#FBE2CF', '#F3D2B4', '#EAC09A', '#D9A577', '#C68B5E',
  '#A86F45', '#8A5530', '#6E4125', '#53311C', '#3B2216',
] as const;

const NATURAL_HAIR = [
  '#16110E', '#2E1E14', '#4E3220', '#7A4E2D', '#B07A3E',
  '#D8B46A', '#E9D49B', '#9C3B1E', '#C25B2C',
] as const;

const GREY_HAIR = ['#9E9E9E', '#C9C6C0', '#E6E2DA'] as const;

const DYED_HAIR = [
  '#E9468C', '#3E8EF2', '#8A4FE3', '#2DBE85', '#FF8A1F', '#3BC9DB',
] as const;

/** Every colour hair can be, for tests and the renderer. */
export const HAIR_COLOURS = [...NATURAL_HAIR, ...GREY_HAIR, ...DYED_HAIR];

/** A cheerful shirt palette. */
export const SHIRTS = [
  '#FF6B6B', '#FFB347', '#FFD93D', '#6BCB77', '#4D96FF', '#9B5DE5',
  '#F15BB5', '#00BBF9', '#00C2A8', '#FF8FAB', '#7AE582', '#FFA552',
] as const;

export const HAIR_STYLES: readonly HairStyle[] = [
  'short', 'long', 'bun', 'bald', 'mohawk', 'curly',
];

let serial = 0;

/**
 * Pick one item uniformly.
 *
 * @param items - A non-empty list.
 * @param rng - Random source.
 * @returns One of `items`.
 */
export function pick<T>(items: readonly T[], rng: Rng): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  const item = items[Math.max(0, index)];
  if (item === undefined) throw new Error('pick() needs a non-empty list');
  return item;
}

/**
 * A shuffled copy (Fisher-Yates).
 *
 * @param items - Any list.
 * @param rng - Random source.
 * @returns A new array in random order.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * A short id that is unique within this process even with a fixed rng.
 *
 * @param prefix - e.g. 'cand' or 'pitch'.
 * @param rng - Random source.
 * @returns e.g. 'cand-k3x9q2-1f'.
 */
export function rollId(prefix: string, rng: Rng): string {
  serial += 1;
  const random = Math.floor(rng() * 36 ** 6).toString(36).padStart(6, '0');
  return `${prefix}-${random}-${serial.toString(36)}`;
}

function trait(rng: Rng): number {
  return Math.round((0.7 + 0.6 * rng()) * 100) / 100;
}

/**
 * Hidden traits, each uniform in 0.7-1.3.
 *
 * @param rng - Random source.
 * @returns Stamina, resilience and talent.
 */
export function rollTraits(rng: Rng): Traits {
  return { stamina: trait(rng), resilience: trait(rng), talent: trait(rng) };
}

function hairColour(age: number, rng: Rng): string {
  if (rng() < 0.12) return pick(DYED_HAIR, rng);
  // Older people go grey more often; a few young ones do too.
  const greyChance = age >= 55 ? 0.6 : age >= 45 ? 0.25 : 0.03;
  if (rng() < greyChance) return pick(GREY_HAIR, rng);
  return pick(NATURAL_HAIR, rng);
}

/**
 * How a new person looks.
 *
 * @param age - Their age, which nudges grey hair.
 * @param rng - Random source.
 * @returns A look with CSS hex colours.
 */
export function rollLook(age: number, rng: Rng): Look {
  return {
    skin: pick(SKIN_TONES, rng),
    hair: hairColour(age, rng),
    hairStyle: pick(HAIR_STYLES, rng),
    shirt: pick(SHIRTS, rng),
    glasses: rng() < 0.3,
  };
}

/** Initials that start plenty of names in many languages. */
const INITIALS = 'ABCDEFGHIJKLMNOPRSTVWYZ'.split('');

/**
 * Distinct first-name initials, to stop Haiku reusing its favourite names.
 *
 * @param count - How many.
 * @param rng - Random source.
 * @returns Upper-case letters.
 */
export function rollInitials(count: number, rng: Rng): string[] {
  return shuffle(INITIALS, rng).slice(0, count);
}

const MUSES = [
  'a lighthouse', 'sourdough', 'competitive yo-yo', 'tax law', 'pigeons',
  'a haunted printer', 'ice hockey', 'opera', 'fermentation', 'llamas',
  'a cruise ship', 'beekeeping', 'karaoke', 'a failed band', 'chess',
  'magic tricks', 'a submarine', 'bonsai', 'the circus', 'parking fines',
  'medieval history', 'a food truck', 'astrology', 'model trains',
  'a lottery win', 'marathon running', 'cheese', 'a cult (left early)',
  'interpretive dance', 'crosswords', 'a goat farm', 'stand-up comedy',
];

/**
 * A few random topics to seed variety in generated text.
 *
 * @param count - How many.
 * @param rng - Random source.
 * @returns Short noun phrases.
 */
export function rollMuses(count: number, rng: Rng): string[] {
  return shuffle(MUSES, rng).slice(0, count);
}
