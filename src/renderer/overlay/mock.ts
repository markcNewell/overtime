/**
 * Preview mode: a fake `window.overtime` with canned game states, used when
 * the overlay is opened as a plain page (no Electron preload). Pick a
 * scenario with `?mock=<name>`; `scripts/preview-overlay.mjs` screenshots
 * every one of them.
 *
 * The mock also reacts a little (coffee, praise, chat...) so the page can be
 * clicked around in a browser.
 */

import type { DirectAction, Effect, OvertimeApi } from '../../shared/ipc';
import type {
  Activity,
  EndingKind,
  GameState,
  Leftover,
  Look,
  Project,
  Worker,
} from '../../shared/types';

/** UI to open straight after load, so screenshots can show it. */
export interface MockUi {
  menu?: boolean;
  fireConfirm?: boolean;
  chat?: string;
  hover?: boolean;
  /** A `data-hit` key (or `act:<action>` in the menu) whose tooltip to show. */
  tip?: string;
  effect?: Effect;
  /** ms after load to play `effect`. */
  effectAt?: number;
}

interface Scenario {
  build: (now: number) => GameState;
  ui?: MockUi;
}

const MIN = 60_000;

export const LOOKS = {
  priya: { skin: '#c68863', hair: '#2b1b14', hairStyle: 'long', shirt: '#4f8fe6', glasses: true },
  dev: { skin: '#f1c9a5', hair: '#d8a24a', hairStyle: 'short', shirt: '#ef6f6c', glasses: false },
  sam: { skin: '#8d5a3b', hair: '#1d1512', hairStyle: 'curly', shirt: '#5cbf8a', glasses: false },
  mei: { skin: '#f3d2b3', hair: '#3a2a4a', hairStyle: 'bun', shirt: '#b57cf2', glasses: true },
  rex: { skin: '#e7b48f', hair: '#e2574c', hairStyle: 'mohawk', shirt: '#3b3d4f', glasses: false },
  gus: { skin: '#d9a07a', hair: '#8e8a8f', hairStyle: 'bald', shirt: '#f2b33d', glasses: true },
} satisfies Record<string, Look>;

const LEFTOVERS: Leftover[] = [
  { kind: 'mug', text: "World's Okayest Developer", fromWorker: 'Dana' },
  { kind: 'sticky-note', text: 'The build is haunted. Do not run it after 5pm.', fromWorker: 'Dana' },
  { kind: 'half-finished-project', text: 'Blockchain for Toasters (64%)', fromWorker: 'Dana' },
];

function worker(now: number, look: Look, patch: Partial<Worker> = {}): Worker {
  return {
    id: 'w-' + look.hairStyle,
    name: 'Priya Natarajan',
    age: 29,
    pronouns: 'she/her',
    level: 'mid',
    personality: 'Relentlessly upbeat, cries at standups',
    specialty: 'Blockchain for toasters',
    quirk: 'Names every variable after a cheese',
    redFlag: 'Lists "vibes" as a programming language',
    backstory: 'Left a bank to "follow the hype".',
    traits: { stamina: 1, resilience: 1, talent: 1 },
    look,
    hiredAt: now - 3 * 24 * 60 * MIN,
    stats: { energy: 72, mood: 70, sanity: 82 },
    xp: 64,
    ledger: { shocks: 1, shouts: 0, praises: 3, bonuses: 0, kindChats: 4, cruelChats: 0, coffees: 2, sabotages: 0 },
    attitude: 'loyal',
    memories: [],
    projectsDone: 2,
    activity: 'working',
    activitySince: now - 20 * MIN,
    recentShocks: [],
    recentPraises: [],
    recentSabotages: [],
    minutesSinceBreak: 25,
    lowMoodMinutes: 0,
    ...patch,
  };
}

const MYSTERY = {
  at: 0.5,
  severity: 2 as const,
  title: 'Login works only on Tuesdays',
  detail: 'Nobody touched the auth code. Allegedly.',
  mystery: true,
};

function project(now: number, progress: number, stuckOn?: number): Project {
  const p: Project = {
    id: 'p1',
    title: 'Uber for Houseplants',
    tagline: 'On-demand watering by strangers',
    difficulty: 3,
    description: 'Your fern, their schedule.',
    hardParts: [
      { at: 0.3, severity: 2, title: 'Ferns refuse OAuth', detail: 'No thumbs.' },
      { at: 0.7, severity: 3, title: 'Surge pricing for cacti', detail: 'Nobody agrees.' },
      MYSTERY,
    ],
    startedAt: now - 70 * MIN,
    progress,
    workMinutes: 60,
    qualitySum: 42,
    hardPartsHit: [],
  };
  if (stuckOn !== undefined) {
    p.stuckOn = stuckOn;
    p.stuckMinutesLeft = 12;
    p.hardPartsHit = [stuckOn];
  }
  return p;
}

function state(now: number, patch: Partial<GameState> = {}): GameState {
  return {
    version: 1,
    pitches: [],
    candidates: [],
    pastWorkers: [],
    deskLeftovers: [],
    releases: [],
    chat: [],
    lastTickAt: now,
    settings: {
      alwaysOnTop: true,
      hideFromScreenShare: false,
      claudePath: '',
      model: 'haiku',
      filesDir: '',
    },
    brainStatus: 'ok',
    ...patch,
  };
}

function at(
  activity: Activity,
  look: Look,
  opts: { since?: number; patch?: Partial<Worker>; progress?: number | null; stuckOn?: number; extra?: Partial<GameState> } = {},
): (now: number) => GameState {
  return (now) => {
    const w = worker(now, look, { activity, activitySince: now - (opts.since ?? 10 * MIN), ...opts.patch });
    const prog = opts.progress === undefined ? 0.42 : opts.progress;
    return state(now, {
      worker: w,
      ...(prog === null ? {} : { project: project(now, prog, opts.stuckOn) }),
      ...opts.extra,
    });
  };
}

function ending(kind: EndingKind, look: Look, sinceMs: number): (now: number) => GameState {
  return at('leaving', look, {
    since: sinceMs,
    patch: { ending: kind, stats: { energy: 30, mood: 4, sanity: kind === 'lost-mind' ? 0 : 20 } },
  });
}

/** The page is screenshotted ~850 ms after load; endings allow for that. */
const SHOT_DELAY = 850;

const SCENARIOS: Record<string, Scenario> = {
  empty: { build: (now) => state(now, { deskLeftovers: LEFTOVERS }) },
  'empty-bare': { build: (now) => state(now) },
  'empty-tip': { build: (now) => state(now, { deskLeftovers: LEFTOVERS }), ui: { tip: 'leftover-note' } },
  arriving: { build: at('arriving', LOOKS.dev, { since: 2200 - SHOT_DELAY, progress: null, extra: { deskLeftovers: LEFTOVERS } }) },
  working: { build: at('working', LOOKS.priya) },
  'working-boost': {
    build: at('working', LOOKS.dev, { patch: { boost: { multiplier: 1.8, until: Date.now() + 8 * MIN }, stats: { energy: 60, mood: 48, sanity: 70 } } }),
  },
  stuck: { build: at('stuck', LOOKS.sam, { stuckOn: 0, progress: 0.31, patch: { stats: { energy: 55, mood: 44, sanity: 70 } } }) },
  coffee: { build: at('coffee', LOOKS.mei, { since: 40_000, patch: { coffeeUntil: Date.now() + 5 * MIN } }) },
  'coffee-walk': { build: at('coffee', LOOKS.mei, { since: 1500 - SHOT_DELAY }) },
  asleep: { build: at('asleep', LOOKS.priya, { patch: { stats: { energy: 0, mood: 40, sanity: 60 } } }) },
  idle: { build: at('idle', LOOKS.rex, { progress: null }) },
  tired: { build: at('working', LOOKS.gus, { patch: { stats: { energy: 12, mood: 50, sanity: 64 } } }) },
  sad: { build: at('working', LOOKS.sam, { patch: { stats: { energy: 50, mood: 26, sanity: 50 } } }) },
  angry: { build: at('working', LOOKS.rex, { patch: { attitude: 'bitter', stats: { energy: 50, mood: 12, sanity: 45 } } }) },
  crazy: { build: at('working', LOOKS.sam, { patch: { stats: { energy: 45, mood: 28, sanity: 22 } } }) },
  unhinged: { build: at('working', LOOKS.dev, { patch: { stats: { energy: 45, mood: 20, sanity: 6 } } }) },
  'bubble-say': {
    build: at('working', LOOKS.priya, {
      extra: { bubble: { kind: 'say', text: 'Do houseplants need two-factor auth? Asking for a fern.', until: Date.now() + MIN } },
    }),
  },
  'bubble-think': {
    build: at('stuck', LOOKS.sam, {
      stuckOn: 0,
      progress: 0.31,
      extra: { bubble: { kind: 'think', text: 'If I rename the bug, is it a feature?', until: Date.now() + MIN } },
    }),
  },
  'bubble-long': {
    build: at('coffee', LOOKS.mei, {
      since: 40_000,
      extra: {
        bubble: {
          kind: 'say',
          text: 'Honestly the coffee here is the only thing keeping this project alive, and I include myself in that.',
          until: Date.now() + MIN,
        },
      },
    }),
  },
  menu: { build: at('working', LOOKS.priya), ui: { menu: true, tip: 'act:sabotage' } },
  'menu-fire': { build: at('working', LOOKS.priya), ui: { menu: true, fireConfirm: true } },
  'menu-empty': { build: (now) => state(now, { deskLeftovers: LEFTOVERS }), ui: { menu: true, tip: 'act:office' } },
  'menu-bubble': {
    build: at('working', LOOKS.dev, {
      extra: { bubble: { kind: 'say', text: 'Is that the clipboard of doom?', until: Date.now() + MIN } },
    }),
    ui: { menu: true },
  },
  chat: { build: at('working', LOOKS.priya), ui: { chat: 'How is the fern app going?' } },
  'chat-reply': {
    build: at('working', LOOKS.priya, {
      extra: {
        bubble: {
          kind: 'say',
          text: 'Honestly? The ferns are winning. But I have a plan involving spreadsheets.',
          until: Date.now() + MIN,
        },
      },
    }),
    ui: { chat: '', effect: { type: 'react', tone: 'neutral' }, effectAt: 0 },
  },
  'chat-waiting': { build: at('working', LOOKS.sam, { extra: { brainStatus: 'thinking' } }), ui: { chat: '' } },
  'chat-coffee': {
    build: at('coffee', LOOKS.mei, {
      since: 40_000,
      extra: { bubble: { kind: 'say', text: 'Five more minutes, then back to the ferns.', until: Date.now() + MIN } },
    }),
    ui: { chat: 'Enjoy it!', effect: { type: 'react', tone: 'kind' }, effectAt: 0 },
  },
  glitch: { build: at('working', LOOKS.priya), ui: { effect: { type: 'glitch' }, effectAt: SHOT_DELAY - 500 } },
  'glitch-late': { build: at('working', LOOKS.priya), ui: { effect: { type: 'glitch' }, effectAt: SHOT_DELAY - 1100 } },
  'mystery-stuck': {
    build: at('stuck', LOOKS.dev, {
      stuckOn: 2,
      progress: 0.5,
      patch: { stats: { energy: 55, mood: 40, sanity: 48 } },
    }),
  },
  'mystery-tip': {
    build: at('stuck', LOOKS.dev, { stuckOn: 2, progress: 0.5, patch: { stats: { energy: 55, mood: 40, sanity: 48 } } }),
    ui: { tip: 'monitor' },
  },
  'react-kind': {
    build: at('working', LOOKS.mei, {
      extra: { bubble: { kind: 'say', text: 'Aww, you noticed! Best boss ever.', until: Date.now() + MIN } },
    }),
    ui: { effect: { type: 'react', tone: 'kind' }, effectAt: 0 },
  },
  'react-cruel': {
    build: at('working', LOOKS.sam, {
      extra: { bubble: { kind: 'say', text: 'Wow. Okay. I will just... keep typing then.', until: Date.now() + MIN } },
    }),
    ui: { effect: { type: 'react', tone: 'cruel' }, effectAt: 0 },
  },
  'react-cruel-bitter': {
    build: at('working', LOOKS.rex, { patch: { attitude: 'bitter', stats: { energy: 60, mood: 30, sanity: 60 } } }),
    ui: { effect: { type: 'react', tone: 'cruel' }, effectAt: 0 },
  },
  'react-neutral': {
    build: at('working', LOOKS.gus, {
      extra: { bubble: { kind: 'say', text: 'Fair point. Noted.', until: Date.now() + MIN } },
    }),
    ui: { effect: { type: 'react', tone: 'neutral' }, effectAt: SHOT_DELAY - 250 },
  },
  'monitor-tip': { build: at('working', LOOKS.priya), ui: { tip: 'monitor' } },
  hover: { build: at('working', LOOKS.priya), ui: { hover: true } },
  'hover-low': {
    build: at('working', LOOKS.rex, { patch: { stats: { energy: 15, mood: 22, sanity: 9 } } }),
    ui: { hover: true },
  },
  'hover-coffee': { build: at('coffee', LOOKS.mei, { since: 40_000 }), ui: { hover: true } },
  offline: { build: at('working', LOOKS.priya, { extra: { brainStatus: 'offline' } }), ui: { tip: 'offline' } },
  thinking: { build: at('working', LOOKS.dev, { extra: { brainStatus: 'thinking' } }) },
  zap: { build: at('working', LOOKS.priya), ui: { effect: { type: 'zap' }, effectAt: SHOT_DELAY - 280 } },
  smoke: { build: at('working', LOOKS.dev, { patch: { stats: { energy: 50, mood: 30, sanity: 50 } } }), ui: { effect: { type: 'smoke' }, effectAt: 0 } },
  'level-up': { build: at('working', LOOKS.sam), ui: { effect: { type: 'level-up' }, effectAt: 0 } },
  confetti: { build: at('working', LOOKS.mei), ui: { effect: { type: 'confetti' }, effectAt: 0 } },
  'ending-lost-mind': { build: ending('lost-mind', LOOKS.sam, 3100 - SHOT_DELAY) },
  'ending-lost-mind-start': { build: ending('lost-mind', LOOKS.priya, 900 - SHOT_DELAY) },
  'ending-fried': { build: ending('fried', LOOKS.dev, 3900 - SHOT_DELAY) },
  'ending-fried-xray': { build: ending('fried', LOOKS.dev, 1000 - SHOT_DELAY) },
  'ending-fried-sooty': { build: ending('fried', LOOKS.dev, 2300 - SHOT_DELAY) },
  'ending-rage-quit': { build: ending('rage-quit', LOOKS.rex, 3300 - SHOT_DELAY) },
  'ending-rage-flip': { build: ending('rage-quit', LOOKS.rex, 1750 - SHOT_DELAY) },
  'ending-fired': { build: ending('fired', LOOKS.gus, 3600 - SHOT_DELAY) },
};

/** Names of every scenario, for the preview script. */
export const SCENARIO_NAMES = Object.keys(SCENARIOS);

const CANNED_REPLIES = [
  "Sure thing, boss. I'll get right on that. Eventually.",
  'Is this a performance review? I wasn’t told there’d be a performance review.',
  'Can we circle back on that after my coffee?',
];

/**
 * Build the fake API for a scenario. Unknown names fall back to `working`.
 */
export function installMock(name: string): { api: OvertimeApi; ui: MockUi } {
  const scenario: Scenario = SCENARIOS[name] ?? { build: at('working', LOOKS.priya) };
  let current = scenario.build(Date.now());
  const stateCbs = new Set<(s: GameState) => void>();
  const effectCbs = new Set<(e: Effect) => void>();
  const push = (patch: Partial<GameState>): void => {
    current = { ...current, ...patch };
    for (const cb of stateCbs) cb(current);
  };
  const say = (text: string, kind: 'say' | 'think' = 'say'): void =>
    push({ bubble: { text, kind, until: Date.now() + 6000 } });
  const patchWorker = (patch: Partial<Worker>): void => {
    if (current.worker) push({ worker: { ...current.worker, ...patch } });
  };

  const act = async (a: DirectAction): Promise<void> => {
    console.log('[mock] act', a.type);
    const w = current.worker;
    if (!w) return;
    switch (a.type) {
      case 'coffee':
        patchWorker({ activity: 'coffee', activitySince: Date.now() });
        window.setTimeout(() => patchWorker({ activity: current.project ? 'working' : 'idle', activitySince: Date.now() }), 9000);
        return;
      case 'praise':
        patchWorker({ stats: { ...w.stats, mood: Math.min(100, w.stats.mood + 8) } });
        say('Aw, thanks boss!');
        return;
      case 'shout':
        patchWorker({ stats: { ...w.stats, mood: Math.max(0, w.stats.mood - 6) }, boost: { multiplier: 1.3, until: Date.now() + 20_000 } });
        say('Yes boss. Sorry boss.');
        return;
      case 'bonus':
        patchWorker({ stats: { ...w.stats, mood: Math.min(100, w.stats.mood + 25) } });
        for (const cb of effectCbs) cb({ type: 'confetti' });
        say('A BONUS?! You are the best boss!');
        return;
      case 'shock':
        // Shocks hurt but no longer speed them up; only shouting does.
        patchWorker({ stats: { ...w.stats, mood: Math.max(0, w.stats.mood - 10) } });
        for (const cb of effectCbs) cb({ type: 'zap' });
        say('OW!');
        return;
      case 'sabotage': {
        const p = current.project;
        if (!p) return;
        for (const cb of effectCbs) cb({ type: 'glitch' });
        const index = p.hardParts.findIndex((h) => h.mystery);
        push({ project: { ...p, stuckOn: index, stuckMinutesLeft: 10 } });
        patchWorker({ activity: 'stuck', activitySince: Date.now() });
        say("Wait, what? I didn't touch that!");
        return;
      }
      case 'fire':
        patchWorker({ activity: 'leaving', ending: 'fired', activitySince: Date.now() });
        return;
    }
  };

  const api: OvertimeApi = {
    getState: async () => current,
    onState: (cb) => {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    onEffect: (cb) => {
      effectCbs.add(cb);
      return () => effectCbs.delete(cb);
    },
    onOfficeTab: () => () => undefined,
    act,
    chat: async (text) => {
      console.log('[mock] chat', text);
      push({ brainStatus: 'thinking' });
      window.setTimeout(() => {
        // Crude tone guess so the reactions can be tried in a browser.
        const tone = /thank|great|nice|love|good/i.test(text)
          ? 'kind'
          : /stupid|lazy|idiot|useless|hurry/i.test(text)
            ? 'cruel'
            : 'neutral';
        for (const cb of effectCbs) cb({ type: 'react', tone });
        push({ brainStatus: 'ok' });
        say(CANNED_REPLIES[Math.floor(Math.random() * CANNED_REPLIES.length)] ?? 'Mm-hm.');
      }, 1800);
    },
    hire: async () => undefined,
    rerollCandidates: async () => undefined,
    assign: async () => undefined,
    openOffice: (tab) => console.log('[mock] openOffice', tab ?? '(default)'),
    openPath: (path) => console.log('[mock] openPath', path),
    setInteractive: (on) => console.log('[mock] setInteractive', on),
    focusWindow: () => console.log('[mock] focusWindow'),
    updateSettings: async () => undefined,
    testClaude: async () => ({ ok: true, message: 'mock' }),
  };
  return { api, ui: scenario.ui ?? {} };
}
