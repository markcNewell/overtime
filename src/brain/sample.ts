/**
 * A small hand-built game state for tests, the smoke test and previews.
 * Not used by the game itself.
 */

import type { GameState, Project, Worker } from '../shared/types';

const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);

/**
 * A mid-level worker a couple of hours into the job, a bit worn down.
 *
 * @param patch - Fields to override.
 * @returns A worker.
 */
export function sampleWorker(patch: Partial<Worker> = {}): Worker {
  return {
    id: 'cand-sample-1',
    name: 'Priyanka Osei',
    age: 31,
    pronouns: 'she/her',
    level: 'mid',
    personality: 'Sunny optimist who narrates her own debugging',
    specialty: 'Dark mode for spreadsheets',
    quirk: 'Keeps a rubber duck called Gerald on her monitor',
    redFlag: 'Asked whether the office has a panic room',
    backstory: 'Spent five years building apps for a bakery chain that ' +
      'turned out to be one man and a very big oven.',
    traits: { stamina: 1, resilience: 0.9, talent: 1.1 },
    look: {
      skin: '#A86F45', hair: '#16110E', hairStyle: 'curly',
      shirt: '#4D96FF', glasses: true,
    },
    hiredAt: T0,
    stats: { energy: 38, mood: 42, sanity: 55 },
    xp: 50,
    ledger: {
      shocks: 3, shouts: 1, praises: 1, bonuses: 0,
      kindChats: 1, cruelChats: 0, coffees: 1, sabotages: 0,
    },
    attitude: 'bitter',
    memories: [
      { at: T0 + 60_000, kind: 'desk',
        text: 'Found a mug saying "World\'s Okayest Developer"' },
      { at: T0 + 600_000, kind: 'boss', text: "The boss's name is Mark" },
      { at: T0 + 900_000, kind: 'boss', text: 'Boss supports Arsenal' },
      { at: T0 + 1_800_000, kind: 'work',
        text: 'Shipped Sock Ledger; the boss called it Buggy' },
    ],
    projectsDone: 1,
    activity: 'stuck',
    activitySince: T0 + 7_000_000,
    recentShocks: [],
    recentPraises: [],
    recentSabotages: [],
    minutesSinceBreak: 25,
    lowMoodMinutes: 0,
    ...patch,
  };
}

/**
 * A project half done and stuck on its second hard part.
 *
 * @param patch - Fields to override.
 * @returns A project.
 */
export function sampleProject(patch: Partial<Project> = {}): Project {
  return {
    id: 'pitch-sample-1',
    title: 'Toaster OS',
    tagline: 'A real operating system for your toaster.',
    difficulty: 4,
    description: 'Brings multitasking, user accounts and mandatory updates ' +
      'to toast. Bread is now a subscription.',
    hardParts: [
      { at: 0.2, severity: 2, title: 'Crumb-tray storage',
        detail: 'The only storage is a crumb tray with 4 KB of memory.' },
      { at: 0.5, severity: 3, title: 'Mandatory updates',
        detail: 'An update bricks the toaster mid-crumpet.' },
    ],
    startedAt: T0 + 3_600_000,
    progress: 0.52,
    workMinutes: 60,
    qualitySum: 36,
    hardPartsHit: [0, 1],
    stuckOn: 1,
    stuckMinutesLeft: 12,
    ...patch,
  };
}

/**
 * A whole game state around `sampleWorker` and `sampleProject`.
 *
 * @param patch - Fields to override.
 * @returns A game state.
 */
export function sampleState(patch: Partial<GameState> = {}): GameState {
  return {
    version: 1,
    worker: sampleWorker(),
    project: sampleProject(),
    pitches: [],
    candidates: [],
    pastWorkers: [{
      id: 'cand-past-1', name: 'Tomasz Wiśniewski', level: 'senior',
      hiredAt: T0 - 86_400_000, endedAt: T0 - 3_600_000,
      ending: 'rage-quit', projectsDone: 2, lastWords: 'I QUIT!',
    }],
    deskLeftovers: [],
    releases: [{
      projectId: 'pitch-old-1', title: 'Sock Ledger',
      workerName: 'Priyanka Osei', finishedAt: T0 + 1_800_000,
      quality: 0.55, grade: 'Buggy',
    }],
    chat: [
      { at: T0 + 500_000, from: 'boss', text: "Hi, I'm Mark. Welcome aboard." },
      { at: T0 + 520_000, from: 'worker',
        text: 'Hi Mark! I promise not to break anything. Much.' },
    ],
    lastTickAt: T0 + 7_200_000,
    settings: {
      alwaysOnTop: true, hideFromScreenShare: false, claudePath: '',
      model: 'haiku', filesDir: '',
    },
    brainStatus: 'ok',
    ...patch,
  };
}
