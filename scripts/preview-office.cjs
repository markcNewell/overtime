// Screenshots the office window's tabs with mock data, headless.
// Usage: npm run build && electron --ozone-platform=headless --no-sandbox \
//          scripts/preview-office.cjs <out-dir>
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const out = process.argv[process.argv.length - 1];
const SHOTS = [
  { name: 'hire', mock: 'hire', tab: 'hire' },
  { name: 'projects-current', mock: 'busy', tab: 'projects' },
  { name: 'projects-pitches', mock: 'pitches', tab: 'projects' },
  { name: 'staff', mock: 'busy', tab: 'staff' },
  { name: 'chat', mock: 'busy', tab: 'chat' },
  { name: 'settings', mock: 'busy', tab: 'settings' },
];
const SIZE = { width: 820, height: 640 };

// A private profile so this never clashes with another Electron process.
app.setPath('userData', join(tmpdir(), `overtime-office-preview-${process.pid}`));

app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ ...SIZE, show: true, frame: false });
  const file = join(__dirname, '..', 'dist/renderer/office/index.html');
  for (const shot of SHOTS) {
    await win.loadFile(file, { query: { mock: shot.mock, tab: shot.tab } });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const d = win.webContents.debugger;
    if (!d.isAttached()) d.attach('1.3');
    // The headless "screen" is tiny, so pin the viewport to the real size.
    await d.sendCommand('Emulation.setDeviceMetricsOverride', {
      ...SIZE,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const res = await d.sendCommand('Page.captureScreenshot', {
      format: 'png',
      // Without this the headless compositor hands back a blank frame.
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, ...SIZE, scale: 1 },
    });
    writeFileSync(join(out, `${shot.name}.png`), Buffer.from(res.data, 'base64'));
    console.log('wrote', shot.name);
  }
  app.quit();
});
