// Renders the app and tray icons from inline SVG into assets/*.png.
// Run with: npm run icons  (needs no display; uses headless Electron)
const { app, BrowserWindow } = require('electron');
const { tmpdir } = require('node:os');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'assets');

/** A coffee mug with a lightning bolt: overtime, powered by caffeine and fear. */
function colourMug() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect x="4" y="4" width="56" height="56" rx="14" fill="#2b2620"/>
    <path d="M22 13c-2 3 2 4 0 7M30 12c-2 3 2 4 0 7M38 13c-2 3 2 4 0 7"
      stroke="#f6f1e7" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".85"/>
    <path d="M44 30h3a6 6 0 0 1 0 12h-3" stroke="#f07a43" stroke-width="4" fill="none"/>
    <rect x="15" y="24" width="30" height="27" rx="6" fill="#f07a43"/>
    <path d="M32 27l-8 12h6l-3 9 9-13h-6l3-8z" fill="#ffd23f" stroke="#2b2620"
      stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`;
}

/** Black silhouette for the macOS menu bar, which tints it for the theme. */
function templateMug() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <defs><mask id="m"><rect width="32" height="32" fill="#fff"/>
      <path d="M16.5 12l-4 6h3l-1.5 5 4.5-6.5h-3l1.5-4.5z" fill="#000"/></mask></defs>
    <path d="M10 4c-1 1.5 1 2 0 3.5M15 3.5c-1 1.5 1 2 0 3.5M20 4c-1 1.5 1 2 0 3.5"
      stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M23 13.5h1.5a3.5 3.5 0 0 1 0 7H23" stroke="#000" stroke-width="2.2" fill="none"/>
    <rect x="6" y="10" width="17" height="17" rx="4" fill="#000" mask="url(#m)"/>
  </svg>`;
}

async function render(win, svg, size, file) {
  const html = `<html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>
    </body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  // Give the compositor a frame to paint before capturing.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const d = win.webContents.debugger;
  if (!d.isAttached()) d.attach('1.3');
  await d.sendCommand('Emulation.setDefaultBackgroundColorOverride', {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  const shot = await d.sendCommand('Page.captureScreenshot', {
    format: 'png',
    // Without this the headless compositor hands back a blank frame.
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
  });
  writeFileSync(join(OUT, file), Buffer.from(shot.data, 'base64'));
  console.log('wrote', file);
}

// A private profile so this never clashes with another Electron process.
app.setPath('userData', join(tmpdir(), `overtime-icons-${process.pid}`));

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 600, height: 600, show: true, frame: false, transparent: true });
  await render(win, colourMug(), 512, 'icon.png');
  await render(win, colourMug(), 32, 'tray.png');
  await render(win, templateMug(), 16, 'trayTemplate.png');
  await render(win, templateMug(), 32, 'trayTemplate@2x.png');
  app.quit();
});
