#!/usr/bin/env node
/**
 * `npm run desktop [-- flags]`: builds the desktop host (a second or so, in a process of its own), then runs it. See desktop/README.md.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const out = join(here, '.build');

try {
  execFileSync(process.execPath, [join(here, 'buildCli.mjs'), root, out], { stdio: 'inherit' });
} catch {
  console.error('The desktop host could not be built.');
  process.exit(1);
}
const { main } = await import(pathToFileURL(join(out, 'main.mjs')).href);
process.exit(await main(process.argv.slice(2), { distDir: join(root, 'dist'), workerFile: pathToFileURL(join(out, 'engineWorker.mjs')) }));
