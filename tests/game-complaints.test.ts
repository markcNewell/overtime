import { describe, expect, it } from 'vitest';
import { hire, newGameState, resolveComplaint } from '../src/game';
import type { Candidate, GameState, Settings } from '../src/shared/types';

const SETTINGS: Settings = {
  alwaysOnTop: true,
  hideFromScreenShare: false,
  claudePath: '',
  model: 'haiku',
  filesDir: '/tmp/x',
};

function withWorker(): GameState {
  const c: Candidate = {
    id: 'w',
    name: 'Dave',
    age: 30,
    pronouns: 'he/him',
    level: 'junior',
    personality: 'p',
    specialty: 's',
    quirk: 'q',
    redFlag: 'r',
    backstory: 'b',
    traits: { stamina: 1, resilience: 1, talent: 1 },
    look: { skin: '#c68c5f', hair: '#222', hairStyle: 'short', shirt: '#38c', glasses: false },
  };
  const state = { ...newGameState(SETTINGS, 0), candidates: [c] };
  const hired = hire(state, 'w', 0);
  return { ...hired, worker: { ...hired.worker!, stats: { energy: 80, mood: 50, sanity: 80 } } };
}

describe('resolveComplaint', () => {
  it('an apology lifts mood and counts as kindness', () => {
    const { state } = resolveComplaint(withWorker(), 'apology', 'the shocks', 10);
    expect(state.worker!.stats.mood).toBe(60);
    expect(state.worker!.ledger.kindChats).toBe(2);
    expect(state.worker!.memories.at(-1)?.text).toContain('apologised about the shocks');
  });

  it('gaslighting costs sanity and leaves them doubting themselves', () => {
    const { state } = resolveComplaint(withWorker(), 'gaslit', 'The Shocks', 10);
    expect(state.worker!.stats.sanity).toBe(70);
    expect(state.worker!.memories.at(-1)).toMatchObject({
      kind: 'self',
      text: 'Maybe I imagined the shocks?',
    });
  });

  it('a backfire hurts and counts as cruelty', () => {
    const { state } = resolveComplaint(withWorker(), 'backfired', 'the insult', 10);
    expect(state.worker!.stats.mood).toBe(42);
    expect(state.worker!.ledger.cruelChats).toBe(1);
  });

  it('does nothing without a worker and never mutates its input', () => {
    const empty = newGameState(SETTINGS, 0);
    expect(resolveComplaint(empty, 'apology', 'x', 1).state.worker).toBeUndefined();
    const before = withWorker();
    const copy = structuredClone(before);
    resolveComplaint(before, 'gaslit', 'x', 1);
    expect(before).toEqual(copy);
  });
});
