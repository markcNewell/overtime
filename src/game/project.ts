/** Internal helpers for a project's hard parts, shared by the clock and sabotage. */

import type { GameEvent, Project, Worker } from '../shared/types';
import { stuckMinutes } from './formulas';
import { gapFor } from './levels';

/**
 * The first hard part, in order, not yet reached.
 *
 * @param project - The project.
 * @returns Its index, or undefined when all have been reached.
 */
export function nextHardPart(project: Project): number | undefined {
  const index = project.hardParts.findIndex(
    (_, i) => !project.hardPartsHit.includes(i),
  );
  return index < 0 ? undefined : index;
}

/**
 * Hit a hard part: they are stuck on it until the timer runs out.
 *
 * @param project - Changed in place.
 * @param worker - Changed in place.
 * @param index - Index into `project.hardParts`.
 * @param t - Epoch ms.
 * @param events - `hard-part-hit` is pushed here.
 */
export function hitHardPart(
  project: Project,
  worker: Worker,
  index: number,
  t: number,
  events: GameEvent[],
): void {
  const part = project.hardParts[index];
  if (!part) return;
  const gap = gapFor(worker.level, project.difficulty);
  project.hardPartsHit.push(index);
  project.stuckOn = index;
  project.stuckMinutesLeft = stuckMinutes(part.severity, gap, worker.traits.talent);
  worker.activity = 'stuck';
  worker.activitySince = t;
  events.push({ type: 'hard-part-hit', index });
}
