/**
 * Builds the desktop host's two programs (desktop/main.ts and desktop/engineWorker.ts) into plain ES modules that Node 22
 * runs as they are. The simulation is TypeScript with extension-less imports, which Node cannot load by itself, so the
 * repository's own bundler (Vite, for a Node target) is the runner: nothing new is installed. `ws` and every other package
 * stay outside the bundle and load from node_modules.
 *
 *   node desktop/run.mjs      (what `npm run desktop` does: build, then start)
 */
import { build } from 'vite';

/**
 * @param {{ root: string, outDir: string, logLevel?: 'info' | 'warn' | 'error' | 'silent' }} o
 *   root: the repository; outDir: where main.mjs and engineWorker.mjs go (emptied first)
 */
export async function buildDesktop(o) {
  await build({
    root: o.root,
    configFile: false,
    publicDir: false, // the app's public/ is served from dist/, not copied here
    logLevel: o.logLevel ?? 'warn',
    build: {
      ssr: true,
      outDir: o.outDir,
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: { main: 'desktop/main.ts', engineWorker: 'desktop/engineWorker.ts' },
        output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
      },
    },
  });
}
