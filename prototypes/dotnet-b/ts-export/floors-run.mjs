#!/usr/bin/env node
/**
 * Runner of the T3.1b / T3.1c matrix (the noise floor and the engine floor). One chunk of jobs per call, so that each call can sit under
 * `flock /tmp/firesim-heavy.lock` for about 15 minutes and release it; jobs already in the store are skipped, so calls resume where the last stopped.
 *
 *   FS_BUILD_DIR=... FS_BUILD_DIR_NOISE=... FS_SOLVER_OUT=... node floors-run.mjs --store DIR --work DIR [--budget SECONDS] [--draws 10] [--kinds ref,chrome,chromeinit,noise] [--glimpse] [--noembers] [--list]
 *
 * Jobs (scenario, seed): katoomba6-fast-4h and katoomba3-standard-4h at seeds 12, 13, 14; warrumbungles6-fast-4h at seed 13 (5 draws). Optional extras, outside the card's
 * matrix: --glimpse adds katoomba3-standard-4h seed 11 with noise seed 1 (the draw T3.1a looked at); --noembers adds the two -noembers scenarios at seed 13, 5 draws, no Chromium arm.
 * The noise seed of draw k is k.
 *   ref         Node 22, no noise (ts-export/export.mjs build): the reference of both floors.
 *   chrome      Chromium, the browser building its own scenario (harness/run-solver-browser.mjs): engine floor, primary arm.
 *   chromeinit  Chromium, the solver on the Node reference's init.bin (--init-from): engine floor without the scenario build's last-bit differences.
 *   noise01..   Node 22 with `--noise K` (K = 1..draws), compared with `ref`.
 * Each job writes its run folder under --work, copies arrival.f32, hashes.json and meta.json into <store>/<scenario>/seed<S>/<kind>/ and deletes the run folder
 * (the references keep init.bin and the snapshot files of the five horizons in <work>/refs/; delete that folder by hand when the arms are done).
 * For the Chromium arms the pair (reference, browser) is also compared array by array at the horizons with `harness/compare-fixtures.mjs`; that JSON is stored as compare.json.
 * Every job appends {job, kind, seconds, ...} to <store>/ledger.jsonl: the wall time under the lock is the sum of `seconds` (the 4 h cap of the plan).
 * The Node builds (FS_BUILD_DIR: `FS_BUILD_DIR=... node run.mjs export katoomba6-fast-4h --to 900 --keep last --out X` makes one; with --noise 1 and FS_BUILD_DIR_NOISE the noise build)
 * must be inside the repository (node_modules); the browser bundle (FS_SOLVER_OUT) is built by harness/run-solver-browser.mjs on first use. Run it in a loop that takes the heavy lock per call.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const opt = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const store = opt('store');
const work = opt('work');
const budgetS = Number(opt('budget', '780'));
const draws = Number(opt('draws', '10'));
const kinds = new Set(opt('kinds', 'ref,chrome,chromeinit,noise').split(','));
const buildClean = process.env.FS_BUILD_DIR;
const buildNoise = process.env.FS_BUILD_DIR_NOISE;
if (!store || !work || !buildClean || !buildNoise || !process.env.FS_SOLVER_OUT) {
  console.error('needs --store, --work, FS_BUILD_DIR, FS_BUILD_DIR_NOISE, FS_SOLVER_OUT');
  process.exit(2);
}
const KEEP = '900,1800,3600,7200,14400';
const CELLS = [];
for (const scenario of ['katoomba6-fast-4h', 'katoomba3-standard-4h']) for (const seed of [12, 13, 14]) CELLS.push({ scenario, seed, draws, estS: scenario.startsWith('katoomba3') ? 32 : 20 });
CELLS.push({ scenario: 'warrumbungles6-fast-4h', seed: 13, draws: Math.min(5, draws), estS: 20 });
// Extra cell (not in the card's matrix): the one draw T3.1a looked at (katoomba3-standard-4h, solver seed 11, noise seed 1, which flipped 5.8 % of cells): its own reference and that draw only.
if (process.argv.includes('--glimpse')) CELLS.push({ scenario: 'katoomba3-standard-4h', seed: 11, draws: 1, noiseSeeds: [1], noChrome: true, estS: 32 });
// Extra cells (not in the card's matrix): the embers-off variants (bars of 10.3 "embers off"), solver seed 13, 5 noise draws each, no Chromium arm.
if (process.argv.includes('--noembers')) for (const scenario of ['katoomba6-fast-4h-noembers', 'katoomba3-standard-4h-noembers']) CELLS.push({ scenario, seed: 13, draws: Math.min(5, draws), noChrome: true, estS: scenario.startsWith('katoomba3') ? 28 : 12 });
// The noise seed of draw k is k (1..10) in every cell; the noise stream is separate from the solver's, and the call order differs between cells, so the draws of two
// cells share a seed but not a pattern. (The matrix of the card was run this way.) A cell may list its own seeds.
const noiseSeedOf = (c, k) => c.noiseSeeds?.[k - 1] ?? k;

const dirOf = (c, kind) => path.join(store, c.scenario, `seed${c.seed}`, kind);
const done = (c, kind) => fs.existsSync(path.join(dirOf(c, kind), 'meta.json'));
const refDir = (c) => path.join(work, 'refs', `${c.scenario}-seed${c.seed}`);
const jobs = [];
if (kinds.has('ref')) for (const c of CELLS) jobs.push({ c, kind: 'ref' });
if (kinds.has('chrome')) for (const c of CELLS.filter((x) => !x.noChrome)) jobs.push({ c, kind: 'chrome' });
if (kinds.has('chromeinit')) for (const c of CELLS.filter((x) => !x.noChrome)) jobs.push({ c, kind: 'chromeinit' });
if (kinds.has('noise')) for (let k = 1; k <= draws; k++) for (const c of CELLS) if (k <= c.draws) jobs.push({ c, kind: `noise${String(k).padStart(2, '0')}`, noise: noiseSeedOf(c, k) });
const pending = jobs.filter((j) => !done(j.c, j.kind));
if (process.argv.includes('--list')) {
  console.log(`${jobs.length} jobs, ${pending.length} pending`);
  for (const j of pending) console.log(`${j.c.scenario} seed${j.c.seed} ${j.kind}`);
  process.exit(0);
}

fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(store, { recursive: true });
const t00 = Date.now();
let ran = 0;
for (const j of pending) {
  const { c, kind } = j;
  const elapsed = (Date.now() - t00) / 1000;
  const est = c.estS * (kind.startsWith('chrome') ? 1.6 : 1.3) + 8;
  if (elapsed + est > budgetS) {
    console.log(`budget: ${Math.round(elapsed)} s used of ${budgetS}, next job ${c.scenario} seed${c.seed} ${kind} (est ${Math.round(est)} s) left for the next call`);
    break;
  }
  if (kind.startsWith('chrome') && !fs.existsSync(path.join(refDir(c), 'init.bin'))) {
    console.log(`skip ${c.scenario} seed${c.seed} ${kind}: reference run folder not in ${path.join(work, 'refs')}`);
    continue;
  }
  const t0 = Date.now();
  const name = `${c.scenario}-seed${c.seed}-${kind}`;
  const out = kind === 'ref' ? path.join(work, 'refs') : path.join(work, 'run');
  const dirName = kind === 'ref' ? `${c.scenario}-seed${c.seed}` : name;
  const keep = kind === 'ref' || kind.startsWith('chrome') ? KEEP : 'none';
  fs.mkdirSync(out, { recursive: true });
  let r;
  if (kind === 'ref' || kind.startsWith('noise')) {
    const noisy = kind.startsWith('noise');
    r = spawnSync(process.execPath, ['--max-old-space-size=4096', path.join(noisy ? buildNoise : buildClean, 'export.mjs'), c.scenario, '--out', out, '--seed', String(c.seed), '--dir', dirName, '--keep', keep, ...(noisy ? ['--noise', String(j.noise)] : [])], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, FS_REPO_ROOT: repo, ...(noisy ? { FS_POW_LOWERED: '1' } : {}) } });
  } else {
    r = spawnSync(process.execPath, [path.join(repo, 'prototypes/dotnet-b/harness/run-solver-browser.mjs'), c.scenario, '--out', out, '--seed', String(c.seed), '--dir', dirName, '--keep', keep, ...(kind === 'chromeinit' ? ['--init-from', refDir(c)] : [])], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
  }
  const seconds = (Date.now() - t0) / 1000;
  const runDir = path.join(out, dirName);
  if (r.status !== 0 || !fs.existsSync(path.join(runDir, 'arrival.f32'))) {
    console.error(`FAILED ${name} (exit ${r.status}); stdout: ${r.stdout}`);
    fs.appendFileSync(path.join(store, 'ledger.jsonl'), JSON.stringify({ job: name, kind, failed: true, status: r.status, seconds }) + '\n');
    process.exit(1);
  }
  const dest = dirOf(c, kind);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(runDir, 'arrival.f32'), path.join(dest, 'arrival.f32'));
  fs.copyFileSync(path.join(runDir, 'hashes.json'), path.join(dest, 'hashes.json'));
  if (kind.startsWith('chrome')) {
    const cmp = spawnSync(process.execPath, [path.join(repo, 'prototypes/dotnet-b/harness/compare-fixtures.mjs'), refDir(c), runDir, '--json', path.join(dest, 'compare.json'), '--quiet'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    if (cmp.status !== 0) console.error(`compare-fixtures exit ${cmp.status} for ${name}`);
  }
  fs.copyFileSync(path.join(runDir, 'meta.json'), path.join(dest, 'meta.json')); // last: its presence marks the job done
  if (kind !== 'ref') fs.rmSync(runDir, { recursive: true, force: true });
  ran++;
  const line = JSON.stringify({ job: name, kind, seconds: Math.round(seconds * 10) / 10, result: r.stdout.trim().split('\n').pop() });
  fs.appendFileSync(path.join(store, 'ledger.jsonl'), line + '\n');
  console.log(line);
}
console.log(`chunk done: ${ran} jobs, ${Math.round((Date.now() - t00) / 1000)} s`);
