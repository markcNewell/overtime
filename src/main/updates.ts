/**
 * Keeps the app up to date from the public GitHub releases.
 *
 * The installed Windows app updates itself: it downloads in the background
 * and installs on restart. The macOS app (not signed with a paid Apple
 * certificate, so it can't replace itself) and the portable Windows exe
 * instead get a notice with a link to the right download.
 */

import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import semver from 'semver';
import type { UpdateNotice } from '../shared/types';
import {
  RELEASES_API,
  downloadUrl,
  newestRelease,
  releaseVersion,
  type GithubRelease,
} from './releases';

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 60 * 60_000;
/** Opening the office checks too, but not more often than this. */
const MIN_GAP_MS = 5 * 60_000;

export interface UpdaterDeps {
  onNotice(notice: UpdateNotice): void;
  log(message: string, err?: unknown): void;
}

export class Updater {
  private lastCheck = 0;
  private notice: UpdateNotice | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** electron-builder's portable exe sets this; it can't update itself. */
  private readonly portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  private readonly selfUpdating = process.platform === 'win32' && !this.portable;

  constructor(private readonly deps: UpdaterDeps) {}

  /** Check shortly after launch, then every hour. Skipped when unpackaged. */
  start(): void {
    if (!app.isPackaged) return;
    if (this.selfUpdating) this.wireAutoUpdater();
    setTimeout(() => this.check(), FIRST_CHECK_MS);
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** A nudge (e.g. the office opened): check unless we just did. */
  checkSoon(): void {
    if (!app.isPackaged || Date.now() - this.lastCheck < MIN_GAP_MS) return;
    this.check();
  }

  /** Restart into a downloaded update, or open the download in the browser. */
  install(): void {
    const notice = this.notice;
    if (!notice) return;
    if (notice.stage === 'ready') {
      // Let windows close first; quitAndInstall then runs the installer.
      setImmediate(() => autoUpdater.quitAndInstall());
      return;
    }
    if (notice.stage === 'download' && notice.url) void shell.openExternal(notice.url);
  }

  private check(): void {
    this.lastCheck = Date.now();
    const work = this.selfUpdating ? autoUpdater.checkForUpdates() : this.checkReleases();
    void Promise.resolve(work).catch((err) => this.deps.log('Update check failed', err));
  }

  private wireAutoUpdater(): void {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Testers on an alpha keep getting alphas.
    autoUpdater.allowPrerelease = semver.prerelease(app.getVersion()) !== null;
    autoUpdater.on('update-available', (info) => {
      this.announce({ version: info.version, stage: 'downloading' });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.announce({ version: info.version, stage: 'ready' });
    });
    autoUpdater.on('error', (err) => this.deps.log('Auto-update failed', err));
  }

  private async checkReleases(): Promise<void> {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Overtime' },
    });
    if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`);
    const release = newestRelease((await res.json()) as GithubRelease[], app.getVersion());
    if (!release) return;
    this.announce({
      version: releaseVersion(release),
      stage: 'download',
      url: downloadUrl(release, process.platform, process.arch, this.portable),
    });
  }

  private announce(notice: UpdateNotice): void {
    const same = this.notice?.version === notice.version && this.notice.stage === notice.stage;
    if (same) return;
    this.notice = notice;
    this.deps.onNotice(notice);
  }
}
