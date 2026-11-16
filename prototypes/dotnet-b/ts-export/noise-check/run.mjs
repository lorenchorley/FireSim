#!/usr/bin/env node
/**
 * The two checks behind noise.ts (stage 3, T3.1a). Run from the repository root (node_modules present):
 *
 *   node prototypes/dotnet-b/ts-export/noise-check/run.mjs measure OUT_DIR   V8's results and glibc's for the 15 functions (+ sqrt): mismatch rate and ulp sizes
 *   node prototypes/dotnet-b/ts-export/noise-check/run.mjs selftest          noise.ts against its own table: rates, ulp sizes, exact cases, determinism, restore
 *
 * `measure` needs python3 (ctypes, glibc's libm.so.6) and is only meaningful on a glibc machine; it prints the table that NOISE_SPECS holds.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..');
const cmd = process.argv[2];
if (cmd === 'measure') {
  const out = resolve(process.argv[3] ?? '');
  if (!process.argv[3]) throw new Error('usage: measure OUT_DIR');
  mkdirSync(out, { recursive: true });
  let r = spawnSync(process.execPath, [join(here, 'libm-gen.mjs'), out], { stdio: 'inherit' });
  if (r.status) process.exit(r.status);
  r = spawnSync('python3', ['-I', join(here, 'libm-cmp.py'), out], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
} else if (cmd === 'selftest') {
  const { build } = await import('vite');
  const outDir = join(root, 'prototypes', 'dotnet-b', 'fixtures', '.build-noise-check');
  rmSync(outDir, { recursive: true, force: true });
  await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: { ssr: true, outDir, emptyOutDir: true, target: 'node22', minify: false, rollupOptions: { input: { selftest: join(here, 'selftest.ts') }, output: { format: 'es', entryFileNames: '[name].mjs' } } },
  });
  const r = spawnSync(process.execPath, [join(outDir, 'selftest.mjs')], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
} else {
  console.error('commands: measure OUT_DIR | selftest');
  process.exit(2);
}
