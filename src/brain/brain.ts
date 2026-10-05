/**
 * The worker's brain: every request the game makes of Claude.
 *
 * Each method builds a prompt, asks the runner, validates the reply and,
 * on any failure at all, returns canned content with `offline: true`. The
 * game must never stall because Claude is missing or rate-limited.
 */

import type {
  Candidate,
  EndingKind,
  GameState,
  Pitch,
  Project,
} from '../shared/types';
import {
  fallbackBios,
  fallbackChat,
  fallbackFarewell,
  fallbackLine,
  fallbackPitch,
  fallbackReleaseNotes,
} from './fallback';
import { BANDS } from './bands';
import {
  candidatesPrompt,
  chatPrompt,
  farewellPrompt,
  feelingNote,
  firstName,
  personaSystem,
  pitchesPrompt,
  releaseNotesPrompt,
  thinkPrompt,
  writerSystem,
} from './prompts';
import {
  rollId,
  rollInitials,
  rollLook,
  rollMuses,
  rollTraits,
  type Rng,
} from './roll';
import type { RunOptions, Runner } from './runner';
import type {
  CandidateBio,
  ChatReply,
  Farewell,
  PitchDraft,
  WorkerLine,
} from './types';
import {
  ensureJunior,
  parseBios,
  parseChatReply,
  parseFarewell,
  parsePitchDrafts,
  parseReleaseNotes,
  parseWorkerLine,
  spreadPitches,
} from './validate';

export type { ChatReply, Farewell, WorkerLine } from './types';

/** Generous: candidates and pitches write a few hundred tokens. */
const WRITER_RUN: RunOptions = { priority: 'normal', timeoutMs: 90_000 };
const LINE_RUN: RunOptions = { priority: 'normal', timeoutMs: 45_000 };
const CHAT_RUN: RunOptions = { priority: 'high', timeoutMs: 45_000 };

/** Names and titles used in prompt examples, which Haiku likes to copy. */
const EXAMPLE_NAMES = ['Odile Fenwick'];
const EXAMPLE_TITLES = ['Umbrella Forecast'];

function namesToAvoid(state: GameState): string[] {
  const names = [
    ...state.candidates.map((c) => c.name),
    ...state.pastWorkers.map((w) => w.name),
    ...(state.worker ? [state.worker.name] : []),
  ];
  return [...new Set(names)];
}

function titlesToAvoid(state: GameState): string[] {
  const titles = [
    ...state.releases.map((r) => r.title),
    ...state.pitches.map((p) => p.title),
    ...(state.project ? [state.project.title] : []),
  ];
  return [...new Set(titles)];
}

/** Asks Claude for everything the worker says, writes and is. */
export class Brain {
  /** Why the last request fell back to canned content, for logs. */
  lastError?: string;

  /**
   * @param runner - Runs prompts; usually a `ClaudeRunner`.
   * @param rng - Random source for rolled traits, looks and fallbacks.
   */
  constructor(
    private readonly runner: Runner,
    private readonly rng: Rng = Math.random,
  ) {}

  /**
   * A fresh shortlist of job candidates.
   *
   * @param state - For names to avoid (current shortlist, past workers).
   * @param count - How many people, default 3.
   * @returns Candidates with rolled ids, traits and looks.
   */
  async candidates(
    state: GameState,
    count = 3,
  ): Promise<{ candidates: Candidate[]; offline: boolean }> {
    const avoid = namesToAvoid(state);
    let bios: CandidateBio[];
    let offline = false;
    try {
      const prompt = candidatesPrompt(count, avoid,
        rollInitials(count, this.rng), rollMuses(3, this.rng));
      const raw = await this.runner.run(writerSystem(), prompt, WRITER_RUN);
      bios = parseBios(raw, [...avoid, ...EXAMPLE_NAMES], count);
      if (bios.length === 0) throw new Error('No usable candidates');
      this.lastError = undefined;
    } catch (err) {
      this.fail(err);
      bios = [];
      offline = true;
    }
    if (bios.length < count) {
      const used = [...avoid, ...bios.map((b) => b.name)];
      bios.push(...fallbackBios(count - bios.length, used, this.rng));
    }
    const people = ensureJunior(bios).map((bio) => this.hireable(bio));
    return { candidates: people, offline };
  }

  /**
   * Three pointless app ideas: one easy, one medium, one hard.
   *
   * @param state - For the worker and titles to avoid.
   * @returns Pitches with rolled ids, in difficulty order.
   */
  async pitches(
    state: GameState,
  ): Promise<{ pitches: Pitch[]; offline: boolean }> {
    const avoid = titlesToAvoid(state);
    let drafts: PitchDraft[];
    let offline = false;
    try {
      const prompt = pitchesPrompt(state.worker, avoid,
        rollMuses(3, this.rng));
      const raw = await this.runner.run(writerSystem(), prompt, WRITER_RUN);
      const parsed = parsePitchDrafts(raw);
      if (parsed.length === 0) throw new Error('No usable pitches');
      drafts = spreadPitches(parsed, [...avoid, ...EXAMPLE_TITLES],
        this.rng).drafts;
      this.lastError = undefined;
    } catch (err) {
      this.fail(err);
      drafts = this.cannedPitches(avoid);
      offline = true;
    }
    const pitches = drafts.map((d) => ({ ...d, id: rollId('pitch', this.rng) }));
    return { pitches, offline };
  }

  /**
   * One line in reaction to a situation (see `situationForEvent`).
   *
   * @param state - For the persona.
   * @param situation - What just happened, in words.
   * @returns A spoken or thought line, maybe with a memory.
   */
  async think(
    state: GameState,
    situation: string,
  ): Promise<{ line: WorkerLine; offline: boolean }> {
    const worker = state.worker;
    try {
      if (!worker) throw new Error('No worker to think');
      const raw = await this.runner.run(personaSystem(state, worker),
        thinkPrompt(situation, feelingNote(state, worker)), LINE_RUN);
      const line = parseWorkerLine(raw, firstName(worker));
      this.lastError = undefined;
      return { line, offline: false };
    } catch (err) {
      this.fail(err);
      return { line: fallbackLine(situation, state, this.rng), offline: true };
    }
  }

  /**
   * The worker's reply to a chat message, and how it came across.
   *
   * @param state - For the persona and recent chat.
   * @param message - What the boss typed.
   * @returns The reply, its tone, maybe a fact about the boss.
   */
  async chat(
    state: GameState,
    message: string,
  ): Promise<{ reply: ChatReply; offline: boolean }> {
    const worker = state.worker;
    try {
      if (!worker) throw new Error('No worker to chat with');
      const raw = await this.runner.run(personaSystem(state, worker, message),
        chatPrompt(message, feelingNote(state, worker)), CHAT_RUN);
      const reply = parseChatReply(raw, message, firstName(worker));
      this.lastError = undefined;
      return { reply, offline: false };
    } catch (err) {
      this.fail(err);
      return { reply: fallbackChat(message, this.rng), offline: true };
    }
  }

  /**
   * Release notes for a finished project, in the worker's voice.
   *
   * @param state - For the persona.
   * @param project - The finished project.
   * @param quality - 0-1.
   * @param grade - The grade name, e.g. 'Masterpiece'.
   * @returns Markdown without a title (the file adds one).
   */
  async releaseNotes(
    state: GameState,
    project: Project,
    quality: number,
    grade: string,
  ): Promise<{ markdown: string; offline: boolean }> {
    const worker = state.worker;
    try {
      if (!worker) throw new Error('No worker to write notes');
      const raw = await this.runner.run(personaSystem(state, worker),
        releaseNotesPrompt(project, quality, grade), WRITER_RUN);
      const markdown = parseReleaseNotes(raw);
      this.lastError = undefined;
      return { markdown, offline: false };
    } catch (err) {
      this.fail(err);
      const markdown = fallbackReleaseNotes(project, grade, quality,
        worker?.name ?? '');
      return { markdown, offline: true };
    }
  }

  /**
   * Last words, a sticky note for the next hire and a mug slogan.
   *
   * @param state - For the persona.
   * @param ending - How they are leaving.
   * @returns The farewell.
   */
  async farewell(
    state: GameState,
    ending: EndingKind,
  ): Promise<{ farewell: Farewell; offline: boolean }> {
    const worker = state.worker;
    try {
      if (!worker) throw new Error('No worker to say goodbye');
      const raw = await this.runner.run(personaSystem(state, worker),
        farewellPrompt(ending), LINE_RUN);
      const farewell = parseFarewell(raw, ending, firstName(worker), this.rng);
      this.lastError = undefined;
      return { farewell, offline: false };
    } catch (err) {
      this.fail(err);
      return { farewell: fallbackFarewell(ending, this.rng), offline: true };
    }
  }

  /** Roll the parts of a candidate the app decides. */
  private hireable(bio: CandidateBio): Candidate {
    return {
      ...bio,
      id: rollId('cand', this.rng),
      traits: rollTraits(this.rng),
      look: rollLook(bio.age, this.rng),
    };
  }

  private cannedPitches(avoid: readonly string[]): PitchDraft[] {
    const out: PitchDraft[] = [];
    for (const band of BANDS) {
      const used = [...avoid, ...out.map((p) => p.title)];
      out.push(fallbackPitch(band, used, this.rng));
    }
    return out;
  }

  private fail(err: unknown): void {
    this.lastError = err instanceof Error ? err.message : String(err);
  }
}
