/**
 * The two windows: the transparent corner overlay and the office.
 */

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { CHANNELS, type OfficeTab } from '../shared/ipc';
import type { Settings } from '../shared/types';

export const OVERLAY_SIZE = { width: 380, height: 320 } as const;
/** Gap between the overlay and the screen edge. */
const EDGE_MARGIN = 8;

const preload = join(__dirname, 'preload.js');

const webPreferences = {
  preload,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

/** Bottom-right of the primary screen's work area (above taskbar/dock). */
function cornerPosition(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - OVERLAY_SIZE.width - EDGE_MARGIN,
    y: area.y + area.height - OVERLAY_SIZE.height,
  };
}

/** Create the always-on-top, click-through corner scene. */
export function createOverlay(settings: Settings): BrowserWindow {
  const win = new BrowserWindow({
    ...OVERLAY_SIZE,
    ...cornerPosition(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Focusable so the inline chat field can take keyboard input.
    focusable: true,
    show: false,
    title: 'Overtime',
    webPreferences,
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  applyOverlaySettings(win, settings);
  void win.loadFile(join(__dirname, 'renderer/overlay/index.html'));
  win.once('ready-to-show', () => win.showInactive());
  screen.on('display-metrics-changed', () => keepInCorner(win));
  screen.on('display-removed', () => keepInCorner(win));
  return win;
}

function keepInCorner(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const { x, y } = cornerPosition();
  win.setPosition(x, y);
}

/** Apply the settings that change how the overlay sits on the desktop. */
export function applyOverlaySettings(
  win: BrowserWindow,
  settings: Settings,
): void {
  // 'floating' keeps it above normal windows on macOS without covering
  // menus; Windows ignores the level.
  win.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  win.setContentProtection(settings.hideFromScreenShare);
}

/** Toggle click-through. Forwarding keeps hover tracking alive. */
export function setOverlayInteractive(win: BrowserWindow, on: boolean): void {
  if (win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!on, { forward: true });
}

/**
 * The office is created on first use and hidden, not destroyed, on close so
 * reopening it is instant.
 */
export class OfficeWindow {
  private win: BrowserWindow | null = null;
  private quitting = false;

  /** Show the office on `tab`, creating it if needed. */
  open(tab: OfficeTab): void {
    const win = this.win ?? this.create();
    const send = (): void => win.webContents.send(CHANNELS.officeTab, tab);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
    win.show();
    win.focus();
  }

  get window(): BrowserWindow | null {
    return this.win;
  }

  /** Let the window really close when the app quits. */
  allowClose(): void {
    this.quitting = true;
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: 820,
      height: 640,
      minWidth: 640,
      minHeight: 480,
      title: 'Overtime: The Office',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f6f1e7',
      webPreferences,
    });
    void win.loadFile(join(__dirname, 'renderer/office/index.html'));
    win.on('close', (event) => {
      if (this.quitting) return;
      event.preventDefault();
      win.hide();
    });
    this.win = win;
    return win;
  }
}
