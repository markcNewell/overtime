/**
 * The boss quietly messes up the worker's code: a planted "mystery" hard
 * part at the point they've reached, and a little lost progress.
 */

import type { GameEvent, HardPart, Project, Severity, Worker } from '../shared/types';
import { hitHardPart } from './project';
import { SABOTAGE } from './tuning';
import { nudge } from './worker';

/** Picked in turn by the sabotage count, so the game stays deterministic. */
const BUGS: readonly (readonly [title: string, detail: string])[] = [
  [
    'Semicolons became Greek question marks',
    'They look identical. The compiler disagrees.',
  ],
  ['Tabs and spaces swapped', 'Every file is now indented like a ransom note.'],
  ['Every variable renamed to x', 'x = x(x, x). Good luck.'],
  ['Prod and dev configs swapped', 'Real customers are now seeing the debug cat.'],
  ['The tests now test themselves', 'They all pass. That is the problem.'],
  ['Git history rewritten', 'Every commit message now just says "fixed it".'],
  ['Server clock set to Mars time', 'Every timestamp is off by roughly one sol.'],
  [
    'All comments translated into Latin',
    'The one that said "do not touch" is now poetry.',
  ],
  ['The build only works on Tuesdays', 'It is not Tuesday.'],
  ['Caps Lock superglued on', 'WRITING camelCase IS NOW A TWO-HANDED JOB.'],
  ['sleep(5) sprinkled everywhere', 'The app is now extremely relaxed.'],
  ['Dependencies pinned to 0.0.1-alpha', 'Nothing imports. Some things hum.'],
];

/**
 * Plant a bug in the worker's project.
 *
 * Progress is knocked back, but never below 0 or behind a hard part they've
 * already reached. The bug lands where progress now is, so it is the next
 * hard part they meet: at once if they're working, as soon as they're back
 * otherwise, and straight after the one they're stuck on if they're stuck.
 *
 * @param project - Changed in place; indices stay pointed at the same parts.
 * @param worker - Changed in place.
 * @param now - Epoch ms.
 * @param events - `code-broken` (and `hard-part-hit` if working) go here.
 */
export function plantBug(
  project: Project,
  worker: Worker,
  now: number,
  events: GameEvent[],
): void {
  const count = worker.ledger.sabotages ?? 0;
  // Already pruned to the window, so this is "in the last 30 minutes".
  const recent = worker.recentSabotages ?? [];
  const extra = Math.min(SABOTAGE.maxExtraSeverity, recent.length);
  const [title, detail] = BUGS[count % BUGS.length] ?? BUGS[0]!;
  const bug: HardPart = {
    at: knockBack(project),
    severity: (1 + extra) as Severity,
    title,
    detail,
    mystery: true,
  };
  const index = insertPart(project, bug);

  worker.ledger.sabotages = count + 1;
  worker.recentSabotages = [...recent, now];
  nudge(worker.stats, { mood: SABOTAGE.mood, sanity: SABOTAGE.sanity });
  events.push({ type: 'code-broken', index });
  if (worker.activity === 'working') hitHardPart(project, worker, index, now, events);
}

/** Lose a little progress; returns where progress ends up. */
function knockBack(project: Project): number {
  const reached = project.hardPartsHit.map((i) => project.hardParts[i]?.at ?? 0);
  // Stay level with the furthest hard part already met, so "hit" stays true.
  const floor = Math.min(project.progress, Math.max(0, ...reached));
  project.progress = Math.max(floor, project.progress - SABOTAGE.knockback);
  return project.progress;
}

/**
 * Insert a part keeping the list sorted by `at`, and remap `hardPartsHit`
 * and `stuckOn` so they still point at the same parts.
 *
 * @returns The new part's index.
 */
function insertPart(project: Project, part: HardPart): number {
  const hit = new Set(project.hardPartsHit);
  const entries = [
    ...project.hardParts.map((p, i) => ({ part: p, old: i as number | undefined })),
    { part, old: undefined },
  ];
  // On a tie, parts already met stay first and the new bug comes before
  // anything not yet reached. Array sort is stable.
  const rank = (old: number | undefined): number =>
    old === undefined ? 1 : hit.has(old) ? 0 : 2;
  entries.sort((a, b) => a.part.at - b.part.at || rank(a.old) - rank(b.old));

  const moved = new Map<number, number>();
  entries.forEach((e, i) => {
    if (e.old !== undefined) moved.set(e.old, i);
  });
  project.hardParts = entries.map((e) => e.part);
  project.hardPartsHit = project.hardPartsHit.map((i) => moved.get(i) ?? i);
  if (project.stuckOn !== undefined) {
    project.stuckOn = moved.get(project.stuckOn) ?? project.stuckOn;
  }
  return entries.findIndex((e) => e.old === undefined);
}
