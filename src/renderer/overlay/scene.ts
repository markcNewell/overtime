/**
 * The static corner scene: floor, coffee station, chair, desk and monitor.
 *
 * Built once as one SVG string. Everything that changes later is reached by
 * id or class and updated in place by `view.ts`, so a state broadcast every
 * five seconds only flips a few attributes.
 */

import { num } from '../shared/svg';

export const SCENE_W = 380;
export const SCENE_H = 320;
/** Where feet touch the floor strip. */
export const FLOOR_Y = 300;
/** Worker x (hip centre) when seated at the desk. */
export const SEAT_X = 200;
/** Worker x when standing at the coffee machine. */
export const COFFEE_X = 92;
export const OFF_LEFT = -70;
export const OFF_RIGHT = 450;
/** Monitor screen centre; the screen is drawn around it, skewed slightly. */
/** Top surface of the desk and the coffee counter. */
const TOP = 262;
const SCREEN_X = 298;
const SCREEN_Y = TOP - 27.5;
/** Inner screen size in screen-local units. */
export const SCREEN_W = 65;
export const SCREEN_H = 37;
export const PROGRESS_W = 56;

const LINE = '#2a2238';
const FONT =
  "ui-rounded, 'Arial Rounded MT Bold', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif";

const stroke = (w = 1.5): string =>
  `stroke="${LINE}" stroke-width="${w}" stroke-linejoin="round"`;

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  extra = '',
): string {
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${fill}" ${extra}/>`;
}

function floor(): string {
  return (
    `<ellipse cx="190" cy="305" rx="184" ry="9" fill="#000000" opacity="0.18"/>` +
    rect(6, 297, 368, 15, '#bfa98f', `rx="7.5" ${stroke()}`) +
    rect(8.5, 298.5, 363, 5.5, '#d8c7b1', 'rx="2.75"') +
    `<path d="M40,306 L60,306 M120,307 L150,307 M250,306.5 L270,306.5 M320,307 L345,307" stroke="#a8927a" stroke-width="1.2" stroke-linecap="round"/>`
  );
}

function coffeeMachine(): string {
  const y = TOP - 55;
  return (
    // Body and water tank.
    rect(22, y + 7, 44, 49, '#3b3d4f', `rx="6" ${stroke()}`) +
    rect(24.5, y, 39, 10, '#5a5e76', `rx="3.5" ${stroke(1.3)}`) +
    rect(30, y + 2.5, 12, 4, '#9fd4ef', 'rx="1.5" opacity="0.8"') +
    // Control panel with the status light.
    rect(27, y + 12, 34, 12, '#e2574c', `rx="2.5" ${stroke(1.2)}`) +
    `<circle cx="33" cy="${y + 18}" r="2" fill="#ffd5c9" ${stroke(0.9)}/>` +
    `<circle cx="40" cy="${y + 18}" r="2" fill="#ffd5c9" ${stroke(0.9)}/>` +
    `<circle id="coffee-light" cx="54.5" cy="${y + 18}" r="2.8" fill="#5ce07a" ${stroke(1)}/>` +
    // Spout and drip tray.
    rect(39, y + 26, 10, 6, '#b8c2cc', `rx="1.5" ${stroke(1.2)}`) +
    rect(42.5, y + 32, 3, 3, '#8d94a3') +
    rect(30, y + 48, 28, 5, '#8d94a3', `rx="1.5" ${stroke(1.2)}`) +
    `<g id="coffee-steam" class="steam">` +
    `<path d="M36,${y - 4} q-3,-4 0,-8 q3,-4 0,-8" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M45,${y - 6} q-3,-4 0,-8 q3,-4 0,-8" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M54,${y - 4} q-3,-4 0,-8" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>` +
    `</g>`
  );
}

function counterTop(): string {
  const cup = (x: number, y: number): string =>
    `<path d="M${x},${y} L${x + 11},${y} L${x + 9.5},${y + 8} L${x + 1.5},${y + 8} Z" fill="#f4efe6" ${stroke(1.2)}/>`;
  const y = TOP - 23;
  return (
    // Paper cups and a sugar jar so the counter reads as a coffee corner.
    cup(70, y) +
    cup(70, y + 6) +
    cup(70, y + 12) +
    rect(84, y + 6, 14, 17, '#cfe8f2', `rx="3" ${stroke(1.2)}`) +
    rect(83, y + 2, 16, 5, '#e2574c', `rx="2" ${stroke(1.2)}`) +
    rect(86, y + 12, 10, 8, '#ffffff', 'rx="1.5" opacity="0.9"')
  );
}

function counter(): string {
  const base = TOP + 6.5;
  const h = 298 - base;
  return (
    `<g id="coffee-station">` +
    rect(16, base, 92, h, '#5fa39b', stroke()) +
    rect(20.5, base + 4, 38, h - 8, '#6fb6ad', `rx="2" ${stroke(1.2)}`) +
    rect(64.5, base + 4, 39, h - 8, '#6fb6ad', `rx="2" ${stroke(1.2)}`) +
    rect(53, base + h / 2 - 4.5, 2.6, 9, '#2a2238', 'rx="1.3"') +
    rect(68.5, base + h / 2 - 4.5, 2.6, 9, '#2a2238', 'rx="1.3"') +
    rect(12, TOP - 0.5, 100, 8, '#efe7d8', `rx="2.5" ${stroke()}`) +
    coffeeMachine() +
    counterTop() +
    `</g>`
  );
}

function chair(): string {
  return (
    `<g id="chair">` +
    `<path d="M186,272 L192,281" stroke="#353d55" stroke-width="4" stroke-linecap="round"/>` +
    `<rect x="176" y="232" width="13" height="43" rx="6" fill="#4b5878" ${stroke()} transform="rotate(-6 182 274)"/>` +
    `<rect x="179.5" y="236" width="4" height="30" rx="2" fill="#5d6b8f" transform="rotate(-6 182 274)"/>` +
    rect(180, 278.5, 37, 7, '#4b5878', `rx="3.5" ${stroke()}`) +
    rect(196, 285, 5, 8, '#8a93a6', stroke(1.2)) +
    rect(182, 292, 34, 3.6, '#353d55', `rx="1.8" ${stroke(1.2)}`) +
    `<circle cx="185" cy="297.4" r="2.4" fill="#2a2238"/>` +
    `<circle cx="199" cy="297.4" r="2.4" fill="#2a2238"/>` +
    `<circle cx="213" cy="297.4" r="2.4" fill="#2a2238"/>` +
    `</g>`
  );
}

function hiringSign(): string {
  return (
    `<g id="hiring-sign" class="hit" data-hit="hiring" data-tip="Nobody works here yet. Click to hire someone.">` +
    `<g transform="rotate(-5 198 256)">` +
    rect(170, 239, 56, 34, '#e9c992', `rx="2" ${stroke()}`) +
    rect(173, 242, 50, 28, 'none', `rx="1.5" stroke="#c9a46a" stroke-width="1" stroke-dasharray="2 2"`) +
    `<text x="198" y="253" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="800" fill="#d64545">NOW</text>` +
    `<text x="198" y="265" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="800" fill="#d64545">HIRING</text>` +
    rect(190, 235.5, 16, 6, '#f6f1d0', 'opacity="0.85" transform="rotate(4 198 238)"') +
    `</g></g>`
  );
}

function deskBody(): string {
  const legTop = TOP + 6.5;
  const drawer = (y: number): string =>
    rect(322, y, 42, 10.5, '#c98d5b', `rx="1.5" ${stroke(1.2)}`) +
    rect(338.5, y + 4, 9, 2.6, '#7a4d2c', 'rx="1.3"');
  return (
    `<g id="desk-body">` +
    rect(222, legTop + 1, 98, 17, '#9a6440', stroke(1.2)) +
    rect(215, legTop, 7.5, 298 - legTop, '#b47a4c', `rx="1.5" ${stroke()}`) +
    rect(318, legTop, 50, 298 - legTop, '#b47a4c', `rx="1.5" ${stroke()}`) +
    drawer(legTop + 3.5) +
    drawer(legTop + 16) +
    rect(210, TOP - 0.5, 164, 8, '#d39462', `rx="2.5" ${stroke()}`) +
    rect(213, TOP + 1, 158, 1.6, '#e8b585', 'rx="0.8"') +
    `</g>`
  );
}

function keyboard(): string {
  let keys = '';
  for (let i = 0; i < 7; i++) {
    keys += rect(219 + i * 4.4, TOP - 3.2, 3.2, 1.6, '#b9b6c9', 'rx="0.5"');
  }
  return (
    `<g id="keyboard">` +
    `<path d="M215,${TOP} L217.5,${TOP - 4.5} L250.5,${TOP - 4.5} L253,${TOP} Z" fill="#e8e6f0" ${stroke(1.2)}/>` +
    keys +
    `<ellipse cx="260" cy="${TOP - 1.6}" rx="3.6" ry="2" fill="#e8e6f0" ${stroke(1.1)}/>` +
    `</g>`
  );
}

/** Coloured bars that look like syntax-highlighted code at this size. */
function codeLines(): string {
  const colours = ['#7ad7f0', '#f7c873', '#e98bb0', '#9be37a', '#c3b7ff', '#ffffff'];
  // Deterministic pseudo-random so every build draws the same code.
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  let out = '';
  const rows = 12;
  for (let copy = 0; copy < 2; copy++) {
    let indent = 0;
    for (let r = 0; r < rows; r++) {
      const y = copy * rows * 4 + r * 4;
      indent = Math.max(0, Math.min(3, indent + (rnd() < 0.3 ? 1 : rnd() < 0.3 ? -1 : 0)));
      let x = -28 + indent * 5;
      const words = 1 + Math.floor(rnd() * 3);
      for (let w = 0; w < words && x < 24; w++) {
        const len = 4 + rnd() * 14;
        const colour = colours[Math.floor(rnd() * colours.length)] ?? '#ffffff';
        out += rect(x, y, Math.min(len, 28 - x), 2, colour, 'rx="1" opacity="0.9"');
        x += len + 2.5;
      }
    }
  }
  return `<g class="code-scroll">${out}</g>`;
}

function screenContent(): string {
  const hw = SCREEN_W / 2;
  const hh = SCREEN_H / 2;
  return (
    `<clipPath id="screen-clip"><rect x="${-hw}" y="${-hh}" width="${SCREEN_W}" height="${SCREEN_H}" rx="1.5"/></clipPath>` +
    rect(-hw, -hh, SCREEN_W, SCREEN_H, '#1b2133', 'rx="1.5"') +
    `<g clip-path="url(#screen-clip)">` +
    `<g id="screen-code"><g transform="translate(0 -15)">${codeLines()}</g></g>` +
    `<g id="screen-idle">` +
    rect(-hw, -hh, SCREEN_W, SCREEN_H, '#5b8fd6') +
    `<circle cx="18" cy="-8" r="10" fill="#7fb0ec"/>` +
    rect(-28, -15, 6, 5, '#ffffff', 'rx="1" opacity="0.85"') +
    rect(-28, -7, 6, 5, '#ffffff', 'rx="1" opacity="0.85"') +
    rect(-28, 1, 6, 5, '#ffe066', 'rx="1" opacity="0.9"') +
    rect(-hw, hh - 4, SCREEN_W, 4, '#2f4d7a') +
    `</g>` +
    `<path id="screen-squiggle" d="M-22,-2 q3,-7 6,0 t6,0 t6,0 t6,0 t6,0 t6,0 t6,0" fill="none" stroke="#ff4d4d" stroke-width="2.4" stroke-linecap="round"/>` +
    rect(-hw, -hh, SCREEN_W, SCREEN_H, '#ff3b3b', 'id="screen-red"') +
    rect(-hw, -hh, SCREEN_W, SCREEN_H, '#000000', 'id="screen-dim"') +
    `<g id="screen-off">` +
    rect(-hw, -hh, SCREEN_W, SCREEN_H, '#141824') +
    `<path d="M-26,-12 L-14,-16 M-26,-6 L-6,-13" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.12"/>` +
    `</g>` +
    `<g id="screen-progress">` +
    rect(-PROGRESS_W / 2, hh - 6.5, PROGRESS_W, 3.6, '#39425a', 'rx="1.8"') +
    rect(-PROGRESS_W / 2, hh - 6.5, 0, 3.6, '#5ce07a', 'id="progress-fill" rx="1.8"') +
    `</g>` +
    `</g>`
  );
}

function needsProjectSign(): string {
  return (
    `<g id="needs-project" class="hit" data-hit="needs-project" data-tip="No project. Click to pick one.">` +
    `<g transform="rotate(-4)">` +
    rect(-25, -13.5, 50, 26, '#ffe066', `rx="1.5" ${stroke(1.3)}`) +
    rect(-25, -13.5, 50, 5, '#f5cf3c', 'rx="1.5"') +
    `<text x="0" y="-1" text-anchor="middle" font-family="${FONT}" font-size="8.2" font-weight="800" fill="#3a2a10">NEEDS A</text>` +
    `<text x="0" y="8.4" text-anchor="middle" font-family="${FONT}" font-size="8.2" font-weight="800" fill="#d64545">PROJECT!</text>` +
    `</g></g>`
  );
}

function leftoverNote(): string {
  return (
    `<g id="left-note" class="hit" data-hit="leftover-note" transform="translate(${SCREEN_W / 2 - 2} ${-SCREEN_H / 2 - 4}) rotate(12)">` +
    rect(-6.5, -6.5, 13, 13, '#ffe066', stroke(1.1)) +
    `<path d="M-4,-2 L4,-2 M-4,1 L3,1 M-4,4 L2,4" stroke="#8a6d1f" stroke-width="0.9" stroke-linecap="round"/>` +
    `</g>`
  );
}

function monitor(): string {
  const hw = SCREEN_W / 2 + 3.5;
  const hh = SCREEN_H / 2 + 3.5;
  return (
    `<g id="monitor" data-hit="monitor">` +
    `<ellipse cx="${SCREEN_X + 1}" cy="${TOP - 0.4}" rx="15" ry="2.6" fill="#3b3e52" ${stroke(1.2)}/>` +
    rect(SCREEN_X - 3.5, TOP - 14, 8, 13, '#4a4e66', stroke(1.2)) +
    `<g transform="translate(${SCREEN_X} ${SCREEN_Y}) skewY(-5)">` +
    // Monitor thickness on the far side sells the angle towards the worker.
    `<path d="M${hw},${-hh + 1} L${hw + 4},${-hh + 3} L${hw + 4},${hh - 1} L${hw},${hh} Z" fill="#22232f" ${stroke(1.2)}/>` +
    rect(-hw, -hh, hw * 2, hh * 2, '#2f3140', `rx="3.5" ${stroke()}`) +
    screenContent() +
    `<circle cx="0" cy="${hh - 1.6}" r="0.9" fill="#5ce07a"/>` +
    needsProjectSign() +
    leftoverNote() +
    `</g>` +
    `</g>`
  );
}

function clipboard(): string {
  const y = TOP - 32;
  return (
    `<g id="clipboard" class="hit" data-hit="clipboard" data-tip="Boss menu">` +
    // The hover lift animates the outer group only: animating a group that
    // also has a transform attribute makes it jump while the transition runs.
    `<g class="clipboard-lift"><g transform="rotate(7 354 ${TOP})">` +
    rect(341, y, 24, 32, '#b5824e', `rx="2.5" ${stroke()}`) +
    rect(344, y + 5, 18, 24, '#ffffff', `rx="1" ${stroke(1)}`) +
    `<path d="M347,${y + 11} l2,2 l3,-4 M354,${y + 11} L359,${y + 11} M347,${y + 17} l2,2 l3,-4 M354,${y + 17} L359,${y + 17} M347,${y + 23} L352,${y + 23} M354,${y + 23} L359,${y + 23}" fill="none" stroke="#5b8fd6" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>` +
    rect(347, y - 3, 12, 6, '#9aa5b1', `rx="2" ${stroke(1.2)}`) +
    `</g></g></g>`
  );
}

function leftoverMug(): string {
  const y = TOP - 11;
  return (
    `<g id="left-mug" class="hit" data-hit="leftover-mug">` +
    `<path d="M267.5,${y + 3} q4.4,0 4.4,3 q0,3 -4.4,3" fill="none" stroke="${LINE}" stroke-width="3.4"/>` +
    `<path d="M267.5,${y + 3} q4.4,0 4.4,3 q0,3 -4.4,3" fill="none" stroke="#ffffff" stroke-width="1.5"/>` +
    rect(258, y, 10.5, 11, '#ffffff', `rx="1.8" ${stroke(1.3)}`) +
    rect(258.7, y + 4, 9.1, 3, '#7c5cd6') +
    `</g>`
  );
}

function leftoverFolder(): string {
  const y = TOP - 17;
  return (
    `<g id="left-folder" class="hit" data-hit="leftover-folder">` +
    `<g transform="rotate(-8 330 ${TOP})">` +
    `<path d="M318,${y} L324,${y} L326,${y + 2.5} L336,${y + 2.5} L336,${TOP} L318,${TOP} Z" fill="#e8b85a" ${stroke(1.2)}/>` +
    rect(319.5, y + 4, 15, 13, '#f3cd77', stroke(1)) +
    `<text x="327" y="${y + 13}" text-anchor="middle" font-family="${FONT}" font-size="5" font-weight="800" fill="#8a5a12">WIP</text>` +
    `</g></g>`
  );
}

function deskItems(): string {
  return (
    `<g id="desk-items">` +
    keyboard() +
    monitor() +
    leftoverMug() +
    leftoverFolder() +
    clipboard() +
    `</g>`
  );
}

function stuckAlert(): string {
  const y = SCREEN_Y - 47;
  return (
    `<g id="stuck-alert"><g class="alert-bob">` +
    `<path d="M${SCREEN_X},${y} l4,4 l5,-2 l-1,5 l4,4 l-5,1 l0,5 l-5,-3 l-4,4 l-1,-5 l-5,-1 l4,-4 l-2,-5 l5,1 Z" fill="#ff4d4d" ${stroke(1.3)} transform="translate(0 2)"/>` +
    `<text x="${SCREEN_X}" y="${y + 16}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="900" fill="#ffffff">!</text>` +
    `</g></g>`
  );
}

function offlineIcon(): string {
  const y = TOP - 58;
  return (
    `<g id="offline-icon" class="hit" data-hit="offline" data-tip="Claude isn't connected, so they're running on canned lines. Check Settings.">` +
    `<path d="M356,${y} L366,${y + 17} L346,${y + 17} Z" fill="#ffd23f" ${stroke(1.4)}/>` +
    `<path d="M356,${y + 5.5} L356,${y + 11.5}" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="356" cy="${y + 14.4}" r="1.1" fill="${LINE}"/>` +
    `</g>`
  );
}

/** The worker layers; `view.ts` fills `.worker-body` with the character. */
function worker(): string {
  return (
    `<g id="worker" class="worker">` +
    `<g class="worker-pos">` +
    `<g class="speed-lines">` +
    `<path d="M-40,-62 L-22,-62 M-46,-51 L-23,-51 M-38,-40 L-22,-40 M-44,-71 L-29,-71" stroke="${LINE}" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M-40,-62 L-22,-62 M-46,-51 L-23,-51 M-38,-40 L-22,-40 M-44,-71 L-29,-71" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>` +
    `</g>` +
    `<g class="worker-flip">` +
    `<g class="worker-shake">` +
    `<g class="worker-body"></g>` +
    `<g class="worker-xray"></g>` +
    `</g></g>` +
    `<g class="worker-ash">` +
    `<ellipse cx="2" cy="0" rx="22" ry="3" fill="#000000" opacity="0.2"/>` +
    `<path d="M-20,0 Q-19,-8 -11,-10 Q-8,-18 0,-17 Q4,-23 10,-16 Q19,-14 21,0 Z" fill="#6f6a72" ${stroke(1.3)}/>` +
    `<path d="M-12,-3 Q-6,-9 0,-7 Q6,-11 12,-4" fill="none" stroke="#8d8890" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M-9,-4 L-7,-5 M-1,-11 L1,-10 M6,-6 L8,-7 M2,-3 L4,-2 M13,-3 L15,-4" stroke="#3d3940" stroke-width="1.4" stroke-linecap="round"/>` +
    `<circle cx="12" cy="-2" r="1.8" fill="#ff8a3d"/><circle cx="-6" cy="-6" r="1.3" fill="#ffb03d"/>` +
    // The badge survives everything.
    `<rect x="-15" y="-5" width="6" height="7" rx="1" fill="#fbfbf7" stroke="${LINE}" stroke-width="0.9" transform="rotate(-18 -12 -1)"/>` +
    `<g class="ash-smoke">` +
    `<circle class="puff" cx="-4" cy="-18" r="5" fill="#9a959e"/>` +
    `<circle class="puff" cx="5" cy="-20" r="4.4" fill="#aaa5ae"/>` +
    `<circle class="puff" cx="0" cy="-22" r="4" fill="#b8b3bc"/>` +
    `<circle class="puff" cx="8" cy="-18" r="3.6" fill="#a29da6"/>` +
    `</g></g>` +
    `<g class="worker-fx">` +
    `<g class="fx-sweat">` +
    `<g transform="translate(19 -12)"><path class="drop" d="M0,0 q-2.6,3.6 -2.6,5.4 a2.6,2.6 0 0,0 5.2,0 q0,-1.8 -2.6,-5.4 Z" fill="#7cc8ff" ${stroke(1)}/></g>` +
    `<g transform="translate(-20 -6)"><path class="drop d2" style="--sx:-3px" d="M0,0 q-2.2,3 -2.2,4.6 a2.2,2.2 0 0,0 4.4,0 q0,-1.6 -2.2,-4.6 Z" fill="#7cc8ff" ${stroke(1)}/></g>` +
    `<g transform="translate(22 -22)"><path class="drop d3" d="M0,0 q-2,2.8 -2,4.2 a2,2 0 0,0 4,0 q0,-1.4 -2,-4.2 Z" fill="#7cc8ff" ${stroke(1)}/></g>` +
    `</g>` +
    `<g class="fx-zzz">` +
    `<text class="z z1" x="0" y="0" font-family="${FONT}" font-weight="900" font-size="11" fill="#ffffff" stroke="${LINE}" stroke-width="2.4" paint-order="stroke">z</text>` +
    `<text class="z z2" x="7" y="-10" font-family="${FONT}" font-weight="900" font-size="14" fill="#ffffff" stroke="${LINE}" stroke-width="2.4" paint-order="stroke">z</text>` +
    `<text class="z z3" x="15" y="-21" font-family="${FONT}" font-weight="900" font-size="17" fill="#ffffff" stroke="${LINE}" stroke-width="2.6" paint-order="stroke">Z</text>` +
    `</g>` +
    `<g class="fx-thinking">` +
    `<circle cx="-7" cy="9" r="2" fill="#ffffff" ${stroke(1.1)}/>` +
    rect(-4, -8, 26, 13, '#ffffff', `rx="6.5" ${stroke(1.3)}`) +
    `<circle class="dot dot1" cx="3" cy="-1.5" r="2" fill="${LINE}"/>` +
    `<circle class="dot dot2" cx="9" cy="-1.5" r="2" fill="${LINE}"/>` +
    `<circle class="dot dot3" cx="15" cy="-1.5" r="2" fill="${LINE}"/>` +
    `</g>` +
    `</g>` +
    `<rect class="worker-hit hit" data-hit="worker" x="-22" y="-94" width="44" height="96" fill="transparent"/>` +
    `</g></g>`
  );
}

/** The whole scene as SVG markup, drawn once at startup. */
export function sceneSvg(): string {
  return (
    `<svg id="scene" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCENE_W} ${SCENE_H}" width="${SCENE_W}" height="${SCENE_H}">` +
    floor() +
    counter() +
    `<g id="desk">${deskBody()}${deskItems()}</g>` +
    chair() +
    hiringSign() +
    stuckAlert() +
    offlineIcon() +
    `<g id="effects-back"></g>` +
    worker() +
    `<g id="effects"></g>` +
    `</svg>`
  );
}
