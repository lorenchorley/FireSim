/**
 * Vite config for round 0's worker bundle (plan T0.6b): `npx vite build -c prototypes/dotnet-b/harness/vite.speedtest.config.ts` from the repository root, or
 * `bash prototypes/dotnet-b/harness/build-speedtest.sh`. One classic (IIFE) script, unminified (a few KB), no hashes in the name, so the same source gives the same
 * file. `src/` is only read. The SHA-256 of `src/ui/speedTestKernels.ts` is compiled in and reported by the worker, so a result says which source the numbers came from.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const kernelsSha = createHash('sha256')
  .update(readFileSync(resolve(repo, 'src/ui/speedTestKernels.ts')))
  .digest('hex');

export default defineConfig({
  root: repo,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  define: { __KERNELS_SHA256__: JSON.stringify(kernelsSha) },
  build: {
    outDir: resolve(repo, 'prototypes/dotnet-b/Fs.TestApp/Resources/Raw/wwwroot'),
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: 'es2022',
    lib: {
      entry: resolve(here, 'speedtest-worker.entry.ts'),
      formats: ['iife'],
      name: 'FsSpeedWorker',
      fileName: () => 'speedtest.worker.js',
    },
  },
});
