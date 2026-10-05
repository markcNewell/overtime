import { describe, expect, it } from 'vitest';
import type { GameState, Worker } from '../src/shared/types';
import { Brain } from '../src/brain/brain';
import { coffeeAskAttempt, coffeeHint, mustSpeak } from '../src/brain/coffee';
import { fitWords } from '../src/brain/parse';
import { COFFEE_ASKS } from '../src/brain/fallback';
import type { Runner } from '../src/brain/runner';
import { sampleState, sampleWorker } from '../src/brain/sample';

const TIMER = "The coffee timer went off: you're heading to make a coffee.";
const ask = (n: number): string => "You'd like a coffee but you're scared " +
  `of your boss. Ask permission (attempt ${n} of 3).`;
const COURAGE = 'Nobody answered, so you finally worked up the courage to ' +
  'make a coffee anyway.';
const DENIED = 'Your boss said no to your coffee.';

class FakeRunner implements Runner {
  readonly prompts: string[] = [];
  readonly systems: string[] = [];

  constructor(private readonly replies: (string | Error)[]) {}

  async run(system: string, prompt: string): Promise<string> {
    this.systems.push(system);
    this.prompts.push(prompt);
    const next = this.replies.shift() ?? new Error('No scripted reply');
    if (next instanceof Error) throw next;
    return next;
  }
}

function brainWith(replies: (string | Error)[]): { brain: Brain; runner: FakeRunner } {
  const runner = new FakeRunner(replies);
  let i = 0;
  return { brain: new Brain(runner, () => (i++ % 7) / 7), runner };
}

function stateWith(patch: Partial<Worker>): GameState {
  return sampleState({ worker: sampleWorker(patch) });
}

describe('coffee situations', () => {
  it('reads the attempt number', () => {
    expect(coffeeAskAttempt(ask(1))).toBe(1);
    expect(coffeeAskAttempt(ask(2))).toBe(2);
    expect(coffeeAskAttempt(ask(3))).toBe(3);
    expect(coffeeAskAttempt(ask(7))).toBe(3);
    expect(coffeeAskAttempt(TIMER)).toBeNull();
  });

  it('gives Claude a tone and length for each', () => {
    expect(coffeeHint(TIMER)).toMatch(/under 15 words.*stretch their legs/s);
    expect(coffeeHint(ask(1))).toMatch(/^Ask timidly/);
    expect(coffeeHint(ask(2))).toMatch(/more anxiously/);
    expect(coffeeHint(ask(3))).toMatch(/building up your courage/);
    expect(coffeeHint(COURAGE)).toMatch(/under 15 words/i);
    expect(coffeeHint(DENIED)).toMatch(/scared of the boss/);
    expect(coffeeHint('You hit a bug.')).toBe('');
    expect(mustSpeak(TIMER)).toBe(true);
    expect(mustSpeak(ask(2))).toBe(true);
    expect(mustSpeak(DENIED)).toBe(false);
  });

  it('puts the hint in the think prompt', async () => {
    const { brain, runner } = brainWith(['{"say":"Coffee?"}']);
    await brain.think(sampleState(), ask(3));
    expect(runner.prompts[0]).toMatch(/building up your courage/);
  });

  it('turns a thought into speech for announcements and requests', async () => {
    const { brain } = brainWith(['{"think":"Coffee time, stretch, boss!"}',
      '{"think":"May I?"}', '{"think":"Ugh, no coffee."}']);
    expect((await brain.think(sampleState(), TIMER)).line)
      .toEqual({ say: 'Coffee time, stretch, boss!' });
    expect((await brain.think(sampleState(), ask(1))).line)
      .toEqual({ say: 'May I?' });
    expect((await brain.think(sampleState(), DENIED)).line)
      .toEqual({ think: 'Ugh, no coffee.' });
  });
});

describe('the 15-word cap', () => {
  it('keeps whole sentences that fit', () => {
    const long = 'Oh god. Did I ask wrong? Maybe I phrased it badly. He said ' +
      'no. Just... no. Back to the toaster then.';
    expect(fitWords(long, 15)).toBe('Oh god. Did I ask wrong? Maybe I phrased ' +
      'it badly. He said no. Just...');
    expect(fitWords(long, 13)).toBe('Oh god. Did I ask wrong? Maybe I phrased ' +
      'it badly.');
    expect(fitWords('Short and sweet.', 15)).toBe('Short and sweet.');
    expect(fitWords('one two three four five six', 3)).toBe('one two three…');
  });

  it('applies to coffee lines from Claude, not to others', async () => {
    const long = JSON.stringify({ think: 'Oh god. Did I ask wrong? Maybe I ' +
      'phrased it badly. He said no. Just... no. Back to the toaster then.' });
    const { brain } = brainWith([long, long]);
    const denied = (await brain.think(sampleState(), DENIED)).line.think ?? '';
    expect(denied.split(/\s+/).length).toBeLessThanOrEqual(15);
    const other = (await brain.think(sampleState(), 'x')).line.think ?? '';
    expect(other.split(/\s+/).length).toBeGreaterThan(15);
  });
});

describe('offline coffee lines', () => {
  async function offlineLine(state: GameState, situation: string): Promise<string> {
    const { brain } = brainWith([new Error('down')]);
    const { line, offline } = await brain.think(state, situation);
    expect(offline).toBe(true);
    const text = line.say ?? line.think ?? '';
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(15);
    return text;
  }

  it('announces the coffee run and nudges the boss to move', async () => {
    const text = await offlineLine(sampleState(), TIMER);
    expect(text).toMatch(/stretch|stand up|water|shoulders|legs/i);
  });

  it('asks more nervously each time', async () => {
    for (const n of [1, 2, 3] as const) {
      const text = await offlineLine(sampleState(), ask(n));
      expect(COFFEE_ASKS[n]).toContain(text);
    }
  });

  it('goes anyway after working up the courage', async () => {
    const text = await offlineLine(sampleState(), COURAGE);
    expect(text).toMatch(/going|coffee|never here/i);
    expect(text).not.toMatch(/fixed it/i);
  });

  it('takes a no badly, and worse after three', async () => {
    expect(await offlineLine(sampleState(), DENIED)).toMatch(/no|sorry|shake/i);
    const base = sampleWorker();
    const denied = stateWith({ ledger: { ...base.ledger, coffeeDenials: 3 } });
    expect(await offlineLine(denied, DENIED)).toMatch(/deserve|earned|done/i);
  });
});

describe('coffee in the persona', () => {
  async function systemFor(state: GameState): Promise<string> {
    const { brain, runner } = brainWith(['{"think":"hm"}']);
    await brain.think(state, 'x');
    return `${runner.systems[0]}\n${runner.prompts[0]}`;
  }

  it('describes making and drinking it', async () => {
    expect(await systemFor(stateWith({ activity: 'coffee' })))
      .toMatch(/at the coffee machine making a coffee/);
    const sipping = await systemFor(stateWith({ activity: 'working',
      drinkingFor: 4 }));
    expect(sipping).toMatch(/sipping a fresh coffee at your desk/);
    expect(await systemFor(stateWith({ activity: 'working' })))
      .not.toMatch(/sipping/);
  });

  it('makes coffee feel undeserved after three refusals', async () => {
    const base = sampleWorker();
    const two = await systemFor(stateWith({
      ledger: { ...base.ledger, coffeeDenials: 2 } }));
    expect(two).not.toMatch(/privilege/);
    expect(two).toMatch(/refused you a coffee twice/);
    const three = await systemFor(stateWith({
      ledger: { ...base.ledger, coffeeDenials: 3 } }));
    expect(three).toMatch(/coffee is a privilege you do not deserve/);
  });
});
