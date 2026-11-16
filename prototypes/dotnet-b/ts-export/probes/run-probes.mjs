#!/usr/bin/env node
/**
 * Driver of the probes (card T3.4). From the repository root (node_modules must exist):
 *
 *   node prototypes/dotnet-b/ts-export/probes/run-probes.mjs all      --out DIR [--golden prototypes/dotnet-b/ts-export/probes/goldens] [--only NAME,NAME]
 *       runs every probe run below (seed 13) into DIR/<run>/probes and, with --golden, writes the committed goldens from them
 *   node prototypes/dotnet-b/ts-export/probes/run-probes.mjs check    --out DIR [--only NAME]
 *       regenerates katoomba3-fast (and, with --only katoomba3-standard, that one) and compares with the committed goldens (exit 1 if different)
 *   node prototypes/dotnet-b/ts-export/probes/run-probes.mjs unchanged --out DIR [--only NAME,NAME]
 *       `run.mjs determinism NAME` with the probes off and on; every snapshot hash and arrival.f32 of the two must be equal, and each pair must be deterministic
 *   node prototypes/dotnet-b/ts-export/probes/run-probes.mjs coverage --out DIR
 *       a markdown table: per area, the probes, their calls in each run, and the files that prove the area
 *
 * Runs of the exporter over a minute go under the heavy lock when others share the machine (flock /tmp/firesim-heavy.lock node ...); the runs here take
 * 5 to 40 s each. Raw frames are written for the first two runs only (120 MB each: delete DIR when done); the 4 h runs are tapes only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGolden, writeGolden } from './golden.mjs';
import { rows } from './spec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..');
const runMjs = join(here, '..', 'run.mjs');
const SEED = 13;

/** The probe runs. `areas`: the golden keeps the per-area call files; `raw`: raw codec frames are written. */
const RUNS = [
  { name: 'katoomba3-fast', to: 960, areas: true, raw: true, blobsAll: true, generators: true },
  { name: 'katoomba3-standard', to: 960, areas: true, raw: true, blobsAll: true },
  { name: 'katoomba3-fast-noembers', to: 960, areas: false, raw: false, blobsAll: true },
  { name: 'katoomba3-standard-noembers', to: 960, areas: false, raw: false, blobsAll: true },
  { name: 'katoomba6-fast-4h', to: 14400, areas: false, raw: false },
  { name: 'katoomba3-standard-4h', to: 14400, areas: false, raw: false },
  { name: 'warrumbungles6-fast-4h', to: 14400, areas: false, raw: false },
];

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const out = arg('out');
const cmd = process.argv[2];
if (!cmd || !out) {
  console.error('usage: run-probes.mjs all|check|unchanged|coverage --out DIR [--golden DIR] [--only NAME,NAME]');
  process.exit(2);
}
const only = arg('only')?.split(',');

function runExporter(r, dir, extraEnv = {}) {
  const t0 = performance.now();
  const p = spawnSync(process.execPath, [runMjs, 'export', r.name, '--out', out, '--seed', String(SEED), '--to', String(r.to), '--dir', dir, '--keep', 'none', '--probes'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...(r.raw ? { FS_PROBES_RAW_MB: '300' } : { FS_PROBES_RAW: '0' }), ...(r.blobsAll ? { FS_PROBES_BLOB_UNTIL: '1e9' } : {}), ...extraEnv },
  });
  if (p.status !== 0) {
    console.error(p.stdout, p.stderr);
    throw new Error(`export ${r.name} failed (${p.status})`);
  }
  const notFound = /NOT FOUND: (.*)/.exec(p.stderr ?? '');
  if (notFound) throw new Error(`probe build: not found: ${notFound[1]}`);
  console.log(`${r.name}: ${((performance.now() - t0) / 1000).toFixed(1)} s  ${p.stdout.trim().split('\n').pop()}`);
}

if (cmd === 'all') {
  const golden = arg('golden');
  for (const r of RUNS) {
    if (only && !only.includes(r.name)) continue;
    const dir = `p-${r.name}`;
    runExporter(r, dir);
    if (golden) {
      const g = writeGolden(join(out, dir, 'probes'), golden, { areas: r.areas, generators: r.generators });
      console.log(`  golden ${g.scenario} -> ${golden}`);
    }
  }
} else if (cmd === 'check') {
  const golden = join(here, 'goldens');
  let bad = 0;
  for (const r of RUNS.filter((x) => (only ? only.includes(x.name) : x.name === 'katoomba3-fast'))) {
    const dir = `chk-${r.name}`;
    runExporter({ ...r, raw: false }, dir);
    const diffs = checkGolden(join(out, dir, 'probes'), golden, { areas: r.areas, generators: r.generators });
    console.log(diffs.length ? `${r.name}: DIFFERENT (${diffs.length})\n${diffs.slice(0, 20).join('\n')}` : `${r.name}: identical to the committed golden`);
    bad += diffs.length ? 1 : 0;
    rmSync(join(out, dir), { recursive: true, force: true });
  }
  process.exit(bad ? 1 : 0);
} else if (cmd === 'unchanged') {
  // For each scenario: determinism (two processes) without probes into OUT/off, and with probes into OUT/on; then the hashes of off and on are compared.
  const list = (only ?? ['katoomba3-fast', 'katoomba3-standard', 'katoomba3-fast-noembers', 'katoomba6-fast-4h', 'katoomba3-standard-4h']).map((n) => ({ name: n, to: n.includes('-4h') ? 900 : 960, raw: !n.includes('-4h') }));
  let bad = 0;
  for (const s of list) {
    const res = {};
    for (const mode of ['off', 'on']) {
      const args = [runMjs, 'determinism', s.name, '--out', join(out, mode), '--to', String(s.to), '--seed', String(SEED), ...(mode === 'on' ? ['--probes'] : [])];
      const p = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...(s.raw ? { FS_PROBES_RAW_MB: '300' } : { FS_PROBES_RAW: '0' }) } });
      console.log(`${s.name} probes ${mode}: ${p.stdout.trim()}`);
      if (p.status !== 0) {
        console.error(p.stderr);
        bad++;
      }
      const base = s.name === 'katoomba3-fast' ? 'determinism' : `determinism-${s.name}`;
      if (mode === 'on') for (const d of ['a', 'b']) rmSync(join(out, mode, `${base}-${d}`, 'probes', 'raw'), { recursive: true, force: true }); // raw frames of a determinism pair: not kept
      res[mode] = { h: JSON.parse(readFileSync(join(out, mode, `${base}-a`, 'hashes.json'), 'utf8')), a: readFileSync(join(out, mode, `${base}-a`, 'arrival.f32')) };
    }
    const keys = Object.keys(res.off.h);
    const diff = keys.filter((k) => res.off.h[k] !== res.on.h[k]);
    const same = diff.length === 0 && keys.length === Object.keys(res.on.h).length && Buffer.compare(res.off.a, res.on.a) === 0;
    console.log(`  ${s.name} to ${s.to} s: ${keys.length} snapshot hashes, probes off vs on: ${same ? 'IDENTICAL' : `DIFFERENT at ${diff.join(',')}`}; last hash ${keys.map(Number).sort((a, b) => a - b).at(-1)} = ${res.off.h[String(keys.map(Number).sort((a, b) => a - b).at(-1))]}`);
    if (!same) bad++;
  }
  process.exit(bad ? 1 : 0);
} else if (cmd === 'coverage') {
  const specRows = rows();
  const runs = RUNS.filter((r) => r.areas).map((r) => r.name);
  const idx = Object.fromEntries(runs.map((n) => [n, JSON.parse(readFileSync(join(out, `p-${n}`, 'probes', 'index.json'), 'utf8')).probes]));
  const areas = [...new Set(specRows.map((r) => r.area))];
  for (const a of areas) {
    const rs = specRows.filter((r) => r.area === a);
    console.log(`\n#### ${a}\n| probe | ${runs.map((n) => `${n} calls (init/spin/w0/w600/w900/other)`).join(' | ')} |\n|---|${runs.map(() => '---').join('|')}|`);
    for (const r of rs) {
      const cells = runs.map((n) => {
        const w = idx[n][r.id]?.windows ?? {};
        const f = (k) => w[k]?.calls ?? 0;
        const tot = ['init', 'spin', 'w0', 'w600', 'w900', 'other'].reduce((s, k) => s + f(k), 0);
        return tot ? `${f('init')}/${f('spin')}/${f('w0')}/${f('w600')}/${f('w900')}/${f('other')}` : 'not called';
      });
      console.log(`| ${r.id} | ${cells.join(' | ')} |`);
    }
  }
  // probes that no run reached (all runs present in DIR, the 4 h ones included: their counts cover the whole run)
  const all = RUNS.filter((r) => existsSync(join(out, `p-${r.name}`, 'probes', 'index.json')));
  const idxAll = all.map((r) => JSON.parse(readFileSync(join(out, `p-${r.name}`, 'probes', 'index.json'), 'utf8')).probes);
  const never = specRows.filter((r) => idxAll.every((i) => !Object.keys(i[r.id]?.windows ?? {}).length));
  console.log(`\nRuns read: ${all.map((r) => r.name).join(', ')}.\nNever called in any of them (${never.length} of ${specRows.length} probes): ${never.map((r) => r.id).join(' ')}`);
} else {
  console.error('commands: all | check | unchanged | coverage');
  process.exit(2);
}
