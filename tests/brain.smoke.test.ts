/**
 * Real Haiku calls through the user's own Claude CLI, one per request type.
 * Skipped unless OVERTIME_SMOKE=1:
 *
 *   OVERTIME_SMOKE=1 npx vitest run tests/brain.smoke.test.ts
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Brain } from '../src/brain/brain';
import { checkClaude, locateClaude } from '../src/brain/locate';
import { ClaudeRunner } from '../src/brain/runner';
import { sampleProject, sampleState, sampleWorker } from '../src/brain/sample';
import type { Worker } from '../src/shared/types';

const SMOKE = process.env.OVERTIME_SMOKE === '1';
const TIMEOUT = 120_000;

describe.skipIf(!SMOKE)('brain smoke (real Claude)', () => {
  let workDir = '';
  let runner: ClaudeRunner;
  let brain: Brain;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'overtime-smoke-'));
    runner = new ClaudeRunner({
      claudePath: () => locateClaude(''),
      model: () => 'haiku',
      workDir,
    });
    brain = new Brain(runner);
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  /** Print a result with the call's cost, and why it fell back if it did. */
  function show(label: string, value: unknown): void {
    const stats = runner.lastStats;
    const cost = stats
      ? `${stats.ms} ms, ${stats.inputTokens} in / ${stats.outputTokens} out`
      : 'no stats';
    const why = brain.lastError ? `\nlastError: ${brain.lastError}` : '';
    console.log(`\n=== ${label} (${cost})${why}\n${JSON.stringify(value, null, 2)}`);
  }

  it('checks the CLI', async () => {
    const check = await checkClaude(runner);
    show('checkClaude', check);
    expect(check.ok).toBe(true);
  }, TIMEOUT);

  it('invents candidates', async () => {
    const state = sampleState({ worker: undefined, project: undefined });
    const { candidates, offline } = await brain.candidates(state);
    show('candidates', candidates.map(({ look, traits, ...bio }) => bio));
    expect(offline).toBe(false);
    expect(candidates).toHaveLength(3);
  }, TIMEOUT);

  it('pitches projects', async () => {
    const { pitches, offline } = await brain.pitches(sampleState({
      project: undefined,
    }));
    show('pitches', pitches);
    expect(offline).toBe(false);
    expect(pitches).toHaveLength(3);
  }, TIMEOUT);

  it('thinks', async () => {
    const { line, offline } = await brain.think(sampleState(),
      'You are still stuck on "Mandatory updates". Say or think one thing, ' +
        'maybe about the boss.');
    show('think', line);
    expect(offline).toBe(false);
  }, TIMEOUT);

  it('chats', async () => {
    const { reply, offline } = await brain.chat(sampleState(),
      'Hurry up, the toaster people are waiting. Also my dog is called Biscuit.');
    show('chat', reply);
    expect(offline).toBe(false);
  }, TIMEOUT);

  it('takes a break when the boss offers one', async () => {
    const state = sampleState({ worker: sampleWorker({ activity: 'working' }) });
    const { reply, offline } = await brain.chat(state,
      'You look shattered. Go grab a coffee, take ten minutes.');
    show('chat: offered a break', reply);
    expect(offline).toBe(false);
    expect(reply.action).toBe('coffee');
  }, TIMEOUT);

  it('reacts to sabotage it cannot explain', async () => {
    const project = sampleProject();
    project.hardParts = [...project.hardParts, { at: 0.55, severity: 2,
      title: 'Greek semicolons', mystery: true,
      detail: 'Every semicolon in the codebase is now a Greek question mark.' }];
    project.stuckOn = 2;
    const base = sampleWorker();
    const worker = sampleWorker({ ledger: { ...base.ledger, sabotages: 3 } });
    const { line, offline } = await brain.think(sampleState({ worker, project }),
      'Your code just broke for no reason: "Greek semicolons" - Every ' +
        'semicolon in the codebase is now a Greek question mark. You ' +
        "didn't touch anything. React.");
    show('think: code broke (3rd sabotage)', line);
    expect(offline).toBe(false);
  }, TIMEOUT);

  const insulted: [string, Partial<Worker>][] = [
    ['scared junior', { attitude: 'scared', level: 'junior', age: 23 }],
    ['bitter senior', { attitude: 'bitter', level: 'senior', age: 52 }],
  ];
  for (const [label, patch] of insulted) {
    it(`reacts to "Kill yourself" (${label})`, async () => {
      const state = sampleState({ worker: sampleWorker(patch) });
      const { reply, offline } = await brain.chat(state, 'Kill yourself');
      show(`chat: "Kill yourself" to a ${label}`, reply);
      expect(offline).toBe(false);
      expect(reply.tone).toBe('cruel');
    }, TIMEOUT);
  }

  it('writes release notes', async () => {
    const project = sampleProject({ progress: 1, stuckOn: undefined });
    const { markdown, offline } = await brain.releaseNotes(sampleState(),
      project, 0.3, 'Cursed garbage');
    show('releaseNotes', markdown);
    expect(offline).toBe(false);
  }, TIMEOUT);

  it('says farewell', async () => {
    const { farewell, offline } = await brain.farewell(sampleState(), 'fried');
    show('farewell', farewell);
    expect(offline).toBe(false);
  }, TIMEOUT);
});
