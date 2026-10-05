/**
 * From parsed JSON to typed, clamped, safe values.
 *
 * Each `parse*` function throws when the reply is unusable as a whole, and
 * quietly repairs or drops anything smaller (one bad field, one bad item).
 * The Brain turns a throw into a canned fallback.
 */

import type {
  Activity,
  ChatRequest,
  ChatTone,
  EndingKind,
  HardPart,
  Level,
  Pronouns,
  Severity,
} from '../shared/types';
import {
  BANDS,
  bandOf,
  clampToBand,
  minHardParts,
  type Band,
} from './bands';
import {
  fallbackFarewell,
  fallbackPitch,
  GENERIC_HARD_PARTS,
  guessTone,
} from './fallback';
import {
  asList,
  asRecord,
  extractJson,
  int,
  num,
  oneOf,
  str,
  text,
} from './parse';
import { CHAT_REQUESTS, usefulAction } from './requests';
import type { Rng } from './roll';
import {
  breaksCharacter,
  isSelfHarmIntent,
  isUnsafe,
  isVicious,
  leaksContext,
} from './safety';
import type {
  CandidateBio,
  ChatReply,
  Farewell,
  PitchDraft,
  WorkerLine,
} from './types';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Clean one spoken line: trim, drop wrapping quotes and a "Name:" prefix.
 *
 * @param x - Raw field.
 * @param maxLen - Maximum length.
 * @param speaker - The worker's first name, if known.
 * @returns The line, or '' if unusable.
 */
export function cleanLine(x: unknown, maxLen: number, speaker = ''): string {
  let line = str(x, maxLen + 40);
  if (speaker) {
    const prefix = new RegExp(`^\\*{0,2}${escapeRegExp(speaker)}\\*{0,2}\\s*:` +
      '\\s*\\*{0,2}\\s*', 'i');
    line = line.replace(prefix, '');
  }
  if (/^["“]/.test(line) && /["”]$/.test(line)) line = line.slice(1, -1);
  return str(line, maxLen);
}

/** A worker line that is present, safe, private and in character. */
function usableLine(line: string): boolean {
  return line.length > 0 && !isSelfHarmIntent(line) &&
    !breaksCharacter(line) && !leaksContext(line);
}

const LEVELS: readonly Level[] = ['junior', 'mid', 'senior', 'lead'];
const LEVEL_SYNONYMS: [RegExp, Level][] = [
  [/intern|graduate|entry|trainee|apprentice/i, 'junior'],
  [/intermediate|middle/i, 'mid'],
  [/principal|staff|head|chief|architect|director/i, 'lead'],
];

/**
 * Coerce a level, accepting a few common synonyms.
 *
 * @param x - Raw field.
 * @returns A level, `mid` when unrecognisable.
 */
export function toLevel(x: unknown): Level {
  const level = oneOf(x, LEVELS, 'mid');
  if (level !== 'mid' || typeof x !== 'string') return level;
  const hit = LEVEL_SYNONYMS.find(([re]) => re.test(x));
  return hit ? hit[1] : 'mid';
}

/**
 * Coerce pronouns ("she", "He/Him", "they/them") to the three supported.
 *
 * @param x - Raw field.
 * @returns Pronouns, `they/them` when unrecognisable.
 */
export function toPronouns(x: unknown): Pronouns {
  if (typeof x !== 'string') return 'they/them';
  const p = x.trim().toLowerCase();
  if (p.startsWith('she') || p.startsWith('her')) return 'she/her';
  if (p.startsWith('he') || p.startsWith('him')) return 'he/him';
  return 'they/them';
}

/**
 * One candidate bio from Claude, or null if it is missing the essentials.
 *
 * @param x - One array item.
 * @returns A clamped bio.
 */
export function toBio(x: unknown): CandidateBio | null {
  const r = asRecord(x);
  if (!r) return null;
  const bio: CandidateBio = {
    name: str(r.name, 40),
    age: int(r.age, 18, 70, 30),
    pronouns: toPronouns(r.pronouns),
    level: toLevel(r.level),
    personality: str(r.personality, 80),
    specialty: str(r.specialty, 60),
    quirk: str(r.quirk, 90) || 'None that they will admit to',
    redFlag: str(r.redFlag ?? r.red_flag, 100) || 'Suspiciously normal',
    backstory: str(r.backstory, 220) || 'Declined to elaborate.',
  };
  if (bio.name.length < 2 || !bio.personality || !bio.specialty) return null;
  if (Object.values(bio).some((v) => typeof v === 'string' && isUnsafe(v))) {
    return null;
  }
  return bio;
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Make sure a shortlist has a junior: the youngest becomes one if not.
 *
 * @param bios - The shortlist.
 * @returns The same list, possibly with one level changed.
 */
export function ensureJunior(bios: CandidateBio[]): CandidateBio[] {
  if (bios.length === 0 || bios.some((b) => b.level === 'junior')) return bios;
  const youngest = bios.reduce((a, b) => (b.age < a.age ? b : a));
  return bios.map((b) => (b === youngest ? { ...b, level: 'junior' } : b));
}

/**
 * Candidate bios from a reply, minus duplicates and names to avoid.
 *
 * @param raw - Model reply.
 * @param avoidNames - Names already used.
 * @param count - The most to keep.
 * @returns Zero or more bios.
 * @throws Error when the reply holds no JSON.
 */
export function parseBios(
  raw: string,
  avoidNames: readonly string[],
  count: number,
): CandidateBio[] {
  const items = asList(extractJson(raw), ['candidates', 'people']);
  const out: CandidateBio[] = [];
  for (const item of items) {
    const bio = toBio(item);
    if (!bio) continue;
    const seen = [...avoidNames, ...out.map((b) => b.name)];
    if (seen.some((n) => sameText(n, bio.name))) continue;
    out.push(bio);
    if (out.length >= count) break;
  }
  return out;
}

const DIFFICULTY_WORDS: Record<string, number> = {
  trivial: 1, easy: 2, medium: 3, tricky: 3, hard: 4, nightmare: 5,
};

function toDifficulty(x: unknown): number {
  if (typeof x === 'string') {
    const word = DIFFICULTY_WORDS[x.trim().toLowerCase()];
    if (word !== undefined) return word;
  }
  return int(x, 1, 5, 3);
}

/**
 * Where a hard part hits, as a fraction 0.1-0.9.
 *
 * Claude is asked for a percent but sometimes answers with a fraction.
 *
 * @param x - Raw `at`.
 * @param fallback - Fraction to use when `x` is not numeric.
 * @returns A fraction, rounded to two places.
 */
export function toAt(x: unknown, fallback: number): number {
  let value = num(x, -1e9, 1e9, Number.NaN);
  if (Number.isNaN(value)) value = fallback * 100;
  else if (value > 0 && value <= 1) value *= 100;
  const percent = Math.min(90, Math.max(10, value));
  return Math.round(percent) / 100;
}

/**
 * One hard part, or null without a title.
 *
 * @param x - Raw item.
 * @param fallbackAt - Fraction to use when `at` is missing.
 * @returns A clamped hard part.
 */
export function toHardPart(x: unknown, fallbackAt: number): HardPart | null {
  const r = asRecord(x);
  if (!r) return null;
  const title = str(r.title, 50);
  if (!title) return null;
  return {
    at: toAt(r.at ?? r.percent, fallbackAt),
    severity: int(r.severity, 1, 3, 2) as Severity,
    title,
    detail: str(r.detail ?? r.description, 200),
  };
}

function toHardParts(x: unknown): HardPart[] {
  const items = Array.isArray(x) ? x : [];
  const parts: HardPart[] = [];
  items.forEach((item, i) => {
    const part = toHardPart(item, (i + 1) / (items.length + 1));
    if (part && !parts.some((p) => sameText(p.title, part.title))) {
      parts.push(part);
    }
  });
  return parts.sort((a, b) => a.at - b.at);
}

/**
 * One pitch from Claude, or null without a title and description.
 *
 * @param x - One array item.
 * @returns A clamped draft (difficulty not yet fitted to a band).
 */
export function toPitchDraft(x: unknown): PitchDraft | null {
  const r = asRecord(x);
  if (!r) return null;
  const draft: PitchDraft = {
    title: str(r.title, 40),
    tagline: str(r.tagline, 80),
    difficulty: toDifficulty(r.difficulty) as PitchDraft['difficulty'],
    description: str(r.description, 360),
    hardParts: toHardParts(r.hardParts ?? r.hard_parts),
  };
  if (!draft.title || !draft.description) return null;
  const words = [draft.title, draft.tagline, draft.description,
    ...draft.hardParts.map((h) => `${h.title} ${h.detail}`)];
  if (words.some(isUnsafe)) return null;
  return draft;
}

/**
 * Pitch drafts from a reply.
 *
 * @param raw - Model reply.
 * @returns Zero or more drafts.
 * @throws Error when the reply holds no JSON.
 */
export function parsePitchDrafts(raw: string): PitchDraft[] {
  const items = asList(extractJson(raw), ['pitches', 'ideas', 'apps']);
  return items
    .map(toPitchDraft)
    .filter((d): d is PitchDraft => d !== null);
}

/**
 * Make a draft's hard parts fit its band: enough of them, no more than
 * four, easy ones gentler and hard ones with at least one brutal part.
 *
 * @param draft - A draft already moved into `band`.
 * @param band - Its band.
 * @returns A new draft.
 */
export function fitHardParts(draft: PitchDraft, band: Band): PitchDraft {
  const parts = draft.hardParts.map((h) => ({ ...h }));
  for (const spare of GENERIC_HARD_PARTS) {
    if (parts.length >= minHardParts(band)) break;
    if (!parts.some((p) => sameText(p.title, spare.title))) {
      parts.push({ ...spare });
    }
  }
  parts.sort((a, b) => a.at - b.at);
  const kept = parts.slice(0, 4);
  if (band === 'easy') {
    kept.forEach((p) => { p.severity = Math.min(p.severity, 2) as Severity; });
  }
  const last = kept[kept.length - 1];
  if (band === 'hard' && last && !kept.some((p) => p.severity === 3)) {
    last.severity = 3;
  }
  return { ...draft, hardParts: kept };
}

const BAND_CENTRE: Record<Band, number> = { easy: 1.5, medium: 3, hard: 4.5 };

function takeNearest(pool: PitchDraft[], band: Band): PitchDraft | undefined {
  if (pool.length === 0) return undefined;
  const distance = (d: PitchDraft): number =>
    Math.abs(d.difficulty - BAND_CENTRE[band]);
  const best = pool.reduce((a, b) => (distance(b) < distance(a) ? b : a));
  pool.splice(pool.indexOf(best), 1);
  return best;
}

/**
 * Turn any number of drafts into exactly one easy, one medium and one hard
 * pitch, in that order.
 *
 * Drafts already in the right band are used first, then the nearest
 * leftovers are moved into empty bands, then canned pitches fill any gap.
 *
 * @param drafts - Claude's drafts.
 * @param avoidTitles - Titles already shipped or on offer.
 * @param rng - Random source for canned picks.
 * @returns Three drafts and how many were canned.
 */
export function spreadPitches(
  drafts: readonly PitchDraft[],
  avoidTitles: readonly string[],
  rng: Rng,
): { drafts: PitchDraft[]; canned: number } {
  const pool: PitchDraft[] = [];
  for (const d of drafts) {
    const used = [...avoidTitles, ...pool.map((p) => p.title)];
    if (!used.some((t) => sameText(t, d.title))) pool.push(d);
  }
  const slots = new Map<Band, PitchDraft>();
  for (const band of BANDS) {
    const index = pool.findIndex((d) => bandOf(d.difficulty) === band);
    if (index >= 0) slots.set(band, pool.splice(index, 1)[0] as PitchDraft);
  }
  for (const band of BANDS) {
    const nearest = slots.has(band) ? undefined : takeNearest(pool, band);
    if (nearest) slots.set(band, nearest);
  }
  let canned = 0;
  const out = BANDS.map((band) => {
    let draft = slots.get(band);
    if (!draft) {
      const used = [...avoidTitles, ...[...slots.values()].map((d) => d.title)];
      draft = fallbackPitch(band, used, rng);
      slots.set(band, draft);
      canned += 1;
    }
    const moved = { ...draft, difficulty: clampToBand(draft.difficulty, band) };
    return fitHardParts(moved, band);
  });
  return { drafts: out, canned };
}

/**
 * A `think` reply: one spoken or thought line, maybe a memory.
 *
 * @param raw - Model reply.
 * @param speaker - The worker's first name.
 * @returns A line with exactly one of `say` / `think`.
 * @throws Error when there is no usable line.
 */
export function parseWorkerLine(raw: string, speaker: string): WorkerLine {
  const r = asRecord(extractJson(raw));
  if (!r) throw new Error('Line reply is not an object');
  const say = cleanLine(r.say ?? r.line ?? r.text, 160, speaker);
  const think = cleanLine(r.think ?? r.thought, 160, speaker);
  const remember = cleanLine(r.remember, 100);
  let line: WorkerLine;
  if (usableLine(say)) line = { say };
  else if (usableLine(think)) line = { think };
  else throw new Error('No usable line in reply');
  if (remember.length >= 3 && usableLine(remember)) line.remember = remember;
  return line;
}

const TONES: readonly ChatTone[] = ['kind', 'neutral', 'cruel'];
const KIND_TONE = /positive|friendly|nice|warm|supportive|encouraging|kind/i;
const CRUEL_TONE = /negative|mean|rude|hostile|harsh|abusive|insult|cruel/i;

/**
 * Coerce a tone, accepting synonyms like "friendly" or "hostile".
 *
 * @param x - Raw field.
 * @param fallback - Used when the field is unrecognisable.
 * @returns A chat tone.
 */
export function toTone(x: unknown, fallback: ChatTone): ChatTone {
  const exact = oneOf(x, TONES, fallback);
  if (typeof x !== 'string' || exact !== fallback) return exact;
  if (CRUEL_TONE.test(x)) return 'cruel';
  if (KIND_TONE.test(x)) return 'kind';
  return exact;
}

const ACTION_SYNONYMS: [RegExp, ChatRequest][] = [
  [/break|rest|tea|breather/i, 'coffee'],
  [/desk|back|resume/i, 'work'],
];

/**
 * Coerce a chat action ("coffee", "work", or a close synonym).
 *
 * @param x - Raw field.
 * @returns The action, or undefined when missing or unrecognisable.
 */
export function toAction(x: unknown): ChatRequest | undefined {
  if (typeof x !== 'string') return undefined;
  const wanted = x.trim().toLowerCase();
  if (!wanted || /^(none|null|no|n\/a)$/.test(wanted)) return undefined;
  const exact = CHAT_REQUESTS.find((a) => wanted.startsWith(a));
  return exact ?? ACTION_SYNONYMS.find(([re]) => re.test(wanted))?.[1];
}

/**
 * A `chat` reply.
 *
 * @param raw - Model reply.
 * @param message - The boss's message, for a keyword tone fallback.
 * @param speaker - The worker's first name.
 * @param activity - What the worker is doing, to drop pointless actions.
 * @returns The reply.
 * @throws Error when there is no usable line.
 */
export function parseChatReply(
  raw: string,
  message: string,
  speaker: string,
  activity: Activity,
): ChatReply {
  const r = asRecord(extractJson(raw));
  if (!r) throw new Error('Chat reply is not an object');
  const say = cleanLine(r.say ?? r.reply ?? r.text, 200, speaker);
  if (!usableLine(say)) throw new Error('No usable chat line');
  // Telling someone to hurt themselves is cruel, whatever Claude thought.
  const tone = isVicious(message)
    ? 'cruel'
    : toTone(r.tone, guessTone(message));
  const reply: ChatReply = { say, tone };
  const action = usefulAction(toAction(r.action), activity);
  if (action) reply.action = action;
  const remember = cleanLine(r.remember, 100);
  if (remember.length >= 3 && usableLine(remember)) reply.remember = remember;
  return reply;
}

/**
 * Cut a slogan to at most six words.
 *
 * @param x - Raw field.
 * @returns The slogan, or ''.
 */
export function toMugText(x: unknown): string {
  const words = cleanLine(x, 60).split(/\s+/).filter(Boolean);
  const text = words.slice(0, 6).join(' ');
  return str(words.length > 6 ? tidyCut(text) : text, 48);
}

/**
 * A slogan cut short shouldn't end mid-aside: drop an unclosed bracket and
 * any dangling words after the last full sentence.
 */
function tidyCut(text: string): string {
  let out = text;
  const open = out.lastIndexOf('(');
  if (open > 0 && !out.slice(open).includes(')')) out = out.slice(0, open).trim();
  const stop = Math.max(out.lastIndexOf('.'), out.lastIndexOf('!'), out.lastIndexOf('?'));
  if (stop > 0 && stop < out.length - 1) out = out.slice(0, stop + 1);
  return out;
}

/**
 * A `farewell` reply; missing extras are filled from the canned set.
 *
 * @param raw - Model reply.
 * @param ending - How they are leaving, for canned extras.
 * @param speaker - The worker's first name.
 * @param rng - Random source.
 * @returns Last words, sticky note and mug slogan.
 * @throws Error when there are no usable last words.
 */
export function parseFarewell(
  raw: string,
  ending: EndingKind,
  speaker: string,
  rng: Rng,
): Farewell {
  const r = asRecord(extractJson(raw));
  if (!r) throw new Error('Farewell reply is not an object');
  const lastWords = cleanLine(r.lastWords ?? r.last_words, 160, speaker);
  if (!usableLine(lastWords)) throw new Error('No usable last words');
  const spare = fallbackFarewell(ending, rng);
  const sticky = cleanLine(r.stickyNote ?? r.sticky_note, 200);
  const mug = toMugText(r.mugText ?? r.mug_text ?? r.mug);
  return {
    lastWords,
    stickyNote: usableLine(sticky) ? sticky : spare.stickyNote,
    mugText: usableLine(mug) ? mug : spare.mugText,
  };
}

/** Unwrap a reply that is entirely one code fence; keep inner fences. */
function unwrapFence(raw: string): string {
  const t = raw.trim();
  const whole = /^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(t);
  if (whole?.[1] !== undefined) return whole[1];
  return t.replace(/^```[\w-]*[ \t]*\r?\n/, '');
}

/** Haiku sometimes answers a markdown request with {"markdown": "..."}. */
function unwrapJsonNotes(md: string): string {
  if (!md.startsWith('{')) return md;
  try {
    const r = asRecord(extractJson(md));
    const inner = r?.markdown ?? r?.notes ?? r?.releaseNotes ?? r?.text;
    return typeof inner === 'string' ? inner : md;
  } catch {
    return md;
  }
}

/**
 * Release notes markdown, unwrapped and trimmed. A leading H1 is dropped
 * because the file adds its own title.
 *
 * @param raw - Model reply.
 * @returns Markdown.
 * @throws Error when the notes are too short or unsafe.
 */
export function parseReleaseNotes(raw: string): string {
  const unwrapped = unwrapJsonNotes(unwrapFence(raw).trim());
  const noTitle = unwrapped.trim().replace(/^#\s+[^\n]*\n+/, '');
  const md = text(noTitle, 2000);
  if (md.length < 40) throw new Error('Release notes too short');
  if (isSelfHarmIntent(md) || breaksCharacter(md) || leaksContext(md)) {
    throw new Error('Release notes failed the content check');
  }
  return md;
}
