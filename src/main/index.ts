/**
 * Electron entry point: wires the windows, tray, brain, files and the
 * director together, and routes IPC from the windows.
 */

import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  shell,
} from 'electron';
import { mkdirSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import {
  Brain,
  ClaudeRunner,
  checkClaude,
  locateClaude,
  loginShellPath,
} from '../brain';
import {
  dayStamp,
  slugify,
  startProjectFolder,
  writePitchBrief,
  writeReleaseNotes,
} from '../files/briefs';
import * as game from '../game';
import {
  CHANNELS,
  type DirectAction,
  type OfficeTab,
} from '../shared/ipc';
import type { Settings } from '../shared/types';
import { Director, type FilesLike } from './director';
import { defaultSettings, loadState, saveState } from './save';
import { OvertimeTray } from './tray';
import { Updater } from './updates';
import {
  OfficeWindow,
  applyOverlaySettings,
  createOverlay,
  setOverlayInteractive,
} from './windows';

const TOGGLE_SHORTCUT = 'CommandOrControl+Alt+Shift+O';
const OFFICE_TABS: OfficeTab[] = ['hire', 'projects', 'staff', 'inbox', 'chat', 'settings'];
const ACTIONS: DirectAction['type'][] = [
  'shock',
  'shout',
  'praise',
  'coffee',
  'bonus',
  'fire',
  'sabotage',
  'deny-coffee',
];

const files: FilesLike = {
  writePitchBrief,
  startProjectFolder,
  writeReleaseNotes,
  fallbackBriefPath: (filesDir, project, now) =>
    join(filesDir, 'projects', `${dayStamp(now)}-${slugify(project.title)}`, 'brief.md'),
};

/**
 * Apps opened from the macOS Finder get a bare PATH, which hides an
 * npm-installed `claude` and the `node` it needs.
 */
async function fixMacPath(): Promise<void> {
  if (process.platform !== 'darwin') return;
  const shellPath = await loginShellPath();
  if (!shellPath) return;
  const parts = new Set([...shellPath.split(':'), ...(process.env.PATH ?? '').split(':')]);
  process.env.PATH = [...parts].filter(Boolean).join(':');
}

/** True if `target` is inside `folder`, so windows can't open arbitrary paths. */
function isInside(folder: string, target: string): boolean {
  const rel = relative(resolve(folder), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

async function main(): Promise<void> {
  await app.whenReady();
  if (process.platform === 'darwin') app.dock?.hide();
  // The office needs no File/Edit menu bar on Windows. macOS keeps the
  // default menu because copy and paste shortcuts live in it.
  else Menu.setApplicationMenu(null);
  await fixMacPath();

  const userData = app.getPath('userData');
  const savePath = join(userData, 'save.json');
  const brainDir = join(userData, 'brain');
  mkdirSync(brainDir, { recursive: true });

  const defaults = defaultSettings(app.getPath('documents'));
  const initial = loadState(savePath, defaults) ?? game.newGameState(defaults, Date.now());

  // The runner reads settings through the director, which is created below.
  let director: Director | undefined;
  const settings = (): Settings => director?.getState().settings ?? initial.settings;
  const runner = new ClaudeRunner({
    claudePath: () => locateClaude(settings().claudePath),
    model: () => settings().model,
    workDir: brainDir,
    onBusy: (busy) => director?.setBrainBusy(busy),
  });
  const brain = new Brain(runner);

  const overlay = createOverlay(initial.settings);
  const office = new OfficeWindow(overlay, initial.settings);

  const d = new Director(initial, {
    brain,
    files,
    now: Date.now,
    random: Math.random,
    publish: (state) => broadcast(CHANNELS.state, state),
    effect: (effect) => broadcast(CHANNELS.effect, effect),
    save: (state) => saveState(savePath, state),
    openOffice: (tab) => office.open(tab, false),
    log: (message, err) => console.error(`[overtime] ${message}`, err ?? ''),
  });
  director = d;

  const toggleOverlay = (): void => {
    if (overlay.isVisible()) overlay.hide();
    else overlay.showInactive();
    tray?.refresh();
  };

  const updateSettings = (patch: Partial<Settings>): Settings => {
    const next = d.updateSettings(patch);
    applyOverlaySettings(overlay, next);
    office.applySettings(next);
    tray?.refresh();
    return next;
  };

  const openFilesFolder = (): void => {
    const dir = d.getState().settings.filesDir;
    mkdirSync(dir, { recursive: true });
    void shell.openPath(dir);
  };

  const updater = new Updater({
    onNotice: (notice) => {
      d.setUpdate(notice);
      tray?.refresh();
    },
    log: (message, err) => console.error(`[overtime] ${message}`, err ?? ''),
  });
  /** Opening the office is a good moment to look for a new version. */
  const openOffice = (tab: OfficeTab): void => {
    office.open(tab);
    updater.checkSoon();
  };

  // Headless test runs on Linux have no tray to attach a menu to.
  const tray = process.env.OVERTIME_NO_TRAY
    ? undefined
    : new OvertimeTray({
        isOverlayVisible: () => overlay.isVisible(),
        toggleOverlay,
        openOffice,
        settings: () => d.getState().settings,
        update: () => d.getState().update,
        installUpdate: () => updater.install(),
        updateSettings,
        openFilesFolder,
        quit: () => app.quit(),
      });

  registerIpc(d, openOffice, overlay, updateSettings, runner);
  ipcMain.on(CHANNELS.installUpdate, () => updater.install());
  globalShortcut.register(TOGGLE_SHORTCUT, toggleOverlay);

  app.on('second-instance', () => office.open('staff'));
  app.on('before-quit', () => {
    office.allowClose();
    d.stop();
    updater.stop();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  d.start();
  updater.start();
  if (!d.getState().worker) office.open('hire', false);
}

function registerIpc(
  d: Director,
  openOffice: (tab: OfficeTab) => void,
  overlay: BrowserWindow,
  updateSettings: (patch: Partial<Settings>) => Settings,
  runner: ClaudeRunner,
): void {
  ipcMain.handle(CHANNELS.getState, () => d.getState());
  ipcMain.handle(CHANNELS.getVersion, () => app.getVersion());
  ipcMain.handle(CHANNELS.act, (_e, action: DirectAction) => {
    if (ACTIONS.includes(action?.type)) d.act(action);
  });
  ipcMain.handle(CHANNELS.chat, (_e, text: unknown) => {
    if (typeof text === 'string') return d.chat(text);
  });
  ipcMain.handle(CHANNELS.hire, (_e, id: unknown) => {
    if (typeof id === 'string') d.hire(id);
  });
  ipcMain.handle(CHANNELS.rerollCandidates, () => d.rerollCandidates());
  ipcMain.handle(CHANNELS.assign, (_e, id: unknown) => {
    if (typeof id === 'string') return d.assign(id);
  });
  ipcMain.on(CHANNELS.readComplaint, (_e, id: unknown) => {
    if (typeof id === 'string') d.readComplaint(id);
  });
  ipcMain.handle(CHANNELS.replyToComplaint, (_e, id: unknown, text: unknown) => {
    if (typeof id === 'string' && typeof text === 'string') return d.replyToComplaint(id, text);
  });
  ipcMain.handle(CHANNELS.updateSettings, (_e, patch: Partial<Settings>) => {
    updateSettings(sanitiseSettings(patch));
  });
  ipcMain.handle(CHANNELS.testClaude, () => checkClaude(runner));
  ipcMain.on(CHANNELS.openOffice, (_e, tab: unknown) => {
    const valid = OFFICE_TABS.includes(tab as OfficeTab);
    openOffice(valid ? (tab as OfficeTab) : 'staff');
  });
  ipcMain.on(CHANNELS.openPath, (_e, target: unknown) => {
    const dir = d.getState().settings.filesDir;
    if (typeof target === 'string' && isInside(dir, target)) {
      void shell.openPath(target);
    }
  });
  ipcMain.on(CHANNELS.setInteractive, (_e, on: unknown) => {
    setOverlayInteractive(overlay, on === true);
  });
  ipcMain.on(CHANNELS.focusWindow, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.focus();
  });
  ipcMain.on(CHANNELS.hideWindow, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.hide();
  });
}

/** Only accept known settings with the right types from a window. */
function sanitiseSettings(patch: Partial<Settings>): Partial<Settings> {
  const clean: Partial<Settings> = {};
  if (typeof patch?.alwaysOnTop === 'boolean') clean.alwaysOnTop = patch.alwaysOnTop;
  if (typeof patch?.hideFromScreenShare === 'boolean') {
    clean.hideFromScreenShare = patch.hideFromScreenShare;
  }
  if (typeof patch?.claudePath === 'string') clean.claudePath = patch.claudePath.trim();
  if (typeof patch?.model === 'string' && patch.model.trim()) {
    clean.model = patch.model.trim();
  }
  if (typeof patch?.filesDir === 'string' && patch.filesDir.trim()) {
    clean.filesDir = patch.filesDir.trim();
  }
  return clean;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Closing the office must not quit the app; it lives in the tray.
  app.on('window-all-closed', () => undefined);
  main().catch((err) => {
    console.error('[overtime] failed to start', err instanceof Error ? err.stack : err);
    app.quit();
  });
}
