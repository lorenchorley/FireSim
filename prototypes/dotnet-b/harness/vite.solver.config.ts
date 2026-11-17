/**
 * Vite config of the browser worker bundle of the whole TypeScript solver (plan T1.5 (d)):
 *   npx vite build -c prototypes/dotnet-b/harness/vite.solver.config.ts            (from the repository root; `harness/build-solver.sh` does it)
 * One ES module worker (the format the app's own simulation worker has, `worker: { format: 'es' }` in vite.config.ts), dynamic imports inlined, no hashes in the
 * name, unminified (so a stack trace reads, and so that it is the same code as the Node arm's unminified `ts-export` bundle), target es2022 like the app.
 * Output: FS_SOLVER_OUT (default `prototypes/dotnet-b/fixtures/.build-solver-browser`, a folder git ignores) / solver.worker.js. `src/` is only read.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');

export default defineConfig({
  root: repo,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: process.env.FS_SOLVER_OUT ?? resolve(repo, 'prototypes/dotnet-b/fixtures/.build-solver-browser'),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'es2022',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: resolve(here, 'solver-worker.entry.ts'),
      output: { format: 'es', entryFileNames: 'solver.worker.js', codeSplitting: false },
    },
  },
});
