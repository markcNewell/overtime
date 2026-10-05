/**
 * Words for the worker's state, so the persona prompt reads like a
 * character note ("exhausted, on the edge") rather than a stats dump.
 * Haiku plays a mood far better from words than from numbers.
 */

import type {
  Activity,
  Attitude,
  GameState,
  Ledger,
  Memory,
  Project,
  Worker,
} from '../shared/types';

/** Pick the label of the first band whose floor `value` reaches. */
function band(value: number, bands: readonly [number, string][]): string {
  const hit = bands.find(([floor]) => value >= floor);
  return hit ? hit[1] : bands[bands.length - 1]?.[1] ?? '';
}

const ENERGY: readonly [number, string][] = [
  [75, 'full of energy'],
  [50, 'fine, energy-wise'],
  [25, 'tired'],
  [10, 'exhausted'],
  [0, 'running on fumes, eyelids drooping'],
];

const MOOD: readonly [number, string][] = [
  [80, 'in a great mood'],
  [60, 'content'],
  [40, 'grumpy'],
  [20, 'miserable'],
  [0, 'utterly fed up and despairing'],
];

const SANITY: readonly [number, string][] = [
  [70, 'perfectly sane'],
  [45, 'a little frayed'],
  [25, 'unravelling'],
  [10, 'on the edge, talking to the rubber duck'],
  [0, 'barely holding it together, seeing code in the wallpaper'],
];

const ACTIVITY: Record<Activity, string> = {
  arriving: 'just walking in for your first day',
  idle: 'at your desk with no project, killing time',
  working: 'typing away at the current project',
  stuck: 'stuck on a nasty problem',
  coffee: 'on a coffee break at the coffee station',
  asleep: 'asleep at your desk',
  leaving: 'leaving for good',
};

/**
 * What the worker is doing, in words.
 *
 * @param activity - The current activity.
 * @returns e.g. "on a coffee break at the coffee station".
 */
export function describeActivity(activity: Activity): string {
  return ACTIVITY[activity];
}

/**
 * Describe the worker's condition in a few plain words.
 *
 * @param worker - The worker.
 * @param now - Current time, for temporary effects.
 * @returns e.g. "tired, grumpy, a little frayed; typing away at ...".
 */
export function describeCondition(worker: Worker, now: number): string {
  const { energy, mood, sanity } = worker.stats;
  const feelings = [band(energy, ENERGY), band(mood, MOOD),
    band(sanity, SANITY)];
  const extras: string[] = [];
  if (worker.boost && worker.boost.until > now) {
    extras.push('jittery and rushing after the boss zapped or yelled at you');
  }
  const recentShocks = worker.recentShocks.filter((t) => now - t < 600_000);
  if (recentShocks.length >= 4) extras.push('smoking slightly from shocks');
  if (worker.wantsCoffeeSince !== undefined) {
    extras.push('desperate for a coffee');
  }
  const doing = ACTIVITY[worker.activity];
  return [feelings.join(', '), doing, ...extras].join('; ');
}

const ATTITUDE: Record<Attitude, string> = {
  neutral: 'You have no strong feelings about your boss yet: polite, a bit ' +
    'wary, still working them out.',
  loyal: 'You genuinely like your boss and would take a bug for them. Warm, ' +
    'eager, a little too honest.',
  scared: 'You are terrified of your boss. You flinch, over-apologise and ' +
    'agree to everything, voice wobbling.',
  bitter: 'You resent your boss. Sarcastic, passive-aggressive, muttering ' +
    'about unions and HR.',
  'sucking-up': 'You flatter your boss shamelessly, angling for a ' +
    'promotion. Every reply is a little bit of grovelling.',
};

/**
 * How the worker feels about the boss, as an instruction to the actor.
 *
 * @param attitude - The derived attitude.
 * @returns One or two sentences.
 */
export function describeAttitude(attitude: Attitude): string {
  return ATTITUDE[attitude];
}

function times(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

/**
 * The boss's track record with this worker, in a sentence.
 *
 * @param ledger - Running counts.
 * @returns e.g. "So far the boss has electrocuted you twice, praised you
 *   once."
 */
export function describeLedger(ledger: Ledger): string {
  const deeds: [number, string][] = [
    [ledger.shocks, 'electrocuted you'],
    [ledger.shouts, 'shouted at you'],
    [ledger.praises, 'praised you'],
    [ledger.bonuses, 'given you a bonus'],
    [ledger.kindChats, 'been kind to you in chat'],
    [ledger.cruelChats, 'been cruel to you in chat'],
    [ledger.coffees, 'sent you for coffee'],
  ];
  const done = deeds
    .filter(([n]) => n > 0)
    .map(([n, deed]) => `${deed} ${times(n)}`);
  if (done.length === 0) return 'The boss has not done anything to you yet.';
  return `So far the boss has ${done.join(', ')}.`;
}

/**
 * The current project in a line or two, including any hard part.
 *
 * @param project - The project, if any.
 * @returns A description, or a note that there is no project.
 */
export function describeProject(project: Project | undefined): string {
  if (!project) return 'No project assigned right now.';
  const pct = Math.round(project.progress * 100);
  const lines = [`"${project.title}" (${project.tagline}), ${pct}% done.`];
  const stuck = project.stuckOn !== undefined
    ? project.hardParts[project.stuckOn]
    : undefined;
  if (stuck?.mystery) {
    lines.push(`You are stuck on a baffling bug, "${stuck.title}": ` +
      `${stuck.detail} It appeared out of nowhere and nothing you did ` +
      'explains it.');
  } else if (stuck) {
    lines.push(`You are stuck on "${stuck.title}": ${stuck.detail}`);
  } else if (project.hardPartsHit.length >= project.hardParts.length) {
    lines.push('The worst of it is behind you.');
  } else {
    lines.push('It is going suspiciously smoothly.');
  }
  return lines.join(' ');
}

/**
 * The boss's secret sabotage, as the worker experiences it. The worker
 * must never learn it was the boss, so this only ever describes symptoms.
 *
 * @param ledger - Running counts (only `sabotages` is read).
 * @returns A sentence, or '' when nothing has been sabotaged.
 */
export function describeSabotage(ledger: Ledger): string {
  const n = ledger.sabotages ?? 0;
  if (n <= 0) return '';
  if (n <= 2) {
    return 'Weird bugs keep appearing in your code out of nowhere.';
  }
  return "You're getting paranoid that someone is sabotaging you: bugs " +
    'keep appearing out of nowhere. You suspect everything, from the boss ' +
    'to the coffee machine, the last developer or cosmic rays.';
}

const MEMORY_TAG: Record<Memory['kind'], string> = {
  boss: 'about the boss',
  work: 'work',
  desk: 'found at your desk',
  self: 'yourself',
};

/**
 * The last few memories as bullet lines.
 *
 * @param memories - All memories, oldest first.
 * @param count - How many of the newest to keep.
 * @returns Bullet lines, or a note that there are none.
 */
export function describeMemories(memories: Memory[], count = 12): string {
  const recent = memories.slice(-count);
  if (recent.length === 0) return '- (nothing yet)';
  return recent.map((m) => `- (${MEMORY_TAG[m.kind]}) ${m.text}`).join('\n');
}

/**
 * Whether an ignored HR complaint has convinced the worker that the whole
 * company is against them. It lasts until an apology arrives after the
 * latest snub.
 *
 * @param state - For the complaints.
 * @param worker - The worker.
 * @returns True while they feel persecuted.
 */
export function feelsPersecuted(
  state: Pick<GameState, 'complaints'>,
  worker: Pick<Worker, 'id'>,
): boolean {
  const mine = (state.complaints ?? []).filter((c) => c.workerId === worker.id);
  const snubs = mine
    .map((c) => c.ignoredAt)
    .filter((t): t is number => t !== undefined);
  if (snubs.length === 0) return false;
  const lastSnub = Math.max(...snubs);
  // A late apology on the ignored complaint itself counts, even unstamped.
  const apologised = mine.some((c) => c.outcome === 'apology' &&
    (c.repliedAt ?? c.ignoredAt ?? c.filedAt) >= lastSnub);
  return !apologised;
}

/** The persona line for a worker who feels persecuted. */
export const PERSECUTED =
  'Nobody answered your HR complaint, and you are now convinced the whole ' +
  'company is against you: HR, IT, the coffee machine, the boss, everyone. ' +
  'It colours everything you say: suspicious, conspiratorial and wounded.';

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
