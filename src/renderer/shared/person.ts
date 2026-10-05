/**
 * The worker character, drawn in flat cartoon SVG from a `Look`.
 *
 * Everything is in "person space": x = 0 is the middle of the hips, y = 0 is
 * the floor and the character faces right (+x). Standing they are about 92
 * units tall, seated about 84. The overlay scene drops this group onto its
 * floor (mirroring it to face left); the office uses `personSvg` for
 * hiring-card portraits.
 *
 * Moving parts sit inside wrapper groups whose origin is the joint they pivot
 * on, so CSS can animate them with a plain `rotate()` (CSS transforms on SVG
 * elements pivot on the local origin by default). Class names:
 * `p-leg-near/far`, `p-arm-near/far`, `p-bob`, `p-head`, `p-eye-twitch`,
 * `p-spin`, `p-steam`.
 */

import type { HairStyle, Look } from '../../shared/types';
import {
  add,
  esc,
  lerp,
  num,
  polyline,
  pt,
  rotate,
  shade,
  sub,
  type Pt,
} from './svg';

export type Pose =
  | 'sit-type'
  | 'sit-slump'
  | 'sit-idle'
  | 'stand'
  | 'walk'
  | 'drink';

export type Expression =
  | 'happy'
  | 'neutral'
  | 'tired'
  | 'sad'
  | 'angry'
  | 'scared'
  | 'crazy'
  | 'asleep'
  | 'shocked';

/** What the arms are doing; each pose has a default. */
export type Arms =
  | 'type'
  | 'fold'
  | 'phone'
  | 'scratch'
  | 'side'
  | 'swing'
  | 'mug'
  | 'box'
  | 'up'
  | 'fists';

export interface PersonOptions {
  pose: Pose;
  expression: Expression;
  /** Overrides the pose's default arms (e.g. scratching their head). */
  arms?: Arms;
  /** Low-sanity touches: a twitchy eye, stray hair spikes, a swirl. */
  crazed?: boolean;
  /** Hair standing on end, whatever the style. */
  hairOnEnd?: boolean;
  /** X-ray view: a dark silhouette with white bones (electric shocks). */
  skeleton?: boolean;
}

export interface PersonSvgOptions extends PersonOptions {
  /** Height of the returned `<svg>` in CSS pixels. Default 96. */
  size?: number;
  /** `bust` crops to head and shoulders for small cards. Default `full`. */
  crop?: 'full' | 'bust';
}

const LINE = '#2a2238';
const OW = 1.5;
const PANTS = '#3c4866';
const SHOE = '#2d2834';
const XRAY = '#22305c';
const XRAY_LINE = '#0f1736';
const BONE = '#f6f1e2';
const HEAD_RX = 17;
const HEAD_RY = 16;
const SEAT_Y = -21;

const DEFAULT_ARMS: Record<Pose, Arms> = {
  'sit-type': 'type',
  'sit-slump': 'fold',
  'sit-idle': 'phone',
  stand: 'side',
  walk: 'swing',
  drink: 'mug',
};

interface Paint {
  skin: string;
  skinShade: string;
  hair: string;
  hairShade: string;
  brow: string;
  shirt: string;
  shirtShade: string;
  pants: string;
  shoe: string;
  line: string;
  xray: boolean;
}

/** Where the joints are for one pose, in person space. */
interface Rig {
  hip: Pt;
  /** Torso rotation about the hip in degrees; positive leans forward. */
  lean: number;
  /** 0 faces the viewer, 1 is a three-quarter turn to the right. */
  turn: number;
  headTilt: number;
  /** Nudges the head off the neck, e.g. drooping forward when asleep. */
  headShift: Pt;
  seated: boolean;
  /** Hip joint, knee, ankle. */
  legNear: [Pt, Pt, Pt];
  legFar: [Pt, Pt, Pt];
  feet: 'side' | 'front';
}

interface ArmPair {
  near: [Pt, Pt];
  far: [Pt, Pt];
}

function paintFor(look: Look, xray: boolean): Paint {
  if (xray) {
    return {
      skin: XRAY,
      skinShade: XRAY,
      hair: shade(XRAY, -0.25),
      hairShade: shade(XRAY, -0.25),
      brow: XRAY,
      shirt: XRAY,
      shirtShade: XRAY,
      pants: XRAY,
      shoe: XRAY,
      line: XRAY_LINE,
      xray: true,
    };
  }
  return {
    skin: look.skin,
    skinShade: shade(look.skin, -0.12),
    hair: look.hair,
    hairShade: shade(look.hair, -0.22),
    brow: shade(look.hair, -0.35),
    shirt: look.shirt,
    shirtShade: shade(look.shirt, -0.16),
    pants: PANTS,
    shoe: SHOE,
    line: LINE,
    xray: false,
  };
}

function sitRig(lean: number, turn: number, headTilt: number, headShift = pt(0, 0)): Rig {
  return {
    hip: pt(0, -27),
    lean,
    turn,
    headTilt,
    headShift,
    seated: true,
    legNear: [pt(3, -25), pt(19, -24.5), pt(19.5, -5)],
    legFar: [pt(-2, -26), pt(14.5, -26.5), pt(14, -5)],
    feet: 'side',
  };
}

function standRig(turn: number): Rig {
  const spread = 5 * (1 - turn) + 1.5;
  return {
    hip: pt(0, -33),
    lean: 0,
    turn,
    headTilt: 0,
    headShift: pt(0, 0),
    seated: false,
    legNear: [pt(spread - 0.5, -31), pt(spread, -17), pt(spread, -5)],
    legFar: [pt(-spread + 0.5, -31), pt(-spread, -17), pt(-spread, -5)],
    feet: turn > 0.6 ? 'side' : 'front',
  };
}

function rigFor(pose: Pose): Rig {
  switch (pose) {
    case 'sit-type':
      return sitRig(6, 1, 0);
    case 'sit-slump':
      return sitRig(36, 1, 26, pt(6, 4));
    case 'sit-idle':
      return sitRig(-8, 0.75, 14);
    case 'stand':
      return standRig(0);
    case 'walk':
      return standRig(1);
    case 'drink':
      return standRig(0.3);
  }
}

/** Hip-local point to person space, following the torso lean. */
function onTorso(rig: Rig, local: Pt): Pt {
  return add(rig.hip, rotate(local, rig.lean));
}

function shoulders(rig: Rig): { near: Pt; far: Pt } {
  const t = rig.turn;
  return {
    // In three-quarter view the near arm hangs off the torso's front edge.
    near: onTorso(rig, pt(9.5 - 2 * t, -22 + 1.5 * t)),
    far: onTorso(rig, pt(-9.5 + 7 * t, -22.5)),
  };
}

function headLocal(rig: Rig): Pt {
  return pt(2 * rig.turn + rig.headShift.x, -45 + rig.headShift.y);
}

/**
 * Where the head sits for a pose, in person space: its centre and radius.
 * The scene uses it to place bubbles, Zzz, sweat and the like.
 */
export function personHead(pose: Pose): { x: number; y: number; r: number } {
  const rig = rigFor(pose);
  const c = onTorso(rig, headLocal(rig));
  return { x: c.x, y: c.y, r: HEAD_RX };
}

function armsFor(kind: Arms, rig: Rig): ArmPair {
  const s = shoulders(rig);
  const t = rig.turn;
  const rel = (o: Pt, x: number, y: number): Pt => add(o, pt(x, y));
  switch (kind) {
    case 'type':
      return {
        near: [pt(14, -35), pt(27, -41.5)],
        far: [pt(5, -40), pt(23, -43.5)],
      };
    case 'fold':
      return {
        near: [pt(33, -40), pt(50, -41)],
        far: [pt(29, -42), pt(46, -43)],
      };
    case 'phone':
      return {
        near: [pt(6.5, -38), pt(11.5, -47)],
        far: [pt(0.5, -40), pt(8.5, -49)],
      };
    case 'scratch':
      return {
        near: [pt(-3, -60), pt(-9.5, -78.5)],
        far: [pt(5, -40), pt(23, -43.5)],
      };
    case 'side': {
      const farDx = -2.5 * (1 - t) + 1 * t;
      return {
        near: [rel(s.near, 2.5 - 1.5 * t, 11), rel(s.near, 3.5 - 1.5 * t, 21)],
        far: [rel(s.far, farDx, 11), rel(s.far, farDx * 1.4, 21)],
      };
    }
    case 'swing':
      return {
        near: [rel(s.near, 1, 11), rel(s.near, 2.5, 21)],
        far: [rel(s.far, 1, 11), rel(s.far, 2.5, 21)],
      };
    case 'mug':
      return {
        near: [rel(s.near, 7.5, 8), rel(s.near, -1.5, -10)],
        far: [rel(s.far, -3, 11), rel(s.far, -4, 21)],
      };
    case 'box':
      return {
        near: [rel(s.near, 6, 10), rel(s.near, 17, 14)],
        far: [rel(s.far, 6, 10), rel(s.far, 12, 15)],
      };
    case 'up':
      return {
        near: [rel(s.near, 6, -11), rel(s.near, 8, -24)],
        far: [rel(s.far, -6 + 8 * t, -11), rel(s.far, -8 + 10 * t, -24)],
      };
    case 'fists':
      return {
        near: [rel(s.near, 7, 8), rel(s.near, 7, -3)],
        far: [rel(s.far, -6 + 9 * t, 8), rel(s.far, -6 + 10 * t, -3)],
      };
  }
}

// ---------------------------------------------------------------- primitives

function limb(points: Pt[], width: number, color: string, line: string): string {
  const d = polyline(points);
  const common = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
  return (
    `<path d="${d}" ${common} stroke="${line}" stroke-width="${num(width + OW * 2)}"/>` +
    `<path d="${d}" ${common} stroke="${color}" stroke-width="${num(width)}"/>`
  );
}

function circle(c: Pt, r: number, fill: string, line: string): string {
  return `<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(r)}" fill="${fill}" stroke="${line}" stroke-width="${OW}"/>`;
}

function bone(points: Pt[]): string {
  const knobs = points
    .map((p) => `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="1.5" fill="${BONE}"/>`)
    .join('');
  return (
    `<path d="${polyline(points)}" fill="none" stroke="${BONE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` +
    knobs
  );
}

// --------------------------------------------------------------------- legs

function shoe(ankle: Pt, feet: 'side' | 'front', side: number, p: Paint): string {
  const { x, y } = ankle;
  if (feet === 'front') {
    return `<ellipse cx="${num(x + side * 1.2)}" cy="${num(y + 2.4)}" rx="5.4" ry="2.9" fill="${p.shoe}" stroke="${p.line}" stroke-width="${OW}"/>`;
  }
  const d =
    `M${num(x - 4.5)},${num(y - 1.5)} L${num(x - 4.5)},${num(y + 3)} ` +
    `Q${num(x - 4.5)},${num(y + 5)} ${num(x - 2.5)},${num(y + 5)} ` +
    `L${num(x + 7.5)},${num(y + 5)} Q${num(x + 10)},${num(y + 5)} ${num(x + 9.4)},${num(y + 2.4)} ` +
    `Q${num(x + 8.4)},${num(y - 1)} ${num(x + 2)},${num(y - 2)} Z`;
  return `<path d="${d}" fill="${p.shoe}" stroke="${p.line}" stroke-width="${OW}" stroke-linejoin="round"/>`;
}

function leg(joints: [Pt, Pt, Pt], rig: Rig, cls: string, side: number, p: Paint): string {
  const hip = joints[0];
  const local = joints.map((j) => sub(j, hip));
  const ankle = local[2] ?? pt(0, 0);
  const bones = p.xray ? bone(local) : '';
  return (
    `<g transform="translate(${num(hip.x)} ${num(hip.y)})"><g class="${cls}">` +
    limb(local, 9, p.pants, p.line) +
    shoe(ankle, rig.feet, side, p) +
    bones +
    `</g></g>`
  );
}

function legs(rig: Rig, p: Paint): string {
  const h = rig.hip;
  const waist = `<rect x="${num(h.x - 12)}" y="${num(h.y - 2.5)}" width="24" height="8.5" rx="4.2" fill="${p.pants}" stroke="${p.line}" stroke-width="${OW}"/>`;
  return (
    leg(rig.legFar, rig, 'p-leg-far', -1, p) +
    leg(rig.legNear, rig, 'p-leg-near', 1, p) +
    waist
  );
}

// --------------------------------------------------------------------- arms

function arm(
  shoulder: Pt,
  joints: [Pt, Pt],
  cls: string,
  fist: boolean,
  p: Paint,
): string {
  const e = sub(joints[0], shoulder);
  const h = sub(joints[1], shoulder);
  const o = pt(0, 0);
  const sleeveEnd = lerp(o, e, 0.6);
  const bones = p.xray ? bone([o, e, h]) : '';
  return (
    `<g transform="translate(${num(shoulder.x)} ${num(shoulder.y)})"><g class="${cls}">` +
    limb([o, e, h], 6.2, p.skin, p.line) +
    limb([o, sleeveEnd], 8, p.shirt, p.line) +
    circle(h, fist ? 3.9 : 3.4, p.skin, p.line) +
    bones +
    `</g></g>`
  );
}

// -------------------------------------------------------------------- torso

function torso(rig: Rig, p: Paint): string {
  const t = rig.turn;
  const o = 2 * t;
  const body =
    'M-12.5,-1 L-11.6,-22.5 Q-11.2,-28.6 -5.5,-28.9 L5.5,-28.9 ' +
    'Q11.2,-28.6 11.6,-22.5 L12.5,-1 Q12.8,3.6 7,3.6 L-7,3.6 Q-12.8,3.6 -12.5,-1 Z';
  const back =
    'M-12.5,-1 L-11.6,-22.5 Q-11.2,-28.6 -5.5,-28.9 L-3.8,-28.9 ' +
    'Q-8.4,-19 -7.4,3.6 L-7,3.6 Q-12.8,3.6 -12.5,-1 Z';
  const parts = [
    `<path d="${body}" fill="${p.shirt}"/>`,
    t > 0.05 && !p.xray
      ? `<path d="${back}" fill="${p.shirtShade}" opacity="${num(0.4 + 0.6 * t)}"/>`
      : '',
    `<path d="${body}" fill="none" stroke="${p.line}" stroke-width="${OW}" stroke-linejoin="round"/>`,
    `<path d="M${num(o - 4.4)},-28.8 Q${num(o)},-23.2 ${num(o + 4.4)},-28.8 Z" fill="${p.skin}" stroke="${p.line}" stroke-width="${OW}" stroke-linejoin="round"/>`,
  ];
  if (p.xray) {
    parts.push(ribs(o));
  } else {
    // A lanyard and badge: reads as "office worker" even at 80 px.
    parts.push(
      `<path d="M${num(o - 3.2)},-27.4 L${num(o + 0.6)},-13.5 L${num(o + 3.6)},-27.4" fill="none" stroke="${shade(p.shirt, -0.45)}" stroke-width="0.9"/>`,
      `<rect x="${num(o - 2.3)}" y="-14" width="5.8" height="7" rx="1" fill="#fbfbf7" stroke="${p.line}" stroke-width="0.9"/>`,
      `<rect x="${num(o - 1.3)}" y="-12.6" width="3.8" height="1.6" fill="${shade(p.shirt, -0.2)}"/>`,
    );
  }
  return parts.join('');
}

function ribs(o: number): string {
  const rib = (y: number, w: number): string =>
    `<path d="M${num(o - w)},${y + 2} Q${num(o)},${y - 1.5} ${num(o + w)},${y + 2}" fill="none" stroke="${BONE}" stroke-width="1.5" stroke-linecap="round"/>`;
  return (
    `<path d="M${num(o)},-26 L${num(o)},-2" stroke="${BONE}" stroke-width="2" stroke-linecap="round"/>` +
    rib(-24, 7) +
    rib(-20, 7.5) +
    rib(-16, 8) +
    rib(-12, 7.5) +
    rib(-7.5, 6) +
    `<path d="M${num(o - 6)},1 Q${num(o)},-3.5 ${num(o + 6)},1 Q${num(o)},3.5 ${num(o - 6)},1 Z" fill="${BONE}"/>`
  );
}

// --------------------------------------------------------------------- hair

interface HairParts {
  back: string;
  front: string;
}

function hairPath(d: string, p: Paint, extra = ''): string {
  return `<path d="${d}" fill="${p.hair}" stroke="${p.line}" stroke-width="${OW}" stroke-linejoin="round" ${extra}/>`;
}

/** A cloud of circles with one outline around the outside. */
function puffs(circles: Array<[number, number, number]>, fill: string, line: string): string {
  const outline = circles
    .map(([x, y, r]) => `<circle cx="${num(x)}" cy="${num(y)}" r="${num(r + OW)}" fill="${line}"/>`)
    .join('');
  const body = circles
    .map(([x, y, r]) => `<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}" fill="${fill}"/>`)
    .join('');
  return outline + body;
}

function hairFor(style: HairStyle, t: number, p: Paint): HairParts {
  const o = 2 * t;
  switch (style) {
    case 'short':
      return {
        back: '',
        front: hairPath(
          `M-17.4,4 C-19,-10 -10,-18.8 ${num(1 + o)},-18.6 C${num(12 + o)},-18.4 19,-11.5 17.8,-2 ` +
            `C15.6,-6.4 ${num(12 + o)},-8.2 ${num(7 + o)},-8 C${num(4.5 + o)},-5.6 ${num(o - 0.5)},-5.4 ${num(o - 4)},-7.2 ` +
            `C${num(o - 8)},-6 -11,-3.4 -12.6,0.6 L-13.6,5.5 Z`,
          p,
        ),
      };
    case 'long':
      return {
        back: hairPath(
          `M${num(-17 - t)},-8 C${num(-21 - t)},6 ${num(-20 - t)},20 ${num(-16 - t)},27 ` +
            `Q${num(-6 - t)},30.5 ${num(10 - 4 * t)},27 C${num(17 - 6 * t)},20 ${num(19 - 4 * t)},6 ${num(17 - t)},-8 Z`,
          p,
        ),
        front: hairPath(
          `M-17.6,8 C-19.4,-10 -9.5,-19 ${num(1.5 + o)},-18.8 C${num(12.5 + o)},-18.5 19.5,-11 18.2,0 ` +
            `C17.6,4 ${num(17.2 - t)},9 ${num(15.6 - t)},12 C${num(14 - t)},6 ${num(13.6 - t)},0 ${num(12.4 - t * 0.5)},-4 ` +
            `C${num(8 + o)},-8.4 ${num(o - 2)},-8.6 ${num(o - 8)},-5.4 C-12,-3 -13.4,2 -14,8 Z`,
          p,
        ),
      };
    case 'bun':
      return {
        back: '',
        front:
          puffs([[-6 - t, -19.5, 7]], p.hair, p.line) +
          `<path d="M${num(-11.8 - t)},-15.8 Q${num(-6 - t)},-12.2 ${num(-0.4 - t)},-15.8" fill="none" stroke="${p.hairShade}" stroke-width="2.2" stroke-linecap="round"/>` +
          hairPath(
            `M-17.4,2.5 C-18.4,-10 -10,-18.6 ${num(1 + o)},-18.4 C${num(11 + o)},-18.2 18.4,-10.5 17.6,-2 ` +
              `C${num(13 + o * 0.5)},-9 ${num(6 + o)},-11.2 ${num(o)},-10.8 C-6.5,-10.4 -12,-6.5 -14.5,0 Z`,
            p,
          ),
      };
    case 'bald': {
      const fringe = (x: number, flip: number): string =>
        hairPath(
          `M${num(x)},-3 C${num(x - 1.6 * flip)},3 ${num(x - 0.2 * flip)},8.5 ${num(x + 3 * flip)},11 ` +
            `L${num(x + 4.4 * flip)},6 C${num(x + 2.8 * flip)},3 ${num(x + 2.4 * flip)},0 ${num(x + 3 * flip)},-3.6 Z`,
          p,
        );
      const sides = t > 0.4 ? fringe(-17, 1) : fringe(-17, 1) + fringe(17, -1);
      return {
        back: '',
        front:
          sides +
          (p.xray
            ? ''
            : `<ellipse cx="${num(-3 + o)}" cy="-11.5" rx="5.5" ry="2.4" fill="#ffffff" opacity="0.4" transform="rotate(-18 ${num(-3 + o)} -11.5)"/>`),
      };
    }
    case 'mohawk':
      return {
        back: '',
        front:
          `<path d="M-17.2,3 C-18.4,-10 -10,-18.4 ${num(1 + o)},-18.2 C${num(11 + o)},-18 18.4,-10.5 17.6,-2 C12,-10 -10,-11 -17.2,3 Z" fill="${p.hair}" opacity="0.28"/>` +
          hairPath(
            `M${num(o - 10)},-13.5 L${num(o - 12.5)},-25 L${num(o - 5)},-18.4 L${num(o - 3.5)},-30.5 ` +
              `L${num(o + 1.5)},-19.6 L${num(o + 6)},-29 L${num(o + 7.2)},-17.6 L${num(o + 13)},-23 ` +
              `L${num(o + 11.5)},-12 C${num(o + 5)},-17.6 ${num(o - 3.5)},-17.6 ${num(o - 10)},-13.5 Z`,
            p,
          ),
      };
    case 'curly':
      return {
        back: puffs(
          [
            [-17, 6, 5.5],
            [-18.6, -2, 5.8],
          ],
          p.hair,
          p.line,
        ),
        front: puffs(
          [
            [-17.6, -3, 5.6],
            [-15.8, -10, 6],
            [-10.5, -15.5, 6.2],
            [-3.2 + o, -18.4, 6.2],
            [4.4 + o, -18.2, 6],
            [11 + o * 0.6, -14.6, 5.8],
            [15.6 + o * 0.3, -9.2, 5.2],
            [17.4, -3, 4.2],
          ],
          p.hair,
          p.line,
        ),
      };
  }
}

function hairOnEndSpikes(p: Paint, t: number): string {
  const o = 2 * t;
  let d = '';
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = ((-168 + (156 * i) / (n - 1)) * Math.PI) / 180;
    const base = 13;
    const tip = 31 + (i % 2) * 5;
    const spread = 0.2;
    const b1 = pt(o + Math.cos(a - spread) * base, Math.sin(a - spread) * base * 0.95);
    const b2 = pt(o + Math.cos(a + spread) * base, Math.sin(a + spread) * base * 0.95);
    const tp = pt(o + Math.cos(a) * tip, Math.sin(a) * tip * 0.95);
    d += `M${num(b1.x)},${num(b1.y)} L${num(tp.x)},${num(tp.y)} L${num(b2.x)},${num(b2.y)} Z `;
  }
  return (
    `<path d="${d}" fill="${p.hair}" stroke="${p.line}" stroke-width="${OW}" stroke-linejoin="round"/>` +
    `<ellipse cx="${num(o)}" cy="-9" rx="15.6" ry="9" fill="${p.hair}"/>`
  );
}

/**
 * Bed-head spikes poking out of the hair for low sanity. Drawn before the
 * hair so the hair hides their bases.
 */
function messySpikes(p: Paint, t: number): string {
  const o = 2 * t;
  const spikes: Array<[number, number]> = [
    [-150, 24],
    [-108, 27],
    [-66, 25.5],
    [-26, 23],
  ];
  let d = '';
  for (const [deg, len] of spikes) {
    const a = (deg * Math.PI) / 180;
    const w = 0.3;
    const b1 = pt(o + Math.cos(a - w) * 14, Math.sin(a - w) * 13);
    const b2 = pt(o + Math.cos(a + w) * 14, Math.sin(a + w) * 13);
    const tip = pt(o + Math.cos(a) * len, Math.sin(a) * len * 0.92);
    d += `M${num(b1.x)},${num(b1.y)} L${num(tip.x)},${num(tip.y)} L${num(b2.x)},${num(b2.y)} Z `;
  }
  return `<path d="${d}" fill="${p.hair}" stroke="${p.line}" stroke-width="${OW}" stroke-linejoin="round"/>`;
}

/** Two frazzled strands, for bald heads where spikes would look odd. */
function strays(p: Paint, t: number): string {
  const o = 2 * t;
  const tuft = (x: number, y: number, dir: number): string => {
    const d = `M${num(x)},${num(y)} l${num(1.2 * dir)},-3.5 l${num(1.1 * dir)},2 l${num(1.4 * dir)},-4`;
    return (
      `<path d="${d}" fill="none" stroke="${p.line}" stroke-width="${OW + 1.6}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="${p.hair}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  };
  return tuft(o - 8, -14.5, -1) + tuft(o + 4, -15.8, 1);
}

// --------------------------------------------------------------------- face

interface EyeSpot {
  x: number;
  y: number;
  sx: number;
}

function eyesFor(t: number): { near: EyeSpot; far: EyeSpot } {
  return {
    near: { x: 6.5 + 4 * t, y: 1.5, sx: 1 },
    far: { x: -6.5 + 6 * t, y: 1.5, sx: 1 - 0.2 * t },
  };
}

function eyeOpen(
  e: EyeSpot,
  rx: number,
  ry: number,
  pupil: number,
  gaze: Pt,
  p: Paint,
): string {
  const w = rx * e.sx;
  return (
    `<ellipse cx="${num(e.x)}" cy="${num(e.y)}" rx="${num(w)}" ry="${num(ry)}" fill="#ffffff" stroke="${p.line}" stroke-width="1.2"/>` +
    `<circle cx="${num(e.x + gaze.x)}" cy="${num(e.y + gaze.y)}" r="${num(pupil)}" fill="${p.line}"/>` +
    `<circle cx="${num(e.x + gaze.x - pupil * 0.38)}" cy="${num(e.y + gaze.y - pupil * 0.42)}" r="${num(Math.max(0.6, pupil * 0.36))}" fill="#ffffff"/>`
  );
}

/** A skin-coloured lid over the top of an eye, rotated for angry/sad. */
function lid(e: EyeSpot, rx: number, ry: number, drop: number, tiltDeg: number, p: Paint): string {
  const w = rx * e.sx + 0.8;
  const h = ry + 0.8;
  const d = `M${num(-w)},${num(drop)} A${num(w)},${num(h)} 0 0 1 ${num(w)},${num(drop)} Z`;
  return (
    `<g transform="translate(${num(e.x)} ${num(e.y)}) rotate(${num(tiltDeg)})">` +
    `<path d="${d}" fill="${p.skin}"/>` +
    `<path d="M${num(-w + 0.6)},${num(drop)} L${num(w - 0.6)},${num(drop)}" stroke="${p.line}" stroke-width="1.3" stroke-linecap="round"/>` +
    `</g>`
  );
}

function closedEye(e: EyeSpot, p: Paint, happy: boolean): string {
  const w = 4 * e.sx;
  const d = happy
    ? `M${num(e.x - w)},${num(e.y + 1)} Q${num(e.x)},${num(e.y - 4)} ${num(e.x + w)},${num(e.y + 1)}`
    : `M${num(e.x - w)},${num(e.y)} Q${num(e.x)},${num(e.y + 3.6)} ${num(e.x + w)},${num(e.y)}`;
  return `<path d="${d}" fill="none" stroke="${p.line}" stroke-width="1.6" stroke-linecap="round"/>`;
}

function spiralEye(e: EyeSpot, p: Paint): string {
  const w = 4.6 * e.sx;
  let d = '';
  for (let i = 0; i <= 28; i++) {
    const a = i * 0.5;
    const r = 0.25 + i * 0.14;
    d += `${i === 0 ? 'M' : 'L'}${num(Math.cos(a) * r * e.sx)},${num(Math.sin(a) * r)} `;
  }
  return (
    `<ellipse cx="${num(e.x)}" cy="${num(e.y)}" rx="${num(w)}" ry="5.3" fill="#ffffff" stroke="${p.line}" stroke-width="1.2"/>` +
    `<g transform="translate(${num(e.x)} ${num(e.y)})"><g class="p-spin">` +
    `<path d="${d}" fill="none" stroke="${p.line}" stroke-width="1.1" stroke-linecap="round"/>` +
    `</g></g>`
  );
}

function brow(e: EyeSpot, lift: number, tilt: number, inner: 1 | -1, p: Paint): string {
  // `tilt` raises the inner end (towards the nose) when positive.
  const half = 2.9 * e.sx + 0.4;
  const y = e.y - 7.2 - lift;
  const innerX = e.x + inner * half;
  const outerX = e.x - inner * half;
  return `<path d="M${num(outerX)},${num(y + tilt * 0.5)} L${num(innerX)},${num(y - tilt * 0.5)}" stroke="${p.brow}" stroke-width="1.8" stroke-linecap="round"/>`;
}

function mouthFor(expr: Expression, m: Pt, p: Paint): string {
  const { x, y } = m;
  const dark = '#5b2333';
  const tongue = '#f07a8a';
  const stroke = `stroke="${p.line}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"`;
  switch (expr) {
    case 'happy':
      return (
        `<path d="M${num(x - 4.6)},${num(y - 1)} Q${num(x)},${num(y - 0.2)} ${num(x + 4.6)},${num(y - 1)} Q${num(x + 4)},${num(y + 5.6)} ${num(x)},${num(y + 5.6)} Q${num(x - 4)},${num(y + 5.6)} ${num(x - 4.6)},${num(y - 1)} Z" fill="${dark}" ${stroke}/>` +
        `<path d="M${num(x - 2.4)},${num(y + 4.4)} Q${num(x)},${num(y + 2)} ${num(x + 2.4)},${num(y + 4.4)} Q${num(x)},${num(y + 5.6)} ${num(x - 2.4)},${num(y + 4.4)} Z" fill="${tongue}"/>`
      );
    case 'neutral':
      return `<path d="M${num(x - 3.4)},${num(y + 0.4)} Q${num(x)},${num(y + 2.2)} ${num(x + 3.4)},${num(y + 0.4)}" fill="none" ${stroke}/>`;
    case 'tired':
      return `<path d="M${num(x - 3)},${num(y + 1)} Q${num(x)},${num(y + 0.2)} ${num(x + 3)},${num(y + 1.2)}" fill="none" ${stroke}/>`;
    case 'sad':
      return `<path d="M${num(x - 3.8)},${num(y + 2.6)} Q${num(x)},${num(y - 1.4)} ${num(x + 3.8)},${num(y + 2.6)}" fill="none" ${stroke}/>`;
    case 'angry':
      return (
        `<path d="M${num(x - 4.6)},${num(y + 3.6)} Q${num(x)},${num(y - 1.4)} ${num(x + 4.6)},${num(y + 3.6)} Z" fill="#ffffff" ${stroke}/>` +
        `<path d="M${num(x - 3.4)},${num(y + 2.3)} L${num(x + 3.4)},${num(y + 2.3)}" stroke="${p.line}" stroke-width="0.8"/>`
      );
    case 'scared':
      return `<path d="M${num(x - 4)},${num(y + 1.4)} q1,-1.6 2,0 t2,0 t2,0 t2,0" fill="none" ${stroke}/>`;
    case 'crazy':
      return (
        `<path d="M${num(x - 5.6)},${num(y - 1.6)} Q${num(x)},${num(y)} ${num(x + 5.6)},${num(y - 2.2)} Q${num(x + 4.6)},${num(y + 6)} ${num(x)},${num(y + 6)} Q${num(x - 4.8)},${num(y + 6)} ${num(x - 5.6)},${num(y - 1.6)} Z" fill="${dark}" ${stroke}/>` +
        `<path d="M${num(x - 4.6)},${num(y - 0.9)} L${num(x + 4.6)},${num(y - 1.4)} L${num(x + 4.2)},${num(y + 1.2)} L${num(x - 4.2)},${num(y + 1.4)} Z" fill="#ffffff"/>`
      );
    case 'asleep':
      return `<ellipse cx="${num(x)}" cy="${num(y + 1.5)}" rx="1.7" ry="2.1" fill="${dark}" ${stroke}/>`;
    case 'shocked':
      return (
        `<ellipse cx="${num(x)}" cy="${num(y + 2)}" rx="3.6" ry="4.6" fill="${dark}" ${stroke}/>` +
        `<ellipse cx="${num(x)}" cy="${num(y + 4.4)}" rx="2.2" ry="1.4" fill="${tongue}"/>`
      );
  }
}

function eyesAndBrows(expr: Expression, t: number, crazed: boolean, p: Paint): string {
  const { near, far } = eyesFor(t);
  const gaze = pt(0.9 * t, 0.3);
  const out: string[] = [];
  const both = (fn: (e: EyeSpot, inner: 1 | -1) => string): void => {
    out.push(fn(far, 1), fn(near, -1));
  };
  switch (expr) {
    case 'happy':
      both((e) => eyeOpen(e, 4.3, 5, 2.5, gaze, p));
      both((e, i) => brow(e, 1.2, -0.8, i, p));
      break;
    case 'neutral':
      both((e) => eyeOpen(e, 4.3, 5, 2.4, gaze, p));
      both((e, i) => brow(e, 0.4, 0, i, p));
      break;
    case 'tired':
      both((e) => eyeOpen(e, 4.3, 5, 2.3, pt(gaze.x, 1.4), p) + lid(e, 4.3, 5, 0.6, 0, p));
      both((e) => `<path d="M${num(e.x - 2.8 * e.sx)},${num(e.y + 6.4)} Q${num(e.x)},${num(e.y + 8)} ${num(e.x + 2.8 * e.sx)},${num(e.y + 6.4)}" fill="none" stroke="#8c7aa8" stroke-width="1" stroke-linecap="round" opacity="0.7"/>`);
      both((e, i) => brow(e, -0.6, 0, i, p));
      break;
    case 'sad':
      both((e) => eyeOpen(e, 4.3, 5, 2.4, pt(gaze.x * 0.6, 1.4), p));
      both((e, i) => lid(e, 4.3, 5, -2.6, i === 1 ? -14 : 14, p));
      both((e, i) => brow(e, 0.8, 2.6, i, p));
      break;
    case 'angry':
      both((e) => eyeOpen(e, 4.3, 5, 2.3, gaze, p));
      both((e, i) => lid(e, 4.3, 5, -1.2, i === 1 ? 20 : -20, p));
      both((e, i) => brow(e, -0.8, -3.2, i, p));
      break;
    case 'scared':
      both((e) => eyeOpen(e, 4.8, 5.8, 1.4, pt(gaze.x * 0.5, 0), p));
      both((e, i) => brow(e, 2.6, 2.4, i, p));
      break;
    case 'crazy':
      out.push(spiralEye(far, p), spiralEye(near, p));
      out.push(brow(far, 2.8, 2, 1, p), brow(near, -0.6, -2.6, -1, p));
      break;
    case 'asleep':
      both((e) => closedEye(e, p, false));
      both((e, i) => brow(e, -0.4, 0.4, i, p));
      break;
    case 'shocked':
      both((e) => eyeOpen(e, 5.1, 6.2, 1.7, pt(0, 0), p));
      both((e, i) => brow(e, 3.6, 1, i, p));
      break;
  }
  if (crazed && expr !== 'crazy' && expr !== 'asleep') {
    // One eye flickers smaller now and then; see `.p-eye-twitch` in CSS.
    out.push(
      `<g transform="translate(${num(far.x)} ${num(far.y)})"><g class="p-eye-twitch">` +
        `<ellipse cx="0" cy="0" rx="${num(4.6 * far.sx)}" ry="5.4" fill="#ffffff" stroke="${p.line}" stroke-width="1.2"/>` +
        `<circle cx="${num(gaze.x)}" cy="0" r="1.2" fill="${p.line}"/>` +
        `</g></g>`,
    );
  }
  return out.join('');
}

function glasses(t: number, expr: Expression, p: Paint): string {
  const { near, far } = eyesFor(t);
  const big = expr === 'shocked' || expr === 'scared' ? 0.6 : 0;
  const frame = (e: EyeSpot): string => {
    const w = (5.6 + big) * e.sx;
    return `<rect x="${num(e.x - w)}" y="${num(e.y - 5.2 - big)}" width="${num(w * 2)}" height="${num(9.8 + big * 2)}" rx="3.6" fill="#ffffff" fill-opacity="0.18" stroke="${p.line}" stroke-width="1.35"/>`;
  };
  const bridgeA = far.x + (5.6 + big) * far.sx;
  const bridgeB = near.x - (5.6 + big) * near.sx;
  const temple =
    t > 0.3
      ? `<path d="M${num(far.x - (5.6 + big) * far.sx)},${num(far.y - 1.6)} L${num(-14.5 + 2 * t)},${num(0.4)}" stroke="${p.line}" stroke-width="1.2" stroke-linecap="round"/>`
      : '';
  return (
    frame(far) +
    frame(near) +
    `<path d="M${num(bridgeA)},${num(near.y - 1.4)} Q${num((bridgeA + bridgeB) / 2)},${num(near.y - 2.8)} ${num(bridgeB)},${num(near.y - 1.4)}" fill="none" stroke="${p.line}" stroke-width="1.3"/>` +
    temple
  );
}

function cheeks(expr: Expression, t: number): string {
  const { near, far } = eyesFor(t);
  const tone =
    expr === 'angry' ? '#ff4d4d' : expr === 'tired' || expr === 'scared' ? '' : '#ff8f8f';
  if (!tone) return '';
  const op = expr === 'happy' || expr === 'angry' ? 0.5 : 0.28;
  const one = (e: EyeSpot, dx: number): string =>
    `<ellipse cx="${num(e.x + dx)}" cy="${num(e.y + 6.6)}" rx="${num(3 * e.sx)}" ry="1.7" fill="${tone}" opacity="${op}"/>`;
  return one(far, -1.2) + one(near, 1);
}

function skull(t: number): string {
  const { near, far } = eyesFor(t);
  const o = 2 * t;
  return (
    `<path d="M${num(o - 13)},-1 C${num(o - 14)},-14 ${num(o + 14)},-14 ${num(o + 13)},-1 C${num(o + 13)},5 ${num(o + 9)},6 ${num(o + 8)},10 L${num(o - 8)},10 C${num(o - 9)},6 ${num(o - 13)},5 ${num(o - 13)},-1 Z" fill="${BONE}"/>` +
    `<ellipse cx="${num(far.x)}" cy="${num(far.y)}" rx="${num(3.6 * far.sx)}" ry="4" fill="${XRAY_LINE}"/>` +
    `<ellipse cx="${num(near.x)}" cy="${num(near.y)}" rx="3.6" ry="4" fill="${XRAY_LINE}"/>` +
    `<path d="M${num((near.x + far.x) / 2 - 1.4)},7.4 L${num((near.x + far.x) / 2)},4.6 L${num((near.x + far.x) / 2 + 1.4)},7.4 Z" fill="${XRAY_LINE}"/>` +
    `<path d="M${num(o - 5)},10 L${num(o - 5)},13 L${num(o + 5)},13 L${num(o + 5)},10 M${num(o - 2.5)},10 L${num(o - 2.5)},13 M${num(o)},10 L${num(o)},13 M${num(o + 2.5)},10 L${num(o + 2.5)},13" fill="${BONE}" stroke="${XRAY_LINE}" stroke-width="0.7"/>`
  );
}

function ears(t: number, p: Paint): string {
  const one = (x: number): string =>
    `<ellipse cx="${num(x)}" cy="3" rx="3.4" ry="4.4" fill="${p.skin}" stroke="${p.line}" stroke-width="${OW}"/>` +
    (p.xray
      ? ''
      : `<path d="M${num(x - 0.8)},1 Q${num(x + 0.9)},3 ${num(x - 0.6)},5.2" fill="none" stroke="${p.skinShade}" stroke-width="1.1" stroke-linecap="round"/>`);
  if (t > 0.5) return one(-15.6 + 2.4 * t);
  return one(-16.6) + one(16.6);
}

function head(look: Look, opts: PersonOptions, rig: Rig, p: Paint): { back: string; front: string } {
  const t = rig.turn;
  const style: HairStyle = opts.hairOnEnd && look.hairStyle === 'bald' ? 'short' : look.hairStyle;
  const hair = hairFor(style, t, p);
  const face = p.xray
    ? skull(t)
    : cheeks(opts.expression, t) +
      eyesAndBrows(opts.expression, t, !!opts.crazed, p) +
      (look.glasses ? glasses(t, opts.expression, p) : '') +
      mouthFor(opts.expression, pt(0.5 + 2.8 * t, 9.5), p);
  const messy = !!opts.crazed && !opts.hairOnEnd && !p.xray;
  const swirl =
    opts.crazed && !p.xray
      ? `<path d="M${num(14 + 2 * t)},-24 m0,0 a2,2 0 1,1 2.6,1.6 a3.4,3.4 0 1,1 -4.6,-3.6 a5,5 0 1,1 6.6,4.8" fill="none" stroke="#9b6bd8" stroke-width="1.4" stroke-linecap="round"/>`
      : '';
  const front =
    ears(t, p) +
    `<ellipse cx="0" cy="0" rx="${HEAD_RX}" ry="${HEAD_RY}" fill="${p.skin}" stroke="${p.line}" stroke-width="${OW}"/>` +
    face +
    (opts.hairOnEnd ? hairOnEndSpikes(p, t) : '') +
    (messy && style !== 'bald' ? messySpikes(p, t) : '') +
    (p.xray && look.hairStyle === 'bald' ? '' : hair.front) +
    (messy && style === 'bald' ? strays(p, t) : '') +
    swirl;
  return { back: hair.back, front };
}

// -------------------------------------------------------------------- props

function phone(at: Pt): string {
  // A light case and a glowing screen so it reads against any shirt.
  return (
    `<g transform="translate(${num(at.x + 1)} ${num(at.y - 2)}) rotate(-28)">` +
    `<rect x="-4" y="-7.5" width="8" height="13" rx="1.8" fill="#f4f1fa" stroke="${LINE}" stroke-width="1.3"/>` +
    `<rect x="-2.8" y="-6" width="5.6" height="9.4" rx="0.9" fill="#7fe0ff"/>` +
    `<path d="M-1.6,-3.6 L1.6,-3.6 M-1.6,-1.6 L0.8,-1.6 M-1.6,0.4 L1.4,0.4" stroke="#ffffff" stroke-width="0.8" stroke-linecap="round"/>` +
    `</g>`
  );
}

function mug(at: Pt, tilt: number): string {
  return (
    `<g transform="translate(${num(at.x)} ${num(at.y)}) rotate(${tilt})">` +
    `<path d="M3.6,-2.6 q4.4,0 4.4,3.2 q0,3.2 -4.4,3" fill="none" stroke="${LINE}" stroke-width="3.6"/>` +
    `<path d="M3.6,-2.6 q4.4,0 4.4,3.2 q0,3.2 -4.4,3" fill="none" stroke="#ffffff" stroke-width="1.6"/>` +
    `<rect x="-4.6" y="-5.2" width="9.2" height="10.4" rx="1.8" fill="#ffffff" stroke="${LINE}" stroke-width="1.3"/>` +
    `<rect x="-3.9" y="-0.8" width="7.8" height="2.4" fill="#e9573f"/>` +
    `<g class="p-steam">` +
    `<path d="M-1.8,-8 q-2,-3 0,-6 q2,-3 0,-6" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.85"/>` +
    `<path d="M2.2,-9 q-2,-3 0,-6" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>` +
    `</g></g>`
  );
}

function box(at: Pt): string {
  const leaf = (d: string): string =>
    `<path d="${d}" fill="#4cae5b" stroke="${LINE}" stroke-width="1.2" stroke-linejoin="round"/>`;
  return (
    `<g transform="translate(${num(at.x)} ${num(at.y)})">` +
    `<rect x="11" y="-15" width="7" height="6" rx="1" fill="#d9663f" stroke="${LINE}" stroke-width="1.2"/>` +
    leaf('M14.5,-14 C10,-18 9,-24 11,-28 C15,-25 16,-19 14.5,-14 Z') +
    leaf('M14.5,-14 C17,-20 22,-23 26,-22 C24,-17 19,-14 14.5,-14 Z') +
    leaf('M14.5,-14 C13,-21 16,-28 20,-31 C21,-25 18,-18 14.5,-14 Z') +
    `<rect x="-2" y="-12" width="5.6" height="6" rx="1" fill="#ffffff" stroke="${LINE}" stroke-width="1.1"/>` +
    `<path d="M-6,-10 L26,-10 L24,10 L-4,10 Z" fill="#cf9a5c" stroke="${LINE}" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M-6,-10 L-9,-14 L4,-14 L6,-10 Z M26,-10 L29,-14 L16,-14 L14,-10 Z" fill="#e0b57c" stroke="${LINE}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M3,-2 L17,-2" stroke="#9c6d37" stroke-width="1.4" stroke-linecap="round"/>` +
    `</g>`
  );
}

// ---------------------------------------------------------------- assembly

/**
 * Draw the character as a `<g>` in person space (feet on y = 0, facing
 * right). The root group carries `pose-*`, `arms-*` and `expr-*` classes so
 * stylesheets can animate it.
 */
export function personGroup(look: Look, opts: PersonOptions): string {
  const rig = rigFor(opts.pose);
  const armsKind = opts.arms ?? DEFAULT_ARMS[opts.pose];
  const p = paintFor(look, !!opts.skeleton);
  const s = shoulders(rig);
  const a = armsFor(armsKind, rig);
  const fist = armsKind === 'fists';
  const hl = headLocal(rig);
  const h = head(look, opts, rig, p);
  const upperT = `translate(${num(rig.hip.x)} ${num(rig.hip.y)}) rotate(${num(rig.lean)})`;
  const headT = `translate(${num(hl.x)} ${num(hl.y)}) rotate(${num(rig.headTilt)})`;

  const nearHand = a.near[1];
  const farHand = a.far[1];
  let heldBehind = '';
  let heldFront = '';
  if (armsKind === 'phone') heldBehind = phone(lerp(nearHand, farHand, 0.5));
  if (armsKind === 'mug') heldFront = mug(add(nearHand, pt(1.5, -1)), -22);
  if (armsKind === 'box') heldBehind = box(add(s.near, pt(4, 15)));

  const underHead = armsKind === 'fold';
  // Facing the viewer both arms are in front of the body, or one sleeve
  // would look puffed and the other missing.
  const farInFront = rig.turn < 0.5;
  const farArm = arm(s.far, a.far, 'p-arm-far', fist, p);
  const nearArm = arm(s.near, a.near, 'p-arm-near', fist, p);
  const cls = [
    'person',
    `pose-${opts.pose}`,
    `arms-${armsKind}`,
    `expr-${opts.expression}`,
    opts.crazed ? 'crazed' : '',
    opts.skeleton ? 'xray' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    `<g class="${cls}">` +
    `<g class="p-bob">` +
    `<g transform="${upperT}"><g transform="${headT}">${h.back}</g></g>` +
    (farInFront ? '' : farArm) +
    `</g>` +
    legs(rig, p) +
    `<g class="p-bob">` +
    `<g transform="${upperT}">${torso(rig, p)}</g>` +
    (farInFront ? farArm : '') +
    // Asleep, the head rests on the arm, so the arm goes underneath it.
    (underHead ? nearArm : '') +
    `<g transform="${upperT}"><g transform="${headT}"><g class="p-head">${h.front}</g></g></g>` +
    heldBehind +
    (underHead ? '' : nearArm) +
    heldFront +
    `</g>` +
    `</g>`
  );
}

function chairFor(): string {
  return (
    `<rect x="-17" y="${SEAT_Y - 1}" width="34" height="6" rx="3" fill="#4b5878" stroke="${LINE}" stroke-width="1.4"/>` +
    `<rect x="-2" y="${SEAT_Y + 5}" width="4" height="11" fill="#8a93a6" stroke="${LINE}" stroke-width="1.2"/>` +
    `<rect x="-15" y="-4.5" width="30" height="3" rx="1.5" fill="#353d55" stroke="${LINE}" stroke-width="1.2"/>`
  );
}

function viewBoxFor(opts: PersonSvgOptions): [number, number, number, number] {
  if (opts.crop === 'bust') {
    const hd = personHead(opts.pose);
    return [hd.x - 28, hd.y - 30, 56, 58];
  }
  const top = opts.hairOnEnd ? -118 : -100;
  if (opts.pose === 'sit-slump') return [-36, top + 14, 94, -top - 12];
  if (opts.pose.startsWith('sit')) return [-36, top + 6, 76, -top - 4];
  return [-38, top - 4, 76, -top + 6];
}

/**
 * Standalone `<svg>` markup of the character, for portraits (hiring cards,
 * staff file). Seated poses get a simple stool so they don't float.
 */
export function personSvg(look: Look, opts: PersonSvgOptions): string {
  const [x, y, w, h] = viewBoxFor(opts);
  const size = opts.size ?? 96;
  const width = (size * w) / h;
  const seat = opts.pose.startsWith('sit') && opts.crop !== 'bust' ? chairFor() : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}" width="${num(width)}" height="${num(size)}" role="img" aria-label="${esc('Worker portrait')}">` +
    seat +
    personGroup(look, opts) +
    `</svg>`
  );
}
