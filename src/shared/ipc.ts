/**
 * The bridge between the Electron main process and the two windows.
 *
 * The preload script exposes `window.overtime` with exactly this shape, and
 * the main process registers one handler per channel in `CHANNELS`.
 */

import type {
  BossAction,
  ChatTone,
  EndingKind,
  GameState,
  Settings,
} from './types';

export type OfficeTab =
  | 'hire'
  | 'projects'
  | 'staff'
  | 'inbox'
  | 'chat'
  | 'settings';

/** One-off visual effects the overlay plays on top of the normal pose. */
export type Effect =
  | { type: 'zap' }
  | { type: 'smoke' }
  | { type: 'level-up' }
  | { type: 'confetti' }
  /** Their monitor glitches: the boss just broke their code. */
  | { type: 'glitch' }
  /** A new email (HR complaint) just landed: the envelope pops. */
  | { type: 'email' }
  /** A brief facial reaction to what the boss just said. */
  | { type: 'react'; tone: ChatTone }
  | { type: 'ending'; kind: EndingKind };

/** Boss actions the windows can send directly; chat goes via `chat()`. */
export type DirectAction = Exclude<BossAction, { type: 'chat' }>;

export interface ClaudeCheck {
  ok: boolean;
  message: string;
}

export interface OvertimeApi {
  getState(): Promise<GameState>;
  /** Called with the full state after every change. Returns an unsubscribe. */
  onState(cb: (state: GameState) => void): () => void;
  onEffect(cb: (effect: Effect) => void): () => void;
  /** Office window only: told which tab to show each time it is opened. */
  onOfficeTab(cb: (tab: OfficeTab) => void): () => void;
  act(action: DirectAction): Promise<void>;
  chat(text: string): Promise<void>;
  hire(candidateId: string): Promise<void>;
  rerollCandidates(): Promise<void>;
  assign(pitchId: string): Promise<void>;
  /** Mark an HR complaint as opened. */
  readComplaint(id: string): void;
  /** Answer an HR complaint; the worker's response arrives via state. */
  replyToComplaint(id: string, text: string): Promise<void>;
  openOffice(tab?: OfficeTab): void;
  /** Open a file or folder with the OS default app. */
  openPath(path: string): void;
  /**
   * The overlay is click-through except over its interactive parts; the
   * overlay calls this as the pointer enters or leaves them.
   */
  setInteractive(on: boolean): void;
  /**
   * Give this window the keyboard. The overlay is shown without activating,
   * so a click into its chat box alone may not move focus on every OS.
   */
  focusWindow(): void;
  /**
   * Hide this window. The office panel must use this, not window.close():
   * a page closing itself destroys its window outright.
   */
  hideWindow(): void;
  /** Restart into a downloaded update, or open its download. */
  installUpdate(): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  testClaude(): Promise<ClaudeCheck>;
}

export const CHANNELS = {
  getState: 'overtime:get-state',
  state: 'overtime:state',
  effect: 'overtime:effect',
  act: 'overtime:act',
  chat: 'overtime:chat',
  hire: 'overtime:hire',
  rerollCandidates: 'overtime:reroll-candidates',
  assign: 'overtime:assign',
  readComplaint: 'overtime:read-complaint',
  replyToComplaint: 'overtime:reply-complaint',
  openOffice: 'overtime:open-office',
  openPath: 'overtime:open-path',
  setInteractive: 'overtime:set-interactive',
  focusWindow: 'overtime:focus-window',
  hideWindow: 'overtime:hide-window',
  installUpdate: 'overtime:install-update',
  updateSettings: 'overtime:update-settings',
  testClaude: 'overtime:test-claude',
  officeTab: 'overtime:office-tab',
} as const;

declare global {
  interface Window {
    overtime: OvertimeApi;
  }
}
