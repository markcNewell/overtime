// End-to-end smoke test: launches the real app headless with a throwaway
// profile, drives it through the same window.overtime API the windows use
// (via the DevTools protocol), and makes real Claude calls.
//
// Usage: npm run build && node scripts/e2e-smoke.mjs <out-dir>
// Linux only (uses XDG_CONFIG_HOME to sandbox the save file).
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'e2e-out');
const PORT = 9333;
const config = join(out, 'config');
const filesDir = join(out, 'files');
mkdirSync(join(config, 'Overtime'), { recursive: true });
mkdirSync(filesDir, { recursive: true });

// Seed a fresh save so briefs land in the sandbox, not ~/Documents.
const now = Date.now();
writeFileSync(
  join(config, 'Overtime', 'save.json'),
  JSON.stringify({
    version: 1,
    pitches: [],
    candidates: [],
    pastWorkers: [],
    deskLeftovers: [],
    releases: [],
    chat: [],
    lastTickAt: now,
    settings: {
      alwaysOnTop: true,
      hideFromScreenShare: false,
      claudePath: '',
      model: 'haiku',
      filesDir,
    },
    brainStatus: 'ok',
  }),
);

const electron = resolve('node_modules/.bin/electron');
const app = spawn(
  electron,
  ['.', '--ozone-platform=headless', '--no-sandbox', `--remote-debugging-port=${PORT}`],
  { env: { ...process.env, XDG_CONFIG_HOME: config, OVERTIME_NO_TRAY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
);
const appLog = [];
for (const stream of [app.stdout, app.stderr]) {
  stream.on('data', (d) => appLog.push(String(d)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal CDP client over the global WebSocket. */
async function connect(match) {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const t = targets.find((x) => x.type === 'page' && x.url.includes(match));
      if (t) return client(t.webSocketDebuggerUrl);
    } catch {}
    await sleep(500);
  }
  throw new Error(`no page matching ${match}`);
}

function client(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => {
    await ready;
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((r) => pending.set(n, r));
  };
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
    return res.result?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

async function waitFor(page, label, predicate, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate('window.overtime.getState()');
    if (predicate(state)) {
      console.log(`ok   ${label} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      return state;
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

async function screenshot(page, name, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  const res = await page.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  writeFileSync(join(out, `${name}.png`), Buffer.from(res.result.data, 'base64'));
}

let failed = false;
try {
  const office = await connect('office/index.html');
  const overlay = await connect('overlay/index.html');

  let s = await waitFor(office, 'three candidates from Claude', (s) => s.candidates.length === 3);
  console.log('     candidates:', s.candidates.map((c) => `${c.name} (${c.level})`).join(', '));
  console.log('     brain:', s.brainStatus);
  await screenshot(office, 'office-hire', 820, 640);

  const pick = s.candidates[0];
  await office.evaluate(`window.overtime.hire(${JSON.stringify(pick.id)})`);
  s = await waitFor(office, 'pitches written', (s) => s.pitches.length === 3 && s.pitches.every((p) => p.filePath));
  console.log('     pitches:', s.pitches.map((p) => `${p.title} [${p.difficulty}]`).join(', '));
  await screenshot(office, 'office-projects', 820, 640);

  const easiest = [...s.pitches].sort((a, b) => a.difficulty - b.difficulty)[0];
  await office.evaluate(`window.overtime.assign(${JSON.stringify(easiest.id)})`);
  s = await waitFor(office, 'project assigned with brief folder', (s) => s.project?.filePath?.includes('projects'));
  s = await waitFor(office, 'worker settled in (not arriving)', (s) => s.worker.activity !== 'arriving', 20_000);

  await overlay.evaluate(`window.overtime.act({ type: 'shock' })`);
  s = await waitFor(office, 'shock counted', (s) => s.worker.ledger.shocks === 1, 10_000);
  console.log('     yelp:', s.bubble?.text);
  await screenshot(overlay, 'overlay-working', 380, 320);

  await office.evaluate(`window.overtime.chat('Morning! My name is Mark and I support Arsenal.')`);
  s = await waitFor(office, 'chat reply', (s) => s.chat.some((l) => l.from === 'worker' && !l.text.startsWith('(thinks)')) && s.chat.at(-1).from !== 'boss');
  console.log('     chat:', s.chat.slice(-3).map((l) => `${l.from}: ${l.text}`).join(' | '));
  console.log('     memories:', s.worker.memories.map((m) => m.text).join(' | '));
  await screenshot(office, 'office-chat-tab', 820, 640);

  await office.evaluate(`window.overtime.act({ type: 'fire' })`);
  s = await waitFor(office, 'fired: leaving', (s) => s.worker?.activity === 'leaving', 10_000);
  await sleep(4000);
  await screenshot(overlay, 'overlay-leaving', 380, 320);
  s = await waitFor(office, 'desk emptied and new candidates', (s) => !s.worker && s.deskLeftovers.length > 0 && s.candidates.length === 3, 120_000);
  console.log('     leftovers:', s.deskLeftovers.map((l) => `${l.kind}: ${l.text}`).join(' | '));
  console.log('     past:', s.pastWorkers.map((p) => `${p.name} (${p.ending}): "${p.lastWords}"`).join(' | '));
  await screenshot(overlay, 'overlay-empty', 380, 320);

  const pitchFiles = existsSync(join(filesDir, 'pitches')) ? readdirSync(join(filesDir, 'pitches')) : [];
  const projectDirs = existsSync(join(filesDir, 'projects')) ? readdirSync(join(filesDir, 'projects')) : [];
  console.log(`ok   files: ${pitchFiles.length} pitch briefs, project folders: ${projectDirs.join(', ')}`);
  office.close();
  overlay.close();
} catch (err) {
  failed = true;
  console.error('FAIL', err.message);
  console.error(appLog.join('').split('\n').filter((l) => !/gl_|egl|EGL|viz_main|MESA|dbus/i.test(l)).slice(-30).join('\n'));
} finally {
  app.kill();
}
process.exit(failed ? 1 : 0);
