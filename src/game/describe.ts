/** The worker's condition in words, for the brain's persona prompt. */

import type { Attitude, GameState, Project, Worker } from '../shared/types';
import { gapFor } from './levels';

/** Highest first: the first band the stat falls under wins. */
type Bands = readonly (readonly [number, string])[];

const ENERGY_WORDS: Bands = [
  [10, 'running on fumes'],
  [25, 'exhausted'],
  [45, 'tired'],
];

const MOOD_WORDS: Bands = [
  [10, 'miserable'],
  [30, 'fed up'],
  [45, 'grumpy'],
];

const SANITY_WORDS: Bands = [
  [15, 'barely holding it together'],
  [35, 'on the edge'],
  [60, 'frazzled'],
];

/** Stats at or above these get a cheerful word instead. */
const HIGH = { energy: 85, mood: 80 } as const;

const ATTITUDE_WORDS: Readonly<Record<Attitude, string | undefined>> = {
  neutral: undefined,
  loyal: 'loyal to the boss',
  scared: 'terrified of the boss',
  bitter: 'resents the boss',
  'sucking-up': 'sucking up to the boss',
};

/**
 * Short phrases describing how the worker is doing.
 *
 * @param state - The game state.
 * @returns e.g. ["exhausted", "miserable", "stuck on: Bluetooth pairing"];
 *   empty without a worker.
 */
export function describeCondition(state: GameState): string[] {
  const worker = state.worker;
  if (!worker) return [];
  const { energy, mood, sanity } = worker.stats;
  const words = [
    bandWord(ENERGY_WORDS, energy) ?? cheerful(energy >= HIGH.energy, 'full of energy'),
    bandWord(MOOD_WORDS, mood) ?? cheerful(mood >= HIGH.mood, 'in a great mood'),
    bandWord(SANITY_WORDS, sanity),
    activityWord(worker, state.project),
    overloadWord(worker, state.project),
    worker.wantsCoffeeSince !== undefined ? 'desperate for coffee' : undefined,
    worker.boost && worker.boost.until > state.lastTickAt ? 'rushing' : undefined,
    ATTITUDE_WORDS[worker.attitude],
  ];
  return words.filter((w): w is string => w !== undefined);
}

function bandWord(bands: Bands, value: number): string | undefined {
  return bands.find(([max]) => value < max)?.[1];
}

function cheerful(high: boolean, word: string): string | undefined {
  return high ? word : undefined;
}

function activityWord(worker: Worker, project: Project | undefined): string | undefined {
  switch (worker.activity) {
    case 'arriving':
      return 'just arrived';
    case 'idle':
      return 'nothing to work on';
    case 'working':
      return 'hard at work';
    case 'stuck': {
      const index = project?.stuckOn;
      const part = index === undefined ? undefined : project?.hardParts[index];
      return part ? `stuck on: ${part.title}` : 'stuck';
    }
    case 'coffee':
      return 'on a coffee break';
    case 'asleep':
      return 'asleep at the desk';
    case 'leaving':
      return 'leaving for good';
  }
}

function overloadWord(worker: Worker, project: Project | undefined): string | undefined {
  if (!project) return undefined;
  return gapFor(worker.level, project.difficulty) > 0 ? 'out of their depth' : undefined;
}
