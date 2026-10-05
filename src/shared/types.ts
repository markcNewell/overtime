/**
 * The whole game state and the vocabulary every part of the app shares.
 *
 * Everything here is plain data so it can be saved as JSON and sent over
 * Electron IPC unchanged. Times are epoch milliseconds unless the name says
 * otherwise. Stats run 0-100.
 */

export type Level = 'junior' | 'mid' | 'senior' | 'lead';
export type Pronouns = 'he/him' | 'she/her' | 'they/them';
export type Attitude = 'neutral' | 'loyal' | 'scared' | 'bitter' | 'sucking-up';
export type EndingKind = 'lost-mind' | 'fried' | 'rage-quit' | 'fired';
export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type Severity = 1 | 2 | 3;
export type ChatTone = 'kind' | 'neutral' | 'cruel';
/**
 * Something the worker agreed to do in a chat reply: take a coffee break,
 * or stop slacking and get back to the desk.
 */
export type ChatRequest = 'coffee' | 'work';
export type HairStyle = 'short' | 'long' | 'bun' | 'bald' | 'mohawk' | 'curly';

/**
 * What the worker is doing right now. The renderer picks the pose from this.
 *
 * - arriving: walking in from off-screen after being hired.
 * - idle: at the desk with no project (slacking, on their phone).
 * - working: typing away at the current project.
 * - stuck: hit a hard part of the project; progress crawls.
 * - coffee: at the coffee station; no progress, energy refills.
 * - asleep: energy ran out; slumped at the desk until woken.
 * - leaving: playing their ending; `Worker.ending` says which.
 */
export type Activity =
  | 'arriving'
  | 'idle'
  | 'working'
  | 'stuck'
  | 'coffee'
  | 'asleep'
  | 'leaving';

/** How they look. Colours are CSS hex strings. */
export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  glasses: boolean;
}

/** Hidden multipliers rolled at generation; 1 is average, range 0.7-1.3. */
export interface Traits {
  /** Slows energy drain. */
  stamina: number;
  /** Slows sanity loss. */
  resilience: number;
  /** Speeds skill gain and shortens time stuck on hard parts. */
  talent: number;
}

/** Someone on the hiring shortlist. */
export interface Candidate {
  id: string;
  name: string;
  age: number;
  pronouns: Pronouns;
  level: Level;
  /** One line, e.g. "Relentlessly upbeat, cries at standups". */
  personality: string;
  /** What they claim to be good at, e.g. "Blockchain for toasters". */
  specialty: string;
  quirk: string;
  /** A funny warning sign the recruiter missed. */
  redFlag: string;
  backstory: string;
  traits: Traits;
  look: Look;
}

export interface Stats {
  energy: number;
  mood: number;
  sanity: number;
}

/** Running count of how the boss has treated this worker. */
export interface Ledger {
  shocks: number;
  shouts: number;
  praises: number;
  bonuses: number;
  kindChats: number;
  cruelChats: number;
  coffees: number;
  /** Times the boss secretly broke their code. They don't know it's you. */
  sabotages: number;
}

export type MemoryKind = 'boss' | 'work' | 'desk' | 'self';

/** Something the worker has learned and will bring up later. */
export interface Memory {
  at: number;
  kind: MemoryKind;
  text: string;
}

export interface Worker extends Candidate {
  hiredAt: number;
  stats: Stats;
  xp: number;
  ledger: Ledger;
  attitude: Attitude;
  memories: Memory[];
  projectsDone: number;
  activity: Activity;
  activitySince: number;
  /** Temporary work-speed multiplier from a shock or shout. */
  boost?: { multiplier: number; until: number };
  /** Times of recent shocks, used for the "fried" ending. */
  recentShocks: number[];
  /** Times of recent praise, used for diminishing returns. */
  recentPraises: number[];
  /** Times of recent sabotage; each one in quick succession is nastier. */
  recentSabotages: number[];
  /** Work minutes since their last break, for taking breaks unasked. */
  minutesSinceBreak: number;
  /** Local calendar day (YYYY-MM-DD) of the last bonus. */
  lastBonusDay?: string;
  /** Consecutive minutes spent at rock-bottom mood. */
  lowMoodMinutes: number;
  /** Set when they have asked for coffee and not had it yet. */
  wantsCoffeeSince?: number;
  /** When the current coffee break ends. */
  coffeeUntil?: number;
  /** Set once an ending starts; the worker is then `leaving`. */
  ending?: EndingKind;
}

/** A point in a project where the developer will struggle. */
export interface HardPart {
  /** Fraction of the project (0-1) where it hits. */
  at: number;
  severity: Severity;
  title: string;
  detail: string;
  /**
   * A bug the boss planted by messing up their code. Hurts sanity more than
   * a normal hard part, and the worker has no idea where it came from.
   */
  mystery?: boolean;
}

/** A pointless app idea on offer. */
export interface Pitch {
  id: string;
  title: string;
  tagline: string;
  difficulty: Difficulty;
  description: string;
  hardParts: HardPart[];
  /** The markdown brief written to disk for this pitch. */
  filePath?: string;
}

export interface Project extends Pitch {
  startedAt: number;
  /** Fraction complete, 0-1. */
  progress: number;
  /** Minutes of actual work, the denominator for quality. */
  workMinutes: number;
  /** Sum of per-minute quality (0-1); quality = qualitySum / workMinutes. */
  qualitySum: number;
  /** Indices into `hardParts` already reached. */
  hardPartsHit: number[];
  /** Index of the hard part they are stuck on now, if any. */
  stuckOn?: number;
  stuckMinutesLeft?: number;
}

/** A finished project and its write-up. */
export interface Release {
  projectId: string;
  title: string;
  workerName: string;
  finishedAt: number;
  quality: number;
  grade: string;
  filePath?: string;
}

/** Something a departed worker left at the desk for the next hire. */
export interface Leftover {
  kind: 'mug' | 'sticky-note' | 'half-finished-project';
  text: string;
  fromWorker: string;
}

export interface PastWorker {
  id: string;
  name: string;
  level: Level;
  hiredAt: number;
  endedAt: number;
  ending: EndingKind;
  projectsDone: number;
  lastWords: string;
}

export interface ChatLine {
  at: number;
  from: 'boss' | 'worker' | 'system';
  text: string;
}

/** The speech or thought bubble over the worker's head. */
export interface Bubble {
  text: string;
  kind: 'say' | 'think';
  until: number;
}

export interface Settings {
  alwaysOnTop: boolean;
  /** Hide the overlay from screen shares and recordings. */
  hideFromScreenShare: boolean;
  /** Empty string means auto-detect the Claude CLI. */
  claudePath: string;
  model: string;
  /** Where pitch briefs and release notes are written. */
  filesDir: string;
}

export type BrainStatus = 'ok' | 'thinking' | 'offline';

export interface GameState {
  version: 1;
  worker?: Worker;
  project?: Project;
  /** The three projects on offer, empty when none are being offered. */
  pitches: Pitch[];
  /** The hiring shortlist, empty when nobody is being hired. */
  candidates: Candidate[];
  pastWorkers: PastWorker[];
  /** What the last worker left behind, waiting for the next hire. */
  deskLeftovers: Leftover[];
  releases: Release[];
  chat: ChatLine[];
  bubble?: Bubble;
  lastTickAt: number;
  settings: Settings;
  brainStatus: BrainStatus;
}

export type BossAction =
  | { type: 'shock' }
  | { type: 'shout' }
  | { type: 'praise' }
  | { type: 'coffee' }
  | { type: 'bonus' }
  | { type: 'fire' }
  | { type: 'sabotage' }
  | { type: 'chat'; tone: ChatTone; request?: ChatRequest };

export type BossActionType = BossAction['type'];

/** Things the simulation reports so the app can react (talk, write files). */
export type GameEvent =
  | { type: 'arrived' }
  | { type: 'hard-part-hit'; index: number }
  | { type: 'hard-part-cleared'; index: number }
  | { type: 'project-finished'; quality: number; grade: string }
  | { type: 'wants-coffee' }
  | { type: 'took-coffee-anyway' }
  /** They decided on their own it was time for a break. */
  | { type: 'took-break' }
  /** The boss broke their code; `index` is the planted hard part. */
  | { type: 'code-broken'; index: number }
  | { type: 'coffee-done' }
  | { type: 'fell-asleep' }
  | { type: 'woke-up' }
  | { type: 'level-up'; level: Level }
  | { type: 'attitude-changed'; from: Attitude; to: Attitude }
  | { type: 'shock-warning' }
  | { type: 'action-refused'; action: BossActionType; reason: string }
  | { type: 'ending'; kind: EndingKind };
