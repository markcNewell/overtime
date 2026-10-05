// Screenshots every overlay mock scenario through headless Electron.
//
// Usage: node scripts/preview-overlay.mjs <out-dir> [--only a,b*,c] [--no-build] [--verbose]
//
// Builds with scripts/build.mjs (falling back to an overlay-only bundle if
// another part of the app does not build yet), then runs Electron on a
// generated CommonJS capture script. Screenshots go through the DevTools
// protocol because capturePage() returns 1x1 on a headless server.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'preview-shots'));
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? (args[onlyIdx + 1] ?? '') : '';
const skipBuild = args.includes('--no-build');
const verbose = args.includes('--verbose');

async function buildOverlayOnly() {
  const { build } = await import('esbuild');
  mkdirSync(join(root, 'dist/renderer/overlay'), { recursive: true });
  cpSync(join(root, 'src/renderer/overlay'), join(root, 'dist/renderer/overlay'), {
    recursive: true,
    filter: (src) => !src.endsWith('.ts'),
  });
  await build({
    entryPoints: [join(root, 'src/renderer/overlay/overlay.ts')],
    outfile: join(root, 'dist/renderer/overlay/overlay.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    sourcemap: true,
    logLevel: 'warning',
  });
}

if (!skipBuild) {
  const res = spawnSync(process.execPath, [join(root, 'scripts/build.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    console.warn('\nfull build failed (other windows may not exist yet); building the overlay only');
    await buildOverlayOnly();
  }
}
if (!existsSync(join(root, 'dist/renderer/overlay/overlay.js'))) {
  console.error('dist/renderer/overlay/overlay.js is missing; build first');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// The capture side runs inside Electron, which wants CommonJS.
const capture = String.raw`
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.setPath('userData', path.join(os.tmpdir(), 'overtime-preview-' + process.pid));
const ROOT = process.env.OT_ROOT;
const OUT = process.env.OT_OUT;
const ONLY = (process.env.OT_ONLY || '').split(',').filter(Boolean);
const PAGE = path.join(ROOT, 'dist/renderer/overlay/index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wanted = (name) =>
  ONLY.length === 0 ||
  ONLY.some((o) => (o.endsWith('*') ? name.startsWith(o.slice(0, -1)) : name === o));

// Close-ups of the worker, in scene pixels, at 4x.
const ZOOMS = {
  working: [140, 190, 140, 115],
  stuck: [140, 170, 140, 135],
  asleep: [150, 200, 120, 105],
  idle: [140, 190, 140, 115],
  coffee: [40, 180, 120, 125],
  crazy: [140, 190, 140, 115],
  unhinged: [140, 190, 140, 115],
  tired: [140, 190, 140, 115],
  'ending-fired': [220, 180, 150, 125],
  'ending-lost-mind': [20, 160, 150, 145],
  'ending-rage-quit': [100, 170, 280, 135],
  'ending-fried-xray': [140, 190, 140, 115],
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 380,
    height: 320,
    show: true,
    frame: false,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false },
  });
  let current = '';
  win.webContents.on('console-message', (e, level, message) => {
    const text = typeof message === 'string' ? message : e.message;
    if (text && !String(text).startsWith('[mock]')) console.log('[' + current + '] ' + text);
  });
  // Load something before attaching: emulation on the initial empty
  // contents crashes Electron on a headless box.
  await win.loadFile(PAGE, { query: { mock: 'working' } });
  const d = win.webContents.debugger;
  d.attach('1.3');

  async function load(query, w = 380, h = 320) {
    win.setContentSize(w, h);
    // A headless window reports a 1x1 viewport, which breaks layout and
    // hit-testing; pin the viewport to the real overlay size.
    await d.sendCommand('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await win.loadFile(PAGE, { query });
  }
  async function shot(name, clip, scale = 2) {
    const r = await d.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale },
    });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('wrote ' + name + '.png');
  }
  async function mouse(type, x, y) {
    await d.sendCommand('Input.dispatchMouseEvent', {
      type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  }

  await load({ mock: 'working' });
  const meta = await win.webContents.executeJavaScript('window.__overtimeMock');

  for (const name of meta.scenarios) {
    if (!wanted(name)) continue;
    current = name;
    await load({ mock: name, bg: '1' });
    await sleep(850);
    await shot(name, [0, 0, 380, 320]);
    if (ZOOMS[name]) await shot(name + '@zoom', ZOOMS[name], 4);
  }

  for (const sheet of meta.sheets) {
    const name = 'sheet-' + sheet;
    if (!wanted(name)) continue;
    current = name;
    await load({ sheet, bg: 'light' }, 1100, 800);
    await sleep(400);
    const h = await win.webContents.executeJavaScript('document.querySelector(".sheet").scrollHeight');
    await shot(name, [0, 0, 1100, Math.min(1600, h)], 1.5);
  }

  // Real pointer events, to check hover, the menu and click-to-shock.
  const interactions = [
    ['interact-hover', 'working', [[ 'mouseMoved', 203, 250 ]], 700],
    ['interact-menu', 'working', [[ 'mouseMoved', 354, 240 ], [ 'mousePressed', 354, 240 ], [ 'mouseReleased', 354, 240 ]], 300],
    ['interact-fire', 'working', [[ 'mouseMoved', 354, 240 ], [ 'mousePressed', 354, 240 ], [ 'mouseReleased', 354, 240 ], ['wait', 200], [ 'mouseMoved', 261, 167 ], [ 'mousePressed', 261, 167 ], [ 'mouseReleased', 261, 167 ]], 300],
    ['interact-zap', 'working', [[ 'mouseMoved', 203, 250 ], [ 'mousePressed', 203, 250 ], [ 'mouseReleased', 203, 250 ]], 260],
    ['interact-tip', 'empty', [[ 'mouseMoved', 263, 256 ]], 300],
    ['interact-light-bg', 'bubble-say', [], 300],
  ];
  for (const [name, mock, steps, wait] of interactions) {
    if (!wanted(name)) continue;
    current = name;
    await load({ mock, bg: name === 'interact-light-bg' ? 'light' : '1' });
    await sleep(700);
    for (const [type, x, y] of steps) {
      if (type === 'wait') await sleep(x);
      else await mouse(type, x, y);
    }
    await sleep(wait);
    await shot(name, [0, 0, 380, 320]);
  }
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
`;

const tmp = mkdtempSync(join(tmpdir(), 'overtime-preview-'));
const script = join(tmp, 'capture.cjs');
writeFileSync(script, capture);
const electron = join(root, 'node_modules/.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const res = spawnSync(electron, ['--ozone-platform=headless', '--no-sandbox', script], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  env: { ...process.env, OT_ROOT: root, OT_OUT: outDir, OT_ONLY: only },
});
// Chromium logs GPU/EGL noise on headless boxes; keep only our lines.
const keep = (line) => /^(wrote |\[[a-z]|Error|error:)/.test(line) || /Uncaught|TypeError|ReferenceError/.test(line);
for (const line of `${res.stdout}\n${res.stderr}`.split('\n')) if (verbose || keep(line)) console.log(line);
if (res.signal || res.status !== 0) {
  console.error(`electron failed (${res.signal ?? `exit ${res.status}`}); rerun with --verbose`);
}
console.log(`screenshots in ${outDir}`);
process.exit(res.status ?? 1);
