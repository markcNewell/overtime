/**
 * Finding the user's `claude` CLI, and checking it answers.
 *
 * Apps launched from the macOS Finder or the Windows Start menu don't get
 * the PATH a terminal has, so a plain `claude` lookup often fails. This
 * tries the configured path, PATH, the login shell, and the usual install
 * locations, in that order.
 */

import { execFile as nodeExecFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeCheck } from '../shared/ipc';
import { ClaudeError, type Runner } from './runner';

/** Things locate needs from the OS, injectable for tests. */
export interface LocateDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** Resolve with stdout, or reject on failure or timeout. */
  exec: (file: string, args: string[], timeoutMs: number) => Promise<string>;
  isFile: (file: string) => Promise<boolean>;
}

const SHELL_TIMEOUT_MS = 5_000;
const MISS_CACHE_MS = 60_000;
const START = '__OVERTIME_START__';
const END = '__OVERTIME_END__';

function defaultExec(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    nodeExecFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

async function defaultIsFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function defaultDeps(): LocateDeps {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    exec: defaultExec,
    isFile: defaultIsFile,
  };
}

let found: { path: string | null; at: number } | undefined;
let shellPath: Promise<string | null> | undefined;

/** Forget cached lookups, e.g. after the user installs Claude. */
export function clearLocateCache(): void {
  found = undefined;
  shellPath = undefined;
}

/** First path in `paths` that exists as a file. */
async function firstFile(
  paths: readonly string[],
  deps: LocateDeps,
): Promise<string | null> {
  for (const p of paths) {
    if (p && (await deps.isFile(p))) return p;
  }
  return null;
}

/** Text between the markers, so rc-file chatter doesn't leak in. */
function between(stdout: string): string | null {
  const start = stdout.lastIndexOf(START);
  const end = stdout.lastIndexOf(END);
  if (start < 0 || end <= start) return null;
  return stdout.slice(start + START.length, end).trim();
}

/** Run a command in the user's interactive login shell. */
async function loginShell(
  command: string,
  deps: LocateDeps,
): Promise<string | null> {
  const fallback = deps.platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
  const shell = deps.env.SHELL || fallback;
  const script = `printf '%s' '${START}'; ${command}; printf '%s' '${END}'`;
  try {
    const out = await deps.exec(shell, ['-ilc', script], SHELL_TIMEOUT_MS);
    return between(out);
  } catch {
    return null;
  }
}

/** Rank `where` output: real executables before npm's .cmd shims. */
function rankWindows(lines: string[]): string[] {
  const rank = (p: string): number => {
    if (/\.exe$/i.test(p)) return 0;
    if (/\.(cmd|bat)$/i.test(p)) return 1;
    return 9;
  };
  return lines
    .map((l) => l.trim())
    .filter((l) => rank(l) < 9)
    .sort((a, b) => rank(a) - rank(b));
}

async function locateWindows(deps: LocateDeps): Promise<string | null> {
  try {
    const out = await deps.exec('where', ['claude'], SHELL_TIMEOUT_MS);
    const hit = await firstFile(rankWindows(out.split(/\r?\n/)), deps);
    if (hit) return hit;
  } catch {
    // `where` exits 1 when nothing matches.
  }
  const profile = deps.env.USERPROFILE || deps.home;
  const appData = deps.env.APPDATA || path.win32.join(profile, 'AppData',
    'Roaming');
  return firstFile([
    path.win32.join(profile, '.local', 'bin', 'claude.exe'),
    path.win32.join(appData, 'npm', 'claude.cmd'),
  ], deps);
}

/** `claude` on the current PATH, without spawning anything. */
async function onPath(deps: LocateDeps): Promise<string | null> {
  const dirs = (deps.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return firstFile(dirs.map((d) => path.join(d, 'claude')), deps);
}

async function locatePosix(deps: LocateDeps): Promise<string | null> {
  const direct = await onPath(deps);
  if (direct) return direct;
  const fromShell = await loginShell('command -v claude', deps);
  const line = fromShell?.split(/\r?\n/).find((l) => l.startsWith('/'));
  if (line && (await deps.isFile(line))) return line;
  return firstFile([
    path.posix.join(deps.home, '.local', 'bin', 'claude'),
    path.posix.join(deps.home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ], deps);
}

/**
 * Find the Claude CLI.
 *
 * Auto-detected results are cached (a miss only for a minute, so a fresh
 * install is picked up without a restart).
 *
 * @param configured - The Settings path; '' means auto-detect.
 * @param deps - OS seams for tests.
 * @returns The CLI's path, or null if it can't be found.
 */
export async function locateClaude(
  configured: string,
  deps: LocateDeps = defaultDeps(),
): Promise<string | null> {
  const wanted = configured.trim();
  if (wanted && (await deps.isFile(wanted))) return wanted;
  const now = Date.now();
  if (found?.path && (await deps.isFile(found.path))) return found.path;
  if (found && found.path === null && now - found.at < MISS_CACHE_MS) {
    return null;
  }
  const hit = deps.platform === 'win32'
    ? await locateWindows(deps)
    : await locatePosix(deps);
  found = { path: hit, at: now };
  return hit;
}

/**
 * The PATH a login shell would have, for apps launched from the Finder.
 *
 * An npm-installed `claude` is a node script, so `node` must be on PATH
 * too; main merges this into `process.env.PATH` at startup on macOS.
 *
 * @param deps - OS seams for tests.
 * @returns The login shell's PATH, or null on Windows or failure.
 */
export function loginShellPath(
  deps: LocateDeps = defaultDeps(),
): Promise<string | null> {
  if (deps.platform === 'win32') return Promise.resolve(null);
  shellPath ??= loginShell('printf "%s" "$PATH"', deps)
    .then((p) => (p ? p : null));
  return shellPath;
}

/** Map a failed call to advice the user can act on. */
function adviceFor(err: unknown): string {
  const why = err instanceof Error ? err.message : String(err);
  const kind = err instanceof ClaudeError ? err.kind : undefined;
  if (kind === 'missing') {
    return 'Claude CLI not found. Install Claude Code and log in, ' +
      'or set its path in Settings.';
  }
  if (kind === 'timeout') {
    return 'Claude took too long to answer. Check your connection and try ' +
      'again.';
  }
  if (/log ?in|auth|api key|credential|unauthori[sz]ed/i.test(why)) {
    return 'Claude Code is installed but not logged in. Run `claude` in a ' +
      'terminal, log in, then test again.';
  }
  if (/limit|rate|quota|overloaded|429|529/i.test(why)) {
    return 'Claude is rate-limited right now. Your worker will improvise ' +
      'until it clears.';
  }
  return `Claude CLI failed: ${why}`;
}

/**
 * Make a tiny real call to prove the CLI works and is logged in.
 *
 * @param runner - The runner the game will use.
 * @returns ok plus a friendly message either way.
 */
export async function checkClaude(runner: Runner): Promise<ClaudeCheck> {
  try {
    const reply = await runner.run(
      'You are a connectivity check. Answer with one word.',
      'Reply with the word ready',
      { priority: 'high', timeoutMs: 45_000 },
    );
    if (/ready/i.test(reply)) {
      return { ok: true, message: 'Claude is connected. Your worker has a ' +
        'brain (allegedly).' };
    }
    return {
      ok: true,
      message: `Claude answered, a bit oddly: "${reply.trim().slice(0, 60)}"`,
    };
  } catch (err) {
    return { ok: false, message: adviceFor(err) };
  }
}
