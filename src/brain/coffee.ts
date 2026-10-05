/**
 * The coffee timer's situations, recognised by their openings.
 *
 * Coffee doubles as a reminder for the player to get up from their desk:
 * every 20-30 minutes the worker announces a coffee run (and nudges the
 * boss to stretch too), or, if scared of the boss, asks permission up to
 * three times. The director sends fixed openings; this module spots them
 * so the prompt can add tone hints and the fallback can pick fitting
 * lines.
 */

export const COFFEE_TIMER = /^The coffee timer went off/i;
export const COFFEE_COURAGE = /^Nobody answered, so you finally worked up the courage/i;
export const COFFEE_DENIED = /^Your boss said no to your coffee/i;
const COFFEE_ASK = /scared of your boss\. Ask permission \(attempt (\d+)/i;

/** Which of the three permission requests this is. */
export type AskAttempt = 1 | 2 | 3;

/**
 * Which permission request this is, if the situation is one.
 *
 * @param situation - The situation text.
 * @returns 1-3, or null when it isn't a coffee request.
 */
export function coffeeAskAttempt(situation: string): AskAttempt | null {
  const match = COFFEE_ASK.exec(situation);
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 10);
  return n >= 3 ? 3 : n <= 1 ? 1 : 2;
}

const ASK_TONE: Record<AskAttempt, string> = {
  1: 'Ask timidly.',
  2: 'Ask again, more anxiously.',
  3: 'Ask one last time, visibly building up your courage.',
};

/**
 * Extra direction for a coffee situation, appended to the think prompt.
 *
 * @param situation - The situation text.
 * @returns A short instruction, or '' for other situations.
 */
export function coffeeHint(situation: string): string {
  const attempt = coffeeAskAttempt(situation);
  if (attempt !== null) {
    return `${ASK_TONE[attempt]} Say it out loud ("say"), under 15 words.`;
  }
  if (COFFEE_TIMER.test(situation)) {
    return 'Announce it casually out loud ("say"), under 15 words. Often ' +
      'nudge the boss to get up too: stretch their legs, grab a drink.';
  }
  if (COFFEE_COURAGE.test(situation)) return 'Under 15 words.';
  if (COFFEE_DENIED.test(situation)) {
    return 'React as someone scared of the boss, under 15 words.';
  }
  return '';
}

/** Coffee lines stay short: they sit next to Yes / No buttons. */
export const COFFEE_MAX_WORDS = 15;

/**
 * The word limit for a situation's line, if it has its own.
 *
 * @param situation - The situation text.
 * @returns 15 for coffee situations, else null.
 */
export function wordCap(situation: string): number | null {
  return coffeeHint(situation) ? COFFEE_MAX_WORDS : null;
}

/**
 * Whether the line must be spoken: an announcement or a request needs the
 * boss to see it as speech, not a private thought.
 *
 * @param situation - The situation text.
 * @returns True for coffee announcements and requests.
 */
export function mustSpeak(situation: string): boolean {
  return COFFEE_TIMER.test(situation) || coffeeAskAttempt(situation) !== null;
}
