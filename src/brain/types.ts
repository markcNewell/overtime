/**
 * The brain's own result types. Game-wide types live in src/shared/.
 */

import type {
  Candidate,
  ChatRequest,
  ChatTone,
  Pitch,
} from '../shared/types';

/** One line from the worker: spoken, thought, and maybe a memory. */
export interface WorkerLine {
  /** Spoken aloud (speech bubble). */
  say?: string;
  /** Kept private (thought bubble). */
  think?: string;
  /** Something worth adding to the worker's memories. */
  remember?: string;
}

/** The worker's answer to a boss chat message. */
export interface ChatReply {
  say: string;
  /** How the boss's message came across. */
  tone: ChatTone;
  /** A fact about the boss worth keeping. */
  remember?: string;
  /** Something the worker agreed to do: take a break or get back to work. */
  action?: ChatRequest;
}

/** What a departing worker leaves behind. */
export interface Farewell {
  lastWords: string;
  /** A note to whoever sits here next. */
  stickyNote: string;
  /** Six words at most. */
  mugText: string;
}

/** The part of a candidate Claude writes; the app rolls the rest. */
export type CandidateBio = Omit<Candidate, 'id' | 'traits' | 'look'>;

/** A pitch before it gets an id. */
export type PitchDraft = Omit<Pitch, 'id' | 'filePath'>;
