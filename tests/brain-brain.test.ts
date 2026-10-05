import { describe, expect, it } from 'vitest';
import type { Candidate, GameState } from '../src/shared/types';
import { Brain } from '../src/brain/brain';
import { CANNED_CANDIDATES, CANNED_PITCHES, guessTone } from '../src/brain/fallback';
import { HAIR_COLOURS, HAIR_STYLES, SHIRTS, SKIN_TONES } from '../src/brain/roll';
import type { RunOptions, Runner } from '../src/brain/runner';
import { sampleProject, sampleState, sampleWorker } from '../src/brain/sample';

interface Call {
  system: string;
  prompt: string;
  opts?: RunOptions;
}

/** Replies from a script; an Error entry is thrown instead. */
class FakeRunner implements Runner {
  readonly calls: Call[] = [];

  constructor(private readonly replies: (string | Error)[]) {}

  async run(system: string, prompt: string, opts?: RunOptions): Promise<string> {
    this.calls.push({ system, prompt, opts });
    const next = this.replies.shift();
    if (next === undefined) throw new Error('No scripted reply');
    if (next instanceof Error) throw next;
    return next;
  }
}

/** A deterministic rng cycling through a fixed sequence. */
function seqRng(): () => number {
  let i = 0;
  const values = [0.11, 0.73, 0.42, 0.95, 0.05, 0.6, 0.31, 0.88, 0.2, 0.5];
  return () => values[i++ % values.length] as number;
}

function brainWith(replies: (string | Error)[]): { brain: Brain; runner: FakeRunner } {
  const runner = new FakeRunner(replies);
  return { brain: new Brain(runner, seqRng()), runner };
}

type Json = Record<string, unknown>;

function person(name: string, extra: Json = {}): Json {
  return {
    name, age: 30, pronouns: 'she/her', level: 'mid',
    personality: 'Cheerful menace', specialty: 'Spreadsheets for cats',
    quirk: 'Hums in hex', redFlag: 'Owns 40 staplers',
    backstory: 'Used to be a lighthouse keeper.', ...extra,
  };
}

function expectRolled(c: Candidate): void {
  expect(c.id).toMatch(/^cand-/);
  for (const t of Object.values(c.traits)) {
    expect(t).toBeGreaterThanOrEqual(0.7);
    expect(t).toBeLessThanOrEqual(1.3);
  }
  expect(SKIN_TONES).toContain(c.look.skin);
  expect(HAIR_COLOURS).toContain(c.look.hair);
  expect(HAIR_STYLES).toContain(c.look.hairStyle);
  expect(SHIRTS).toContain(c.look.shirt);
  expect(typeof c.look.glasses).toBe('boolean');
}

const emptyHiring = (): GameState =>
  sampleState({ worker: undefined, project: undefined });

describe('Brain.candidates', () => {
  it('uses good JSON and rolls ids, traits and looks', async () => {
    const reply = JSON.stringify([
      person('Ada Obi', { level: 'junior' }),
      person('Lars Holm'),
      person('Mei Tan'),
    ]);
    const { brain } = brainWith([reply]);
    const { candidates, offline } = await brain.candidates(emptyHiring());
    expect(offline).toBe(false);
    expect(candidates.map((c) => c.name)).toEqual(['Ada Obi', 'Lars Holm', 'Mei Tan']);
    candidates.forEach(expectRolled);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(3);
  });

  it('accepts fenced JSON wrapped in an object', async () => {
    const reply = '```json\n{"candidates": ' +
      JSON.stringify([person('Ada Obi', { level: 'junior' })]) + '}\n```';
    const { brain } = brainWith([reply]);
    const { candidates, offline } = await brain.candidates(emptyHiring(), 1);
    expect(offline).toBe(false);
    expect(candidates[0]?.name).toBe('Ada Obi');
  });

  it('falls back to canned people on garbage, offline', async () => {
    const { brain } = brainWith(['I cannot do that, Dave.']);
    const { candidates, offline } = await brain.candidates(emptyHiring());
    expect(offline).toBe(true);
    expect(candidates).toHaveLength(3);
    const canned = CANNED_CANDIDATES.map((c) => c.name);
    candidates.forEach((c) => expect(canned).toContain(c.name));
    candidates.forEach(expectRolled);
    expect(candidates.some((c) => c.level === 'junior')).toBe(true);
  });

  it('falls back when the runner throws', async () => {
    const { brain } = brainWith([new Error('rate limited')]);
    const { candidates, offline } = await brain.candidates(emptyHiring());
    expect(offline).toBe(true);
    expect(candidates).toHaveLength(3);
    expect(brain.lastError).toBe('rate limited');
  });

  it('coerces enums and clamps fields', async () => {
    const reply = JSON.stringify([
      person('Ada Obi', { pronouns: 'She', level: 'Senior Developer', age: 200 }),
      person('Bo Lin', { pronouns: 'HE/HIM', level: 'intern', age: '17' }),
      person('Cy Ruiz', { pronouns: 'xe/xem', level: 'wizard',
        backstory: 'x'.repeat(600) }),
    ]);
    const { brain } = brainWith([reply]);
    const { candidates } = await brain.candidates(emptyHiring());
    const [a, b, c] = candidates;
    expect(a).toMatchObject({ pronouns: 'she/her', level: 'senior', age: 70 });
    expect(b).toMatchObject({ pronouns: 'he/him', level: 'junior', age: 18 });
    expect(c).toMatchObject({ pronouns: 'they/them', level: 'mid' });
    expect(c?.backstory.length).toBeLessThanOrEqual(220);
  });

  it('drops items missing essentials and tops up from the canned set', async () => {
    const reply = JSON.stringify([
      person('Ada Obi', { level: 'junior' }),
      { name: 'No Personality' },
      'not an object',
    ]);
    const { brain } = brainWith([reply]);
    const { candidates, offline } = await brain.candidates(emptyHiring());
    expect(offline).toBe(false);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]?.name).toBe('Ada Obi');
  });

  it('passes names to avoid and drops repeats', async () => {
    const state = emptyHiring();
    state.candidates = [{ ...sampleWorker(), name: 'Zed Current' }];
    const reply = JSON.stringify([
      person('Zed Current'),
      person('Tomasz Wiśniewski'),
      person('Fresh Face', { level: 'junior' }),
    ]);
    const { brain, runner } = brainWith([reply]);
    const { candidates } = await brain.candidates(state);
    const prompt = runner.calls[0]?.prompt ?? '';
    expect(prompt).toContain('Zed Current');
    expect(prompt).toContain('Tomasz Wiśniewski');
    const names = candidates.map((c) => c.name);
    expect(names).toContain('Fresh Face');
    expect(names).not.toContain('Zed Current');
    expect(names).not.toContain('Tomasz Wiśniewski');
    expect(candidates).toHaveLength(3);
  });

  it('makes the youngest a junior when nobody is', async () => {
    const reply = JSON.stringify([
      person('Old Timer', { age: 60, level: 'lead' }),
      person('Young One', { age: 22, level: 'senior' }),
      person('Mid Life', { age: 40, level: 'mid' }),
    ]);
    const { brain } = brainWith([reply]);
    const { candidates } = await brain.candidates(emptyHiring());
    expect(candidates.find((c) => c.name === 'Young One')?.level).toBe('junior');
  });

  it('avoids canned names already used when offline', async () => {
    const state = emptyHiring();
    state.pastWorkers = CANNED_CANDIDATES.slice(0, 7).map((c, i) => ({
      id: `p${i}`, name: c.name, level: c.level, hiredAt: 0, endedAt: 1,
      ending: 'fired' as const, projectsDone: 0, lastWords: '',
    }));
    const { brain } = brainWith([new Error('down')]);
    const { candidates } = await brain.candidates(state);
    const used = new Set(state.pastWorkers.map((w) => w.name));
    expect(candidates).toHaveLength(3);
    candidates.forEach((c) => expect(used.has(c.name)).toBe(false));
    expect(new Set(candidates.map((c) => c.name)).size).toBe(3);
  });
});

function pitch(title: string, difficulty: unknown, parts = 2): Json {
  return {
    title, tagline: 'It does a thing.', difficulty,
    description: 'Deadpan. Pointless. Funded.',
    hardParts: Array.from({ length: parts }, (_, i) => ({
      at: 20 + i * 25, severity: 2, title: `${title} part ${i + 1}`,
      detail: 'It goes wrong.',
    })),
  };
}

describe('Brain.pitches', () => {
  it('returns one easy, one medium and one hard, in order', async () => {
    const reply = JSON.stringify([pitch('Hard One', 5, 3), pitch('Easy One', 1),
      pitch('Mid One', 3)]);
    const { brain, runner } = brainWith([reply]);
    const { pitches, offline } = await brain.pitches(sampleState());
    expect(offline).toBe(false);
    expect(pitches.map((p) => p.title)).toEqual(['Easy One', 'Mid One', 'Hard One']);
    expect(pitches.map((p) => p.difficulty)).toEqual([1, 3, 5]);
    pitches.forEach((p) => expect(p.id).toMatch(/^pitch-/));
    expect(runner.calls[0]?.prompt).toContain('Sock Ledger');
  });

  it('stores percent hard parts as sorted fractions in 0.1-0.9', async () => {
    const p = pitch('Weird Ats', 2);
    p.hardParts = [
      { at: 75, severity: 1, title: 'Late', detail: 'd' },
      { at: 0.4, severity: 2, title: 'Fraction', detail: 'd' },
      { at: 150, severity: 9, title: 'Too far', detail: 'd' },
      { at: 2, severity: 0, title: 'Too early', detail: 'd' },
    ];
    const reply = JSON.stringify([p, pitch('M', 3), pitch('H', 4, 3)]);
    const { brain } = brainWith([reply]);
    const { pitches } = await brain.pitches(sampleState());
    const parts = pitches[0]?.hardParts ?? [];
    expect(parts.map((h) => h.at)).toEqual([0.1, 0.4, 0.75, 0.9]);
    expect(parts.map((h) => h.title))
      .toEqual(['Too early', 'Fraction', 'Late', 'Too far']);
    // Easy projects top out at severity 2; zero clamps up to 1.
    expect(parts.map((h) => h.severity)).toEqual([1, 2, 1, 2]);
  });

  it('fixes a bad difficulty spread', async () => {
    const reply = JSON.stringify([pitch('A', 3), pitch('B', 3), pitch('C', 3)]);
    const { brain } = brainWith([reply]);
    const { pitches } = await brain.pitches(sampleState());
    expect(pitches.map((p) => p.difficulty)).toEqual([2, 3, 4]);
    // The hard slot gets enough hard parts and at least one brutal one.
    const hard = pitches[2]!;
    expect(hard.hardParts.length).toBeGreaterThanOrEqual(3);
    expect(hard.hardParts.some((h) => h.severity === 3)).toBe(true);
  });

  it('coerces word difficulties', async () => {
    const reply = JSON.stringify([pitch('A', 'hard', 3), pitch('B', 'easy'),
      pitch('C', 'medium')]);
    const { brain } = brainWith([reply]);
    const { pitches } = await brain.pitches(sampleState());
    expect(pitches.map((p) => p.title)).toEqual(['B', 'C', 'A']);
  });

  it('fills a missing band from the canned set, still online', async () => {
    const reply = JSON.stringify([pitch('Big', 5, 4), pitch('Bigger', 4, 3)]);
    const { brain } = brainWith([reply]);
    const { pitches, offline } = await brain.pitches(sampleState());
    expect(offline).toBe(false);
    expect(pitches).toHaveLength(3);
    const diffs = pitches.map((p) => p.difficulty);
    expect(diffs[0]).toBeLessThanOrEqual(2);
    expect(diffs[1]).toBe(3);
    expect(diffs[2]).toBeGreaterThanOrEqual(4);
  });

  it('drops titles that were already released', async () => {
    const reply = JSON.stringify([pitch('Sock Ledger', 2), pitch('M', 3),
      pitch('H', 4, 3)]);
    const { brain } = brainWith([reply]);
    const { pitches } = await brain.pitches(sampleState());
    expect(pitches.map((p) => p.title)).not.toContain('Sock Ledger');
    expect(pitches).toHaveLength(3);
  });

  it('falls back to canned pitches when Claude fails', async () => {
    const { brain } = brainWith(['```json\nnot json\n```']);
    const { pitches, offline } = await brain.pitches(sampleState());
    expect(offline).toBe(true);
    expect(pitches.map((p) => p.difficulty <= 2)).toEqual([true, false, false]);
    expect(pitches[1]?.difficulty).toBe(3);
    expect(pitches[2]?.difficulty).toBeGreaterThanOrEqual(4);
    const canned = CANNED_PITCHES.map((p) => p.title);
    pitches.forEach((p) => expect(canned).toContain(p.title));
    expect(pitches.map((p) => p.title)).not.toContain('Sock Ledger');
  });

  it('makes sequels once every canned title in a band is used', async () => {
    const easy = CANNED_PITCHES.filter((p) => p.difficulty <= 2);
    const state = sampleState({
      releases: easy.map((p, i) => ({
        projectId: `r${i}`, title: p.title, workerName: 'X', finishedAt: 0,
        quality: 0.5, grade: 'Buggy',
      })),
    });
    const { brain } = brainWith([new Error('down')]);
    const { pitches } = await brain.pitches(state);
    expect(pitches[0]?.title).toMatch(/ 2$/);
  });
});

describe('Brain.think', () => {
  it('returns a spoken line with the persona as system prompt', async () => {
    const { brain, runner } = brainWith(['{"say":"Gerald, we are doomed."}']);
    const { line, offline } = await brain.think(sampleState(), 'You hit a bug.');
    expect(offline).toBe(false);
    expect(line).toEqual({ say: 'Gerald, we are doomed.' });
    const system = runner.calls[0]?.system ?? '';
    expect(system).toContain('Priyanka Osei');
    expect(system).toContain('she/her');
    expect(system).toContain('You resent your boss');
    expect(system).toContain('electrocuted you 3 times');
    expect(system).toContain('Boss supports Arsenal');
    expect(system).toContain('Mandatory updates');
    expect(system).toContain('52% done');
    expect(system).toContain("Hi, I'm Mark");
    expect(system).toMatch(/never mention being an AI/i);
    expect(system).toMatch(/self-harm/);
    expect(runner.calls[0]?.prompt).toContain('You hit a bug.');
  });

  it('returns a thought and a memory, stripping a name prefix and quotes', async () => {
    const json = JSON.stringify({ think: 'Priyanka: "Why toast?"',
      remember: 'Toast is evil' });
    const reply = `\`\`\`json\n${json}\n\`\`\``;
    const { brain } = brainWith([reply]);
    const { line } = await brain.think(sampleState(), 'x');
    expect(line).toEqual({ think: 'Why toast?', remember: 'Toast is evil' });
  });

  it('keeps only say when both are given', async () => {
    const { brain } = brainWith(['{"say":"Out loud","think":"Inside"}']);
    const { line } = await brain.think(sampleState(), 'x');
    expect(line).toEqual({ say: 'Out loud' });
  });

  it('falls back on garbage with a line matching the situation', async () => {
    const { brain } = brainWith(['lol']);
    const { line, offline } = await brain.think(sampleState(),
      'Your boss just gave you a cash bonus! React.');
    expect(offline).toBe(true);
    expect(line.say).toMatch(/bonus|money/i);
  });

  it('falls back when the line breaks character', async () => {
    const { brain } = brainWith(['{"say":"As an AI, I do not drink coffee."}']);
    const { offline } = await brain.think(sampleState(), 'x');
    expect(offline).toBe(true);
  });

  it('falls back when the line touches self-harm', async () => {
    const { brain } = brainWith(['{"say":"I want to die."}']);
    const { line, offline } = await brain.think(sampleState(), 'x');
    expect(offline).toBe(true);
    expect(line.say ?? line.think).toBeTruthy();
  });

  it('falls back without a worker', async () => {
    const { brain, runner } = brainWith([]);
    const { offline } = await brain.think(sampleState({ worker: undefined }), 'x');
    expect(offline).toBe(true);
    expect(runner.calls).toHaveLength(0);
  });

  it('trims long lines', async () => {
    const long = 'blah '.repeat(100);
    const { brain } = brainWith([JSON.stringify({ say: long })]);
    const { line } = await brain.think(sampleState(), 'x');
    expect(line.say?.length).toBeLessThanOrEqual(160);
  });
});

describe('Brain.chat', () => {
  it('returns say, tone and memory, at high priority', async () => {
    const reply = JSON.stringify({ say: 'Up the Gunners, Mark.', tone: 'kind',
      remember: 'Boss has a cat' });
    const { brain, runner } = brainWith([reply]);
    const { reply: out, offline } = await brain.chat(sampleState(), 'I have a cat!');
    expect(offline).toBe(false);
    expect(out).toEqual({ say: 'Up the Gunners, Mark.', tone: 'kind',
      remember: 'Boss has a cat' });
    expect(runner.calls[0]?.opts?.priority).toBe('high');
    expect(runner.calls[0]?.prompt).toContain('I have a cat!');
  });

  it('coerces tone synonyms and guesses a missing tone', async () => {
    const { brain } = brainWith([
      '{"say":"ok","tone":"Hostile"}',
      '{"say":"ok"}',
      '{"say":"ok","tone":"???"}',
    ]);
    const tone = async (msg: string): Promise<string> =>
      (await brain.chat(sampleState(), msg)).reply.tone;
    expect(await tone('hello')).toBe('cruel');
    expect(await tone('you useless idiot')).toBe('cruel');
    expect(await tone('thanks, well done')).toBe('kind');
  });

  it('does not repeat the message being answered in the transcript', async () => {
    const state = sampleState();
    state.chat = [...state.chat, { at: 1, from: 'boss', text: 'UNIQUE-MSG' }];
    const { brain, runner } = brainWith(['{"say":"ok","tone":"neutral"}']);
    await brain.chat(state, 'UNIQUE-MSG');
    expect(runner.calls[0]?.system).not.toContain('UNIQUE-MSG');
    expect(runner.calls[0]?.prompt).toContain('UNIQUE-MSG');
  });

  it('falls back with a keyword tone when Claude fails', async () => {
    const { brain } = brainWith([new Error('down'), new Error('down'),
      new Error('down')]);
    const cruel = await brain.chat(sampleState(), 'Work FASTER, you idiot');
    expect(cruel.offline).toBe(true);
    expect(cruel.reply.tone).toBe('cruel');
    expect(cruel.reply.say.length).toBeGreaterThan(0);
    expect((await brain.chat(sampleState(), 'Thanks, great job!')).reply.tone)
      .toBe('kind');
    expect((await brain.chat(sampleState(), 'What time is it?')).reply.tone)
      .toBe('neutral');
  });
});

describe('guessTone', () => {
  it('reads common words', () => {
    expect(guessTone('I love this, thank you')).toBe('kind');
    expect(guessTone('You are useless')).toBe('cruel');
    expect(guessTone('I love how useless you are')).toBe('cruel');
    expect(guessTone('Morning')).toBe('neutral');
    expect(guessTone("You're FIRED")).toBe('cruel');
  });
});

describe('Brain.releaseNotes', () => {
  const project = sampleProject();

  it('strips fences and a leading title', async () => {
    const md = '```markdown\n# Toaster OS\n\nIt toasts.\n\n## What\'s new\n- Toast\n\n' +
      '## Known issues\n- Fire\n```';
    const { brain } = brainWith([md]);
    const { markdown, offline } = await brain.releaseNotes(sampleState(), project,
      0.85, 'Masterpiece');
    expect(offline).toBe(false);
    expect(markdown.startsWith('It toasts.')).toBe(true);
    expect(markdown).not.toContain('```');
    expect(markdown).toContain('## Known issues');
  });

  it('keeps inner code blocks', async () => {
    const md = 'Shipped it, with a dash of chaos.\n\n```\ntoast --force\n```\n\n- Done';
    const { brain } = brainWith([md]);
    const { markdown } = await brain.releaseNotes(sampleState(), project, 0.5, 'Buggy');
    expect(markdown).toContain('toast --force');
    expect(markdown.startsWith('Shipped it')).toBe(true);
  });

  it('unwraps a JSON answer', async () => {
    const reply = JSON.stringify({
      markdown: 'A long enough summary of the release notes.\n- One',
    });
    const { brain } = brainWith([reply]);
    const { markdown, offline } = await brain.releaseNotes(sampleState(), project,
      0.5, 'Buggy');
    expect(offline).toBe(false);
    expect(markdown).toContain('A long enough summary');
  });

  it('asks for the grade tone', async () => {
    const { brain, runner } = brainWith([new Error('down')]);
    await brain.releaseNotes(sampleState(), project, 0.2, 'Cursed garbage');
    expect(runner.calls[0]?.prompt).toMatch(/unhinged/);
    expect(runner.calls[0]?.prompt).toContain('Cursed garbage');
  });

  it('falls back to a template matching the grade', async () => {
    const { brain } = brainWith(['too short', new Error('down')]);
    const cursed = await brain.releaseNotes(sampleState(), project, 0.2,
      'Cursed garbage');
    expect(cursed.offline).toBe(true);
    expect(cursed.markdown).toContain('Toaster OS');
    expect(cursed.markdown).toMatch(/ANGRY/);
    expect(cursed.markdown).toContain('Priyanka');
    const best = await brain.releaseNotes(sampleState(), project, 0.9, 'Masterpiece');
    expect(best.markdown).toMatch(/outdone myself/);
  });
});

describe('Brain.farewell', () => {
  it('returns all three parts and trims the mug to six words', async () => {
    const reply = JSON.stringify({
      lastWords: 'Goodbye, cruel toaster!',
      stickyNote: 'Gerald knows the password.',
      mugText: 'One two three four five six seven eight',
    });
    const { brain, runner } = brainWith([reply]);
    const { farewell, offline } = await brain.farewell(sampleState(), 'fried');
    expect(offline).toBe(false);
    expect(farewell.lastWords).toBe('Goodbye, cruel toaster!');
    expect(farewell.stickyNote).toBe('Gerald knows the password.');
    expect(farewell.mugText).toBe('One two three four five six');
    expect(runner.calls[0]?.prompt).toMatch(/electrocuted/);
  });

  it('fills missing extras from the canned set', async () => {
    const { brain } = brainWith(['{"lastWords":"I QUIT!"}']);
    const { farewell, offline } = await brain.farewell(sampleState(), 'rage-quit');
    expect(offline).toBe(false);
    expect(farewell.lastWords).toBe('I QUIT!');
    expect(farewell.stickyNote.length).toBeGreaterThan(0);
    expect(farewell.mugText.length).toBeGreaterThan(0);
  });

  it('falls back per ending when Claude fails', async () => {
    const endings = ['lost-mind', 'fried', 'rage-quit', 'fired'] as const;
    const { brain } = brainWith(endings.map(() => new Error('down')));
    for (const ending of endings) {
      const { farewell, offline } = await brain.farewell(sampleState(), ending);
      expect(offline).toBe(true);
      expect(farewell.lastWords.length).toBeGreaterThan(0);
      expect(farewell.stickyNote.length).toBeGreaterThan(0);
      expect(farewell.mugText.split(' ').length).toBeLessThanOrEqual(6);
    }
  });
});
