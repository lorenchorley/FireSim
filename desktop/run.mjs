#!/usr/bin/env node
/**
 * `npm run desktop [-- flags]`: builds the desktop host (a few seconds), then runs it. See desktop/README.md.
 */
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDesktop } from './build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'desktop', '.build');

try {
  await buildDesktop({ root, outDir: out });
} catch (e) {
  console.error(`The desktop host could not be built: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
const { main } = await import(pathToFileURL(join(out, 'main.mjs')).href);
process.exit(await main(process.argv.slice(2), { distDir: join(root, 'dist'), workerFile: pathToFileURL(join(out, 'engineWorker.mjs')) }));
