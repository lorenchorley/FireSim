/**
 * T1.6a: builds `speedtest-kernels.entry.ts` into one classic (IIFE) script `speedtest-kernels.js` exposing `FsKernels` (unminified, es2022, like harness/vite.speedtest.config.ts).
 *   FS_KERNELS_OUT=/some/dir npx vite build -c prototypes/dotnet-b/harness/vite.kernels.config.ts        (from the repository root; needs node_modules)
 * `src/` is only read.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const out = process.env.FS_KERNELS_OUT;
if (!out) throw new Error('set FS_KERNELS_OUT to the output directory');

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
    lib: { entry: resolve(here, 'speedtest-kernels.entry.ts'), formats: ['iife'], name: 'FsKernels', fileName: () => 'speedtest-kernels.js' },
  },
});
