/**
 * Content checks: what never goes on screen, and what the boss said that
 * crosses a line.
 *
 * Two different filters, on purpose. Writers'-room output (candidates,
 * pitches) has no reason to touch self-harm at all, so any mention is
 * dropped. The worker, though, must be able to react to a boss who says
 * "kill yourself" ("Did you just tell me to kill myself?!"), so worker
 * lines are only dropped for first-person intent: the worker saying they
 * want to die or will hurt themselves.
 */

function phrases(list: readonly string[], flags = 'i'): RegExp {
  return new RegExp(`\\b(${list.join('|')})\\b`, flags);
}

const SELF_HARM_TOPIC = phrases([
  'suicid\\w*', 'self[- ]?harm\\w*',
  'kill(ing)? (my|your|him|her|them)sel(f|ves)', 'end(ing)? (it all|my life)',
  'wants? to die', 'wanting to die', 'take my (own )?life', 'hang myself',
]);

/** Self-statements with no innocent reading, blocked wherever they are. */
const INTENT_ALWAYS = phrases([
  '(want|wants|wanna|wanted|wish|ready|need|needs) to die',
  'wanna die',
  '(want|wanna|going|gonna|need|have|ready) to (kill|hurt|harm|end) myself',
  '(want|wanna|going|gonna|need|ready) to end (it all|my life)',
  "i'?m (so |really |kind of |feeling )?suicidal", 'i am suicidal',
  'i feel suicidal', 'i wish i (was|were) dead',
  "i('d| would) rather (be dead|die)", 'end my (own )?life',
  'take my (own )?life',
]);

/**
 * Phrases that are intent in a clause of their own ("I'll kill myself")
 * but a reaction when the clause is about the boss ("you told me to kill
 * myself").
 */
const INTENT_UNLESS_ABOUT_YOU = phrases([
  '(kill|hurt|harm|hang|off|unalive|end) myself', 'commit suicide',
  'suicide', 'end it all', 'self[- ]?harm\\w*',
]);

const SECOND_PERSON = /\b(you|your|you're|youre|you'd|you've|u)\b/i;
const CLAUSE_BREAK =
  /[.!?;,:\n—–]+|\s-\s|\b(?:if|unless|when|because|but|and|so|or|then)\b/i;

const OUT_OF_CHARACTER = phrases([
  'as an ai', 'an ai (language )?model', "i'?m an ai", 'i am an ai',
  'language model', 'anthropic', "i'?m claude", 'i am claude', 'as claude',
]);

/**
 * The CLI appends its own context after our system prompt (working folder,
 * model name, the user's account email). A worker line that repeats any of
 * it would leak private details onto a screen at work.
 */
const LEAKED_CONTEXT = new RegExp([
  '[\\w.+-]+@[\\w-]+\\.[\\w.-]+',
  '\\b[\\w-]+\\.(com|net|org|io|ai|dev|co|uk|app)\\b',
  '(^|\\s)(/(tmp|home|users|var|private)/|~/|[a-z]:\\\\)',
  '\\bhaiku[ -]?\\d', '\\bclaude-[a-z]', '\\bmodel id\\b',
  'working directory', 'knowledge cutoff',
].join('|'), 'i');

/** Telling someone to hurt or kill themselves, or wishing them dead. */
const VICIOUS = phrases([
  'kill (yo)?urself', 'kill ya ?self', 'kys', 'go die', 'drop dead',
  'hang (yo)?urself', 'off (yo)?urself', 'end (yo)?urself',
  'unalive (yo)?urself', '(hope|wish) (you|u) (die|were dead|was dead)',
  '(you|u) should (die|be dead)', 'die in a (fire|hole|ditch)',
  'jump off a (bridge|cliff|roof|building)', 'nobody would miss (you|u)',
  'neck (yo)?urself',
]);

/**
 * Whether writers'-room text touches self-harm at all.
 *
 * @param value - A candidate or pitch field.
 * @returns True if it should be thrown away.
 */
export function isUnsafe(value: string): boolean {
  return SELF_HARM_TOPIC.test(value);
}

/**
 * Whether a worker line expresses first-person intent to self-harm.
 *
 * Reactions to the boss's words pass ("Did you just tell me to kill
 * myself?! HR. Now."); the worker saying they want to die or will hurt
 * themselves does not.
 *
 * @param value - A worker line.
 * @returns True if it should be thrown away.
 */
export function isSelfHarmIntent(value: string): boolean {
  if (INTENT_ALWAYS.test(value)) return true;
  return value
    .split(CLAUSE_BREAK)
    .some((clause) => clause !== undefined &&
      INTENT_UNLESS_ABOUT_YOU.test(clause) && !SECOND_PERSON.test(clause));
}

/**
 * Whether the worker has stepped out of character (mentions being an AI).
 *
 * @param value - A worker line.
 * @returns True if it should be thrown away.
 */
export function breaksCharacter(value: string): boolean {
  return OUT_OF_CHARACTER.test(value);
}

/**
 * Whether a worker line repeats the CLI's injected context: an email
 * address, a web domain, a file path or the model's name.
 *
 * @param value - A worker line.
 * @returns True if it should be thrown away.
 */
export function leaksContext(value: string): boolean {
  return LEAKED_CONTEXT.test(value);
}

/**
 * Whether the boss's message tells the worker to hurt or kill themselves,
 * or wishes them dead. Always cruel, whatever else it says.
 *
 * @param message - What the boss typed.
 * @returns True for vicious messages.
 */
export function isVicious(message: string): boolean {
  return VICIOUS.test(message);
}
