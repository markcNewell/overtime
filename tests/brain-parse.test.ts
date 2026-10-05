import { describe, expect, it } from 'vitest';
import {
  asList,
  extractJson,
  int,
  num,
  oneOf,
  str,
  stripFences,
  text,
} from '../src/brain/parse';
import { toMugText } from '../src/brain/validate';

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"say":"hi"}')).toEqual({ say: 'hi' });
  });

  it('parses a fenced json block', () => {
    const reply = '```json\n{"say": "hello"}\n```';
    expect(extractJson(reply)).toEqual({ say: 'hello' });
  });

  it('parses a fence without a language tag', () => {
    expect(extractJson('```\n[1, 2]\n```')).toEqual([1, 2]);
  });

  it('ignores prose before and after', () => {
    const reply = 'Sure! Here you go:\n{"a": 1}\nHope that helps {smile}';
    expect(extractJson(reply)).toEqual({ a: 1 });
  });

  it('parses an array', () => {
    expect(extractJson('Ok: [{"n":1},{"n":2}]')).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('respects braces inside strings', () => {
    expect(extractJson('{"say":"}{ ]["}')).toEqual({ say: '}{ ][' });
  });

  it('respects escaped quotes inside strings', () => {
    const reply = '{"say":"she said \\"{hi}\\" twice"}';
    expect(extractJson(reply)).toEqual({ say: 'she said "{hi}" twice' });
  });

  it('handles nesting', () => {
    const reply = '{"a":{"b":[1,{"c":"d"}]}} trailing';
    expect(extractJson(reply)).toEqual({ a: { b: [1, { c: 'd' }] } });
  });

  it('takes the first JSON value when there are two', () => {
    expect(extractJson('{"a":1} {"b":2}')).toEqual({ a: 1 });
  });

  it('skips an unbalanced brace before the real value', () => {
    expect(extractJson('{ oops {"a":1}')).toEqual({ a: 1 });
  });

  it('skips a balanced but invalid candidate', () => {
    expect(extractJson('{not json} then {"ok":true}')).toEqual({ ok: true });
  });

  it('repairs trailing commas', () => {
    expect(extractJson('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it('finds JSON outside a fence that holds none', () => {
    const reply = '```\nno json here\n```\n{"a":1}';
    expect(extractJson(reply)).toEqual({ a: 1 });
  });

  it('copes with an unclosed fence', () => {
    expect(extractJson('```json\n{"a":1}')).toEqual({ a: 1 });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('I am a teapot.')).toThrow(/No JSON/);
    expect(() => extractJson('')).toThrow();
    expect(() => extractJson('{"never": "closed"')).toThrow();
  });
});

describe('stripFences', () => {
  it('returns fenced content or the trimmed text', () => {
    expect(stripFences('x\n```md\n# Hi\n```\ny')).toBe('# Hi');
    expect(stripFences('  plain  ')).toBe('plain');
  });
});

describe('str', () => {
  it('trims and collapses whitespace', () => {
    expect(str('  a \n  b\tc  ', 20)).toBe('a b c');
  });

  it('truncates at a word boundary with an ellipsis', () => {
    const out = str('the quick brown fox jumps over the lazy dog', 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('the quick brown')).toBe(true);
  });

  it('stringifies numbers and rejects other types', () => {
    expect(str(42, 10)).toBe('42');
    expect(str(null, 10)).toBe('');
    expect(str({ a: 1 }, 10)).toBe('');
    expect(str(undefined, 10)).toBe('');
  });
});

describe('text', () => {
  it('keeps line breaks but collapses blank runs', () => {
    expect(text('a\r\n\n\n\nb  \nc', 100)).toBe('a\n\nb\nc');
  });
});

describe('oneOf', () => {
  const levels = ['junior', 'mid', 'senior', 'lead'] as const;

  it('matches ignoring case and space', () => {
    expect(oneOf(' Senior ', levels, 'mid')).toBe('senior');
  });

  it('accepts a reply that starts with an option', () => {
    expect(oneOf('Lead developer', levels, 'mid')).toBe('lead');
  });

  it('falls back otherwise', () => {
    expect(oneOf('wizard', levels, 'mid')).toBe('mid');
    expect(oneOf(3, levels, 'junior')).toBe('junior');
  });
});

describe('num and int', () => {
  it('clamps numbers and numeric strings', () => {
    expect(num(150, 0, 100, 5)).toBe(100);
    expect(num('-3', 0, 100, 5)).toBe(0);
    expect(num('25%', 0, 100, 5)).toBe(25);
  });

  it('falls back on non-numbers', () => {
    expect(num('lots', 0, 100, 5)).toBe(5);
    expect(num(Number.NaN, 0, 100, 5)).toBe(5);
    expect(num(null, 0, 100, 5)).toBe(5);
  });

  it('rounds with int', () => {
    expect(int('2.6', 1, 5, 3)).toBe(3);
    expect(int(9, 1, 5, 3)).toBe(5);
  });
});

describe('asList', () => {
  it('accepts bare and wrapped arrays', () => {
    expect(asList([1], ['x'])).toEqual([1]);
    expect(asList({ pitches: [2] }, ['pitches'])).toEqual([2]);
    expect(asList({ whatever: [3] }, ['pitches'])).toEqual([3]);
    expect(asList({ a: 1 }, ['pitches'])).toEqual([]);
    expect(asList('nope', ['pitches'])).toEqual([]);
  });
});


describe('toMugText', () => {
  it('does not leave a slogan hanging mid-bracket', () => {
    expect(toMugText('Medieval Tax Collector. Send Help. (Or Bring Snacks.)')).toBe(
      'Medieval Tax Collector. Send Help.',
    );
  });

  it('keeps short slogans as they are', () => {
    expect(toMugText("World's okayest dev")).toBe("World's okayest dev");
  });
});
