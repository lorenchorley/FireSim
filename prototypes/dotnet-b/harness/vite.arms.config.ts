/**
 * T1.5 (c): builds the browser bundles of the TypeScript kernel arms, one classic (IIFE) script per build, unminified, es2022:
 *   FS_ARMS_ENTRY=worker FS_ARMS_OUT=DIR npx vite build -c prototypes/dotnet-b/harness/vite.arms.config.ts   -> DIR/arms-worker.js (the Web Worker: the app's kernels and the pool forms)
 *   FS_ARMS_ENTRY=page   FS_ARMS_OUT=DIR npx vite build -c prototypes/dotnet-b/harness/vite.arms.config.ts   -> DIR/arms-page.js   (the page: spawns workers, builds the arena, collects results)
 * (from the repository root; needs node_modules). `src/` is only read. harness/run-arms-browser.mjs builds both when they are missing or older than their sources.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const out = process.env.FS_ARMS_OUT;
const which = process.env.FS_ARMS_ENTRY;
if (!out || (which !== 'worker' && which !== 'page')) throw new Error('set FS_ARMS_OUT to the output directory and FS_ARMS_ENTRY to worker or page');
const armsDir = resolve(here, '../Fs.Bench/ts/arms');

export default defineConfig({
  root: repo,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: resolve(out),
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: 'es2022',
    lib: {
      entry: resolve(armsDir, which === 'worker' ? 'worker-browser.ts' : 'page-main.ts'),
      formats: ['iife'],
      name: which === 'worker' ? 'FsArmsWorker' : 'FsArmsPage',
      fileName: () => `arms-${which}.js`,
    },
  },
});
