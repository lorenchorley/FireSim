#!/usr/bin/env node
/**
 * `node desktop/measure.mjs EXTENT_M TIER RUN_TO_S [CELL_M]`: builds desktop/measureSession.ts (a second or so, into desktop/.build-test-measure,
 * which git ignores) and runs it with `--expose-gc`: what one session costs in memory. See measureSession.ts for the arguments.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktop } from './build.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, '.build-test-measure');
await buildDesktop({ root: join(here, '..'), outDir: out, logLevel: 'warn', extra: { measure: 'desktop/measureSession.ts' } });
const run = spawnSync(process.execPath, ['--expose-gc', join(out, 'measure.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
