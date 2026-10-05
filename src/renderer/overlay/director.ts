/**
 * Choreography: turns the worker's activity into a timeline of "segments"
 * (walk here, sit, flail, collapse...) and says which segment is live now.
 *
 * Plans are anchored to `activitySince`, so reopening the overlay halfway
 * through an ending picks it up at the right moment instead of restarting.
 * The director only does timing and positions; `view.ts` draws.
 */

import type { Activity, EndingKind, Worker } from '../../shared/types';
import type { Arms, Expression, Pose } from '../shared/person';
import { COFFEE_X, OFF_LEFT, OFF_RIGHT, SEAT_X } from './scene';

export interface Segment {
  /** Length in ms; `Infinity` for the final hold. */
  dur: number;
  pose: Pose;
  arms?: Arms;
  x0: number;
  /** Walks linearly from `x0` to `x1` over the segment when set. */
  x1?: number;
  facing: 1 | -1;
  /** Overrides the expression the stats would give. */
  expression?: Expression;
  hairOnEnd?: boolean;
  /** Extra classes on the worker group for this segment. */
  cls?: string;
  /** Extra classes on the scene root (e.g. the flipped desk). */
  sceneCls?: string;
  hidden?: boolean;
  /** Shouted text that follows the worker (e.g. "AAAA!"). */
  shout?: string;
}

export interface Plan {
  key: string;
  start: number;
  segments: Segment[];
}

export interface Live {
  seg: Segment;
  index: number;
  /** ms into the segment. */
  elapsed: number;
  /** ms until the next segment starts, or Infinity. */
  remaining: number;
}

/** Walking pace in px per ms; ~3 s from the chair to the coffee machine. */
const WALK = 0.036;
/** How long each ending plays before the worker is gone. */
export const ENDING_MS: Record<EndingKind, number> = {
  'lost-mind': 6500,
  fried: 7500,
  'rage-quit': 7000,
  fired: 7500,
};

const SEATED: Activity[] = ['idle', 'working', 'stuck', 'asleep'];

function hold(pose: Pose, x: number, extra: Partial<Segment> = {}): Segment {
  return { dur: Infinity, pose, x0: x, facing: 1, ...extra };
}

function walk(from: number, to: number, extra: Partial<Segment> = {}): Segment {
  const dur = Math.max(400, Math.abs(to - from) / WALK);
  return {
    dur,
    pose: 'walk',
    x0: from,
    x1: to,
    facing: to < from ? -1 : 1,
    ...extra,
  };
}

function seatedHold(activity: Activity, mystery = false): Segment {
  switch (activity) {
    case 'working':
      return hold('sit-type', SEAT_X);
    case 'stuck':
      // A planted bug is worse than an honest hard part: both hands on head.
      return mystery
        ? hold('sit-type', SEAT_X, { arms: 'clutch', cls: 'seg-frazzled' })
        : hold('sit-type', SEAT_X, { arms: 'scratch' });
    case 'asleep':
      return hold('sit-slump', SEAT_X);
    default:
      return hold('sit-idle', SEAT_X);
  }
}

function endingPlan(kind: EndingKind, x0: number, seated: boolean): Segment[] {
  const gone: Segment = hold('stand', x0, { hidden: true });
  switch (kind) {
    case 'lost-mind':
      return [
        {
          dur: 1700,
          pose: 'stand',
          arms: 'up',
          x0,
          facing: 1,
          expression: 'crazy',
          hairOnEnd: true,
          cls: 'seg-tremble',
          shout: 'AAAAAA!',
        },
        walk(x0, OFF_LEFT, {
          dur: 3600,
          arms: 'up',
          expression: 'crazy',
          hairOnEnd: true,
          cls: 'seg-run',
          shout: 'AAAAAAAA!',
        }),
        gone,
      ];
    case 'fried':
      return [
        {
          dur: 1800,
          pose: seated ? 'sit-type' : 'stand',
          x0,
          facing: 1,
          expression: 'shocked',
          cls: 'seg-xray',
        },
        {
          dur: 800,
          pose: 'stand',
          x0,
          facing: 1,
          expression: 'shocked',
          hairOnEnd: true,
          cls: 'seg-sooty',
        },
        {
          dur: 700,
          pose: 'stand',
          x0,
          facing: 1,
          expression: 'shocked',
          hairOnEnd: true,
          cls: 'seg-sooty seg-collapse',
        },
        { dur: 4200, pose: 'stand', x0, facing: 1, hidden: true, cls: 'seg-ash' },
        gone,
      ];
    case 'rage-quit':
      return [
        {
          dur: 1300,
          pose: 'stand',
          arms: 'fists',
          x0,
          facing: 1,
          expression: 'angry',
          cls: 'seg-tremble',
          shout: '#@!%&!!',
        },
        {
          dur: 1000,
          pose: 'stand',
          arms: 'up',
          x0,
          facing: 1,
          expression: 'angry',
          sceneCls: 'seg-flip',
          shout: 'I QUIT!',
        },
        walk(x0, OFF_LEFT, {
          dur: 3800,
          arms: 'fists',
          expression: 'angry',
          cls: 'seg-stomp',
          sceneCls: 'desk-flipped',
          shout: 'I QUIT!',
        }),
        { ...gone, sceneCls: 'desk-flipped' },
      ];
    case 'fired':
      return [
        { dur: 1300, pose: 'stand', arms: 'box', x0, facing: 1, expression: 'sad' },
        walk(x0, OFF_RIGHT, {
          dur: 5800,
          arms: 'box',
          expression: 'sad',
          cls: 'seg-trudge',
        }),
        gone,
      ];
  }
}

/**
 * Build the timeline for the worker's current activity. `fromX` is where
 * the worker is drawn right now, so a change of activity walks them from
 * there instead of teleporting. `mystery` is set while they are stuck on a
 * bug the boss planted.
 */
export function planFor(
  worker: Worker,
  fromX: number | undefined,
  now: number,
  mystery = false,
): Plan {
  const a = worker.activity;
  const key = `${worker.id}|${a}|${worker.ending ?? ''}|${worker.activitySince}|${mystery ? 'm' : ''}`;
  const since = worker.activitySince;
  const atSeat = fromX === undefined || Math.abs(fromX - SEAT_X) < 2;

  if (a === 'arriving') {
    return {
      key,
      start: since,
      segments: [walk(OFF_RIGHT, SEAT_X, { dur: 4400, expression: 'happy' }), hold('sit-idle', SEAT_X, { arms: 'side' })],
    };
  }
  if (a === 'leaving') {
    const x0 = fromX ?? SEAT_X;
    const seated = atSeat;
    return { key, start: since, segments: endingPlan(worker.ending ?? 'fired', x0, seated) };
  }
  if (a === 'coffee') {
    const x0 = fromX ?? SEAT_X;
    if (Math.abs(x0 - COFFEE_X) < 2) {
      return { key, start: since, segments: [hold('drink', COFFEE_X)] };
    }
    // Starting from wherever they are; if the overlay opened mid-break the
    // elapsed time skips straight past the walk.
    return {
      key,
      start: fromX === undefined ? since : Math.max(since, now - 200),
      segments: [walk(x0, COFFEE_X), hold('drink', COFFEE_X)],
    };
  }
  if (SEATED.includes(a)) {
    const seated = seatedHold(a, mystery);
    if (atSeat) return { key, start: since, segments: [seated] };
    return { key, start: now, segments: [walk(fromX, SEAT_X), seated] };
  }
  return { key, start: since, segments: [seatedHold('idle')] };
}

/** Which segment of a plan is live at `now`. */
export function liveSegment(plan: Plan, now: number): Live {
  let t = Math.max(0, now - plan.start);
  for (let i = 0; i < plan.segments.length; i++) {
    const seg = plan.segments[i];
    if (!seg) break;
    if (t < seg.dur || i === plan.segments.length - 1) {
      return { seg, index: i, elapsed: t, remaining: seg.dur - t };
    }
    t -= seg.dur;
  }
  const last = plan.segments[plan.segments.length - 1] ?? hold('sit-idle', SEAT_X);
  return { seg: last, index: plan.segments.length - 1, elapsed: t, remaining: Infinity };
}

/** The worker's x in a live segment. */
export function xAt(live: Live): number {
  const { seg, elapsed } = live;
  if (seg.x1 === undefined) return seg.x0;
  const k = Math.min(1, elapsed / seg.dur);
  return seg.x0 + (seg.x1 - seg.x0) * k;
}

/** Total length of a plan up to its final hold, for "is it over yet". */
export function planLength(plan: Plan): number {
  return plan.segments.reduce((sum, s) => (Number.isFinite(s.dur) ? sum + s.dur : sum), 0);
}
