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

/** The office panel's size, including a margin for its drop shadow. */
const PANEL = { width: 396, height: 500, minHeight: 360 } as const;
/** How much of the overlay's top is empty sky the panel may overlap. */
const OVERLAY_SKY = 40;

/**
 * Where the office panel goes: directly above the corner scene if the screen
 * is tall enough, otherwise beside it, so it always looks attached.
 */
function panelBounds(overlay: BrowserWindow): Electron.Rectangle {
  const o = overlay.getBounds();
  const area = screen.getDisplayMatching(o).workArea;
  const right = o.x + o.width;
  const above = o.y + OVERLAY_SKY - area.y;
  if (above >= PANEL.minHeight + 20) {
    const height = Math.min(PANEL.height, above);
    return { x: right - PANEL.width, y: o.y + OVERLAY_SKY - height, width: PANEL.width, height };
  }
  const height = Math.min(PANEL.height, o.y + o.height - area.y);
  return { x: o.x - PANEL.width, y: o.y + o.height - height, width: PANEL.width, height };
}

/**
 * The office: a small panel that pops up next to the worker, like a tray
 * menu. Created on first use and hidden, not destroyed, so it reopens
 * instantly. It hides itself when you click away.
 */
export class OfficeWindow {
  private win: BrowserWindow | null = null;
  private quitting = false;

  constructor(
    private readonly overlay: BrowserWindow,
    private settings: Settings,
  ) {}

  /**
   * Show the office on `tab`. `focus` is false when the game opens it by
   * itself, so it never steals the keyboard from whatever you're typing in.
   */
  open(tab: OfficeTab, focus = true): void {
    const win = this.win ?? this.create();
    const send = (): void => win.webContents.send(CHANNELS.officeTab, tab);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
    win.setBounds(panelBounds(this.overlay));
    if (focus) {
      win.show();
      win.focus();
    } else if (!win.isVisible()) {
      win.showInactive();
    }
  }

  get window(): BrowserWindow | null {
    return this.win;
  }

  /** Keep the panel's stacking and screen-share hiding in step with the overlay. */
  applySettings(settings: Settings): void {
    this.settings = settings;
    if (this.win && !this.win.isDestroyed()) applyOverlaySettings(this.win, settings);
  }

  /** Let the window really close when the app quits. */
  allowClose(): void {
    this.quitting = true;
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      ...panelBounds(this.overlay),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      title: 'Overtime: The Office',
      webPreferences,
    });
    applyOverlaySettings(win, this.settings);
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    void win.loadFile(join(__dirname, 'renderer/office/index.html'));
    win.on('close', (event) => {
      if (this.quitting) return;
      event.preventDefault();
      win.hide();
    });
    // Like a tray menu: click anywhere else and it tucks itself away.
    win.on('blur', () => {
      if (!this.quitting && !win.isDestroyed()) win.hide();
    });
    this.win = win;
    return win;
  }
}
