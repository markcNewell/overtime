/**
 * Small helpers for building SVG markup as strings, shared by the overlay
 * scene and the character drawing.
 */

/** A point in whatever coordinate space the caller is drawing in. */
export interface Pt {
  x: number;
  y: number;
}

/** Shorthand constructor for a point. */
export function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Round to two decimals so the markup stays short and stable. */
export function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Escape text for use inside SVG or HTML markup and attribute values. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Parse `#rgb` or `#rrggbb`; anything else falls back to mid grey. */
function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return [128, 128, 128];
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * Lighten (amount > 0) or darken (amount < 0) a hex colour by mixing it with
 * white or black. `amount` runs -1..1.
 */
export function shade(hex: string, amount: number): string {
  const target = amount >= 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(amount));
  const out = parseHex(hex).map((c) => Math.round(c + (target - c) * k));
  return '#' + out.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Rotate a point around the origin by `deg` degrees (SVG direction). */
export function rotate(p: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** `a + b`. */
export function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** `a - b`. */
export function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** The point a fraction `k` of the way from `a` to `b`. */
export function lerp(a: Pt, b: Pt, k: number): Pt {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** An `M x,y L x,y ...` path through the points. */
export function polyline(points: Pt[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p.x)},${num(p.y)}`)
    .join(' ');
}
