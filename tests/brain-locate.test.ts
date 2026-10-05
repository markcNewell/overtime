import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkClaude,
  clearLocateCache,
  locateClaude,
  loginShellPath,
  type LocateDeps,
} from '../src/brain/locate';
import { ClaudeError, type Runner } from '../src/brain/runner';

interface Fake {
  deps: LocateDeps;
  execs: string[][];
}

function fakeDeps(opts: {
  platform: NodeJS.Platform;
  files?: string[];
  env?: NodeJS.ProcessEnv;
  exec?: (file: string, args: string[]) => string;
}): Fake {
  const execs: string[][] = [];
  const files = new Set(opts.files ?? []);
  const deps: LocateDeps = {
    platform: opts.platform,
    env: opts.env ?? {},
    home: opts.platform === 'win32' ? 'C:\\Users\\mark' : '/home/mark',
    exec: async (file, args) => {
      execs.push([file, ...args]);
      if (!opts.exec) throw new Error('not found');
      return opts.exec(file, args);
    },
    isFile: async (file) => files.has(file),
  };
  return { deps, execs };
}

beforeEach(() => clearLocateCache());

describe('locateClaude', () => {
  it('uses a configured path that exists', async () => {
    const { deps, execs } = fakeDeps({ platform: 'darwin', files: ['/x/claude'] });
    expect(await locateClaude('/x/claude', deps)).toBe('/x/claude');
    expect(execs).toHaveLength(0);
  });

  it('auto-detects when the configured path is missing', async () => {
    const { deps } = fakeDeps({ platform: 'darwin',
      files: ['/home/mark/.local/bin/claude'] });
    expect(await locateClaude('/gone/claude', deps))
      .toBe('/home/mark/.local/bin/claude');
  });

  it('prefers claude.exe over claude.cmd from where on Windows', async () => {
    const cmd = 'C:\\Users\\mark\\AppData\\Roaming\\npm\\claude.cmd';
    const exe = 'C:\\Users\\mark\\.local\\bin\\claude.exe';
    const { deps } = fakeDeps({
      platform: 'win32',
      files: [cmd, exe],
      exec: () => [cmd.replace(/\.cmd$/, ''), cmd, exe, ''].join('\r\n'),
    });
    expect(await locateClaude('', deps)).toBe(exe);
  });

  it('falls back to the npm shim on Windows', async () => {
    const shim = 'C:\\Users\\mark\\AppData\\Roaming\\npm\\claude.cmd';
    const { deps } = fakeDeps({
      platform: 'win32',
      files: [shim],
      env: {
        USERPROFILE: 'C:\\Users\\mark',
        APPDATA: 'C:\\Users\\mark\\AppData\\Roaming',
      },
    });
    expect(await locateClaude('', deps)).toBe(shim);
  });

  it('asks the login shell on macOS, ignoring rc-file chatter', async () => {
    const { deps, execs } = fakeDeps({
      platform: 'darwin',
      env: { SHELL: '/bin/zsh', PATH: '/usr/bin' },
      files: ['/Users/mark/.nvm/bin/claude'],
      exec: () => 'Welcome to zsh!\n__OVERTIME_START__/Users/mark/.nvm/bin/claude\n' +
        '__OVERTIME_END__',
    });
    expect(await locateClaude('', deps)).toBe('/Users/mark/.nvm/bin/claude');
    expect(execs[0]?.slice(0, 2)).toEqual(['/bin/zsh', '-ilc']);
  });

  it('checks the usual install folders last', async () => {
    const { deps } = fakeDeps({ platform: 'darwin',
      files: ['/opt/homebrew/bin/claude'] });
    expect(await locateClaude('', deps)).toBe('/opt/homebrew/bin/claude');
  });

  it('finds claude on PATH without spawning', async () => {
    const { deps, execs } = fakeDeps({ platform: 'linux',
      env: { PATH: '/a:/b' }, files: ['/b/claude'] });
    expect(await locateClaude('', deps)).toBe('/b/claude');
    expect(execs).toHaveLength(0);
  });

  it('returns null when nothing is found and caches the miss', async () => {
    const { deps, execs } = fakeDeps({ platform: 'darwin' });
    expect(await locateClaude('', deps)).toBeNull();
    const calls = execs.length;
    expect(await locateClaude('', deps)).toBeNull();
    expect(execs.length).toBe(calls);
  });

  it('caches a hit', async () => {
    const { deps, execs } = fakeDeps({
      platform: 'darwin',
      files: ['/u/claude'],
      exec: () => '__OVERTIME_START__/u/claude__OVERTIME_END__',
    });
    await locateClaude('', deps);
    await locateClaude('', deps);
    expect(execs).toHaveLength(1);
  });
});

describe('loginShellPath', () => {
  it('returns the PATH between the markers', async () => {
    const { deps } = fakeDeps({
      platform: 'darwin',
      exec: () => 'motd\n__OVERTIME_START__/opt/homebrew/bin:/usr/bin__OVERTIME_END__',
    });
    expect(await loginShellPath(deps)).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('is null on Windows or when the shell fails', async () => {
    expect(await loginShellPath(fakeDeps({ platform: 'win32' }).deps)).toBeNull();
    clearLocateCache();
    expect(await loginShellPath(fakeDeps({ platform: 'darwin' }).deps)).toBeNull();
  });
});

describe('checkClaude', () => {
  const runner = (reply: string | Error): Runner => ({
    run: async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });

  it('is ok when Claude says ready', async () => {
    const check = await checkClaude(runner('Ready.'));
    expect(check.ok).toBe(true);
    expect(check.message).toMatch(/connected/);
  });

  it('explains a missing CLI', async () => {
    const check = await checkClaude(runner(new ClaudeError('missing', 'gone')));
    expect(check).toEqual({ ok: false, message: expect.stringMatching(
      /Claude CLI not found\. Install Claude Code and log in/) });
  });

  it('explains a logged-out CLI', async () => {
    const check = await checkClaude(runner(new ClaudeError('is-error',
      'Claude CLI error: Invalid API key · Please run /login')));
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/not logged in/);
  });

  it('explains a timeout and a rate limit', async () => {
    const slow = await checkClaude(runner(new ClaudeError('timeout', 'slow')));
    expect(slow.message).toMatch(/too long/);
    const limited = await checkClaude(runner(new ClaudeError('is-error',
      'Claude AI usage limit reached')));
    expect(limited.message).toMatch(/rate-limited/);
  });
});
