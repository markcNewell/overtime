import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Pitch, Project } from '../src/shared/types';
import {
  dayStamp,
  parseHardParts,
  renderBrief,
  slugify,
  startProjectFolder,
  writePitchBrief,
  writeReleaseNotes,
} from '../src/files/briefs';

const NOW = new Date(2026, 9, 5, 14, 7).getTime();

function samplePitch(patch: Partial<Pitch> = {}): Pitch {
  return {
    id: 'pitch-1',
    title: 'Sock Ledger',
    tagline: 'Double-entry bookkeeping for lost socks.',
    difficulty: 3,
    description: 'Every sock you own, tracked to the penny.',
    hardParts: [
      { at: 0.65, severity: 2, title: 'The tumble dryer',
        detail: 'Socks go in as a pair and come out as a question.' },
      { at: 0.25, severity: 1, title: 'Sock identity',
        detail: 'Two grey socks are legally the same sock.' },
    ],
    ...patch,
  };
}

function asProject(pitch: Pitch): Project {
  return {
    ...pitch, startedAt: NOW, progress: 1, workMinutes: 90, qualitySum: 60,
    hardPartsHit: [0, 1],
  };
}

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'overtime-files-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('slugify and dayStamp', () => {
  it('makes filename-safe slugs', () => {
    expect(slugify('Sock Ledger')).toBe('sock-ledger');
    expect(slugify('  Is It Lunch Yet?!  ')).toBe('is-it-lunch-yet');
    expect(slugify('Crème Brûlée & Co.')).toBe('creme-brulee-and-co');
    expect(slugify('🔥🔥')).toBe('untitled');
    expect(slugify('a'.repeat(80)).length).toBeLessThanOrEqual(48);
    expect(slugify('word '.repeat(20))).not.toMatch(/-$/);
  });

  it('stamps the local day', () => {
    expect(dayStamp(NOW)).toBe('2026-10-05');
    expect(dayStamp(new Date(2026, 0, 9, 23, 59).getTime())).toBe('2026-01-09');
  });
});

describe('renderBrief', () => {
  it('has the title, stars, who and when, and the struggle list', () => {
    const md = renderBrief(samplePitch(), 'Priyanka Osei', NOW);
    expect(md).toMatch(/^# Sock Ledger\n/);
    expect(md).toContain('> Double-entry bookkeeping for lost socks.');
    expect(md).toContain('★★★☆☆ Tricky (3/5)');
    expect(md).toContain('**Pitched to:** Priyanka Osei on 2026-10-05 at 14:07');
    expect(md).toContain('## What it is');
    expect(md).toContain('## Where the developer will struggle');
    expect(md).toMatch(/Edit this list before you assign the project/);
    // Sorted by where they hit.
    const first = md.indexOf('- [25%] [1] Sock identity: Two grey socks');
    const second = md.indexOf('- [65%] [2] The tumble dryer: Socks go in');
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it('skips mystery parts', () => {
    const pitch = samplePitch();
    pitch.hardParts = [...pitch.hardParts, { at: 0.5, severity: 3,
      title: 'Planted bug', detail: 'Shh.', mystery: true }];
    const md = renderBrief(pitch, 'X', NOW);
    expect(md).not.toContain('Planted bug');
    expect(parseHardParts(md)).toHaveLength(2);
  });

  it('names each difficulty', () => {
    const names = [1, 2, 3, 4, 5].map((d) =>
      renderBrief(samplePitch({ difficulty: d as Pitch['difficulty'] }), 'X', NOW));
    expect(names[0]).toContain('★☆☆☆☆ Trivial');
    expect(names[1]).toContain('★★☆☆☆ Easy');
    expect(names[3]).toContain('★★★★☆ Hard');
    expect(names[4]).toContain('★★★★★ Nightmare');
  });
});

describe('parseHardParts', () => {
  it('round-trips a rendered brief', () => {
    const pitch = samplePitch();
    const parsed = parseHardParts(renderBrief(pitch, 'X', NOW));
    const sorted = [...pitch.hardParts].sort((a, b) => a.at - b.at);
    expect(parsed).toEqual(sorted);
  });

  it('round-trips a title with a colon', () => {
    const pitch = samplePitch({ hardParts: [
      { at: 0.4, severity: 3, title: 'Re: Emails', detail: 'Too many.' },
    ] });
    const parsed = parseHardParts(renderBrief(pitch, 'X', NOW));
    expect(parsed).toEqual([
      { at: 0.4, severity: 3, title: 'Re - Emails', detail: 'Too many.' },
    ]);
  });

  it('reads a hand-edited list forgivingly', () => {
    const md = [
      '# Sock Ledger',
      '',
      '##   Where the developer will struggle  ',
      '',
      'Some note the user left.',
      '-   [ 80 % ]   [3]   Final boss :  It explodes.  ',
      '* [10] [1] No percent sign: fine',
      '- [50%] [2] No detail at all',
      '1. [0.3] [2] A fraction - with a dash detail',
      '- [150%] [7] Way too far: clamped',
      '- [5%] [high] Word severity: brutal',
      '- no brackets here: ignored',
      '- [abc] [2] Bad at: ignored',
      '',
      '## Something else',
      '- [40%] [2] Not in the section: ignored',
    ].join('\n');
    expect(parseHardParts(md)).toEqual([
      { at: 0.05, severity: 3, title: 'Word severity', detail: 'brutal' },
      { at: 0.1, severity: 1, title: 'No percent sign', detail: 'fine' },
      { at: 0.3, severity: 2, title: 'A fraction', detail: 'with a dash detail' },
      { at: 0.5, severity: 2, title: 'No detail at all', detail: '' },
      { at: 0.8, severity: 3, title: 'Final boss', detail: 'It explodes.' },
      { at: 0.99, severity: 3, title: 'Way too far', detail: 'clamped' },
    ]);
  });

  it('defaults a missing severity to 2', () => {
    const md = '## Where the developer will struggle\n- [40%] Only at: hi';
    expect(parseHardParts(md)).toEqual([
      { at: 0.4, severity: 2, title: 'Only at', detail: 'hi' },
    ]);
  });

  it('returns null when the section is missing or empty', () => {
    expect(parseHardParts('# Title\n\nNo list here.')).toBeNull();
    const empty = '## Where the developer will struggle\n\n- just words\n';
    expect(parseHardParts(empty)).toBeNull();
  });
});

describe('writePitchBrief', () => {
  it('writes pitches/<day>-<slug>.md and avoids clashes', async () => {
    const pitch = samplePitch();
    const first = await writePitchBrief(dir, pitch, 'Priyanka', NOW);
    const second = await writePitchBrief(dir, pitch, 'Priyanka', NOW);
    const third = await writePitchBrief(dir, pitch, 'Priyanka', NOW);
    expect(first).toBe(path.join(dir, 'pitches', '2026-10-05-sock-ledger.md'));
    expect(second).toBe(path.join(dir, 'pitches', '2026-10-05-sock-ledger-2.md'));
    expect(third).toBe(path.join(dir, 'pitches', '2026-10-05-sock-ledger-3.md'));
    expect(await readFile(first, 'utf8')).toBe(renderBrief(pitch, 'Priyanka', NOW));
  });
});

describe('startProjectFolder', () => {
  it('uses the hard parts from an edited brief and copies it', async () => {
    const pitch = samplePitch();
    const filePath = await writePitchBrief(dir, pitch, 'Priyanka', NOW);
    const edited = (await readFile(filePath, 'utf8'))
      .replace('- [25%] [1] Sock identity', '- [40%] [3] Sock identity');
    await writeFile(filePath, edited, 'utf8');
    const { briefPath, hardParts } = await startProjectFolder(dir,
      { ...pitch, filePath }, NOW);
    expect(briefPath).toBe(path.join(dir, 'projects', '2026-10-05-sock-ledger',
      'brief.md'));
    expect(hardParts[0]).toMatchObject({ at: 0.4, severity: 3,
      title: 'Sock identity' });
    expect(await readFile(briefPath, 'utf8')).toBe(edited);
  });

  it('falls back to the pitch hard parts when the brief is broken', async () => {
    const pitch = samplePitch();
    const filePath = await writePitchBrief(dir, pitch, 'Priyanka', NOW);
    await writeFile(filePath, '# Sock Ledger\n\nI deleted everything. Oops.\n');
    const { briefPath, hardParts } = await startProjectFolder(dir,
      { ...pitch, filePath }, NOW);
    expect(hardParts).toEqual(pitch.hardParts);
    const copy = await readFile(briefPath, 'utf8');
    expect(copy).toContain('I deleted everything. Oops.');
    expect(copy).toMatch(/couldn't be read/);
  });

  it('renders a brief when the pitch file is missing', async () => {
    const pitch = samplePitch({ filePath: path.join(dir, 'nope.md') });
    const { briefPath, hardParts } = await startProjectFolder(dir, pitch, NOW);
    expect(hardParts.map((h) => h.title)).toEqual(['Sock identity',
      'The tumble dryer']);
    expect(await readFile(briefPath, 'utf8')).toContain('# Sock Ledger');
  });

  it('adds a suffix when the project folder exists', async () => {
    const pitch = samplePitch();
    const a = await startProjectFolder(dir, pitch, NOW);
    const b = await startProjectFolder(dir, pitch, NOW);
    expect(path.basename(path.dirname(a.briefPath))).toBe('2026-10-05-sock-ledger');
    expect(path.basename(path.dirname(b.briefPath))).toBe('2026-10-05-sock-ledger-2');
  });
});

describe('writeReleaseNotes', () => {
  it('writes release-notes.md next to the brief with a header', async () => {
    const pitch = samplePitch();
    const { briefPath } = await startProjectFolder(dir, pitch, NOW);
    const file = await writeReleaseNotes(briefPath, asProject(pitch),
      'It works.\n\n## Known issues\n- Socks', {
        workerName: 'Priyanka Osei', grade: 'Solid', quality: 0.712, now: NOW,
      });
    expect(file).toBe(path.join(path.dirname(briefPath), 'release-notes.md'));
    const md = await readFile(file, 'utf8');
    expect(md).toMatch(/^# Sock Ledger: release notes\n/);
    expect(md).toContain('**Shipped by:** Priyanka Osei on 2026-10-05');
    expect(md).toContain('**Grade:** Solid (71% quality)');
    expect(md).toContain('★★★☆☆ Tricky');
    expect(md).toContain('## Known issues\n- Socks');
  });

  it('recreates a missing project folder', async () => {
    const briefPath = path.join(dir, 'projects', 'gone', 'brief.md');
    const file = await writeReleaseNotes(briefPath, asProject(samplePitch()),
      'Notes.', { workerName: 'X', grade: 'Buggy', quality: 0.5, now: NOW });
    expect(await readFile(file, 'utf8')).toContain('Notes.');
  });
});
