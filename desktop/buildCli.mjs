/**
 * `node desktop/buildCli.mjs ROOT OUTDIR`: builds the desktop host (see build.mjs) in a process of its own, so that run.mjs
 * starts the host without Vite (and its bundler) loaded into it: about 200 MB of memory that the host never needs.
 */
import { buildDesktop } from './build.mjs';

const [root, outDir] = process.argv.slice(2);
if (!root || !outDir) {
  console.error('usage: node desktop/buildCli.mjs ROOT OUTDIR');
  process.exit(2);
}
try {
  await buildDesktop({ root, outDir });
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
