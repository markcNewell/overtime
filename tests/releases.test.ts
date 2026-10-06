import { describe, expect, it } from 'vitest';
import {
  downloadUrl,
  newestRelease,
  releaseVersion,
  type GithubRelease,
} from '../src/main/releases';

function release(tag: string, prerelease: boolean, names: string[] = []): GithubRelease {
  return {
    tag_name: tag,
    draft: false,
    prerelease,
    html_url: `https://github.com/markcNewell/overtime/releases/tag/${tag}`,
    assets: names.map((name) => ({ name, browser_download_url: `https://dl/${name}` })),
  };
}

const RELEASES = [
  release('v0.1.0-alpha.1', true),
  release('v0.1.0-alpha.3', true, [
    'Overtime-0.1.0-alpha.3-arm64.dmg',
    'Overtime-0.1.0-alpha.3.dmg',
    'Overtime-0.1.0-alpha.3-portable.exe',
    'Overtime-Setup-0.1.0-alpha.3.exe',
    'latest.yml',
  ]),
  release('v0.1.0-alpha.2', true),
];

describe('newestRelease', () => {
  it('offers the newest alpha to someone on an alpha', () => {
    expect(newestRelease(RELEASES, '0.1.0-alpha.2')?.tag_name).toBe('v0.1.0-alpha.3');
  });

  it('says nothing when already up to date', () => {
    expect(newestRelease(RELEASES, '0.1.0-alpha.3')).toBeUndefined();
  });

  it('keeps people on stable versions away from pre-releases', () => {
    const list = [...RELEASES, release('v0.2.0', false), release('v0.3.0-beta.1', true)];
    expect(newestRelease(list, '0.1.0')?.tag_name).toBe('v0.2.0');
  });

  it('prefers a stable release over an older alpha of it', () => {
    const list = [...RELEASES, release('v0.1.0', false)];
    expect(newestRelease(list, '0.1.0-alpha.3')?.tag_name).toBe('v0.1.0');
  });

  it('ignores drafts and odd tags', () => {
    const draft = { ...release('v9.0.0', false), draft: true };
    expect(newestRelease([draft, release('nightly', true)], '0.1.0')).toBeUndefined();
  });
});

describe('downloadUrl', () => {
  const r = RELEASES[1]!;

  it('picks the right file for each machine', () => {
    expect(downloadUrl(r, 'darwin', 'arm64', false)).toBe('https://dl/Overtime-0.1.0-alpha.3-arm64.dmg');
    expect(downloadUrl(r, 'darwin', 'x64', false)).toBe('https://dl/Overtime-0.1.0-alpha.3.dmg');
    expect(downloadUrl(r, 'win32', 'x64', true)).toBe('https://dl/Overtime-0.1.0-alpha.3-portable.exe');
    expect(downloadUrl(r, 'win32', 'x64', false)).toBe('https://dl/Overtime-Setup-0.1.0-alpha.3.exe');
  });

  it('falls back to the release page', () => {
    expect(downloadUrl(r, 'linux', 'x64', false)).toBe(r.html_url);
  });

  it('strips the v from the tag', () => {
    expect(releaseVersion(r)).toBe('0.1.0-alpha.3');
  });
});
