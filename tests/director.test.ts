import { describe, expect, it } from 'vitest';
import type { BrainLike, DirectorDeps, FilesLike } from '../src/main/director';
import { Director } from '../src/main/director';
import * as game from '../src/game';
import type { Effect, OfficeTab } from '../src/shared/ipc';
import type { Candidate, GameState, Pitch, Settings } from '../src/shared/types';

const SETTINGS: Settings = {
  alwaysOnTop: true,
  hideFromScreenShare: false,
  claudePath: '',
  model: 'haiku',
  filesDir: '/tmp/overtime-test',
};

function candidate(id: string): Candidate {
  return {
    id,
    name: `Person ${id}`,
    age: 30,
    pronouns: 'they/them',
    level: 'mid',
    personality: 'fine',
    specialty: 'apps',
    quirk: 'none',
    redFlag: 'none',
    backstory: 'none',
    traits: { stamina: 1, resilience: 1, talent: 1 },
    look: { skin: '#c68c5f', hair: '#222', hairStyle: 'short', shirt: '#38c', glasses: false },
  };
}

function pitch(id: string, difficulty: 1 | 3 | 5): Pitch {
  return {
    id,
    title: `App ${id}`,
    tagline: 'pointless',
    difficulty,
    description: 'does nothing',
    hardParts: [{ at: 0.5, severity: 1, title: 'bug', detail: 'it breaks' }],
  };
}

/** A director wired to fakes, with a clock the test controls. */
function setup(initial?: GameState) {
  let now = 1_000_000;
  const calls = {
    think: [] as string[],
    chat: [] as string[],
    complaints: [] as string[],
    replies: [] as string[],
    briefs: 0,
    releases: 0,
  };
  let complaintOutcome: 'apology' | 'gaslit' | 'unconvinced' | 'backfired' = 'gaslit';
  const published: GameState[] = [];
  const effects: Effect[] = [];
  const opened: OfficeTab[] = [];
  let offline = false;
  let chatReply: Awaited<ReturnType<BrainLike['chat']>>['reply'] = {
    say: 'Thanks boss',
    tone: 'kind',
    remember: 'Boss is nice',
  };
  const brain: BrainLike = {
    candidates: async () => ({
      candidates: [candidate('a'), candidate('b'), candidate('c')],
      offline,
    }),
    pitches: async () => ({ pitches: [pitch('p1', 1), pitch('p2', 3), pitch('p3', 5)], offline }),
    think: async (_s, situation) => {
      calls.think.push(situation);
      return { line: { say: 'A line.' }, offline };
    },
    chat: async (_s, message) => {
      calls.chat.push(message);
      return { reply: chatReply, offline };
    },
    releaseNotes: async () => ({ markdown: '# Notes', offline }),
    farewell: async () => ({
      farewell: { lastWords: 'Bye', stickyNote: 'Run', mugText: 'NOPE' },
      offline,
    }),
    complaint: async (_s, trigger) => {
      calls.complaints.push(trigger);
      return { subject: 'Formal complaint', body: 'You shocked me.', offline };
    },
    complaintReply: async (_s, _c, reply) => {
      calls.replies.push(reply);
      return { outcome: complaintOutcome, response: 'Oh. Maybe I imagined it.', offline };
    },
  };
  const files: FilesLike = {
    writePitchBrief: async (_d, p) => {
      calls.briefs++;
      return `/tmp/overtime-test/pitches/${p.id}.md`;
    },
    startProjectFolder: async (_d, p) => ({
      briefPath: `/tmp/overtime-test/projects/${p.id}/brief.md`,
      hardParts: [{ at: 0.3, severity: 2, title: 'edited', detail: 'by the boss' }],
    }),
    writeReleaseNotes: async (briefPath) => {
      calls.releases++;
      return briefPath.replace('brief.md', 'release-notes.md');
    },
    fallbackBriefPath: () => '/tmp/overtime-test/projects/x/brief.md',
  };
  const deps: DirectorDeps = {
    brain,
    files,
    now: () => now,
    random: () => 0.5,
    publish: (s) => published.push(s),
    effect: (e) => effects.push(e),
    save: () => undefined,
    openOffice: (tab) => opened.push(tab),
    log: () => undefined,
  };
  const director = new Director(initial ?? game.newGameState(SETTINGS, now), deps);
  return {
    director,
    calls,
    published,
    effects,
    opened,
    advance: (ms: number) => {
      now += ms;
    },
    setOffline: (v: boolean) => {
      offline = v;
    },
    setChatReply: (reply: typeof chatReply) => {
      chatReply = reply;
    },
  };
}

/** Let pending promise chains (fake brain, fake files) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

/** Hire candidate 'a' and assign the medium project. */
async function hiredAndWorking(t: ReturnType<typeof setup>): Promise<void> {
  t.director.start();
  await settle();
  t.director.hire('a');
  await settle();
  await t.director.assign('p2');
  await settle();
}

describe('Director', () => {
  it('fetches candidates when the desk is empty', async () => {
    const t = setup();
    t.director.start();
    await settle();
    t.director.stop();
    expect(t.director.getState().candidates).toHaveLength(3);
  });

  it('hiring fetches pitches, writes briefs and opens the project picker', async () => {
    const t = setup();
    t.director.start();
    await settle();
    t.director.hire('a');
    await settle();
    t.director.stop();
    const s = t.director.getState();
    expect(s.worker?.id).toBe('a');
    expect(s.pitches).toHaveLength(3);
    expect(s.pitches.every((p) => p.filePath)).toBe(true);
    expect(t.calls.briefs).toBe(3);
    expect(t.opened).toContain('projects');
  });

  it('assigning reads the edited hard parts from the brief folder', async () => {
    const t = setup();
    await hiredAndWorking(t);
    t.director.stop();
    const project = t.director.getState().project;
    expect(project?.title).toBe('App p2');
    expect(project?.hardParts[0]?.title).toBe('edited');
    expect(project?.filePath).toContain('projects/p2/brief.md');
    expect(t.calls.think.some((s) => s.includes('assigned'))).toBe(true);
  });

  it('a shock gets an instant yelp without calling Claude', async () => {
    const t = setup();
    await hiredAndWorking(t);
    const before = t.calls.think.length;
    t.director.act({ type: 'shock' });
    await settle();
    t.director.stop();
    expect(t.director.getState().bubble?.text).toBeTruthy();
    expect(t.calls.think.length).toBe(before);
    expect(t.director.getState().worker?.ledger.shocks).toBe(1);
  });

  it('chat logs both sides, applies the tone and remembers', async () => {
    const t = setup();
    await hiredAndWorking(t);
    await t.director.chat('  Great work today  ');
    t.director.stop();
    const s = t.director.getState();
    expect(t.calls.chat).toEqual(['Great work today']);
    expect(s.chat.filter((l) => l.from !== 'system').map((l) => l.from)).toEqual(
      expect.arrayContaining(['boss', 'worker']),
    );
    expect(s.worker?.ledger.kindChats).toBe(1);
    expect(s.worker?.memories.some((m) => m.text === 'Boss is nice')).toBe(true);
    expect(s.bubble?.text).toBe('Thanks boss');
  });

  it('firing plays the ending, then empties the desk and reopens hiring', async () => {
    const t = setup();
    await hiredAndWorking(t);
    t.director.act({ type: 'fire' });
    await settle();
    expect(t.effects).toContainEqual({ type: 'ending', kind: 'fired' });
    expect(t.director.getState().worker?.activity).toBe('leaving');
    t.advance(10_000);
    t.director.tick();
    await settle();
    t.director.stop();
    const s = t.director.getState();
    expect(s.worker).toBeUndefined();
    expect(s.pastWorkers.at(-1)?.ending).toBe('fired');
    expect(s.deskLeftovers.map((l) => l.kind)).toContain('mug');
    expect(s.candidates).toHaveLength(3);
    expect(t.opened.at(-1)).toBe('hire');
  });

  it('finishing a project writes release notes and offers new pitches', async () => {
    const t = setup();
    await hiredAndWorking(t);
    // Jump the project to the brink of done, past its only hard part.
    const s = t.director.getState();
    const project = s.project!;
    (t.director as unknown as { state: GameState }).state = {
      ...s,
      worker: { ...s.worker!, activity: 'working', stats: { energy: 100, mood: 80, sanity: 100 } },
      project: { ...project, progress: 0.999, hardPartsHit: [0], workMinutes: 60, qualitySum: 45 },
    };
    t.advance(60_000);
    t.director.tick();
    await settle();
    t.director.stop();
    const after = t.director.getState();
    expect(after.project).toBeUndefined();
    expect(after.releases.at(-1)?.filePath).toContain('release-notes.md');
    expect(t.calls.releases).toBe(1);
    expect(after.pitches).toHaveLength(3);
    expect(t.effects).toContainEqual({ type: 'confetti' });
  });

  it('shows the brain as offline when Claude falls back', async () => {
    const t = setup();
    t.setOffline(true);
    t.director.start();
    await settle();
    t.director.stop();
    expect(t.director.getState().brainStatus).toBe('offline');
  });

  it('coming back after a long gap sends them home first', async () => {
    const t = setup();
    await hiredAndWorking(t);
    t.director.stop();
    const tired = t.director.getState();
    const worn = {
      ...tired,
      worker: { ...tired.worker!, stats: { energy: 5, mood: 40, sanity: 50 } },
    };
    const t2 = setup({ ...worn, lastTickAt: worn.lastTickAt - 2 * 3_600_000 });
    t2.director.start();
    t2.director.stop();
    expect(t2.director.getState().worker!.stats.energy).toBeGreaterThan(50);
  });

  it('a chat reply that agrees to a break really sends them for coffee', async () => {
    const t = setup();
    await hiredAndWorking(t);
    t.advance(10_000);
    t.director.tick();
    t.setChatReply({ say: 'Oh thank you, yes!', tone: 'kind', action: 'coffee' });
    await t.director.chat('Go take a break');
    t.director.stop();
    const s = t.director.getState();
    expect(s.worker?.activity).toBe('coffee');
    expect(t.effects).toContainEqual({ type: 'react', tone: 'kind' });
    expect(s.bubble?.text).toBe('Oh thank you, yes!');
  });

  it('a chat reply without an action leaves them where they are', async () => {
    const t = setup();
    await hiredAndWorking(t);
    t.advance(10_000);
    t.director.tick();
    t.setChatReply({ say: 'Be back in five', tone: 'neutral' });
    await t.director.chat('Fancy a coffee?');
    t.director.stop();
    expect(t.director.getState().worker?.activity).not.toBe('coffee');
  });

  it('messing up their code glitches the screen and gets a reaction', async () => {
    const t = setup();
    await hiredAndWorking(t);
    t.advance(10_000);
    t.director.tick();
    await settle();
    const before = t.calls.think.length;
    t.director.act({ type: 'sabotage' });
    await settle();
    t.director.stop();
    expect(t.effects).toContainEqual({ type: 'glitch' });
    expect(t.calls.think.slice(before).some((s) => s.startsWith('Your code just broke'))).toBe(
      true,
    );
    expect(t.director.getState().project?.hardParts.some((h) => h.mystery)).toBe(true);
  });

  it('a bug planted during a coffee break is discovered on their return', async () => {
    const t = setup();
    await hiredAndWorking(t);
    t.advance(10_000);
    t.director.tick();
    t.director.act({ type: 'coffee' });
    await settle();
    const before = t.calls.think.length;
    t.director.act({ type: 'sabotage' });
    await settle();
    expect(t.calls.think.slice(before).some((s) => s.startsWith('Your code just broke'))).toBe(
      false,
    );
    // Coffee breaks are minutes long; tick through to the end of it.
    for (let i = 0; i < 12 * 12; i++) {
      t.advance(5_000);
      t.director.tick();
    }
    await settle();
    t.director.stop();
    expect(t.calls.think.slice(before).some((s) => s.startsWith('You sat back down'))).toBe(true);
  });

  it('threatening HR out loud emails the boss a complaint', async () => {
    const t = setup();
    await hiredAndWorking(t);
    t.setChatReply({ say: "That's it, I'm going to HR.", tone: 'cruel' });
    await t.director.chat('You are useless');
    await settle();
    const s = t.director.getState();
    expect(s.complaints).toHaveLength(1);
    expect(s.complaints[0]).toMatchObject({ subject: 'Formal complaint', workerId: 'a' });
    expect(t.effects).toContainEqual({ type: 'email' });
    // A second threat straight away is just talk.
    await t.director.chat('Still useless');
    await settle();
    t.director.stop();
    expect(t.director.getState().complaints).toHaveLength(1);
  });

  it('gaslighting a complaint that works costs them sanity', async () => {
    const t = setup();
    await hiredAndWorking(t);
    t.setChatReply({ say: 'Reporting you to human resources!', tone: 'cruel' });
    await t.director.chat('Work faster');
    await settle();
    const id = t.director.getState().complaints[0]!.id;
    const sanity = t.director.getState().worker!.stats.sanity;
    t.director.readComplaint(id);
    await t.director.replyToComplaint(id, 'That never happened. You must be confused.');
    t.director.stop();
    const s = t.director.getState();
    expect(t.calls.replies).toEqual(['That never happened. You must be confused.']);
    expect(s.complaints[0]).toMatchObject({ outcome: 'gaslit', readAt: expect.any(Number) });
    expect(s.worker!.stats.sanity).toBeLessThan(sanity);
    expect(s.bubble?.text).toBe('Oh. Maybe I imagined it.');
    // Answered complaints can't be answered twice.
    await t.director.replyToComplaint(id, 'again');
    expect(t.calls.replies).toHaveLength(1);
  });

  it('thinking about HR is not a complaint', async () => {
    const t = setup();
    await hiredAndWorking(t);
    (t.director as unknown as { applyLine(l: object): void }).applyLine({
      think: 'Should I go to HR?',
    });
    await settle();
    t.director.stop();
    expect(t.director.getState().complaints).toHaveLength(0);
  });

  it('the coffee timer sends a relaxed worker for coffee by announcing it', async () => {
    const t = setup();
    await hiredAndWorking(t);
    const before = t.calls.think.length;
    // random() is 0.5 in these tests, so the timer is 25 minutes.
    for (let i = 0; i < 26 * 12; i++) {
      t.advance(5_000);
      t.director.tick();
      await settle();
      if (t.director.getState().worker?.activity === 'coffee') break;
    }
    t.director.stop();
    expect(t.director.getState().worker?.activity).toBe('coffee');
    expect(t.calls.think.slice(before).some((s) => s.startsWith('The coffee timer went off'))).toBe(
      true,
    );
  });

  it('a scared worker asks first, and saying no keeps them at the desk', async () => {
    const t = setup();
    await hiredAndWorking(t);
    const s0 = t.director.getState();
    // Enough shocks on record to be terrified of the boss.
    (t.director as unknown as { state: GameState }).state = {
      ...s0,
      worker: {
        ...s0.worker!,
        attitude: 'scared',
        ledger: { ...s0.worker!.ledger, shocks: 10 },
        coffeeTimer: 0.1,
      },
    };
    t.advance(60_000);
    t.director.tick();
    await settle();
    expect(t.director.getState().worker?.wantsCoffeeSince).toBeDefined();
    expect(t.calls.think.some((s) => s.startsWith("You'd like a coffee"))).toBe(true);
    t.director.act({ type: 'deny-coffee' });
    await settle();
    t.director.stop();
    const w = t.director.getState().worker!;
    expect(w.wantsCoffeeSince).toBeUndefined();
    expect(w.activity).not.toBe('coffee');
    expect(w.ledger.coffeeDenials).toBe(1);
    expect(t.calls.think.some((s) => s.startsWith('Your boss said no to your coffee'))).toBe(true);
  });
});

