/**
 * Chat actions: a reply can carry something the worker agreed to do (take
 * a break, or get back to work), so "be back in five" actually happens.
 */

import type { Activity, ChatRequest, ChatTone } from '../shared/types';

export const CHAT_REQUESTS: readonly ChatRequest[] = ['coffee', 'work'];

const AWAY: readonly Activity[] = ['coffee', 'asleep', 'idle'];

/**
 * Drop an action that would change nothing or can't happen now.
 *
 * @param action - The proposed action, if any.
 * @param activity - What the worker is doing.
 * @returns The action, or undefined when it is pointless (a coffee break
 *   while on one, getting back to work while working, anything while
 *   arriving or leaving).
 */
export function usefulAction(
  action: ChatRequest | undefined,
  activity: Activity,
): ChatRequest | undefined {
  if (!action || activity === 'arriving' || activity === 'leaving') {
    return undefined;
  }
  if (action === 'coffee' && activity === 'coffee') return undefined;
  if (action === 'work' && !AWAY.includes(activity)) return undefined;
  return action;
}

const WORK_REQUEST = /\b(back to work|get to work|get back|stop slacking)\b/i;
// "break" as in a rest, not "don't break the build".
const BREAK_REQUEST = new RegExp(
  '\\b(coffee|tea|breather|rest|break)\\b(?!\\s+(it|this|that|the|' +
    'anything|something|everything|my|your|stuff|things)\\b)',
  'i',
);

/**
 * Guess, without Claude, whether the boss asked for a break or for work.
 *
 * @param message - What the boss typed.
 * @param tone - How it came across; a cruel mention of coffee is not an
 *   invitation.
 * @returns The request, or undefined when none is clear.
 */
export function guessRequest(
  message: string,
  tone: ChatTone,
): ChatRequest | undefined {
  if (WORK_REQUEST.test(message)) return 'work';
  if (tone !== 'cruel' && BREAK_REQUEST.test(message)) return 'coffee';
  return undefined;
}
