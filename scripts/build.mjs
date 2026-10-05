// Bundles the main process, preload and both windows into dist/.
// Usage: node scripts/build.mjs [--watch]
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const node = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

const browser = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
  sourcemap: true,
  logLevel: 'info',
};

const targets = [
  { ...node, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.js' },
  {
    ...node,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload.js',
  },
  {
    ...browser,
    entryPoints: ['src/renderer/overlay/overlay.ts'],
    outfile: 'dist/renderer/overlay/overlay.js',
  },
  {
    ...browser,
    entryPoints: ['src/renderer/office/office.ts'],
    outfile: 'dist/renderer/office/office.js',
  },
];

function copyStatic() {
  // HTML and CSS are copied as-is next to the bundles.
  for (const win of ['overlay', 'office']) {
    mkdirSync(`dist/renderer/${win}`, { recursive: true });
    cpSync(`src/renderer/${win}`, `dist/renderer/${win}`, {
      recursive: true,
      filter: (src) => !src.endsWith('.ts'),
    });
  }
  if (existsSync('assets')) cpSync('assets', 'dist/assets', { recursive: true });
}

rmSync('dist', { recursive: true, force: true });
copyStatic();

if (watch) {
  for (const t of targets) await (await context(t)).watch();
  console.log('watching...');
} else {
  await Promise.all(targets.map((t) => build(t)));
}
