/**
 * Loads and saves the game as one JSON file in the app's userData folder.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState, Settings, Worker } from '../shared/types';

/** Settings for a fresh install. `filesDir` depends on the machine. */
export function defaultSettings(documentsDir: string): Settings {
  return {
    alwaysOnTop: true,
    hideFromScreenShare: false,
    claudePath: '',
    model: 'haiku',
    filesDir: join(documentsDir, 'Overtime'),
  };
}

/**
 * Read the save file, or return null when there is none or it is unreadable.
 *
 * A corrupt save is moved aside rather than deleted so a bug never silently
 * destroys someone's worker.
 */
export function loadState(path: string, settings: Settings): GameState | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as GameState;
    if (raw.version !== 1) throw new Error(`unknown save version ${raw.version}`);
    return withDefaults(raw, settings);
  } catch (err) {
    console.error('Save file unreadable, starting fresh:', err);
    renameSync(path, `${path}.broken-${Date.now()}`);
    return null;
  }
}

/** Fill in anything an older save is missing. */
function withDefaults(state: GameState, settings: Settings): GameState {
  return {
    ...state,
    pitches: state.pitches ?? [],
    candidates: state.candidates ?? [],
    pastWorkers: state.pastWorkers ?? [],
    deskLeftovers: state.deskLeftovers ?? [],
    releases: state.releases ?? [],
    complaints: state.complaints ?? [],
    chat: state.chat ?? [],
    worker: state.worker ? workerWithDefaults(state.worker) : undefined,
    settings: { ...settings, ...state.settings },
    // Whatever the brain was doing when the app closed is long gone.
    brainStatus: 'ok',
  };
}

/** Fields added after the first release, so existing workers survive. */
function workerWithDefaults(worker: Worker): Worker {
  return {
    ...worker,
    ledger: { ...worker.ledger, sabotages: worker.ledger.sabotages ?? 0 },
    recentSabotages: worker.recentSabotages ?? [],
    minutesSinceBreak: worker.minutesSinceBreak ?? 0,
  };
}

/** Write atomically: a crash mid-write leaves the previous save intact. */
export function saveState(path: string, state: GameState): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}
