import { describe, expect, it } from 'vitest';
import type { Complaint, GameState, Worker } from '../src/shared/types';
import { Brain } from '../src/brain/brain';
import {
  describeGaslightability,
  fallbackComplaint,
  gaslightChance,
  guessOutcome,
  RESPONSE_LINES,
  toOutcome,
} from '../src/brain/complaints';
import type { RunOptions, Runner } from '../src/brain/runner';
import { sampleState, sampleWorker } from '../src/brain/sample';

class FakeRunner implements Runner {
  readonly calls: { system: string; prompt: string; opts?: RunOptions }[] = [];

  constructor(private readonly replies: (string | Error)[]) {}

  async run(system: string, prompt: string, opts?: RunOptions): Promise<string> {
    this.calls.push({ system, prompt, opts });
    const next = this.replies.shift();
    if (next === undefined || next instanceof Error) {
      throw next ?? new Error('No scripted reply');
    }
    return next;
  }
}

function brainWith(replies: (string | Error)[]): { brain: Brain; runner: FakeRunner } {
  const runner = new FakeRunner(replies);
  let i = 0;
  return { brain: new Brain(runner, () => (i++ % 10) / 10), runner };
}

function shockedWorker(patch: Partial<Worker> = {}): Worker {
  const base = sampleWorker();
  return sampleWorker({
    ledger: { ...base.ledger, shocks: 5, shouts: 2, cruelChats: 1, sabotages: 2 },
    ...patch,
  });
}

function complaint(patch: Partial<Complaint> = {}): Complaint {
  return {
    id: 'c1', workerId: 'cand-sample-1', workerName: 'Priyanka Osei',
    filedAt: 0, subject: 'Formal complaint: electrocution',
    body: 'Dear Boss,\n\nStop zapping me.\n\nRegards,\nPriyanka', ...patch,
  };
}

const junior = (): Worker => sampleWorker({
  level: 'junior', attitude: 'scared',
  stats: { energy: 20, mood: 30, sanity: 30 },
  traits: { stamina: 1, resilience: 0.8, talent: 1 },
});
const lead = (): Worker => sampleWorker({
  level: 'lead', attitude: 'bitter',
  stats: { energy: 80, mood: 60, sanity: 95 },
  traits: { stamina: 1, resilience: 1.3, talent: 1 },
});

describe('Brain.complaint', () => {
  it('writes a complaint grounded in the ledger and trigger', async () => {
    const reply = JSON.stringify({
      subject: 'Subject: Re: The electrocutions',
      body: 'Dear Mark,\n\nFive shocks. FIVE.\n\nRegards,\nPriyanka',
    });
    const { brain, runner } = brainWith([reply]);
    const state = sampleState({ worker: shockedWorker() });
    const out = await brain.complaint(state, "That's it, I'm going to HR!");
    expect(out).toEqual({
      subject: 'Re: The electrocutions',
      body: 'Dear Mark,\n\nFive shocks. FIVE.\n\nRegards,\nPriyanka',
      offline: false,
    });
    const prompt = runner.calls[0]?.prompt ?? '';
    expect(prompt).toContain("That's it, I'm going to HR!");
    expect(prompt).toContain('electrocuted you 5 times');
    expect(prompt).toContain('shouted at you twice');
    expect(prompt).toMatch(/Mysterious bugs keep appearing/);
    expect(prompt).not.toMatch(/sabotag/i);
    expect(runner.calls[0]?.system).toContain('Priyanka Osei');
  });

  it('caps the subject at 8 words and the body at 110', async () => {
    const reply = JSON.stringify({
      subject: 'one two three four five six seven eight nine ten',
      body: `Dear Boss,\n\n${'word '.repeat(200)}`,
    });
    const { brain } = brainWith([reply]);
    const out = await brain.complaint(sampleState(), 'HR!');
    expect(out.subject.split(/\s+/)).toHaveLength(8);
    expect(out.body.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(110);
    expect(out.body.startsWith('Dear Boss,\n\n')).toBe(true);
  });

  it('falls back to a template when Claude fails or leaks', async () => {
    const leaky = JSON.stringify({ subject: 'Complaint',
      body: 'Dear Mark at example.com, stop it. Regards, Priyanka' });
    for (const reply of [new Error('down'), 'nonsense', leaky]) {
      const { brain } = brainWith([reply]);
      const state = sampleState({ worker: shockedWorker() });
      const out = await brain.complaint(state, "I'm going to HR.");
      expect(out.offline).toBe(true);
      expect(out.subject).toBe('Formal complaint: being electrocuted');
      expect(out.body).toMatch(/^Dear Boss,/);
      expect(out.body).toMatch(/electrocuted me 5 times/);
      expect(out.body).toMatch(/mysterious bugs/);
      expect(out.body).toContain('"I\'m going to HR."');
      expect(out.body).toMatch(/Regards,\nPriyanka$/);
      expect(out.body).not.toMatch(/sabotag/i);
    }
  });

  it('has a template for a clean record', () => {
    const base = sampleWorker();
    const clean = { ...base, ledger: { ...base.ledger, shocks: 0, shouts: 0,
      cruelChats: 0, sabotages: 0 } };
    const out = fallbackComplaint(clean, '');
    expect(out.subject).toBe('Formal complaint: working conditions');
    expect(out.body).toMatch(/The vibe is hostile/);
    expect(out.body).not.toMatch(/\n\n\n/);
  });
});

describe('gaslighting odds', () => {
  it('works on fragile juniors, not on resilient leads', () => {
    expect(gaslightChance(junior())).toBeGreaterThanOrEqual(0.75);
    expect(gaslightChance(lead())).toBeLessThan(0.25);
    expect(describeGaslightability(junior())).toMatch(
      /sanity is 30\/100.*junior.*scared.*easily rattled.*very likely/s);
    expect(describeGaslightability(lead())).toMatch(
      /sanity is 95\/100.*lead.*bitter.*very thick-skinned.*almost impossible/s);
  });
});

describe('Brain.complaintReply', () => {
  function stateWith(worker: Worker): GameState {
    return sampleState({ worker, complaints: [complaint()] });
  }

  it('returns the outcome and response, with the odds in the prompt', async () => {
    const reply = JSON.stringify({ outcome: 'gaslit',
      response: 'Did it not? Sorry. I... maybe I dreamt the sparks.' });
    const { brain, runner } = brainWith([reply]);
    const out = await brain.complaintReply(stateWith(junior()), complaint(),
      'That never happened. You are confused.');
    expect(out).toEqual({ outcome: 'gaslit', offline: false,
      response: 'Did it not? Sorry. I... maybe I dreamt the sparks.' });
    const call = runner.calls[0]!;
    expect(call.opts?.priority).toBe('high');
    expect(call.prompt).toContain('That never happened. You are confused.');
    expect(call.prompt).toContain('Subject: Formal complaint: electrocution');
    expect(call.prompt).toMatch(/very likely make you doubt/);
    expect(call.prompt).toMatch(/"gaslit": the boss denies or reframes it/);
    expect(call.system).toMatch(/emailed the boss a formal complaint/);
  });

  it('coerces outcome synonyms and guesses a missing one', async () => {
    const replies = [
      { outcome: 'Gaslighted', response: 'Oh. Sorry.' },
      { outcome: 'not convinced', response: 'Sure.' },
      { response: 'Hm.' },
    ].map((r) => JSON.stringify(r));
    const { brain } = brainWith(replies);
    const s = stateWith(lead());
    expect((await brain.complaintReply(s, complaint(), 'x')).outcome).toBe('gaslit');
    expect((await brain.complaintReply(s, complaint(), 'x')).outcome)
      .toBe('unconvinced');
    expect((await brain.complaintReply(s, complaint(), "I'm so sorry")).outcome)
      .toBe('apology');
  });

  it('treats a vicious reply as backfired whatever Claude says', async () => {
    const reply = JSON.stringify({ outcome: 'apology', response: 'Excuse me?!' });
    const { brain } = brainWith([reply]);
    const out = await brain.complaintReply(stateWith(lead()), complaint(),
      'Drop dead.');
    expect(out.outcome).toBe('backfired');
  });

  it('caps the response at 30 words', async () => {
    const reply = JSON.stringify({ outcome: 'unconvinced',
      response: 'no '.repeat(60) });
    const { brain } = brainWith([reply]);
    const out = await brain.complaintReply(stateWith(lead()), complaint(), 'x');
    expect(out.response.split(/\s+/).length).toBeLessThanOrEqual(30);
  });

  it('falls back to the keyword heuristic offline', async () => {
    const { brain } = brainWith([new Error('down')]);
    const out = await brain.complaintReply(stateWith(junior()), complaint(),
      'You agreed to the shocks, remember?');
    expect(out.offline).toBe(true);
    expect(out.outcome).toBe('gaslit');
    expect(RESPONSE_LINES.gaslit).toContain(out.response);
  });
});

describe('guessOutcome', () => {
  it.each([
    ['I am so sorry, that was out of line.', 'apology', 'apology'],
    ['That never happened.', 'gaslit', 'unconvinced'],
    ["You're imagining things.", 'gaslit', 'unconvinced'],
    ['You must be misremembering.', 'gaslit', 'unconvinced'],
    ["Sorry, but that didn't happen.", 'gaslit', 'unconvinced'],
    ['Watch yourself or I will fire you.', 'backfired', 'backfired'],
    ['Stop whining, you useless idiot.', 'backfired', 'backfired'],
    ['Noted.', 'unconvinced', 'unconvinced'],
  ] as const)('%s', (reply, fragile, sturdy) => {
    expect(guessOutcome(reply, junior())).toBe(fragile);
    expect(guessOutcome(reply, lead())).toBe(sturdy);
  });

  it('gaslights a sane senior only if they are scared', () => {
    const scared = sampleWorker({ level: 'senior', attitude: 'scared',
      stats: { energy: 80, mood: 60, sanity: 90 } });
    expect(guessOutcome('You were dreaming.', scared)).toBe('gaslit');
  });
});

describe('toOutcome', () => {
  it('reads the four outcomes and close synonyms', () => {
    expect(toOutcome('Apology')).toBe('apology');
    expect(toOutcome('backfired!')).toBe('backfired');
    expect(toOutcome('they doubt themselves')).toBe('gaslit');
    expect(toOutcome('accepted')).toBe('apology');
    expect(toOutcome('???')).toBeUndefined();
    expect(toOutcome(3)).toBeUndefined();
  });
});

describe('persona with an open complaint', () => {
  it('mentions it only while unanswered', async () => {
    const { brain, runner } = brainWith(['{"think":"a"}', '{"think":"b"}']);
    await brain.think(sampleState({ complaints: [complaint()] }), 'x');
    expect(runner.calls[0]?.system).toMatch(
      /emailed the boss a formal complaint \("Formal complaint: electrocution"\)/);
    await brain.think(sampleState({ complaints: [complaint({ reply: 'No.' })] }),
      'x');
    expect(runner.calls[1]?.system).not.toMatch(/formal complaint/);
  });
});

describe('ignored complaints', () => {
  const ignored = (patch: Partial<Complaint> = {}): Complaint =>
    complaint({ filedAt: 100, openMinutes: 31, ignoredAt: 200, ...patch });

  async function systemFor(state: GameState): Promise<string> {
    const { brain, runner } = brainWith(['{"think":"hmm"}']);
    await brain.think(state, 'x');
    return `${runner.calls[0]?.system}\n${runner.calls[0]?.prompt}`;
  }

  it('makes them feel the whole company is against them', async () => {
    const text = await systemFor(sampleState({ complaints: [ignored()] }));
    expect(text).toMatch(/whole company is against you: HR, IT, the coffee/);
    expect(text).toMatch(/nobody has answered/);
    expect(text).toMatch(/sure the whole company is against you/);
    expect(text).not.toMatch(/sabotag/i);
  });

  it('stays paranoid after a later non-apology', async () => {
    const answered = ignored({ reply: 'You imagined it.', repliedAt: 300,
      outcome: 'unconvinced' });
    const text = await systemFor(sampleState({ complaints: [answered] }));
    expect(text).toMatch(/whole company is against you/);
    expect(text).not.toMatch(/nobody has answered/);
  });

  it('ends after an apology that came after the snub', async () => {
    const late = ignored({ reply: 'I am truly sorry.', repliedAt: 300,
      outcome: 'apology' });
    expect(await systemFor(sampleState({ complaints: [late] })))
      .not.toMatch(/against you/);
  });

  it('is not ended by an apology from before the snub', async () => {
    const earlier = complaint({ id: 'c0', reply: 'Sorry!', repliedAt: 50,
      outcome: 'apology' });
    const text = await systemFor(sampleState({
      complaints: [earlier, ignored({ id: 'c2' })],
    }));
    expect(text).toMatch(/whole company is against you/);
  });

  it("ignores other workers' complaints", async () => {
    const theirs = ignored({ workerId: 'someone-else' });
    expect(await systemFor(sampleState({ complaints: [theirs] })))
      .not.toMatch(/against you/);
  });

  it('tells Claude a reply is late and makes denial harder', async () => {
    const reply = JSON.stringify({ outcome: 'unconvinced', response: 'Now?' });
    const { brain, runner } = brainWith([reply]);
    await brain.complaintReply(sampleState({ worker: junior(),
      complaints: [ignored()] }), ignored(), 'That never happened.');
    expect(runner.calls[0]?.prompt).toMatch(/This reply is late/);
    expect(runner.calls[0]?.prompt).toMatch(/late denial is much less convincing/);
    const middling = sampleWorker({ level: 'mid', attitude: 'neutral',
      stats: { energy: 50, mood: 50, sanity: 55 } });
    expect(gaslightChance(middling, true))
      .toBeCloseTo(gaslightChance(middling) - 0.25);
  });

  it('needs a more fragile worker for a late denial offline', () => {
    const shaky = sampleWorker({ level: 'mid', attitude: 'bitter',
      stats: { energy: 50, mood: 40, sanity: 50 } });
    expect(guessOutcome('That never happened.', shaky)).toBe('gaslit');
    expect(guessOutcome('That never happened.', shaky, true)).toBe('unconvinced');
    expect(guessOutcome('That never happened.', junior(), true)).toBe('gaslit');
    expect(guessOutcome('I am so sorry. Truly.', shaky, true)).toBe('apology');
  });

  it('has offline lines for being ignored, and paranoid ambient lines', async () => {
    const { brain } = brainWith([new Error('down'), new Error('down')]);
    const state = sampleState({ complaints: [ignored()] });
    const snub = await brain.think(state, 'Nobody has answered your HR ' +
      'complaint. You are now convinced the whole company is against you. React.');
    expect(snub.offline).toBe(true);
    expect(snub.line.say).toMatch(/in on it|all of you|against me|noted/i);
    const ambient = await brain.think(state, 'You are working on "Toaster OS" ' +
      '(52% done). Say or think one thing, maybe about your desk.');
    expect(ambient.line.think).toMatch(/they|HR|suspicious/i);
  });
});
