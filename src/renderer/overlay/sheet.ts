/**
 * Preview-only contact sheets of the character (`?sheet=faces|hair|poses`),
 * so faces and poses can be checked up close in screenshots.
 */

import type { HairStyle, Look } from '../../shared/types';
import {
  personSvg,
  type Expression,
  type PersonSvgOptions,
} from '../shared/person';
import { esc } from '../shared/svg';
import { LOOKS } from './mock';

export const SHEETS = ['faces', 'hair', 'poses', 'xray'] as const;

interface Cell {
  look: Look;
  opts: PersonSvgOptions;
  label: string;
}

const EXPRESSIONS: Expression[] = [
  'happy',
  'neutral',
  'tired',
  'sad',
  'angry',
  'scared',
  'crazy',
  'asleep',
  'shocked',
];

const STYLES: HairStyle[] = ['short', 'long', 'bun', 'bald', 'mohawk', 'curly'];

function cells(kind: string): Cell[] {
  const base = LOOKS.priya;
  switch (kind) {
    case 'faces':
      return [
        ...EXPRESSIONS.map((e) => ({
          look: base,
          opts: { pose: 'stand' as const, expression: e, crop: 'bust' as const, size: 150 },
          label: e,
        })),
        ...EXPRESSIONS.slice(0, 3).map((e) => ({
          look: LOOKS.dev,
          opts: { pose: 'sit-type' as const, expression: e, crop: 'bust' as const, size: 150, crazed: true },
          label: `${e} + crazed`,
        })),
      ];
    case 'hair':
      return Object.values(LOOKS).flatMap((look, i) => [
        {
          look: { ...look, hairStyle: STYLES[i] ?? look.hairStyle },
          opts: { pose: 'stand' as const, expression: 'happy' as const, size: 190 },
          label: `${STYLES[i] ?? look.hairStyle} front`,
        },
        {
          look: { ...look, hairStyle: STYLES[i] ?? look.hairStyle },
          opts: { pose: 'walk' as const, expression: 'neutral' as const, size: 190 },
          label: '3/4',
        },
      ]);
    case 'poses':
      return [
        { look: base, opts: { pose: 'sit-type', expression: 'happy', size: 180 }, label: 'sit-type' },
        { look: base, opts: { pose: 'sit-type', arms: 'scratch', expression: 'scared', size: 180 }, label: 'stuck' },
        { look: base, opts: { pose: 'sit-slump', expression: 'asleep', size: 180 }, label: 'sit-slump' },
        { look: base, opts: { pose: 'sit-idle', expression: 'neutral', size: 180 }, label: 'sit-idle' },
        { look: base, opts: { pose: 'stand', expression: 'neutral', size: 180 }, label: 'stand' },
        { look: base, opts: { pose: 'walk', expression: 'happy', size: 180 }, label: 'walk' },
        { look: base, opts: { pose: 'drink', expression: 'happy', size: 180 }, label: 'drink' },
        { look: base, opts: { pose: 'walk', arms: 'box', expression: 'sad', size: 180 }, label: 'fired' },
        { look: base, opts: { pose: 'stand', arms: 'up', expression: 'crazy', hairOnEnd: true, size: 180 }, label: 'lost-mind' },
        { look: base, opts: { pose: 'stand', arms: 'fists', expression: 'angry', size: 180 }, label: 'rage' },
      ];
    default:
      return [
        { look: base, opts: { pose: 'sit-type', expression: 'shocked', skeleton: true, size: 200 }, label: 'xray sit' },
        { look: base, opts: { pose: 'stand', expression: 'shocked', skeleton: true, size: 200 }, label: 'xray stand' },
        { look: LOOKS.gus, opts: { pose: 'walk', expression: 'shocked', skeleton: true, size: 200 }, label: 'xray walk' },
      ];
  }
}

/** Replace the page with a grid of portraits. */
export function renderSheet(kind: string, host: HTMLElement): void {
  document.body.classList.add('sheet-mode');
  host.innerHTML =
    `<div class="sheet">` +
    cells(kind)
      .map(
        (c) =>
          `<figure class="sheet-cell">${personSvg(c.look, c.opts)}<figcaption>${esc(c.label)}</figcaption></figure>`,
      )
      .join('') +
    `</div>`;
}
