/**
 * Reading the GitHub releases list: which release is newer than this app,
 * and which of its files suits this machine. Pure, so it can be tested
 * without Electron.
 */

import semver from 'semver';

export const RELEASES_API =
  'https://api.github.com/repos/markcNewell/overtime/releases?per_page=20';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** The fields we use from GitHub's release JSON. */
export interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: ReleaseAsset[];
}

/**
 * The newest published release that is newer than `current`.
 *
 * Pre-releases only count when the running app is itself a pre-release, so
 * testers keep getting alphas and everyone else only stable versions.
 *
 * @param releases - GitHub's release list, any order.
 * @param current - The running app's version, e.g. "0.1.0-alpha.2".
 * @returns The release to offer, or undefined if up to date.
 */
export function newestRelease(
  releases: GithubRelease[],
  current: string,
): GithubRelease | undefined {
  const testing = semver.prerelease(current) !== null;
  let best: { release: GithubRelease; version: string } | undefined;
  for (const release of releases) {
    if (release.draft || (release.prerelease && !testing)) continue;
    const version = semver.valid(semver.clean(release.tag_name));
    if (!version || !semver.gt(version, current)) continue;
    if (!best || semver.gt(version, best.version)) best = { release, version };
  }
  return best?.release;
}

/** The release's version without the leading "v". */
export function releaseVersion(release: GithubRelease): string {
  return semver.clean(release.tag_name) ?? release.tag_name;
}

/**
 * The download that suits this machine, or the release page if none fits.
 *
 * @param release - The release on offer.
 * @param platform - `process.platform`.
 * @param arch - `process.arch`.
 * @param portable - True for the portable Windows exe.
 * @returns A URL to open in the browser.
 */
export function downloadUrl(
  release: GithubRelease,
  platform: string,
  arch: string,
  portable: boolean,
): string {
  const match = release.assets.find((a) => suits(a.name, platform, arch, portable));
  return match?.browser_download_url ?? release.html_url;
}

function suits(name: string, platform: string, arch: string, portable: boolean): boolean {
  if (platform === 'darwin') {
    if (!name.endsWith('.dmg')) return false;
    return arch === 'arm64' ? name.includes('arm64') : !name.includes('arm64');
  }
  if (platform === 'win32') {
    if (!name.endsWith('.exe')) return false;
    return portable ? name.includes('portable') : name.includes('Setup');
  }
  return false;
}
