/**
 * Runs the office: ticks the simulation, reacts to what happens (the worker
 * talks, briefs and release notes get written, endings play out), and
 * handles everything the boss does from either window.
 *
 * All game rules live in src/game; all words come from src/brain. This class
 * only decides when to call them and keeps the state moving.
 */

import * as game from '../game';
import type { Farewell, WorkerLine } from '../brain';
import type { DirectAction, Effect, OfficeTab } from '../shared/ipc';
import type {
  ChatLine,
  ChatRequest,
  Complaint,
  ComplaintOutcome,
  ChatTone,
  EndingKind,
  GameEvent,
  GameState,
  HardPart,
  Pitch,
  Project,
  Settings,
} from '../shared/types';

const TICK_MS = 5_000;
const SAVE_EVERY_MS = 15_000;
/** Minimum gap between lines prompted by game events, to spare the quota. */
const EVENT_LINE_GAP_MS = 90_000;
const THOUGHT_MIN_MS = 8 * 60_000;
const THOUGHT_MAX_MS = 15 * 60_000;
/** How long the overlay's ending animation runs before the desk empties. */
const ENDING_MS = 9_000;
const CHAT_LOG_MAX = 100;
const CHAT_INPUT_MAX = 300;
const REPLY_INPUT_MAX = 1000;
/** A threat to go to HR files an email, but not more often than this. */
const COMPLAINT_GAP_MS = 10 * 60_000;
/** Unanswered complaints pile up to this many, then threats are just talk. */
const OPEN_COMPLAINTS_MAX = 3;
const COMPLAINTS_KEPT = 30;
/** Spoken lines that mean they're taking it to HR. */
const HR_THREAT = /\b(HR|human resources)\b|formal complaint|report(ing)? you\b/i;

/** How the worker's face reacts to each way a complaint can end. */
const OUTCOME_TONE: Record<ComplaintOutcome, ChatTone> = {
  apology: 'kind',
  gaslit: 'neutral',
  unconvinced: 'neutral',
  backfired: 'cruel',
};

/** The subset of Brain the director uses, so tests can fake it. */
export interface BrainLike {
  candidates(state: GameState): Promise<{
    candidates: GameState['candidates'];
    offline: boolean;
  }>;
  pitches(state: GameState): Promise<{ pitches: Pitch[]; offline: boolean }>;
  think(
    state: GameState,
    situation: string,
  ): Promise<{ line: WorkerLine; offline: boolean }>;
  chat(
    state: GameState,
    message: string,
  ): Promise<{
    reply: {
      say: string;
      tone: 'kind' | 'neutral' | 'cruel';
      remember?: string;
      action?: ChatRequest;
    };
    offline: boolean;
  }>;
  releaseNotes(
    state: GameState,
    project: Project,
    quality: number,
    grade: string,
  ): Promise<{ markdown: string; offline: boolean }>;
  farewell(
    state: GameState,
    ending: EndingKind,
  ): Promise<{ farewell: Farewell; offline: boolean }>;
  complaint(
    state: GameState,
    trigger: string,
  ): Promise<{ subject: string; body: string; offline: boolean }>;
  complaintReply(
    state: GameState,
    complaint: Complaint,
    reply: string,
  ): Promise<{ outcome: ComplaintOutcome; response: string; offline: boolean }>;
}

/** The file operations the director needs (src/files). */
export interface FilesLike {
  writePitchBrief(
    filesDir: string,
    pitch: Pitch,
    workerName: string,
    now: number,
  ): Promise<string>;
  startProjectFolder(
    filesDir: string,
    pitch: Pitch,
    now: number,
  ): Promise<{ briefPath: string; hardParts: HardPart[] }>;
  writeReleaseNotes(
    briefPath: string,
    project: Project,
    markdown: string,
    meta: { workerName: string; grade: string; quality: number; now: number },
  ): Promise<string>;
  fallbackBriefPath(filesDir: string, project: Project, now: number): string;
}

export interface DirectorDeps {
  brain: BrainLike;
  files: FilesLike;
  now: () => number;
  random: () => number;
  /** Push the latest state to every window. */
  publish: (state: GameState) => void;
  effect: (effect: Effect) => void;
  save: (state: GameState) => void;
  openOffice: (tab: OfficeTab) => void;
  log: (message: string, err?: unknown) => void;
}

/** Quick reactions to a shock, so clicking doesn't burn a Claude call. */
const SHOCK_YELPS: Record<string, string[]> = {
  neutral: ['OW!', 'Hey! That hurt!', 'Okay, okay, typing faster!'],
  loyal: ['Ow... I thought we were friends?', 'Ouch. Fair, I was slacking.'],
  scared: ['Sorry sorry sorry!', "I'm working! I'm working!", 'Eep!'],
  bitter: ['Really mature.', 'HR is going to hear about this.', 'Wow. Okay.'],
  'sucking-up': ['Thank you for the feedback, boss!', 'Ow! Great energy!'],
};

export class Director {
  private state: GameState;
  private timer: ReturnType<typeof setInterval> | undefined;
  private nextThoughtAt = 0;
  private lastEventLineAt = 0;
  private lineInFlight = false;
  private dirty = false;
  private lastSavedAt = 0;
  private fetchingCandidates = false;
  private fetchingPitches = false;
  private ending: { startedAt: number; farewell?: Farewell } | undefined;
  private busy = false;
  private offline = false;
  private filingComplaint = false;
  /** An important line that arrived while another was being written. */
  private queuedLine: string | undefined;
  /** Bugs planted while they were away, announced when they come back. */
  private readonly unnoticedBugs = new Set<string>();

  constructor(
    initial: GameState,
    private readonly deps: DirectorDeps,
  ) {
    this.state = initial;
  }

  /** Begin the day: come back from home if away, then start the clock. */
  start(): void {
    const now = this.deps.now();
    const awayMs = now - this.state.lastTickAt;
    // Time freezes while the app is closed: either they went home and come
    // back rested, or it was a short gap and nothing happened.
    this.state =
      this.state.worker && awayMs >= game.AWAY_MINUTES * 60_000
        ? game.goHome(this.state, now)
        : { ...this.state, lastTickAt: now };
    if (this.state.worker?.activity === 'leaving') {
      this.startEnding(this.state.worker.ending ?? 'rage-quit');
    }
    this.ensureWork();
    this.scheduleThought(now);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.commit(true);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.saveNow();
  }

  getState(): GameState {
    return this.state;
  }

  /** Called by the Claude runner as requests start and finish. */
  setBrainBusy(busy: boolean): void {
    this.busy = busy;
    this.refreshBrainStatus();
  }

  // ---------------------------------------------------------------------
  // The clock

  /** One step of the game loop. Public so tests can drive it. */
  tick(): void {
    const now = this.deps.now();
    const before = this.state;
    const { state, events } = game.tick(this.state, now, this.deps.random);
    this.state = state;
    this.handleEvents(events, before);
    this.maybeFinishEnding(now);
    this.maybeThink(now);
    this.commit();
    if (this.dirty && now - this.lastSavedAt >= SAVE_EVERY_MS) this.saveNow();
  }

  private handleEvents(events: GameEvent[], before: GameState): void {
    for (const event of events) this.handleEvent(event, before);
  }

  private handleEvent(event: GameEvent, before: GameState): void {
    const worker = this.state.worker;
    switch (event.type) {
      case 'arrived':
        void this.speak(arrivalSituation(this.state), true);
        return;
      case 'hard-part-hit': {
        const part = this.state.project?.hardParts[event.index];
        if (part?.mystery) {
          // Planted while they were away from the desk: they find it now.
          if (this.unnoticedBugs.delete(bugKey(part))) {
            void this.speak(
              `You sat back down and your code is broken: "${part.title}" - ` +
                `${part.detail}. It was fine when you left. React.`,
              true,
            );
          }
          return;
        }
        if (part) {
          void this.speak(
            `You just hit a hard part of the project: "${part.title}" - ` +
              `${part.detail}. React to it.`,
            true,
          );
        }
        return;
      }
      case 'hard-part-cleared':
        void this.speak('You finally got past the hard part you were stuck on.');
        return;
      case 'project-finished':
        if (before.project) {
          void this.shipRelease(before.project, event.quality, event.grade);
        }
        this.deps.effect({ type: 'confetti' });
        void this.speak(
          `You just finished the project "${before.project?.title ?? ''}". ` +
            `Honest quality verdict: ${event.grade}. React to shipping it.`,
          true,
        );
        this.ensureWork();
        this.commit(true);
        return;
      case 'wants-coffee': {
        const courage = event.attempt >= 3 ? ', and you are building up the courage to just go' : '';
        void this.speak(
          "You'd like a coffee but you're scared of your boss. Ask permission " +
            `(attempt ${event.attempt} of 3${courage}).`,
          true,
        );
        return;
      }
      case 'complaint-ignored':
        void this.speak(
          'Nobody has answered your HR complaint. You are now convinced the whole ' +
            'company is against you. React.',
          true,
        );
        return;
      case 'took-break':
        void this.speak(
          "The coffee timer went off: you're heading to make a coffee. Announce " +
            'it casually, and maybe tell the boss to stretch their legs too.',
          true,
        );
        return;
      case 'code-broken': {
        const part = this.state.project?.hardParts[event.index];
        this.deps.effect({ type: 'glitch' });
        if (!part) return;
        const away = worker?.activity === 'coffee' || worker?.activity === 'asleep';
        if (away) {
          this.unnoticedBugs.add(bugKey(part));
        } else {
          void this.speak(
            `Your code just broke for no reason: "${part.title}" - ` +
              `${part.detail}. You didn't touch anything. React.`,
            true,
          );
        }
        return;
      }
      case 'took-coffee-anyway':
        void this.speak(
          'Nobody answered, so you finally worked up the courage to make a coffee anyway.',
          true,
        );
        return;
      case 'fell-asleep':
        this.setBubble('Zzz...', 'think');
        return;
      case 'woke-up':
        return;
      case 'level-up':
        this.deps.effect({ type: 'level-up' });
        void this.speak(
          `You just got promoted to ${event.level} developer. React.`,
          true,
        );
        return;
      case 'attitude-changed':
        if (worker) this.log(`${worker.name} is now ${event.to}`);
        return;
      case 'shock-warning':
        this.deps.effect({ type: 'smoke' });
        return;
      case 'action-refused':
        this.setBubble(event.reason, 'think');
        return;
      case 'ending':
        this.startEnding(event.kind);
        return;
      case 'coffee-done':
        return;
    }
  }

  private maybeThink(now: number): void {
    if (now < this.nextThoughtAt) return;
    this.scheduleThought(now);
    const worker = this.state.worker;
    if (!worker) return;
    if (worker.activity === 'asleep') {
      this.setBubble('Zzz... five more minutes...', 'think');
      return;
    }
    if (worker.activity === 'leaving' || worker.activity === 'arriving') return;
    void this.speak(idleSituation(this.state, this.deps.random), true);
  }

  private scheduleThought(now: number): void {
    const spread = THOUGHT_MAX_MS - THOUGHT_MIN_MS;
    this.nextThoughtAt = now + THOUGHT_MIN_MS + this.deps.random() * spread;
  }

  // ---------------------------------------------------------------------
  // Boss actions

  act(action: DirectAction): void {
    const now = this.deps.now();
    const { state, events } = game.act(this.state, action, now, this.deps.random);
    this.state = state;
    this.handleEvents(events, state);
    const refused = events.some((e) => e.type === 'action-refused');
    if (!refused) this.react(action);
    this.commit();
  }

  /** The worker's immediate response to what the boss just did. */
  private react(action: DirectAction): void {
    const worker = this.state.worker;
    if (!worker || worker.activity === 'leaving') return;
    switch (action.type) {
      case 'shock': {
        const yelps = SHOCK_YELPS[worker.attitude] ?? SHOCK_YELPS.neutral!;
        const yelp = yelps[Math.floor(this.deps.random() * yelps.length)];
        if (yelp) {
          this.setBubble(yelp, 'say');
          this.maybeComplain(yelp);
        }
        return;
      }
      case 'praise':
        void this.speak('Your boss just praised you. React.', true);
        return;
      case 'shout':
        void this.speak('Your boss just shouted at you to work harder. React.', true);
        return;
      case 'bonus':
        void this.speak('Your boss just gave you a cash bonus! React.', true);
        return;
      case 'coffee':
        void this.speak('Your boss just sent you for a coffee break.', true);
        return;
      case 'deny-coffee':
        void this.speak('Your boss said no to your coffee. React.', true);
        return;
      case 'fire':
      case 'sabotage':
        // The ending and the broken code each have their own reaction.
        return;
    }
  }

  async chat(raw: string): Promise<void> {
    const text = raw.trim().slice(0, CHAT_INPUT_MAX);
    if (!text) return;
    const worker = this.state.worker;
    if (!worker || worker.activity === 'leaving') {
      this.addChat('system', "Nobody's at the desk to hear you.");
      this.commit();
      return;
    }
    this.addChat('boss', text);
    this.commit();
    const { reply, offline } = await this.deps.brain.chat(this.state, text);
    this.markOffline(offline);
    if (!this.isStillHere(worker.id)) return;
    const now = this.deps.now();
    const result = game.act(
      this.state,
      { type: 'chat', tone: reply.tone, request: reply.action },
      now,
      this.deps.random,
    );
    this.state = result.state;
    this.handleEvents(result.events, result.state);
    this.deps.effect({ type: 'react', tone: reply.tone });
    this.applyLine({ say: reply.say });
    if (reply.remember) this.remember('boss', reply.remember);
    this.commit();
  }

  // ---------------------------------------------------------------------
  // Hiring and projects

  hire(candidateId: string): void {
    if (this.state.worker) return;
    const now = this.deps.now();
    this.state = game.hire(this.state, candidateId, now, this.deps.random);
    const name = this.state.worker?.name ?? 'Someone';
    this.addChat('system', `${name} has joined the company.`);
    this.ensureWork();
    this.commit(true);
  }

  async rerollCandidates(): Promise<void> {
    await this.fetchCandidates(true);
  }

  async assign(pitchId: string): Promise<void> {
    const pitch = this.state.pitches.find((p) => p.id === pitchId);
    if (!pitch || !this.state.worker || this.state.project) return;
    const now = this.deps.now();
    let briefPath: string | undefined;
    let hardParts = pitch.hardParts;
    try {
      ({ briefPath, hardParts } = await this.deps.files.startProjectFolder(
        this.state.settings.filesDir,
        pitch,
        now,
      ));
    } catch (err) {
      this.log('Could not set up the project folder', err);
    }
    // The await gave the boss time to do something else; check again.
    if (!this.state.pitches.some((p) => p.id === pitchId)) return;
    this.state = game.assign(this.state, pitchId, now, hardParts);
    if (briefPath && this.state.project) {
      this.state = {
        ...this.state,
        project: { ...this.state.project, filePath: briefPath },
      };
    }
    this.addChat('system', `Assigned "${pitch.title}".`);
    void this.speak(
      `Your boss just assigned you a new project: "${pitch.title}" - ` +
        `${pitch.tagline} (difficulty ${pitch.difficulty} of 5). React.`,
      true,
    );
    this.commit(true);
  }

  /** Ask for whatever the office is missing: a hire, or a project. */
  private ensureWork(): void {
    const { worker, project, pitches, candidates } = this.state;
    if (!worker && candidates.length === 0) void this.fetchCandidates(false);
    if (worker && worker.activity !== 'leaving' && !project && pitches.length === 0) {
      void this.fetchPitches();
    }
  }

  private async fetchCandidates(replace: boolean): Promise<void> {
    if (this.fetchingCandidates) return;
    if (!replace && this.state.candidates.length > 0) return;
    this.fetchingCandidates = true;
    try {
      const { candidates, offline } = await this.deps.brain.candidates(this.state);
      this.markOffline(offline);
      if (this.state.worker) return;
      this.state = { ...this.state, candidates };
      this.commit();
    } finally {
      this.fetchingCandidates = false;
    }
  }

  private async fetchPitches(): Promise<void> {
    if (this.fetchingPitches) return;
    const worker = this.state.worker;
    if (!worker) return;
    this.fetchingPitches = true;
    try {
      const { pitches, offline } = await this.deps.brain.pitches(this.state);
      this.markOffline(offline);
      const written = await this.writeBriefs(pitches, worker.name);
      if (!this.isStillHere(worker.id) || this.state.project) return;
      this.state = { ...this.state, pitches: written };
      if (worker.projectsDone === 0) this.deps.openOffice('projects');
      this.commit(true);
    } finally {
      this.fetchingPitches = false;
    }
  }

  private async writeBriefs(pitches: Pitch[], workerName: string): Promise<Pitch[]> {
    const now = this.deps.now();
    const dir = this.state.settings.filesDir;
    return Promise.all(
      pitches.map(async (pitch) => {
        try {
          const filePath = await this.deps.files.writePitchBrief(
            dir,
            pitch,
            workerName,
            now,
          );
          return { ...pitch, filePath };
        } catch (err) {
          this.log(`Could not write the brief for ${pitch.title}`, err);
          return pitch;
        }
      }),
    );
  }

  private async shipRelease(
    project: Project,
    quality: number,
    grade: string,
  ): Promise<void> {
    const worker = this.state.worker;
    if (!worker) return;
    const now = this.deps.now();
    const { markdown, offline } = await this.deps.brain.releaseNotes(
      this.state,
      project,
      quality,
      grade,
    );
    this.markOffline(offline);
    const files = this.deps.files;
    const dir = this.state.settings.filesDir;
    const briefPath = project.filePath ?? files.fallbackBriefPath(dir, project, now);
    try {
      const filePath = await files.writeReleaseNotes(briefPath, project, markdown, {
        workerName: worker.name,
        grade,
        quality,
        now,
      });
      this.state = {
        ...this.state,
        releases: this.state.releases.map((r) =>
          r.projectId === project.id ? { ...r, filePath } : r,
        ),
      };
      this.commit(true);
    } catch (err) {
      this.log(`Could not write release notes for ${project.title}`, err);
    }
  }

  // ---------------------------------------------------------------------
  // HR complaints

  /** If they just threatened HR, make it real: an email lands on the desk. */
  private maybeComplain(line: string): void {
    if (!HR_THREAT.test(line)) return;
    const worker = this.state.worker;
    if (!worker || worker.activity === 'leaving' || this.filingComplaint) return;
    const now = this.deps.now();
    const mine = this.state.complaints.filter((c) => c.workerId === worker.id);
    const last = mine.at(-1);
    if (last && now - last.filedAt < COMPLAINT_GAP_MS) return;
    if (mine.filter((c) => !c.reply).length >= OPEN_COMPLAINTS_MAX) return;
    void this.fileComplaint(line, worker.id, worker.name);
  }

  private async fileComplaint(trigger: string, workerId: string, name: string): Promise<void> {
    this.filingComplaint = true;
    try {
      const { subject, body, offline } = await this.deps.brain.complaint(this.state, trigger);
      this.markOffline(offline);
      if (!this.isStillHere(workerId)) return;
      const now = this.deps.now();
      const complaint: Complaint = {
        id: `complaint-${now}-${Math.floor(this.deps.random() * 1e6)}`,
        workerId,
        workerName: name,
        filedAt: now,
        subject,
        body,
      };
      const complaints = [...this.state.complaints, complaint].slice(-COMPLAINTS_KEPT);
      this.state = { ...this.state, complaints };
      this.addChat('system', `${name} emailed you a complaint: "${subject}"`);
      this.deps.effect({ type: 'email' });
      this.commit(true);
    } catch (err) {
      this.log('Complaint failed', err);
    } finally {
      this.filingComplaint = false;
    }
  }

  readComplaint(id: string): void {
    const now = this.deps.now();
    if (!this.state.complaints.some((c) => c.id === id && !c.readAt)) return;
    this.updateComplaint(id, { readAt: now });
    this.commit();
  }

  /** Answer a complaint; Claude decides whether the gaslighting worked. */
  async replyToComplaint(id: string, raw: string): Promise<void> {
    const text = raw.trim().slice(0, REPLY_INPUT_MAX);
    const complaint = this.state.complaints.find((c) => c.id === id);
    if (!text || !complaint || complaint.reply) return;
    const worker = this.state.worker;
    if (!worker || worker.id !== complaint.workerId || worker.activity === 'leaving') return;
    const now = this.deps.now();
    this.updateComplaint(id, { reply: text, repliedAt: now, readAt: complaint.readAt ?? now });
    this.addChat('boss', `(email) ${text}`);
    this.commit(true);
    const answered = this.state.complaints.find((c) => c.id === id) ?? complaint;
    const { outcome, response, offline } = await this.deps.brain.complaintReply(
      this.state,
      answered,
      text,
    );
    this.markOffline(offline);
    this.updateComplaint(id, { outcome, response });
    if (this.isStillHere(worker.id)) {
      const result = game.resolveComplaint(this.state, outcome, complaint.subject, this.deps.now());
      this.state = result.state;
      this.handleEvents(result.events, result.state);
      this.deps.effect({ type: 'react', tone: OUTCOME_TONE[outcome] });
      this.setBubble(response, 'say');
      this.addChat('worker', response);
    }
    this.commit(true);
  }

  private updateComplaint(id: string, patch: Partial<Complaint>): void {
    const complaints = this.state.complaints.map((c) => (c.id === id ? { ...c, ...patch } : c));
    this.state = { ...this.state, complaints };
  }

  // ---------------------------------------------------------------------
  // Endings

  private startEnding(kind: EndingKind): void {
    if (this.ending) return;
    const ending: { startedAt: number; farewell?: Farewell } = {
      startedAt: this.deps.now(),
    };
    this.ending = ending;
    this.deps.effect({ type: 'ending', kind });
    void this.deps.brain
      .farewell(this.state, kind)
      .then(({ farewell, offline }) => {
        this.markOffline(offline);
        ending.farewell = farewell;
        this.setBubble(farewell.lastWords, 'say');
        this.commit();
      })
      .catch((err) => {
        // Never leave someone stuck mid-exit because Claude fell over.
        this.log('Farewell failed', err);
        ending.farewell = { lastWords: '...', stickyNote: 'Good luck.', mugText: 'OVERTIME' };
      });
  }

  /** Empty the desk once the animation has played and last words are in. */
  private maybeFinishEnding(now: number): void {
    const ending = this.ending;
    const worker = this.state.worker;
    if (!ending?.farewell || !worker) return;
    if (now - ending.startedAt < ENDING_MS) return;
    this.ending = undefined;
    const how = ENDING_LABELS[worker.ending ?? 'fired'];
    this.addChat('system', `${worker.name} ${how}. Last words: "${ending.farewell.lastWords}"`);
    this.state = game.retire(this.state, now, ending.farewell);
    void this.fetchCandidates(false);
    this.deps.openOffice('hire');
    this.commit(true);
  }

  // ---------------------------------------------------------------------
  // Talking

  /**
   * Ask Claude for one line in character. Event-driven lines are throttled;
   * `important` ones (boss actions, big moments) skip the throttle but never
   * stack up behind each other.
   */
  private async speak(situation: string, important = false): Promise<void> {
    const worker = this.state.worker;
    if (!worker) return;
    if (this.lineInFlight) {
      // Two big moments at once (sitting down, then asking for coffee): keep
      // the latest important one for when Claude is free, drop small talk.
      if (important) this.queuedLine = situation;
      return;
    }
    const now = this.deps.now();
    if (!important && now - this.lastEventLineAt < EVENT_LINE_GAP_MS) return;
    this.lineInFlight = true;
    this.lastEventLineAt = now;
    try {
      const { line, offline } = await this.deps.brain.think(this.state, situation);
      this.markOffline(offline);
      if (!this.isStillHere(worker.id)) return;
      this.applyLine(line);
      this.commit();
    } catch (err) {
      this.log('Worker line failed', err);
    } finally {
      this.lineInFlight = false;
      const next = this.queuedLine;
      this.queuedLine = undefined;
      if (next) void this.speak(next, true);
    }
  }

  private applyLine(line: WorkerLine): void {
    const text = line.say ?? line.think;
    if (text) {
      const kind = line.say ? 'say' : 'think';
      this.setBubble(text, kind);
      this.addChat('worker', kind === 'think' ? `(thinks) ${text}` : text);
      // Only spoken threats count; muttering about HR in your head is free.
      if (kind === 'say') this.maybeComplain(text);
    }
    if (line.remember) this.remember('self', line.remember);
  }

  private remember(kind: 'boss' | 'self', text: string): void {
    const worker = this.state.worker;
    if (!worker) return;
    const memory = { at: this.deps.now(), kind, text };
    this.state = { ...this.state, worker: game.addMemory(worker, memory) };
  }

  private setBubble(text: string, kind: 'say' | 'think'): void {
    this.state = game.setBubble(this.state, text, kind, this.deps.now());
  }

  private addChat(from: ChatLine['from'], text: string): void {
    const line: ChatLine = { at: this.deps.now(), from, text };
    const chat = [...this.state.chat, line].slice(-CHAT_LOG_MAX);
    this.state = { ...this.state, chat };
  }

  // ---------------------------------------------------------------------
  // Settings, status, persistence

  updateSettings(patch: Partial<Settings>): Settings {
    const settings = { ...this.state.settings, ...patch };
    this.state = { ...this.state, settings };
    this.commit(true);
    return settings;
  }

  private markOffline(offline: boolean): void {
    this.offline = offline;
    this.refreshBrainStatus();
  }

  private refreshBrainStatus(): void {
    const brainStatus = this.busy ? 'thinking' : this.offline ? 'offline' : 'ok';
    if (brainStatus === this.state.brainStatus) return;
    this.state = { ...this.state, brainStatus };
    this.commit();
  }

  /** True if the worker who started an async request is still at the desk. */
  private isStillHere(workerId: string): boolean {
    const worker = this.state.worker;
    return worker?.id === workerId && worker.activity !== 'leaving';
  }

  private commit(saveNow = false): void {
    this.dirty = true;
    this.deps.publish(this.state);
    if (saveNow) this.saveNow();
  }

  private saveNow(): void {
    try {
      this.deps.save(this.state);
      this.dirty = false;
      this.lastSavedAt = this.deps.now();
    } catch (err) {
      this.log('Save failed', err);
    }
  }

  private log(message: string, err?: unknown): void {
    this.deps.log(message, err);
  }
}

function bugKey(part: HardPart): string {
  return `${part.at}|${part.title}`;
}

const ENDING_LABELS: Record<EndingKind, string> = {
  'lost-mind': 'lost their mind and ran off screaming',
  fried: 'was fried by one shock too many',
  'rage-quit': 'flipped the desk and quit',
  fired: 'was fired',
};

function arrivalSituation(state: GameState): string {
  const leftovers = state.deskLeftovers;
  if (leftovers.length === 0) {
    return 'It is your first day. You just sat down at your new desk. Say hello.';
  }
  const found = leftovers.map((l) => `${l.kind}: "${l.text}"`).join('; ');
  return (
    'It is your first day. You just sat down at your new desk and found what ' +
    `the last person left behind (${found}). React to it.`
  );
}

const IDLE_TOPICS = [
  'the codebase',
  'the boss',
  'your weekend',
  'the coffee machine',
  'office gossip',
  'your career',
  'the project',
  'something you remember',
  'the weather outside',
  'your desk',
];

/** What to tell Claude when nothing in particular has happened. */
function idleSituation(state: GameState, random: () => number): string {
  const worker = state.worker;
  const project = state.project;
  const topic = IDLE_TOPICS[Math.floor(random() * IDLE_TOPICS.length)];
  const nudge = `Say or think one thing, maybe about ${topic}.`;
  if (!worker) return nudge;
  switch (worker.activity) {
    case 'stuck': {
      const part = project?.stuckOn !== undefined
        ? project.hardParts[project.stuckOn]
        : undefined;
      return `You are still stuck on "${part?.title ?? 'a bug'}". ${nudge}`;
    }
    case 'coffee':
      return `You are on a coffee break at the coffee machine. ${nudge}`;
    case 'idle':
      return `You have no project and are killing time at your desk. ${nudge}`;
    default: {
      const pct = Math.round((project?.progress ?? 0) * 100);
      const title = project?.title ?? 'something';
      return `You are working on "${title}" (${pct}% done). ${nudge}`;
    }
  }
}
