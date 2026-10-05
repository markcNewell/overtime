/**
 * The brain: Claude CLI runner, prompts, parsing and canned fallbacks.
 *
 * Main wires it up roughly like this:
 *
 * ```ts
 * const runner = new ClaudeRunner({
 *   claudePath: () => locateClaude(state.settings.claudePath),
 *   model: () => state.settings.model || 'haiku',
 *   workDir: path.join(app.getPath('userData'), 'brain'),
 *   onBusy: (busy) => setBrainStatus(busy ? 'thinking' : lastStatus),
 * });
 * const brain = new Brain(runner);
 * ```
 */

export { Brain } from './brain';
export type { ChatReply, Farewell, WorkerLine } from './types';
export {
  ClaudeError,
  ClaudeRunner,
  type ClaudeErrorKind,
  type ClaudeRunnerOptions,
  type RunOptions,
  type RunStats,
  type Runner,
} from './runner';
export {
  checkClaude,
  clearLocateCache,
  locateClaude,
  loginShellPath,
} from './locate';
export { guessTone } from './fallback';
