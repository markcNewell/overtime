import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { SpawnOptions } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClaudeError,
  ClaudeRunner,
  quoteWindowsArg,
  type ChildLike,
  type ClaudeRunnerOptions,
  type SpawnFn,
} from '../src/brain/runner';

/** A child process whose output the test controls. */
class FakeChild extends EventEmitter {
  readonly pid = 4242;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  stdinText = '';

  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) => { this.stdinText += chunk; });
  }

  kill(): boolean {
    this.killed = true;
    setImmediate(() => this.emit('close', null));
    return true;
  }

  /** Print stdout, then exit. */
  finish(stdout: string, code = 0, stderr = ''): void {
    if (stderr) this.stderr.write(stderr);
    this.stdout.end(stdout);
    this.stderr.end();
    setImmediate(() => this.emit('close', code));
  }
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
  child: FakeChild;
  /** The system prompt file's content at spawn time. */
  system: string | null;
}

function envelope(result: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result,
    usage: { input_tokens: 500, output_tokens: 40 }, total_cost_usd: 0.0005,
    ...extra,
  });
}

/** A spawn that records calls and lets `respond` drive each child. */
function fakeSpawn(
  respond: (call: SpawnCall) => void = (c) => c.child.finish(envelope('ok')),
): { spawn: SpawnFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    const child = new FakeChild();
    const sysIndex = args.findIndex((a) => a === '--system-prompt-file');
    const sysFile = args[sysIndex + 1]?.replace(/^"|"$/g, '');
    const system = sysFile && existsSync(sysFile)
      ? readFileSync(sysFile, 'utf8')
      : null;
    const call = { command, args, options, child, system };
    calls.push(call);
    if (command !== 'taskkill') setImmediate(() => respond(call));
    return child as unknown as ChildLike;
  };
  return { spawn, calls };
}

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'overtime brain '));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function runnerWith(
  spawn: SpawnFn,
  extra: Partial<ClaudeRunnerOptions> = {},
): ClaudeRunner {
  return new ClaudeRunner({
    claudePath: async () => '/usr/local/bin/claude',
    model: () => 'haiku',
    workDir,
    spawn,
    platform: 'linux',
    env: { PATH: '/usr/bin', CLAUDECODE: '1', CLAUDE_CODE_SSE_PORT: '1234',
      CLAUDE_CODE_USE_BEDROCK: '1' },
    ...extra,
  });
}

describe('ClaudeRunner', () => {
  it('runs claude -p with the prompt on stdin and returns .result', async () => {
    const { spawn, calls } = fakeSpawn((c) => c.child.finish(envelope('hello')));
    const runner = runnerWith(spawn);
    const out = await runner.run('SYSTEM TEXT', 'PROMPT TEXT');
    expect(out).toBe('hello');
    const call = calls[0]!;
    expect(call.command).toBe('/usr/local/bin/claude');
    expect(call.args.slice(0, 9)).toEqual([
      '-p', '--model', 'haiku', '--output-format', 'json', '--tools', '',
      '--system-prompt-file', call.args[8],
    ]);
    expect(call.args).toContain('--no-session-persistence');
    expect(call.args).toContain('--strict-mcp-config');
    const sources = call.args.indexOf('--setting-sources');
    expect(call.args[sources + 1]).toBe('');
    const settings = call.args[call.args.indexOf('--settings') + 1]!;
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual({
      alwaysThinkingEnabled: false,
    });
    expect(call.system).toBe('SYSTEM TEXT');
    expect(call.child.stdinText).toBe('PROMPT TEXT');
    expect(call.options).toMatchObject({ cwd: workDir, shell: false, windowsHide: true });
    expect(call.options.env?.MAX_THINKING_TOKENS).toBe('0');
    expect(call.options.env?.CLAUDECODE).toBeUndefined();
    expect(call.options.env?.CLAUDE_CODE_SSE_PORT).toBeUndefined();
    expect(call.options.env?.CLAUDE_CODE_USE_BEDROCK).toBe('1');
    // The system prompt file is cleaned up afterwards.
    expect(existsSync(call.args[8]!)).toBe(false);
    expect(runner.lastStats).toMatchObject({ inputTokens: 500, outputTokens: 40 });
  });

  it('runs one at a time, high priority first', async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const { spawn } = fakeSpawn((c) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        order.push(c.child.stdinText);
        c.child.finish(envelope(c.child.stdinText));
      }, 15);
    });
    const busy: boolean[] = [];
    const runner = runnerWith(spawn, { onBusy: (b) => busy.push(b) });
    const jobs = [
      runner.run('s', 'first'),
      runner.run('s', 'normal-1'),
      runner.run('s', 'normal-2'),
      runner.run('s', 'chat-1', { priority: 'high' }),
      runner.run('s', 'chat-2', { priority: 'high' }),
    ];
    const results = await Promise.all(jobs);
    expect(results).toEqual(['first', 'normal-1', 'normal-2', 'chat-1', 'chat-2']);
    expect(order).toEqual(['first', 'chat-1', 'chat-2', 'normal-1', 'normal-2']);
    expect(maxActive).toBe(1);
    expect(busy).toEqual([true, false]);
  });

  it('kills the process and rejects on timeout', async () => {
    const { spawn, calls } = fakeSpawn(() => undefined);
    const runner = runnerWith(spawn);
    const err = await runner.run('s', 'p', { timeoutMs: 30 }).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeError);
    expect((err as ClaudeError).kind).toBe('timeout');
    expect((err as Error).message).toMatch(/timed out/);
    expect(calls[0]?.child.killed).toBe(true);
  });

  it('keeps going after a failure', async () => {
    let n = 0;
    const { spawn } = fakeSpawn((c) => {
      n += 1;
      if (n === 1) c.child.finish('', 1, 'boom');
      else c.child.finish(envelope('second'));
    });
    const runner = runnerWith(spawn);
    const first = runner.run('s', 'a').catch((e: Error) => e.message);
    const second = runner.run('s', 'b');
    expect(await first).toMatch(/exited with code 1: boom/);
    expect(await second).toBe('second');
  });

  it('rejects when the envelope reports is_error', async () => {
    const { spawn } = fakeSpawn((c) => c.child.finish(
      envelope('Invalid API key · Please run /login', { is_error: true }), 1));
    const err = await runnerWith(spawn).run('s', 'p').catch((e) => e);
    expect((err as ClaudeError).kind).toBe('is-error');
    expect((err as Error).message).toMatch(/Invalid API key/);
  });

  it('rejects on a non-success subtype', async () => {
    const { spawn } = fakeSpawn((c) => c.child.finish(
      envelope('', { subtype: 'error_max_turns' })));
    const err = await runnerWith(spawn).run('s', 'p').catch((e) => e);
    expect((err as ClaudeError).kind).toBe('is-error');
    expect((err as Error).message).toMatch(/error_max_turns/);
  });

  it('rejects on output that is not an envelope', async () => {
    const { spawn } = fakeSpawn((c) => c.child.finish('Segmentation fault'));
    const err = await runnerWith(spawn).run('s', 'p').catch((e) => e);
    expect((err as ClaudeError).kind).toBe('bad-output');
  });

  it('reports a missing CLI', async () => {
    const { spawn, calls } = fakeSpawn();
    const runner = runnerWith(spawn, { claudePath: async () => null });
    const err = await runner.run('s', 'p').catch((e) => e);
    expect((err as ClaudeError).kind).toBe('missing');
    expect((err as Error).message).toMatch(/not found/);
    expect(calls).toHaveLength(0);
  });

  it('reports ENOENT from spawn as missing', async () => {
    const { spawn } = fakeSpawn((c) => {
      const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      c.child.emit('error', err);
    });
    const err = await runnerWith(spawn).run('s', 'p').catch((e) => e);
    expect((err as ClaudeError).kind).toBe('missing');
  });

  it('runs a Windows .cmd shim through the shell with quoted args', async () => {
    const { spawn, calls } = fakeSpawn();
    const shim = 'C:\\Users\\Mark Newell\\AppData\\Roaming\\npm\\claude.cmd';
    const runner = runnerWith(spawn, {
      platform: 'win32',
      claudePath: async () => shim,
    });
    await runner.run('s', 'p');
    const call = calls[0]!;
    expect(call.options.shell).toBe(true);
    expect(call.options.windowsHide).toBe(true);
    expect(call.command).toBe(`"${shim}"`);
    expect(call.args[call.args.indexOf('--tools') + 1]).toBe('""');
    expect(call.args[call.args.indexOf('--setting-sources') + 1]).toBe('""');
    const sys = call.args[call.args.indexOf('--system-prompt-file') + 1]!;
    // workDir has a space in it, so the path must be quoted.
    expect(sys.startsWith('"') && sys.endsWith('"')).toBe(true);
    expect(call.args).toContain('-p');
  });

  it('runs a Windows .exe directly with raw args', async () => {
    const { spawn, calls } = fakeSpawn();
    const runner = runnerWith(spawn, {
      platform: 'win32',
      claudePath: async () => 'C:\\Users\\mark\\.local\\bin\\claude.exe',
    });
    await runner.run('s', 'p');
    const call = calls[0]!;
    expect(call.options.shell).toBe(false);
    expect(call.args[call.args.indexOf('--tools') + 1]).toBe('');
  });

  it('kills the whole tree on Windows timeouts', async () => {
    const { spawn, calls } = fakeSpawn(() => undefined);
    const runner = runnerWith(spawn, {
      platform: 'win32',
      claudePath: async () => 'C:\\npm\\claude.cmd',
    });
    await runner.run('s', 'p', { timeoutMs: 20 }).catch(() => undefined);
    const kill = calls.find((c) => c.command === 'taskkill');
    expect(kill?.args).toEqual(['/pid', '4242', '/T', '/F']);
  });
});

describe('quoteWindowsArg', () => {
  it('quotes empty strings, spaces and specials, doubling quotes', () => {
    expect(quoteWindowsArg('')).toBe('""');
    expect(quoteWindowsArg('haiku')).toBe('haiku');
    expect(quoteWindowsArg('--tools')).toBe('--tools');
    expect(quoteWindowsArg('C:\\a b\\c.txt')).toBe('"C:\\a b\\c.txt"');
    expect(quoteWindowsArg('a&b')).toBe('"a&b"');
    expect(quoteWindowsArg('say "hi"')).toBe('"say ""hi"""');
  });
});
