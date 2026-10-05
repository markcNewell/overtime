/**
 * Turning Haiku's replies into trustworthy values.
 *
 * Haiku is asked for bare JSON but often wraps it in code fences or adds a
 * friendly sentence, so the parser hunts for the first JSON value instead of
 * parsing the whole reply. The validators never throw: they coerce or fall
 * back, so one bad field never sinks a whole reply.
 */

const FENCE = /```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/;

/**
 * Remove a surrounding markdown code fence, if there is one.
 *
 * @param text - Raw model output.
 * @returns The fenced content when a fence is present, else the trimmed text.
 */
export function stripFences(text: string): string {
  const match = FENCE.exec(text);
  if (match?.[1] !== undefined) return match[1].trim();
  // An unclosed fence still marks where the content starts.
  return text.replace(/^\s*```[a-zA-Z0-9_-]*\s*/, '').trim();
}

/** Index just past the balanced value that opens at `start`, or -1. */
function balancedEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

/** Haiku occasionally leaves trailing commas; JSON.parse rejects them. */
function dropTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, '$1');
}

function tryParse(candidate: string): { ok: true; value: unknown } | null {
  for (const text of [candidate, dropTrailingCommas(candidate)]) {
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      // Try the next repair.
    }
  }
  return null;
}

/** First balanced, parseable `{...}` or `[...]` in `text`, if any. */
function firstJsonValue(text: string): { ok: true; value: unknown } | null {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const end = balancedEnd(text, i);
    if (end < 0) continue;
    const parsed = tryParse(text.slice(i, end));
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Find and parse the first JSON object or array in a model reply.
 *
 * Looks inside a code fence first, then the raw text, so prose before or
 * after the JSON is ignored. Braces inside strings are respected.
 *
 * @param text - Raw model output.
 * @returns The parsed value.
 * @throws Error when no parseable JSON object or array is found.
 */
export function extractJson(text: string): unknown {
  const stripped = stripFences(text);
  const found = firstJsonValue(stripped) ?? firstJsonValue(text);
  if (!found) throw new Error('No JSON found in reply');
  return found.value;
}

/** Cut `text` to `maxLen` characters, preferring a word boundary. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, Math.max(1, maxLen - 1));
  const space = cut.lastIndexOf(' ');
  const base = space > maxLen * 0.6 ? cut.slice(0, space) : cut;
  return `${base.replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * Coerce a value to a tidy single-line string of at most `maxLen` chars.
 *
 * @param x - Anything; numbers are stringified, other non-strings give ''.
 * @param maxLen - Maximum length, including any ellipsis added.
 * @returns The trimmed, whitespace-collapsed string, or '' when unusable.
 */
export function str(x: unknown, maxLen: number): string {
  let text: string;
  if (typeof x === 'string') text = x;
  else if (typeof x === 'number' && Number.isFinite(x)) text = String(x);
  else return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return truncate(clean, maxLen);
}

/**
 * Like `str` but keeps line breaks, for multi-paragraph text.
 *
 * @param x - Anything; non-strings give ''.
 * @param maxLen - Maximum length.
 * @returns The trimmed text with runs of blank lines collapsed.
 */
export function text(x: unknown, maxLen: number): string {
  if (typeof x !== 'string') return '';
  const clean = x
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean.length <= maxLen ? clean : truncate(clean, maxLen);
}

/**
 * Coerce a value to one of a fixed set of strings.
 *
 * Matching ignores case and surrounding space, and accepts a reply that
 * starts with an option ("Senior developer" matches "senior").
 *
 * @param x - Candidate value.
 * @param options - Allowed values.
 * @param fallback - Returned when nothing matches.
 * @returns A member of `options`.
 */
export function oneOf<T extends string>(
  x: unknown,
  options: readonly T[],
  fallback: T,
): T {
  if (typeof x !== 'string') return fallback;
  const wanted = x.trim().toLowerCase();
  const exact = options.find((o) => o.toLowerCase() === wanted);
  if (exact) return exact;
  const prefixed = options.find((o) => wanted.startsWith(o.toLowerCase()));
  return prefixed ?? fallback;
}

/**
 * Coerce a value to a finite number clamped to `[min, max]`.
 *
 * @param x - A number or numeric string ("25%" works).
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @param fallback - Returned when `x` is not numeric.
 * @returns The clamped number.
 */
export function num(
  x: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  let value = Number.NaN;
  if (typeof x === 'number') value = x;
  else if (typeof x === 'string') value = Number.parseFloat(x);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamp a value to an integer in `[min, max]`.
 *
 * @param x - A number or numeric string.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @param fallback - Returned when `x` is not numeric.
 * @returns The rounded, clamped integer.
 */
export function int(
  x: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return Math.round(num(x, min, max, fallback));
}

/**
 * Narrow an unknown value to a plain object.
 *
 * @param x - Anything.
 * @returns `x` as a record, or null if it is not a non-array object.
 */
export function asRecord(x: unknown): Record<string, unknown> | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  return x as Record<string, unknown>;
}

/**
 * Get an array out of a reply that may be bare (`[...]`) or wrapped
 * (`{"candidates": [...]}`).
 *
 * @param x - Parsed JSON.
 * @param keys - Wrapper keys to look under, in order.
 * @returns The array, or an empty one when none is found.
 */
export function asList(x: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(x)) return x;
  const record = asRecord(x);
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  const firstArray = Object.values(record).find((v) => Array.isArray(v));
  return Array.isArray(firstArray) ? firstArray : [];
}
