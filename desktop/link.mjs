#!/usr/bin/env node
/**
 * `node desktop/link.mjs SCENARIO LINK HOLD RUN_S`: builds the host and desktop/linkMeasure.ts (a second or so, into desktop/.build-test-link, which git
 * ignores) and runs the throttled-link measurement. See linkMeasure.ts for the arguments and what it records.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktop } from './build.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, '.build-test-link');
await buildDesktop({ root: join(here, '..'), outDir: out, logLevel: 'warn', extra: { linkMeasure: 'desktop/linkMeasure.ts', server: 'desktop/server.ts', engine: 'desktop/engine.ts' } });
const run = spawnSync(process.execPath, [join(out, 'linkMeasure.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
