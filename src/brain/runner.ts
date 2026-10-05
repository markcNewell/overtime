/**
 * Runs one-shot `claude -p` calls on the user's own subscription.
 *
 * Calls are queued and run one at a time so the worker never hammers the
 * user's rate limit; chat jumps the queue so the boss is never kept waiting
 * behind an ambient thought.
 */

import {
  spawn as nodeSpawn,
  type SpawnOptions,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { extractJson, asRecord } from './parse';

/** Per-call options. */
export interface RunOptions {
  /** `high` (chat) runs before any queued `normal` call. */
  priority?: 'high' | 'normal';
  /** Kill the process after this long. Default 60 s. */
  timeoutMs?: number;
}

/** Anything that can answer a system prompt + prompt with text. */
export interface Runner {
  run(system: string, prompt: string, opts?: RunOptions): Promise<string>;
}

/** Why a call failed, so the UI can say something useful. */
export type ClaudeErrorKind =
  | 'missing'
  | 'timeout'
  | 'exit'
  | 'is-error'
  | 'bad-output';

/** A failed CLI call. `kind` says which way it failed. */
export class ClaudeError extends Error {
  constructor(
    readonly kind: ClaudeErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ClaudeError';
  }
}

/** The bits of a child process the runner uses; real or faked in tests. */
export interface ChildLike {
  readonly pid?: number | undefined;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;
}

/** Same shape as `child_process.spawn`, injectable for tests. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildLike;

/** Measurements from the last successful call, for logging. */
export interface RunStats {
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** Constructor options for `ClaudeRunner`. */
export interface ClaudeRunnerOptions {
  /** Resolved per call so a changed Settings path applies at once. */
  claudePath: () => Promise<string | null>;
  /** Model alias, `haiku` by default. */
  model: () => string;
  /** An empty folder the app owns; prompt and settings files go here. */
  workDir: string;
  /** Called with true when work starts and false when the queue drains. */
  onBusy?: (busy: boolean) => void;
  /** Test seam: defaults to `child_process.spawn`. */
  spawn?: SpawnFn;
  /** Test seam: defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Test seam: defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

interface Job {
  system: string;
  prompt: string;
  priority: 'high' | 'normal';
  timeoutMs: number;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const STDERR_LIMIT = 4_000;
const BRAIN_SETTINGS = JSON.stringify({ alwaysThinkingEnabled: false });

/**
 * Variables a parent Claude Code session sets for its own children. Passing
 * them on (when the app is started from a Claude Code terminal) would tie
 * the worker's calls to that session.
 */
const SESSION_ENV = new RegExp(
  '^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT|CLAUDE_CODE_(' +
    'SESSION|CHILD|BRIDGE|MESSAGING|SSE|ENTRYPOINT|WORKER|EXECPATH|' +
    'ENVIRONMENT_KIND)\\w*)$',
);

/**
 * Quote one argument for `cmd.exe`, which is what runs a `.cmd` shim.
 *
 * Node joins `shell: true` arguments with spaces, so empty strings vanish
 * and paths with spaces split unless quoted. Inner quotes are doubled,
 * which both cmd.exe and the MSVC argv parser read as a literal quote.
 *
 * @param arg - One raw argument.
 * @returns The argument, quoted if it needs to be.
 */
export function quoteWindowsArg(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"&|<>^()%!,;=]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Whether a CLI path is a batch shim that must run through the shell.
 *
 * @param file - The resolved CLI path.
 * @param platform - The OS.
 * @returns True for `.cmd` / `.bat` on Windows.
 */
export function needsShell(file: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(file);
}

/**
 * The fixed `claude -p` argument list.
 *
 * @param model - Model alias.
 * @param systemFile - Path of the system prompt file.
 * @param settingsFile - Path of the thinking-off settings file.
 * @returns Arguments for the CLI.
 */
export function claudeArgs(
  model: string,
  systemFile: string,
  settingsFile: string,
): string[] {
  return [
    '-p',
    '--model', model,
    '--output-format', 'json',
    '--tools', '',
    '--system-prompt-file', systemFile,
    '--no-session-persistence',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--settings', settingsFile,
  ];
}

/** The parent env minus Claude Code session vars, with thinking off. */
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!SESSION_ENV.test(key)) out[key] = value;
  }
  out.MAX_THINKING_TOKENS = '0';
  return out;
}

/** First line of a CLI message, trimmed to something a toast can show. */
function snippet(text: string): string {
  const line = text.trim().split(/\r?\n/).find((l) => l.trim()) ?? '';
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

interface Envelope {
  result?: unknown;
  is_error?: unknown;
  subtype?: unknown;
  total_cost_usd?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

function readEnvelope(stdout: string): Envelope | null {
  try {
    return asRecord(JSON.parse(stdout.trim())) as Envelope | null;
  } catch {
    // Some versions print a warning line first; fall back to a search.
  }
  try {
    return asRecord(extractJson(stdout)) as Envelope | null;
  } catch {
    return null;
  }
}

function finite(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

/**
 * Turn the CLI's stdout into reply text, or throw a `ClaudeError`.
 *
 * @param stdout - The CLI's whole stdout.
 * @param code - Exit code.
 * @param stderr - The CLI's stderr, for the error message.
 * @returns The reply text and its usage figures.
 */
export function readResult(
  stdout: string,
  code: number | null,
  stderr: string,
): { text: string; envelope: Envelope } {
  const envelope = readEnvelope(stdout);
  const result = typeof envelope?.result === 'string' ? envelope.result : '';
  if (envelope && (envelope.is_error === true ||
      (envelope.subtype !== undefined && envelope.subtype !== 'success'))) {
    const why = snippet(result) || String(envelope.subtype ?? 'unknown');
    throw new ClaudeError('is-error', `Claude CLI error: ${why}`);
  }
  if (code !== 0) {
    const why = snippet(stderr) || snippet(stdout) || 'no output';
    throw new ClaudeError('exit', `Claude CLI exited with code ${code}: ${why}`);
  }
  if (!envelope || typeof envelope.result !== 'string') {
    throw new ClaudeError('bad-output', 'Claude CLI gave no result text');
  }
  return { text: result, envelope };
}

/** Runs `claude -p` calls one at a time from a queue. */
export class ClaudeRunner implements Runner {
  /** Timing and tokens of the last successful call. */
  lastStats?: RunStats;

  private readonly queue: Job[] = [];
  private running = false;
  private busy = false;
  private readonly spawnFn: SpawnFn;
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;

  /**
   * @param opts - Where the CLI is, which model, and the work folder.
   */
  constructor(private readonly opts: ClaudeRunnerOptions) {
    this.spawnFn = opts.spawn ?? (nodeSpawn as unknown as SpawnFn);
    this.platform = opts.platform ?? process.platform;
    this.env = opts.env ?? process.env;
  }

  /**
   * Queue one call and resolve with Claude's reply text.
   *
   * @param system - The system prompt (written to a temp file).
   * @param prompt - The user prompt (sent on stdin).
   * @param opts - Priority and timeout.
   * @returns The `.result` text from the CLI's JSON envelope.
   * @throws ClaudeError when the CLI is missing, fails, times out or
   *   reports an error.
   */
  run(system: string, prompt: string, opts: RunOptions = {}): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.enqueue({
        system,
        prompt,
        priority: opts.priority ?? 'normal',
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  /** Number of calls waiting (not counting the one running). */
  get pending(): number {
    return this.queue.length;
  }

  private enqueue(job: Job): void {
    if (job.priority === 'normal') {
      this.queue.push(job);
      return;
    }
    // High jobs go after earlier high jobs but before every normal one.
    const firstNormal = this.queue.findIndex((j) => j.priority === 'normal');
    if (firstNormal < 0) this.queue.push(job);
    else this.queue.splice(firstNormal, 0, job);
  }

  private pump(): void {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = true;
    this.setBusy(true);
    this.execute(job)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.running = false;
        if (this.queue.length === 0) this.setBusy(false);
        this.pump();
      });
  }

  /** Report only changes, so a burst of calls is one 'thinking' spell. */
  private setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    this.opts.onBusy?.(busy);
  }

  private async execute(job: Job): Promise<string> {
    const file = await this.opts.claudePath();
    if (!file) {
      throw new ClaudeError(
        'missing',
        'Claude CLI not found. Install Claude Code and log in, ' +
          'or set its path in Settings.',
      );
    }
    const { workDir } = this.opts;
    await mkdir(workDir, { recursive: true });
    const settingsFile = path.join(workDir, 'brain-settings.json');
    const systemFile = path.join(workDir, `persona-${randomUUID()}.txt`);
    await writeFile(settingsFile, BRAIN_SETTINGS, 'utf8');
    await writeFile(systemFile, job.system, 'utf8');
    const started = Date.now();
    try {
      const args = claudeArgs(this.opts.model(), systemFile, settingsFile);
      const out = await this.spawnOnce(file, args, job);
      const { text, envelope } = readResult(out.stdout, out.code, out.stderr);
      this.lastStats = {
        ms: Date.now() - started,
        inputTokens: finite(envelope.usage?.input_tokens),
        outputTokens: finite(envelope.usage?.output_tokens),
        costUsd: finite(envelope.total_cost_usd),
      };
      return text;
    } finally {
      await rm(systemFile, { force: true }).catch(() => undefined);
    }
  }

  private spawnOnce(
    file: string,
    args: string[],
    job: Job,
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const shell = needsShell(file, this.platform);
    const command = shell ? quoteWindowsArg(file) : file;
    const finalArgs = shell ? args.map(quoteWindowsArg) : args;
    return new Promise((resolve, reject) => {
      let child: ChildLike;
      try {
        child = this.spawnFn(command, finalArgs, {
          cwd: this.opts.workDir,
          env: childEnv(this.env),
          shell,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(this.spawnError(file, err));
        return;
      }
      this.collect(child, file, job, resolve, reject);
    });
  }

  private collect(
    child: ChildLike,
    file: string,
    job: Job,
    resolve: (out: { stdout: string; stderr: string; code: number | null }) =>
      void,
    reject: (err: Error) => void,
  ): void {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      this.killTree(child);
      const secs = Math.round(job.timeoutMs / 1000);
      finish(() => reject(new ClaudeError(
        'timeout', `Claude CLI timed out after ${secs} s`)));
    }, job.timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk;
    });
    child.on('error', (err) => {
      finish(() => reject(this.spawnError(file, err)));
    });
    child.on('close', (code) => {
      finish(() => resolve({ stdout, stderr, code }));
    });
    // A CLI that dies before reading stdin raises EPIPE; 'close' reports it.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(job.prompt, 'utf8');
  }

  private spawnError(file: string, err: unknown): ClaudeError {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return new ClaudeError('missing', `Claude CLI not found at ${file}`);
    }
    const why = err instanceof Error ? err.message : String(err);
    return new ClaudeError('exit', `Could not start Claude CLI: ${why}`);
  }

  /** With `shell: true` on Windows, killing cmd.exe leaves node running. */
  private killTree(child: ChildLike): void {
    if (this.platform === 'win32' && child.pid !== undefined) {
      try {
        this.spawnFn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        }).on('error', () => undefined);
      } catch {
        // Fall through to a plain kill.
      }
    }
    child.kill();
  }
}
