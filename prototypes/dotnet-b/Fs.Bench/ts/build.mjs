// Builds drivers (TypeScript, extension-less imports) into Node ES modules with the repo's own Vite, into OUT_DIR.
// usage: node build.mjs OUT_DIR driver.ts [driver2.ts ...]   (the repo root is found relative to this file)
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';
const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../../../..');
const [outDir, ...inputs] = process.argv.slice(2);
if (!outDir || inputs.length === 0) {
  console.error('usage: node build.mjs OUT_DIR driver.ts...');
  process.exit(2);
}
const input = {};
for (const f of inputs) input[basename(f).replace(/\.ts$/, '')] = resolve(f);
await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: true,
    outDir: resolve(outDir),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: { input, output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' } },
  },
});
console.log('built', Object.keys(input).join(', '), '->', outDir);
