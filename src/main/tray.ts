/**
 * The tray (Windows) / menu bar (macOS) icon: the only way to quit, and the
 * quick switches for screen sharing.
 */

import { Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
import type { OfficeTab } from '../shared/ipc';
import type { Settings, UpdateNotice } from '../shared/types';

export interface TrayActions {
  isOverlayVisible(): boolean;
  toggleOverlay(): void;
  openOffice(tab: OfficeTab): void;
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
  openFilesFolder(): void;
  update(): UpdateNotice | undefined;
  installUpdate(): void;
  quit(): void;
}

/** macOS wants a black "Template" image it can tint for light/dark bars. */
function trayIcon(): Electron.NativeImage {
  const name = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  return nativeImage.createFromPath(join(__dirname, 'assets', name));
}

export class OvertimeTray {
  private readonly tray: Tray;

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(trayIcon());
    this.tray.setToolTip('Overtime');
    // On Windows a left click should do the obvious thing.
    this.tray.on('click', () => {
      if (process.platform !== 'darwin') actions.toggleOverlay();
    });
    this.refresh();
  }

  /** Rebuild the menu so checkmarks and labels match the current state. */
  refresh(): void {
    const a = this.actions;
    const settings = a.settings();
    const menu = Menu.buildFromTemplate([
      {
        label: a.isOverlayVisible() ? 'Hide worker' : 'Show worker',
        accelerator: 'CommandOrControl+Alt+Shift+O',
        click: () => a.toggleOverlay(),
      },
      { label: 'Open the office', click: () => a.openOffice('staff') },
      { type: 'separator' },
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: settings.alwaysOnTop,
        click: (item) => a.updateSettings({ alwaysOnTop: item.checked }),
      },
      {
        label: 'Hide from screen share',
        type: 'checkbox',
        checked: settings.hideFromScreenShare,
        click: (item) => a.updateSettings({ hideFromScreenShare: item.checked }),
      },
      { type: 'separator' },
      { label: 'Open files folder', click: () => a.openFilesFolder() },
      { label: 'Settings...', click: () => a.openOffice('settings') },
      ...this.updateItems(),
      { type: 'separator' },
      { label: 'Quit Overtime', click: () => a.quit() },
    ]);
    this.tray.setContextMenu(menu);
  }

  /** "Restart to update" or "Download …" once a newer version is out. */
  private updateItems(): Electron.MenuItemConstructorOptions[] {
    const notice = this.actions.update();
    if (!notice || notice.stage === 'downloading') return [];
    const label =
      notice.stage === 'ready'
        ? `Restart to update to ${notice.version}`
        : `Download Overtime ${notice.version}`;
    return [{ type: 'separator' }, { label, click: () => this.actions.installUpdate() }];
  }
}
