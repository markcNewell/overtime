/**
 * Pitch briefs and release notes on disk.
 *
 * Every pitched idea gets a markdown brief. Its "Where the developer will
 * struggle" list is read back when the project is assigned, so the player
 * can edit a brief to move or soften the hard parts. The parser is
 * forgiving because people will edit these by hand.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Difficulty,
  HardPart,
  Pitch,
  Project,
  Severity,
} from '../shared/types';

const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  1: 'Trivial',
  2: 'Easy',
  3: 'Tricky',
  4: 'Hard',
  5: 'Nightmare',
};

const STRUGGLE_HEADING = 'Where the developer will struggle';
const SLUG_MAX = 48;
const MAX_SUFFIX = 999;
const MAX_HARD_PARTS = 8;

/**
 * A filename-safe slug.
 *
 * @param title - Any title, accents and emoji included.
 * @returns Lower-case ASCII words joined by hyphens, or 'untitled'.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = slug.slice(0, SLUG_MAX).replace(/-+$/, '');
  return cut || 'untitled';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The local calendar day.
 *
 * @param now - Epoch ms.
 * @returns YYYY-MM-DD in local time.
 */
export function dayStamp(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStamp(now: number): string {
  const d = new Date(now);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDifficulty(n: number): Difficulty {
  return Math.min(5, Math.max(1, Math.round(n))) as Difficulty;
}

/**
 * Difficulty as stars and a name.
 *
 * @param difficulty - 1-5.
 * @returns e.g. "★★★☆☆ Tricky (3/5)".
 */
export function difficultyLabel(difficulty: number): string {
  const d = toDifficulty(difficulty);
  return `${'★'.repeat(d)}${'☆'.repeat(5 - d)} ${DIFFICULTY_NAMES[d]} (${d}/5)`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * One hard part as a brief line.
 *
 * @param part - The hard part.
 * @returns e.g. "- [25%] [2] Title: what goes wrong".
 */
export function hardPartLine(part: HardPart): string {
  // A colon in the title would split it in the wrong place on re-read.
  const title = oneLine(part.title).replace(/:/g, ' -');
  const detail = oneLine(part.detail);
  const head = `- [${Math.round(part.at * 100)}%] [${part.severity}] ${title}`;
  return detail ? `${head}: ${detail}` : head;
}

/**
 * The markdown brief for a pitch.
 *
 * @param pitch - The pitch.
 * @param workerName - Who it was pitched to ('' if unknown).
 * @param now - When it was pitched.
 * @returns Markdown.
 */
export function renderBrief(
  pitch: Pitch,
  workerName: string,
  now: number,
): string {
  const when = `${dayStamp(now)} at ${timeStamp(now)}`;
  const pitched = workerName.trim()
    ? `**Pitched to:** ${workerName.trim()} on ${when}`
    : `**Pitched:** ${when}`;
  const parts = [...pitch.hardParts].sort((a, b) => a.at - b.at);
  return [
    `# ${oneLine(pitch.title)}`,
    '',
    `> ${oneLine(pitch.tagline)}`,
    '',
    `**Difficulty:** ${difficultyLabel(pitch.difficulty)}`,
    '',
    pitched,
    '',
    '## What it is',
    '',
    pitch.description.trim(),
    '',
    `## ${STRUGGLE_HEADING}`,
    '',
    'Edit this list before you assign the project to change where the ' +
      'developer gets stuck. One line each: `[how far in %] [severity 1-3] ' +
      'Title: what goes wrong`.',
    '',
    ...parts.map(hardPartLine),
    '',
  ].join('\n');
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const BRACKET = /^\s*\[([^\]]*)\]/;
const BARE_PERCENT = /^\s*(\d+(?:\.\d+)?)\s*%/;

/** The lines under the struggle heading, or null if there is none. */
function struggleSection(markdown: string): string[] | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const h = HEADING.exec(l);
    return h?.[1] !== undefined && /struggle|hard parts/i.test(h[1]);
  });
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => HEADING.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

/** Up to two leading `[..]` tokens (or a bare `25%`), and the rest. */
function leadingTokens(content: string): { tokens: string[]; rest: string } {
  const tokens: string[] = [];
  let rest = content;
  while (tokens.length < 2) {
    const match = BRACKET.exec(rest) ?? BARE_PERCENT.exec(rest);
    if (!match) break;
    tokens.push(match[0].includes('[') ? match[1] ?? '' : `${match[1]}%`);
    rest = rest.slice(match[0].length);
  }
  return { tokens, rest };
}

/** "25%", "25", "0.25" -> 0.25, clamped to 1-99 %. */
function readAt(token: string): number | null {
  const match = /(\d+(?:\.\d+)?)/.exec(token);
  if (!match?.[1]) return null;
  let value = Number.parseFloat(match[1]);
  if (!token.includes('%') && value > 0 && value < 1) value *= 100;
  const percent = Math.min(99, Math.max(1, value));
  return Math.round(percent) / 100;
}

/** "2", "sev 3", "high" -> 1-3; default 2. */
function readSeverity(token: string | undefined): Severity {
  if (token === undefined) return 2;
  const digits = /(\d+)/.exec(token);
  if (digits?.[1]) {
    return Math.min(3, Math.max(1, Number.parseInt(digits[1], 10))) as Severity;
  }
  if (/low|mild|minor|easy/i.test(token)) return 1;
  if (/high|brutal|severe|hard|nasty/i.test(token)) return 3;
  return 2;
}

function stripEmphasis(text: string): string {
  return text.replace(/^[*_`\s]+|[*_`\s]+$/g, '');
}

/** "Title: detail" (or "Title - detail") -> its two halves. */
function splitTitle(rest: string): { title: string; detail: string } {
  const clean = oneLine(rest);
  const colon = clean.indexOf(':');
  const dash = clean.search(/\s[-–—]\s/);
  const at = colon >= 0 ? colon : dash;
  if (at < 0) return { title: stripEmphasis(clean), detail: '' };
  const width = colon >= 0 ? 1 : 3;
  return {
    title: stripEmphasis(clean.slice(0, at)),
    detail: stripEmphasis(clean.slice(at + width)),
  };
}

function parseLine(line: string): HardPart | null {
  const bullet = BULLET.exec(line);
  if (!bullet?.[1]) return null;
  const { tokens, rest } = leadingTokens(bullet[1]);
  const at = tokens[0] === undefined ? null : readAt(tokens[0]);
  if (at === null) return null;
  const { title, detail } = splitTitle(rest);
  if (!title) return null;
  return {
    at,
    severity: readSeverity(tokens[1]),
    title: title.slice(0, 60),
    detail: detail.slice(0, 200),
  };
}

/**
 * Read the hard parts back from a (possibly hand-edited) brief.
 *
 * Accepts `- [25%] [2] Title: detail` with extra spaces, a missing `%`,
 * a missing detail, `*` or numbered bullets, and `Title - detail`.
 *
 * @param markdown - The brief.
 * @returns Hard parts sorted by `at`, or null if the section is missing
 *   or has no valid lines.
 */
export function parseHardParts(markdown: string): HardPart[] | null {
  const section = struggleSection(markdown);
  if (!section) return null;
  const parts = section
    .map(parseLine)
    .filter((p): p is HardPart => p !== null)
    .slice(0, MAX_HARD_PARTS)
    .sort((a, b) => a.at - b.at);
  return parts.length > 0 ? parts : null;
}

function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function suffixed(base: string, n: number): string {
  return n === 1 ? base : `${base}-${n}`;
}

/** Create a new file, adding -2, -3... if the name is taken. */
async function writeNewFile(
  dir: string,
  base: string,
  ext: string,
  content: string,
): Promise<string> {
  for (let n = 1; n <= MAX_SUFFIX; n += 1) {
    const file = path.join(dir, `${suffixed(base, n)}${ext}`);
    try {
      await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
      return file;
    } catch (err) {
      if (errnoCode(err) !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Too many files named ${base}${ext} in ${dir}`);
}

/** Create a new folder, adding -2, -3... if the name is taken. */
async function makeNewDir(parent: string, base: string): Promise<string> {
  for (let n = 1; n <= MAX_SUFFIX; n += 1) {
    const dir = path.join(parent, suffixed(base, n));
    try {
      await mkdir(dir);
      return dir;
    } catch (err) {
      if (errnoCode(err) !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Too many folders named ${base} in ${parent}`);
}

/**
 * Write a pitch's brief to `filesDir/pitches/<day>-<slug>.md`.
 *
 * @param filesDir - The Overtime files folder.
 * @param pitch - The pitch.
 * @param workerName - Who it is pitched to.
 * @param now - When.
 * @returns The new file's path.
 */
export async function writePitchBrief(
  filesDir: string,
  pitch: Pitch,
  workerName: string,
  now: number,
): Promise<string> {
  const dir = path.join(filesDir, 'pitches');
  await mkdir(dir, { recursive: true });
  const base = `${dayStamp(now)}-${slugify(pitch.title)}`;
  return writeNewFile(dir, base, '.md', renderBrief(pitch, workerName, now));
}

async function readIfExists(file: string | undefined): Promise<string | null> {
  if (!file) return null;
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Tell the reader why their edited list was ignored, and what was used. */
function unreadableNote(parts: readonly HardPart[]): string {
  return [
    '',
    '## Hard parts used',
    '',
    "_The list above couldn't be read, so the developer will struggle where " +
      'the original pitch said:_',
    '',
    ...parts.map((p) => `${hardPartLine(p).replace(/^- /, '* ')}`),
    '',
  ].join('\n');
}

/**
 * Start a project folder from its pitch.
 *
 * Reads the pitch's brief (with any edits the player made), takes its hard
 * parts, and copies it to `filesDir/projects/<day>-<slug>/brief.md`. A
 * brief that is missing or no longer parses falls back to the hard parts
 * the pitch was generated with.
 *
 * @param filesDir - The Overtime files folder.
 * @param pitch - The pitch being assigned.
 * @param now - When.
 * @returns The copied brief's path and the hard parts to use.
 */
export async function startProjectFolder(
  filesDir: string,
  pitch: Pitch,
  now: number,
): Promise<{ briefPath: string; hardParts: HardPart[] }> {
  const original = pitch.hardParts.map((h) => ({ ...h }));
  const edited = await readIfExists(pitch.filePath);
  let markdown = edited ?? renderBrief(pitch, '', now);
  const parsed = parseHardParts(markdown);
  if (edited !== null && parsed === null) {
    markdown = `${markdown.trimEnd()}\n${unreadableNote(original)}`;
  }
  const projects = path.join(filesDir, 'projects');
  await mkdir(projects, { recursive: true });
  const dir = await makeNewDir(projects,
    `${dayStamp(now)}-${slugify(pitch.title)}`);
  const briefPath = path.join(dir, 'brief.md');
  await writeFile(briefPath, markdown, 'utf8');
  return { briefPath, hardParts: parsed ?? original };
}

/**
 * Write `release-notes.md` next to a project's brief.
 *
 * @param briefPath - The project's brief.md.
 * @param project - The finished project.
 * @param markdown - The notes body from the brain.
 * @param meta - Who shipped it, the grade and when.
 * @returns The notes file's path.
 */
export async function writeReleaseNotes(
  briefPath: string,
  project: Project,
  markdown: string,
  meta: { workerName: string; grade: string; quality: number; now: number },
): Promise<string> {
  const dir = path.dirname(briefPath);
  await mkdir(dir, { recursive: true });
  const pct = Math.round(Math.min(1, Math.max(0, meta.quality)) * 100);
  const content = [
    `# ${oneLine(project.title)}: release notes`,
    '',
    `**Shipped by:** ${meta.workerName} on ${dayStamp(meta.now)}`,
    '',
    `**Grade:** ${meta.grade} (${pct}% quality) · ` +
      `**Difficulty:** ${difficultyLabel(project.difficulty)}`,
    '',
    '---',
    '',
    markdown.trim(),
    '',
  ].join('\n');
  const file = path.join(dir, 'release-notes.md');
  await writeFile(file, content, 'utf8');
  return file;
}
