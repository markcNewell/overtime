/**
 * One-off visual effects drawn into the scene's `#effects` layer: shock
 * bolts, smoke, the level-up burst and confetti. Each adds a group, lets
 * its CSS animation run, then removes it.
 */

import { num, type Pt } from '../shared/svg';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LINE = '#2a2238';

function spawn(layer: SVGGElement, markup: string, ms: number): void {
  const g = document.createElementNS(SVG_NS, 'g');
  g.innerHTML = markup;
  layer.appendChild(g);
  window.setTimeout(() => g.remove(), ms);
}

function bolt(x: number, y: number, rot: number, scale: number, delay: number): string {
  return (
    `<g transform="translate(${num(x)} ${num(y)}) rotate(${rot}) scale(${scale})">` +
    `<path class="fx-bolt" style="animation-delay:${delay}ms" d="M-1,-11 L6,-2 L1.5,-1.5 L6,10 L-5,0 L0,-0.5 L-5,-11 Z" fill="#ffe14d" stroke="${LINE}" stroke-width="1.3" stroke-linejoin="round"/>` +
    `</g>`
  );
}

/**
 * Lightning bolts around the worker and a glow behind them; `body` is
 * mid-torso. The glow goes in the back layer so it lights the worker up
 * instead of washing them out.
 */
export function zapBolts(front: SVGGElement, back: SVGGElement, body: Pt): void {
  const { x, y } = body;
  spawn(
    back,
    `<circle class="fx-flash" cx="${num(x)}" cy="${num(y)}" r="44" fill="#fff38a"/>` +
      `<circle class="fx-flash" cx="${num(x)}" cy="${num(y)}" r="30" fill="#ffffff"/>`,
    700,
  );
  spawn(
    front,
    bolt(x - 31, y - 20, -20, 1.4, 0) +
      bolt(x + 32, y - 28, 25, 1.5, 40) +
      bolt(x - 28, y + 16, -35, 1.1, 70) +
      bolt(x + 31, y + 10, 30, 1.25, 20) +
      bolt(x + 2, y - 56, 5, 1.15, 55),
    700,
  );
}

/** Wisps of smoke rising off the top of the head. */
export function smoke(layer: SVGGElement, headTop: Pt): void {
  let puffs = '';
  const spots = [
    [-8, 0, 6, 0],
    [3, -2, 6.5, 200],
    [10, 1, 5.5, 420],
    [-3, -1, 7, 650],
    [6, 0, 5.8, 900],
    [-9, -2, 6.2, 1150],
    [1, 0, 6.6, 1400],
  ];
  for (const [dx = 0, dy = 0, r = 4, delay = 0] of spots) {
    puffs +=
      `<g transform="translate(${num(headTop.x + dx)} ${num(headTop.y + dy)})">` +
      `<circle class="fx-puff" style="animation-delay:${delay}ms" cx="0" cy="0" r="${r}" fill="#7d7884" stroke="#5f5a66" stroke-width="1" opacity="0"/>` +
      `</g>`;
  }
  spawn(layer, puffs, 3400);
}

function starPath(r1: number, r2: number, n: number): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = (Math.PI * i) / n - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${num(Math.cos(a) * r)},${num(Math.sin(a) * r)} `;
  }
  return d + 'Z';
}

/** A gold star burst with "LEVEL UP!" over the head. */
export function levelUp(layer: SVGGElement, headTop: Pt, label = 'LEVEL UP!'): void {
  const x = Math.min(330, Math.max(50, headTop.x));
  const y = Math.max(40, headTop.y - 22);
  const sparks = [-40, 30, -25, 45, 0]
    .map(
      (dx, i) =>
        `<g transform="translate(${num(dx)} ${num(i % 2 ? -18 : 14)})"><path class="fx-spark" style="animation-delay:${120 + i * 70}ms" d="${starPath(4, 1.6, 4)}" fill="#ffffff" stroke="${LINE}" stroke-width="0.9"/></g>`,
    )
    .join('');
  spawn(
    layer,
    `<g class="fx-level" transform="translate(${num(x)} ${num(y)})">` +
      `<g class="fx-burst"><path d="${starPath(30, 19, 12)}" fill="#ffd23f" stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"/></g>` +
      sparks +
      `<g class="fx-pop"><text x="0" y="4.5" text-anchor="middle" font-family="ui-rounded, 'Segoe UI', system-ui, sans-serif" font-size="13" font-weight="900" fill="#ffffff" stroke="${LINE}" stroke-width="3" paint-order="stroke" letter-spacing="0.5">${label}</text></g>` +
      `</g>`,
    2600,
  );
}

/** Confetti raining over the whole scene. */
export function confetti(layer: SVGGElement): void {
  const colours = ['#ff5d73', '#ffd23f', '#5ce07a', '#5b8fd6', '#b57cf2', '#ff9f43'];
  let bits = '';
  for (let i = 0; i < 46; i++) {
    const x = 10 + Math.random() * 360;
    const w = 3 + Math.random() * 3;
    const h = 5 + Math.random() * 4;
    const colour = colours[i % colours.length] ?? '#ffd23f';
    const style = [
      `--dx:${num((Math.random() - 0.5) * 70)}px`,
      `--rot:${Math.round((Math.random() - 0.5) * 900)}deg`,
      `animation-duration:${Math.round(1900 + Math.random() * 1300)}ms`,
      `animation-delay:${Math.round(Math.random() * 600)}ms`,
    ].join(';');
    bits +=
      `<g transform="translate(${num(x)} ${num(70 + Math.random() * 40)})">` +
      `<rect class="fx-confetti" style="${style}" x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}" rx="1" fill="${colour}"/>` +
      `</g>`;
  }
  spawn(layer, bits, 4000);
}
