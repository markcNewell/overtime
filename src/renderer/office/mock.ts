/**
 * A fake `window.overtime` for previewing the office in a plain browser
 * (or headless screenshots). Never used inside the real app, where the
 * preload script provides the API.
 *
 * `?mock=hire` shows the hiring screen; anything else shows a busy office.
 */

import type { OvertimeApi } from '../../shared/ipc';
import type { Candidate, GameState, Look, Worker } from '../../shared/types';

const HOUR = 3_600_000;

function look(skin: string, hair: string, hairStyle: Look['hairStyle'], shirt: string, glasses = false): Look {
  return { skin, hair, hairStyle, shirt, glasses };
}

const CANDIDATES: Candidate[] = [
  {
    id: 'c1',
    name: 'Priya Okafor',
    age: 23,
    pronouns: 'she/her',
    level: 'junior',
    personality: 'Relentlessly upbeat, cries at standups',
    specialty: 'Blockchain for toasters',
    quirk: 'Names every variable after a cheese',
    redFlag: 'Lists "vibes" as a programming language',
    backstory: 'Dropped out of a bootcamp because it was too structured.',
    traits: { stamina: 1.2, resilience: 0.75, talent: 1.1 },
    look: look('#c68c5f', '#2b1b14', 'curly', '#5ab0d6', true),
  },
  {
    id: 'c2',
    name: 'Gary Pembleton',
    age: 51,
    pronouns: 'he/him',
    level: 'senior',
    personality: 'Has seen things. Will tell you about them.',
    specialty: 'COBOL, emotionally',
    quirk: 'Prints out pull requests to review them',
    redFlag: 'Refers to the cloud as "someone else\'s shed"',
    backstory: 'Twenty years at a bank. Escaped through a ventilation shaft.',
    traits: { stamina: 0.8, resilience: 1.3, talent: 0.9 },
    look: look('#f1c7a5', '#9a9a9a', 'bald', '#8a6f4e'),
  },
  {
    id: 'c3',
    name: 'Sam Reyes',
    age: 29,
    pronouns: 'they/them',
    level: 'mid',
    personality: 'Calm, unsettlingly calm',
    specialty: 'Microservices for single-page sites',
    quirk: 'Only speaks in commit messages before 10am',
    redFlag: 'Has a tattoo of a stack trace',
    backstory: 'Previously built 14 to-do apps. None of them are done.',
    traits: { stamina: 1.0, resilience: 1.0, talent: 1.25 },
    look: look('#8d5a3b', '#d6457a', 'mohawk', '#f2b134'),
  },
];

function worker(now: number): Worker {
  return {
    ...CANDIDATES[2]!,
    hiredAt: now - 30 * HOUR,
    stats: { energy: 38, mood: 52, sanity: 71 },
    xp: 61,
    ledger: { shocks: 7, shouts: 2, praises: 4, bonuses: 1, kindChats: 3, cruelChats: 1, coffees: 5 },
    attitude: 'neutral',
    memories: [
      { at: now - 26 * HOUR, kind: 'desk', text: "Found a mug from Dave: 'World's okayest dev'" },
      { at: now - 20 * HOUR, kind: 'boss', text: 'The boss supports Arsenal and is sad about it' },
      { at: now - 3 * HOUR, kind: 'work', text: 'Shipped Uber for Pigeons (Buggy)' },
    ],
    projectsDone: 1,
    activity: 'stuck',
    activitySince: now - 600_000,
    recentShocks: [],
    recentPraises: [],
    lowMoodMinutes: 0,
  };
}

function mockState(scenario: string): GameState {
  const now = Date.now();
  const base: GameState = {
    version: 1,
    pitches: [],
    candidates: [],
    pastWorkers: [],
    deskLeftovers: [
      { kind: 'mug', text: "World's okayest dev", fromWorker: 'Dave' },
      { kind: 'sticky-note', text: 'Do not click him. Trust me.', fromWorker: 'Dave' },
    ],
    releases: [
      {
        projectId: 'r1',
        title: 'Uber for Pigeons',
        workerName: 'Sam Reyes',
        finishedAt: now - 3 * HOUR,
        quality: 0.55,
        grade: 'Buggy',
      },
    ],
    chat: [
      { at: now - 2 * HOUR, from: 'boss', text: 'Morning Sam, how is it going?' },
      { at: now - 2 * HOUR + 5000, from: 'worker', text: 'The pigeons have unionised. Otherwise fine.' },
      { at: now - HOUR, from: 'system', text: 'Assigned "Smart Fridge Horoscopes".' },
    ],
    lastTickAt: now,
    settings: {
      alwaysOnTop: true,
      hideFromScreenShare: false,
      claudePath: '',
      model: 'haiku',
      filesDir: '/Users/you/Documents/Overtime',
    },
    brainStatus: 'ok',
  };
  if (scenario === 'hire') return { ...base, candidates: CANDIDATES };
  if (scenario === 'pitches') {
    return {
      ...base,
      worker: { ...worker(now), activity: 'idle' },
      pitches: [
        {
          id: 'x1',
          title: 'Tinder for Houseplants',
          tagline: 'Swipe right on photosynthesis',
          difficulty: 2,
          description: 'Matches lonely ferns. Nobody asked for this.',
          hardParts: [
            { at: 0.4, severity: 1, title: 'Cacti keep ghosting', detail: 'Retention is 0%.' },
            { at: 0.7, severity: 2, title: 'Photo upload of soil', detail: 'All brown.' },
          ],
          filePath: '/Users/you/Documents/Overtime/pitches/a.md',
        },
        {
          id: 'x2',
          title: 'Blockchain Doorbell',
          tagline: 'Every ding-dong, immutable',
          difficulty: 3,
          description: 'Mints an NFT each time someone rings. Gas fees exceed rent.',
          hardParts: [
            { at: 0.3, severity: 2, title: 'Consensus on who rang', detail: 'Nodes disagree.' },
            { at: 0.6, severity: 2, title: 'Doorbell needs a wallet', detail: 'Seed phrase lost.' },
          ],
        },
        {
          id: 'x3',
          title: 'AI Sock Matcher',
          tagline: 'Deep learning for the laundry basket',
          difficulty: 5,
          description: 'Finds the missing sock using 40 GPUs and a prayer.',
          hardParts: [
            { at: 0.15, severity: 3, title: 'Training data is all left socks', detail: 'Bias.' },
            { at: 0.5, severity: 3, title: 'Socks are not real', detail: 'Existential.' },
            { at: 0.85, severity: 2, title: 'GPU melts the dryer', detail: 'Fire.' },
          ],
        },
      ],
    };
  }
  return {
    ...base,
    worker: worker(now),
    project: {
      id: 'p1',
      title: 'Smart Fridge Horoscopes',
      tagline: 'Your yoghurt knows your future',
      difficulty: 4,
      description: 'Reads the stars, then your leftovers.',
      hardParts: [
        { at: 0.2, severity: 2, title: 'Fridge API is a fax machine', detail: 'Literally.' },
        { at: 0.55, severity: 3, title: 'Mercury in retrograde', detail: 'All tests fail.' },
        { at: 0.8, severity: 1, title: 'Cheese drawer auth', detail: 'OAuth for dairy.' },
      ],
      startedAt: now - HOUR,
      progress: 0.57,
      workMinutes: 60,
      qualitySum: 40,
      hardPartsHit: [0, 1],
      stuckOn: 1,
      stuckMinutesLeft: 12,
    },
  };
}

/** Install the fake API on `window.overtime`. */
export function installMockApi(): void {
  const scenario = new URLSearchParams(location.search).get('mock') ?? 'busy';
  const state = mockState(scenario);
  const noop = async (): Promise<void> => undefined;
  const api: OvertimeApi = {
    getState: async () => state,
    onState: () => () => undefined,
    onEffect: () => () => undefined,
    onOfficeTab: () => () => undefined,
    act: noop,
    chat: noop,
    hire: noop,
    rerollCandidates: noop,
    assign: noop,
    openOffice: () => undefined,
    openPath: () => undefined,
    setInteractive: () => undefined,
    updateSettings: noop,
    testClaude: async () => ({ ok: true, message: 'Claude is ready.' }),
  };
  window.overtime = api;
}
