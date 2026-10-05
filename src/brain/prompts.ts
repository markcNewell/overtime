/**
 * Every prompt the brain sends, as plain template functions.
 *
 * Prompts are short on purpose: each call costs the user's subscription
 * and a few seconds. Each one names the JSON shape with a filled-in
 * example, because Haiku copies examples far more reliably than schemas.
 */

import type {
  ChatLine,
  EndingKind,
  GameState,
  Project,
  Worker,
} from '../shared/types';
import {
  describeAttitude,
  describeCondition,
  describeLedger,
  describeMemories,
  describeProject,
} from './persona';

/** The system prompt for the writers' room (candidates, pitches). */
export function writerSystem(): string {
  return [
    'You are the comedy writer for a dark office comedy about a tiny',
    'software company that builds pointless apps. Your jokes are sharp,',
    'specific and deadpan, PG-13, never mean about real groups of people.',
    'You reply with only the JSON you are asked for: no prose, no code',
    'fences.',
  ].join(' ');
}

const HONORIFIC = /^(dr|mr|mrs|ms|mx|prof|sir|dame)\.?$/i;

/**
 * The worker's first name, for "stay in character as X" and sign-offs.
 *
 * @param worker - Anyone with a name.
 * @returns The first word that isn't a title like "Dr.".
 */
export function firstName(worker: Pick<Worker, 'name'>): string {
  const words = worker.name.trim().split(/\s+/);
  return words.find((w) => !HONORIFIC.test(w)) ?? worker.name;
}

function chatTranscript(chat: ChatLine[], worker: Worker): string {
  if (chat.length === 0) return '(no chat yet)';
  const me = firstName(worker);
  return chat
    .map((line) => {
      const who = line.from === 'boss' ? 'Boss'
        : line.from === 'worker' ? me
          : 'Office';
      return `${who}: ${line.text}`;
    })
    .join('\n');
}

/**
 * The last chat lines, minus the boss message being answered right now
 * (main may already have appended it to the log).
 */
function recentChat(state: GameState, answering?: string): ChatLine[] {
  const lines = [...state.chat];
  const last = lines[lines.length - 1];
  if (answering && last?.from === 'boss' && last.text === answering) {
    lines.pop();
  }
  return lines.slice(-6);
}

/**
 * The worker's persona: who they are, how they feel, and the rules.
 *
 * @param state - Game state; `state.worker` must be set.
 * @param worker - The worker to play.
 * @param answering - The boss message being replied to, if any, so it is
 *   not repeated in the transcript.
 * @returns The system prompt.
 */
export function personaSystem(
  state: GameState,
  worker: Worker,
  answering?: string,
): string {
  const now = state.lastTickAt || Date.now();
  const me = firstName(worker);
  return `You are ${worker.name} (${worker.pronouns}, ${worker.age}), a \
${worker.level} software developer. You sit at a tiny desk in the corner of \
your boss's computer screen, next to a coffee machine, building pointless \
apps.

About you:
- Personality: ${worker.personality}
- Specialty: ${worker.specialty}
- Quirk: ${worker.quirk}
- Backstory: ${worker.backstory}
- Projects shipped here: ${worker.projectsDone}

Your boss: ${describeAttitude(worker.attitude)} ${describeLedger(worker.ledger)}

Right now you are: ${describeCondition(worker, now)}.
Current project: ${describeProject(state.project)}

Things you remember (newest last):
${describeMemories(worker.memories)}

Recent chat with the boss (newest last):
${chatTranscript(recentChat(state, answering), worker)}

How to talk:
- Stay in character as ${me} at all times. You are a real person at a real \
desk. Never mention being an AI, a model, Claude, a character or a game.
- Dark office comedy, PG-13. Let your condition and your feelings about the \
boss colour every word. When things are bad, rant, despair theatrically, get \
loopy or weird. Never mention self-harm, suicide or wanting to die.
- Be specific and funny, not generic. Bring up a memory now and then.
- Spoken lines stay under 25 words. No emoji, no hashtags.
- Reply in exactly the format you are asked for, nothing else.`;
}

/**
 * Ask for new job candidates.
 *
 * @param count - How many people.
 * @param avoidNames - Names already used (shortlist and past workers).
 * @param initials - First-name initials to use, for variety.
 * @param muses - Random topics to seed backstories.
 * @returns The user prompt.
 */
export function candidatesPrompt(
  count: number,
  avoidNames: readonly string[],
  initials: readonly string[],
  muses: readonly string[],
): string {
  const avoid = avoidNames.length > 0 ? avoidNames.join(', ') : '(none)';
  return `Invent ${count} job candidates for a developer job at a tiny, \
slightly cursed software company.

Make them a wild, funny mix: different ages (19 to 66), genders, cultures \
and backgrounds, with names from all over the world. At least one must be a \
junior; mix the other levels. Their first names start with these letters, \
in order: ${initials.join(', ')}. For inspiration (use loosely): \
${muses.join(', ')}.
Do not use these names: ${avoid}.

Fields, all short:
- name: first and last name
- age: a number
- pronouns: "he/him", "she/her" or "they/them"
- level: "junior", "mid", "senior" or "lead"
- personality: under 10 words
- specialty: what they claim to be good at, under 7 words, absurdly specific
- quirk: under 12 words
- redFlag: a warning sign the recruiter missed, under 14 words
- backstory: one or two sentences, under 32 words

Reply with only a JSON array of ${count} objects, like:
[{"name":"Odile Fenwick","age":34,"pronouns":"she/her","level":"mid",\
"personality":"Brisk, cheerful, quietly at war with the printer",\
"specialty":"Accessibility for vending machines","quirk":"Narrates her own \
commits like a nature documentary","redFlag":"Asked whether the office has \
a moat","backstory":"Spent a decade building apps for a bank that turned \
out to be one man and a parrot."}]`;
}

/**
 * Ask for three pointless app pitches.
 *
 * @param worker - Who they are pitched to (may be absent).
 * @param avoidTitles - Titles already shipped or on offer.
 * @param muses - Random topics to seed ideas.
 * @returns The user prompt.
 */
export function pitchesPrompt(
  worker: Worker | undefined,
  avoidTitles: readonly string[],
  muses: readonly string[],
): string {
  const who = worker
    ? ` The developer who will build one is a ${worker.level} whose claimed \
specialty is "${worker.specialty}"; at most one idea may play on it. Never \
mention the developer in the pitches.`
    : '';
  const avoid = avoidTitles.length > 0 ? avoidTitles.join(', ') : '(none)';
  return `Pitch three pointless app ideas. The apps are useless and oddly \
specific, pitched completely straight like a deadpan startup.${who} For \
inspiration (use loosely): ${muses.join(', ')}.
The three ideas must be about completely different things: no shared topic, \
user or gimmick.

Exactly one easy (difficulty 1 or 2), one medium (3) and one hard (4 or 5).
Each pitch has:
- title: 1 to 4 words
- tagline: under 10 words
- description: 2 or 3 short deadpan sentences, under 40 words
- hardParts: where the developer will struggle. Easy gets 2, medium 2 or 3, \
hard 3 or 4 and nastier. Each has "at" (how far in, percent 10 to 90), \
"severity" (1 annoying, 2 bad, 3 brutal), "title" (2 to 5 words) and \
"detail" (what goes wrong for the developer, one funny sentence under 16 \
words).
Do not reuse these titles: ${avoid}.

Reply with only a JSON array of 3 objects, like:
[{"title":"Umbrella Forecast","tagline":"Predicts when you will lose your \
umbrella.","difficulty":2,"description":"Tracks your umbrella's location and \
mood. Warns you an hour before you leave it on a train. Has never been \
right.","hardParts":[{"at":30,"severity":1,"title":"Umbrella GPS",\
"detail":"The tracker only works when the umbrella is open, indoors, which \
is bad luck."},{"at":70,"severity":2,"title":"Train timetables","detail":\
"The rail API returns trains that were cancelled in 1994."}]}]`;
}

const ATTITUDE_SHORT: Record<Worker['attitude'], string> = {
  neutral: 'You are polite but wary with the boss.',
  loyal: 'You adore the boss.',
  scared: 'You are terrified of the boss.',
  bitter: 'You resent the boss: be sarcastic.',
  'sucking-up': 'You grovel to the boss.',
};

/**
 * A one-line reminder of how the worker feels, repeated in the user turn
 * because Haiku follows the last thing it read far more than the system
 * prompt.
 *
 * @param state - Game state.
 * @param worker - The worker.
 * @returns e.g. "Remember: you are tired, grumpy...; you resent your boss."
 */
export function feelingNote(state: GameState, worker: Worker): string {
  const now = state.lastTickAt || Date.now();
  return `Remember: you are ${describeCondition(worker, now)}. ` +
    ATTITUDE_SHORT[worker.attitude];
}

/**
 * Ask for one line in reaction to a situation.
 *
 * @param situation - What just happened, in words.
 * @param feeling - A reminder of mood and attitude (see `feelingNote`).
 * @returns The user prompt.
 */
export function thinkPrompt(situation: string, feeling: string): string {
  return `What is happening: ${situation}
(${feeling})

React with one short line, under 20 words. Either say it out loud ("say") \
or keep it as a private thought ("think"). Only if something genuinely \
memorable happened, add "remember": a note to yourself under 12 words \
(rare).

Reply with only JSON, like {"say":"..."} or {"think":"..."}`;
}

/**
 * Ask for a chat reply and a read of the boss's tone.
 *
 * @param message - What the boss typed.
 * @param feeling - A reminder of mood and attitude (see `feelingNote`).
 * @returns The user prompt.
 */
export function chatPrompt(message: string, feeling: string): string {
  const clipped = message.trim().slice(0, 500);
  return `Your boss just sent you this message:
"""
${clipped}
"""
(${feeling})

Reply to them in character, under 25 words. Also judge how the boss's \
message came across: "kind", "neutral" or "cruel". If the boss told you a \
fact about themselves worth keeping (their name, team, pet, birthday...), \
add "remember" with it, under 12 words, e.g. "Boss supports Arsenal".

Reply with only JSON, like {"say":"...","tone":"neutral"}`;
}

const GRADE_TONE: Record<string, string> = {
  masterpiece: 'insufferably proud and smug; you are a genius and the ' +
    'world should know',
  solid: 'quietly pleased and professional, with one wry joke',
  buggy: 'defensive; known issues are dressed up as "planned behaviour"',
  'barely compiles': 'apologetic and evasive; blame the deadline and the ' +
    'boss, gently',
  'cursed garbage': 'unhinged; list the bugs as features, issue ominous ' +
    'warnings, slightly feral',
};

/**
 * The voice for release notes of a given grade.
 *
 * @param grade - e.g. 'Masterpiece' (case-insensitive).
 * @returns A tone instruction.
 */
export function gradeTone(grade: string): string {
  return GRADE_TONE[grade.trim().toLowerCase()] ??
    'honest about how it went, with a joke or two';
}

/**
 * Ask for release notes in markdown.
 *
 * @param project - The finished project.
 * @param quality - 0-1.
 * @param grade - The grade name.
 * @returns The user prompt.
 */
export function releaseNotesPrompt(
  project: Project,
  quality: number,
  grade: string,
): string {
  const parts = project.hardParts.map((h) => `- ${h.title}: ${h.detail}`);
  const pct = Math.round(quality * 100);
  return `You just shipped "${project.title}" (${project.tagline}). \
${project.description}

The hard parts you fought:
${parts.join('\n') || '- none'}

The boss graded it: ${grade} (${pct}% quality).

Write its release notes yourself, in your own voice, under 150 words of \
plain markdown: a one or two line summary, then "## What's new" and \
"## Known issues" as short bullet lists, then sign off with your first \
name. Tone: ${gradeTone(grade)}. No top-level title, no code fences, no \
JSON.`;
}

const ENDING_SCENE: Record<EndingKind, string> = {
  'lost-mind': 'Your sanity has finally snapped. Your hair is standing on ' +
    'end, you are babbling, and you are about to run off screaming into ' +
    'the distance, cartoon-style.',
  fried: 'The boss has electrocuted you one time too many. You are about ' +
    'to go up in a puff of smoke and leave a small, smouldering pile of ' +
    'ash, cartoon-style.',
  'rage-quit': 'You have had enough. You are about to flip your desk and ' +
    'storm out, quitting on the spot.',
  fired: 'The boss has just fired you. You are packing your things into a ' +
    'cardboard box and walking out.',
};

/**
 * Describe an ending as a scene for the worker to react to.
 *
 * @param ending - Which ending.
 * @returns One or two sentences.
 */
export function endingScene(ending: EndingKind): string {
  return ENDING_SCENE[ending];
}

/**
 * Ask for last words, a sticky note and a mug slogan.
 *
 * @param ending - How they are leaving.
 * @returns The user prompt.
 */
export function farewellPrompt(ending: EndingKind): string {
  return `${endingScene(ending)}

This is your exit. Keep it slapstick and cartoonish, never about dying or \
self-harm.
- lastWords: what you say or shout as you go, under 20 words
- stickyNote: a note you leave on the monitor for whoever sits here next, \
under 30 words
- mugText: the slogan on the mug you leave behind, at most 6 words

Reply with only JSON, like {"lastWords":"...","stickyNote":"...",\
"mugText":"..."}`;
}
