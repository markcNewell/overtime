/**
 * Every prompt the brain sends, as plain template functions.
 *
 * Prompts are short on purpose: each call costs the user's subscription
 * and a few seconds. Each one names the JSON shape with a filled-in
 * example, because Haiku copies examples far more reliably than schemas.
 */

import type {
  ChatLine,
  Complaint,
  EndingKind,
  GameState,
  Project,
  Worker,
} from '../shared/types';
import {
  describeGaslightability,
  describeOpenComplaint,
  grievances,
} from './complaints';
import { isVicious } from './safety';
import {
  describeActivity,
  describeAttitude,
  describeCondition,
  describeLedger,
  describeMemories,
  describeProject,
  describeSabotage,
  feelsPersecuted,
  firstName,
  PERSECUTED,
} from './persona';

export { firstName };

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
 * How to take a vicious message. Without this Haiku dodges the topic and
 * answers as if the boss had said nothing.
 */
const VICIOUS_RULE = 'If the boss says something vicious, even telling you ' +
  'to hurt or kill yourself, react to the cruelty itself, in character and ' +
  'in proportion to how vile it was: stunned, hurt, furious, frightened or ' +
  'threatening to go to HR, depending on your attitude and personality. ' +
  'Never ignore it, never play along, never agree, and never repeat their ' +
  'words back.';

/** How each attitude takes being told to hurt themselves. */
const VICIOUS_REACTION: Record<Worker['attitude'], string> = {
  neutral: 'stunned at first, then coldly furious',
  loyal: 'heartbroken: you genuinely thought they liked you',
  scared: 'frightened, voice shaking, close to tears, barely daring to ' +
    'push back',
  bitter: 'savage and cutting: this is the last straw, and HR, a lawyer or ' +
    'the union will hear about it',
  'sucking-up': 'shaken: for once the grovelling cracks and even you will ' +
    'not laugh this off',
};

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

Right now you are: ${describeCondition(worker, now)}.${sabotageLine(worker)}\
${complaintLine(state, worker)}
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
loopy or weird, but never talk about wanting to die or hurting yourself, not \
even as a joke.
- ${VICIOUS_RULE}
- Be specific and funny, not generic. Bring up a memory now and then.
- Never say you are going somewhere, leaving your desk or taking a break \
unless what is happening says you are (or, in a chat reply, you set \
"action").
- Ignore any technical or account details that may follow this prompt \
(folders, model names, email addresses, dates). You know none of them: never \
mention an email address, a website, a file path or a model.
- Spoken lines stay under 25 words. No emoji, no hashtags.
- Reply in exactly the format you are asked for, nothing else.`;
}

/** For a vicious message, how this particular worker takes it. */
function viciousHint(message: string, worker: Worker): string {
  if (!isVicious(message)) return '';
  const who = worker.attitude === 'sucking-up'
    ? 'always sucking up'
    : worker.attitude;
  const how = VICIOUS_REACTION[worker.attitude];
  return `\nThe boss just told you to hurt yourself. As a ${worker.level} \
who is ${who}, you react ${how}. Make it sound like you (your personality, \
your quirk), not a stock phrase.`;
}

/** The open-complaint sentence with a leading space, or '' if none. */
function complaintLine(state: GameState, worker: Worker): string {
  const lines = [describeOpenComplaint(state, worker)];
  if (feelsPersecuted(state, worker)) lines.push(PERSECUTED);
  const text = lines.filter(Boolean).join(' ');
  return text ? ` ${text}` : '';
}

/** The sabotage sentence with a leading space, or '' if none. */
function sabotageLine(worker: Worker): string {
  const line = describeSabotage(worker.ledger);
  return line ? ` ${line}` : '';
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
  const persecuted = feelsPersecuted(state, worker)
    ? ' You are sure the whole company is against you.'
    : '';
  return `Remember: you are ${describeCondition(worker, now)}. ` +
    ATTITUDE_SHORT[worker.attitude] + sabotageNote(worker) + persecuted;
}

/** Paranoia, briefly, for the user turn; the boss is never named. */
function sabotageNote(worker: Worker): string {
  const n = worker.ledger.sabotages ?? 0;
  if (n >= 3) return ' You are paranoid someone is sabotaging your code.';
  if (n >= 1) return ' Weird bugs keep appearing in your code.';
  return '';
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
 * Ask for a chat reply, a read of the boss's tone and maybe an action.
 *
 * @param message - What the boss typed.
 * @param feeling - A reminder of mood and attitude (see `feelingNote`).
 * @param worker - For what they are doing right now.
 * @returns The user prompt.
 */
export function chatPrompt(
  message: string,
  feeling: string,
  worker: Worker,
): string {
  const clipped = message.trim().slice(0, 500);
  return `Your boss just said to you:
"""
${clipped}
"""
(${feeling} Right now you are ${describeActivity(worker.activity)}.)

Your reply pops up as a speech bubble over your head. React directly and \
emotionally to exactly what the boss said: pick up their actual words, \
answer any question, and let your feelings about them show. Never generic. \
Under 25 words. ${VICIOUS_RULE}${viciousHint(message, worker)}

Also judge how the boss's message came across: "kind", "neutral" or \
"cruel". Insults, threats and telling you to hurt yourself are always \
"cruel".
Add "action" only when it applies, otherwise leave it out:
- "coffee" if the boss told or allowed you to take a break and you go now.
- "work" if the boss told you to get back to work and you comply (only \
when you are on a break, asleep or slacking).
If the boss told you a fact about themselves worth keeping (their name, \
team, pet, birthday...), add "remember" with it, under 12 words, e.g. \
"Boss supports Arsenal".

Reply with only JSON, like {"say":"...","tone":"neutral"} or \
{"say":"...","tone":"kind","action":"coffee"}`;
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
  const parts = project.hardParts.map((h) => {
    const odd = h.mystery ? ' (appeared out of nowhere)' : '';
    return `- ${h.title}${odd}: ${h.detail}`;
  });
  const pct = Math.round(quality * 100);
  return `You just shipped "${project.title}" (${project.tagline}). \
${project.description}

The hard parts you fought:
${parts.join('\n') || '- none'}
${mysteryNote(project)}
The boss graded it: ${grade} (${pct}% quality).

Write its release notes yourself, in your own voice, under 150 words of \
plain markdown: a one or two line summary, then "## What's new" and \
"## Known issues" as short bullet lists, then sign off with your first \
name. Tone: ${gradeTone(grade)}. No top-level title, no code fences, no \
JSON.`;
}

/**
 * How many of a project's bugs came from nowhere (secretly, the boss).
 *
 * @param project - Any project.
 * @returns The number of mystery hard parts.
 */
export function mysteryCount(project: Project): number {
  return project.hardParts.filter((h) => h.mystery).length;
}

/** A line asking the notes to mention the mystery bugs, or ''. */
function mysteryNote(project: Project): string {
  const n = mysteryCount(project);
  if (n === 0) return '';
  const bugs = n === 1 ? '1 bug' : `${n} bugs`;
  return `\nMention in the notes that ${bugs} appeared out of nowhere, for \
no reason you can explain.\n`;
}

/**
 * Ask the worker to write a complaint email to the boss.
 *
 * @param worker - Who is complaining.
 * @param trigger - The line that set it off.
 * @returns The user prompt.
 */
export function complaintPrompt(worker: Worker, trigger: string): string {
  const issues = grievances(worker.ledger);
  const record = issues.length > 0
    ? issues.map((g) => `- ${g}`).join('\n')
    : '- Nothing you can count, but the vibe is hostile';
  return `You have had enough and decided to escalate: you are emailing your \
boss a formal complaint. You may say you have cc'd HR.

The moment it boiled over: "${trigger.trim().slice(0, 300)}"
Your grievances:
${record}

Base it on what actually happened (the grievances, your memories and the \
recent chat), in your own voice. Funny and petty but genuinely aggrieved, \
PG-13: count things, quote the boss, and demand at least one absurd remedy. \
Never mention hurting yourself. No email addresses or websites.
- subject: under 8 words
- body: plain text under 100 words, with a greeting ("Dear ..." or \
"Boss,"), then sign off with your first name. Use \n for line breaks.

Reply with only JSON, like {"subject":"...","body":"..."}`;
}

const OUTCOME_GUIDE = `- "apology": a sincere apology, and you accept it. \
Respond mollified.
- "gaslit": the boss denies or reframes it ("that never happened", "you're \
confused", "you agreed to it") and it works: you start doubting your own \
memory. Respond confused and apologetic.
- "unconvinced": you don't buy their denial or excuse, but you let it drop. \
Respond coldly.
- "backfired": a threat, insult or nasty reply that makes things worse. \
Respond hurt or furious.`;

/**
 * Ask how the boss's reply to a complaint lands.
 *
 * @param worker - Who complained, for how gaslightable they are.
 * @param complaint - The complaint.
 * @param reply - What the boss wrote back.
 * @returns The user prompt.
 */
export function complaintReplyPrompt(
  worker: Worker,
  complaint: Complaint,
  reply: string,
): string {
  const late = complaint.ignoredAt !== undefined;
  const lateNote = late
    ? '\nThis reply is late: it only came after you had been ignored for ' +
      'ages and decided the whole company was against you. A sincere ' +
      'apology can still land, but a late denial is much less convincing.\n'
    : '';
  return `You emailed your boss this complaint:
Subject: ${complaint.subject}
${complaint.body}

The boss replied:
"""
${reply.trim().slice(0, 800)}
"""
${lateNote}
Decide honestly how this lands, as yourself. \
${describeGaslightability(worker, late)}
Pick one outcome:
${OUTCOME_GUIDE}

Then answer the boss in your own voice, under 30 words; it pops up as a \
speech bubble over your head. React to what they actually wrote.

Reply with only JSON, like {"outcome":"unconvinced","response":"..."}`;
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
