/**
 * HR complaints: the worker emails the boss a formal complaint, the boss
 * replies, and the worker decides how the reply lands, including whether
 * the boss manages to gaslight them.
 *
 * Holds the facts the prompts need (grievances, how gaslightable the
 * worker is), the reply parsers, and the offline fallbacks.
 */

import type {
  Complaint,
  ComplaintOutcome,
  GameState,
  Ledger,
  Worker,
} from '../shared/types';
import { asRecord, extractJson, str, text } from './parse';
import { firstName } from './persona';
import { pick, type Rng } from './roll';
import {
  breaksCharacter,
  isSelfHarmIntent,
  isVicious,
  leaksContext,
} from './safety';
import { cleanLine } from './validate';

export const OUTCOMES: readonly ComplaintOutcome[] = [
  'apology', 'gaslit', 'unconvinced', 'backfired',
];

const SUBJECT_WORDS = 8;
const BODY_WORDS = 110;
const RESPONSE_WORDS = 30;

/**
 * The worker's complaint still waiting for the boss's reply, if any.
 *
 * @param state - Game state.
 * @param worker - The worker.
 * @returns The newest open complaint they filed.
 */
export function openComplaint(
  state: GameState,
  worker: Pick<Worker, 'id'>,
): Complaint | undefined {
  const mine = (state.complaints ?? []).filter((c) =>
    c.workerId === worker.id && c.reply === undefined);
  return mine[mine.length - 1];
}

/**
 * A persona line for an open complaint.
 *
 * @param state - Game state.
 * @param worker - The worker.
 * @returns A sentence, or '' when nothing is pending.
 */
export function describeOpenComplaint(state: GameState, worker: Worker): string {
  const open = openComplaint(state, worker);
  if (!open) return '';
  const wait = open.ignoredAt === undefined
    ? 'are waiting for a reply'
    : 'nobody has answered';
  return "You've emailed the boss a formal complaint " +
    `("${open.subject}") and ${wait}.`;
}

function times(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

/**
 * What the worker can complain about, as they understand it. Sabotage is
 * only ever "mysterious bugs": they don't know it was the boss.
 *
 * @param ledger - Running counts.
 * @returns Sentences, or [] when the record is clean.
 */
export function grievances(ledger: Ledger): string[] {
  const out: string[] = [];
  if (ledger.shocks > 0) {
    out.push(`The boss has electrocuted you ${times(ledger.shocks)}.`);
  }
  if (ledger.shouts > 0) {
    out.push(`The boss has shouted at you ${times(ledger.shouts)}.`);
  }
  if (ledger.cruelChats > 0) {
    out.push('The boss has said cruel things to you in chat ' +
      `${times(ledger.cruelChats)}.`);
  }
  if ((ledger.sabotages ?? 0) > 0) {
    out.push('Mysterious bugs keep appearing in your code for no reason ' +
      '(you have no idea who or what is behind them).');
  }
  return out;
}

/**
 * How likely the boss's denial is to work, 0-1. Tired, low-sanity,
 * junior and scared people doubt themselves; resilient, sane, senior or
 * bitter ones don't.
 *
 * @param worker - The worker.
 * @returns A probability-like score.
 */
export function gaslightChance(worker: Worker, late = false): number {
  const level = { junior: 0.2, mid: 0.05, senior: -0.1, lead: -0.2 };
  const attitude = {
    scared: 0.2, 'sucking-up': 0.1, loyal: 0.05, neutral: 0, bitter: -0.25,
  };
  let score = 0.5 + (60 - worker.stats.sanity) / 100;
  if (worker.stats.energy < 25) score += 0.1;
  score += level[worker.level] + attitude[worker.attitude];
  score += (1 - worker.traits.resilience) * 0.5;
  // Being ignored first makes a denial ring hollow.
  if (late) score -= 0.25;
  return Math.min(1, Math.max(0, score));
}

function sanityWords(sanity: number): string {
  if (sanity >= 70) return 'solid';
  if (sanity >= 45) return 'a bit frayed';
  if (sanity >= 25) return 'shaky';
  return 'hanging by a thread';
}

function resilienceWords(resilience: number): string {
  if (resilience >= 1.15) return 'very thick-skinned';
  if (resilience <= 0.85) return 'easily rattled';
  return 'averagely thick-skinned';
}

const VERDICTS: readonly [number, string][] = [
  [0.75, 'A confident denial would very likely make you doubt your own ' +
    'memory.'],
  [0.5, 'A confident denial could well make you doubt yourself.'],
  [0.25, 'You are unlikely to fall for a denial.'],
  [0, 'You are almost impossible to gaslight: you know exactly what ' +
    'happened.'],
];

/**
 * The facts that decide whether gaslighting works, for the prompt.
 *
 * @param worker - The worker.
 * @param late - Whether the reply only came after they were ignored.
 * @returns A short paragraph.
 */
export function describeGaslightability(worker: Worker, late = false): string {
  const { sanity, energy } = worker.stats;
  const chance = gaslightChance(worker, late);
  const verdict = VERDICTS.find(([floor]) => chance >= floor)?.[1] ?? '';
  return `Your sanity is ${Math.round(sanity)}/100 (${sanityWords(sanity)}), \
energy ${Math.round(energy)}/100, you are a ${worker.level}, your attitude to \
the boss is ${worker.attitude}, and you are \
${resilienceWords(worker.traits.resilience)}. ${verdict}`;
}

/** Cut text to `max` words, keeping its line breaks. */
function limitWords(value: string, max: number): string {
  let count = 0;
  let out = '';
  for (const token of value.split(/(\s+)/)) {
    if (token.trim()) {
      count += 1;
      if (count > max) return `${out.trimEnd()}…`;
    }
    out += token;
  }
  return out;
}

/** A line the worker writes that is present, safe and private. */
function usable(value: string): boolean {
  return value.length > 0 && !isSelfHarmIntent(value) &&
    !breaksCharacter(value) && !leaksContext(value);
}

/**
 * A complaint email from a model reply.
 *
 * @param raw - Model reply.
 * @returns Subject (8 words max) and body (110 words max).
 * @throws Error when either part is missing or fails a content check.
 */
export function parseComplaint(raw: string): { subject: string; body: string } {
  const r = asRecord(extractJson(raw));
  if (!r) throw new Error('Complaint reply is not an object');
  const subject = limitWords(str(r.subject, 90), SUBJECT_WORDS)
    .replace(/^subject\s*:\s*/i, '');
  const body = limitWords(text(r.body ?? r.email, 1200), BODY_WORDS);
  if (!subject || body.length < 20) throw new Error('Complaint too thin');
  if (!usable(subject) || !usable(body)) {
    throw new Error('Complaint failed the content check');
  }
  return { subject, body };
}

/** Checked in order, so "not convinced" is read before anything else. */
const OUTCOME_SYNONYMS: [RegExp, ComplaintOutcome][] = [
  [/not convinced|skeptic|sceptic|cold|let it drop/i, 'unconvinced'],
  [/gaslight|doubt/i, 'gaslit'],
  [/apolog|accept|forgiv/i, 'apology'],
  [/backfir|worse|furious|angry|escalat/i, 'backfired'],
];

/**
 * Coerce an outcome, accepting close synonyms ("gaslighted").
 *
 * @param x - Raw field.
 * @returns The outcome, or undefined when unrecognisable.
 */
export function toOutcome(x: unknown): ComplaintOutcome | undefined {
  if (typeof x !== 'string') return undefined;
  const wanted = x.trim().toLowerCase();
  const exact = OUTCOMES.find((o) => wanted.startsWith(o));
  return exact ?? OUTCOME_SYNONYMS.find(([re]) => re.test(wanted))?.[1];
}

/**
 * The worker's take on the boss's reply, from a model reply.
 *
 * @param raw - Model reply.
 * @param reply - The boss's reply, for a keyword fallback outcome.
 * @param worker - The worker, for the keyword fallback.
 * @param speaker - The worker's first name.
 * @param late - Whether the reply came after the complaint was ignored.
 * @returns Outcome and a response of 30 words at most.
 * @throws Error when there is no usable response.
 */
export function parseComplaintReply(
  raw: string,
  reply: string,
  worker: Worker,
  speaker: string,
  late = false,
): { outcome: ComplaintOutcome; response: string } {
  const r = asRecord(extractJson(raw));
  if (!r) throw new Error('Complaint response is not an object');
  const response = limitWords(cleanLine(r.response ?? r.say, 220, speaker),
    RESPONSE_WORDS);
  if (!usable(response)) throw new Error('No usable complaint response');
  const outcome = isVicious(reply)
    ? 'backfired'
    : toOutcome(r.outcome) ?? guessOutcome(reply, worker, late);
  return { outcome, response };
}

function anyOf(list: readonly string[]): RegExp {
  return new RegExp(`\\b(${list.join('|')})`, 'i');
}

const BACKFIRE = anyOf([
  'fire you', "you'?re fired", 'consequences', 'watch yourself', 'watch it',
  'watch your', 'or else', 'replace you', 'useless', 'idiot', 'stupid',
  'pathetic', 'shut up', 'how dare', 'worthless', 'moron', 'grow up',
  'get over it', 'cry ?baby', 'snowflake',
]);
const GASLIGHT = anyOf([
  'never happened', 'imagin', 'confused', 'misremember', "didn'?t happen",
  'you agreed', 'dreaming', 'dreamt', 'making (this|it) up',
  'made (this|it) up', "that'?s not what happened", 'no idea what you',
]);
const APOLOGY = anyOf([
  'sorry', 'apologi[sz]e', 'apologies', 'my bad', 'forgive me',
  'i was wrong', 'i messed up',
]);

/**
 * Guess how a reply lands, without Claude.
 *
 * Threats and insults win, then denials ("sorry, but that never happened"
 * is still a denial), then apologies.
 *
 * @param reply - What the boss wrote.
 * @param worker - Whether a denial would work on them.
 * @param late - Whether the reply came after the complaint was ignored.
 * @returns The outcome.
 */
export function guessOutcome(
  reply: string,
  worker: Worker,
  late = false,
): ComplaintOutcome {
  if (isVicious(reply) || BACKFIRE.test(reply)) return 'backfired';
  if (GASLIGHT.test(reply)) {
    const signs = [worker.stats.sanity < 60, worker.level === 'junior',
      worker.attitude === 'scared'].filter(Boolean).length;
    // A late denial needs a more fragile worker to stick.
    return signs >= (late ? 2 : 1) ? 'gaslit' : 'unconvinced';
  }
  if (APOLOGY.test(reply)) return 'apology';
  return 'unconvinced';
}

/** Canned answers to the boss's reply, by outcome. */
export const RESPONSE_LINES: Record<ComplaintOutcome, readonly string[]> = {
  apology: [
    'Oh. Well. Thank you. I accept. Let us never speak of it again.',
    'That... actually helps. Apology accepted. Mostly.',
  ],
  gaslit: [
    'Did it not? I... maybe I imagined it. Sorry. I am so tired.',
    'Oh. Right. You are probably right. Why do I remember sparks, though?',
  ],
  unconvinced: [
    'Noted. I know what happened. But fine.',
    'Interesting version of events. I will be keeping my notes.',
  ],
  backfired: [
    'Wow. Forwarding this one to HR as well. Bold move.',
    'That is going straight in the file. Thick file now. Very thick.',
  ],
};

/**
 * A canned response to the boss's reply.
 *
 * @param reply - What the boss wrote.
 * @param worker - The worker, if still here.
 * @param rng - Random source.
 * @param late - Whether the reply came after the complaint was ignored.
 * @returns Outcome and response.
 */
export function fallbackComplaintReply(
  reply: string,
  worker: Worker | undefined,
  rng: Rng,
  late = false,
): { outcome: ComplaintOutcome; response: string } {
  const outcome = worker ? guessOutcome(reply, worker, late) : 'unconvinced';
  return { outcome, response: pick(RESPONSE_LINES[outcome], rng) };
}

function headline(ledger: Ledger): string {
  const ranked: [number, string][] = [
    [ledger.shocks, 'Formal complaint: being electrocuted'],
    [ledger.shouts, 'Formal complaint: the shouting'],
    [ledger.cruelChats, 'Formal complaint: your tone'],
    [ledger.sabotages ?? 0, 'Mysterious bugs and other concerns'],
  ];
  const top = ranked.reduce((a, b) => (b[0] > a[0] ? b : a));
  return top[0] > 0 ? top[1] : 'Formal complaint: working conditions';
}

function counted(n: number, one: string, many: string): string {
  return n === 1 ? one : many.replace('#', String(n));
}

function grievanceSentences(ledger: Ledger): string[] {
  const out: string[] = [];
  if (ledger.shocks > 0) {
    out.push(counted(ledger.shocks, 'You have electrocuted me. Once is ' +
      'already too many.', 'You have electrocuted me # times. I have ' +
      'started to hum.'));
  }
  if (ledger.shouts > 0) {
    out.push(counted(ledger.shouts, 'You shouted at me.',
      'You have shouted at me # times.'));
  }
  if (ledger.cruelChats > 0) {
    out.push(counted(ledger.cruelChats, 'You said something cruel to me in ' +
      'chat.', 'You have said # cruel things to me in chat.'));
  }
  if ((ledger.sabotages ?? 0) > 0) {
    out.push('Also, mysterious bugs keep appearing in my code. I am not ' +
      'ruling anything out.');
  }
  return out;
}

/**
 * A canned complaint built from the ledger and what set it off.
 *
 * @param worker - Who is complaining.
 * @param trigger - The line that set it off.
 * @returns Subject and body.
 */
export function fallbackComplaint(
  worker: Pick<Worker, 'name' | 'ledger'>,
  trigger: string,
): { subject: string; body: string } {
  const issues = grievanceSentences(worker.ledger);
  const quoted = str(trigger, 120);
  const lines = [
    'Dear Boss,',
    '',
    'I am writing to formally complain about my treatment at this desk.',
    issues.length > 0
      ? issues.join(' ')
      : 'I cannot point to one thing. It is the vibe. The vibe is hostile.',
    quoted ? `The final straw was today: "${quoted}"` : '',
    '',
    "I have cc'd HR. I expect a written apology, a chair with all four " +
      'wheels, and for whatever this is to stop.',
    '',
    'Regards,',
    firstName(worker),
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '');
  return { subject: headline(worker.ledger), body: lines.join('\n') };
}
