#!/usr/bin/env node
/**
 * Card T1.5 (d): runs a named scenario of ts-export/scenarios.ts with the whole TypeScript solver inside a Web Worker in Chromium (Playwright's pre-installed
 * one), and writes the same fixture folder `ts-export/export.ts` writes, so that `ts-export/inspect.mjs`, `run.mjs verify` and harness/compare-fixtures.mjs read it.
 *
 *   node prototypes/dotnet-b/harness/run-solver-browser.mjs NAME --out FIXTURES_DIR [--seed N] [--to S] [--dir NAME] [--keep all|none|last|T,T,..] [--interval S] [--init-from DIR] [--rebuild]
 *
 * --init-from DIR: run the solver on DIR/init.bin (e.g. the Node exporter's fixture) instead of building the scenario in the browser: it separates the maths of the scenario
 * builder (weather, terrain) from the solver's. The scenario's seed must be the run's seed.
 *
 * NAME is any scenario of ts-export/scenarios.ts (the 4 h ones too). The options are those of `ts-export/run.mjs export` (seed, to, dir, keep, interval); --noise,
 * --perturb and --probes do not exist here. Output: FIXTURES_DIR/<dir>/{init.bin, ignitions.json, snap-<t>.bin (per --keep), hashes.json, arrival.f32, meta.json},
 * with the same keys as export.ts's meta.json where they mean the same thing (`engine` replaces `node`; `timingMs` is the worker's own performance.now, unrounded).
 *
 * How it runs: builds harness/solver-worker.entry.ts with harness/vite.solver.config.ts if the bundle is missing or older than the solver's sources (or --rebuild);
 * starts an http server on 127.0.0.1 (random port) that serves harness/solver-page.html, the bundle, and the repository's public/ (fetched by the app's asset loader);
 * launches Chromium with no options (`chromium.launch()`), loads the page, calls window.runSolver, receives the result files by POST and writes them.
 * Environment: FS_SOLVER_OUT (bundle folder; default prototypes/dotnet-b/fixtures/.build-solver-browser).
 * Timed runs belong under `flock /tmp/firesim-heavy.lock`; the load average at start and end is in meta.json (`load`).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const bundleDir = process.env.FS_SOLVER_OUT ?? path.join(repo, 'prototypes', 'dotnet-b', 'fixtures', '.build-solver-browser');
const bundle = path.join(bundleDir, 'solver.worker.js');

function opt(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const name = process.argv[2];
const outRoot = opt('out');
if (!name || name.startsWith('--') || !outRoot) {
  console.error('usage: run-solver-browser.mjs NAME --out FIXTURES_DIR [--seed N] [--to S] [--dir NAME] [--keep all|none|last|T,T,..] [--interval S] [--rebuild]');
  process.exit(2);
}

function newestSource() {
  let newest = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mjs)$/.test(e.name)) newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  for (const d of ['src', 'prototypes/dotnet-b/ts-export']) walk(path.join(repo, d));
  for (const f of ['solver-worker.entry.ts', 'vite.solver.config.ts']) newest = Math.max(newest, fs.statSync(path.join(here, f)).mtimeMs);
  return newest;
}
if (process.argv.includes('--rebuild') || !fs.existsSync(bundle) || fs.statSync(bundle).mtimeMs < newestSource()) {
  const r = spawnSync('npx', ['vite', 'build', '-c', path.join(here, 'vite.solver.config.ts')], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, FS_SOLVER_OUT: bundleDir } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const { chromium } = createRequire(import.meta.url)('playwright');
const pageHtml = fs.readFileSync(path.join(here, 'solver-page.html'));
const publicDir = path.join(repo, 'public');
const received = new Map();
const initFrom = opt('init-from');

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname.startsWith('/out/')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.set(decodeURIComponent(u.pathname.slice(5)), Buffer.concat(chunks));
      res.writeHead(204).end();
    });
    return;
  }
  if (u.pathname === '/in/init.bin' && initFrom) return void res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(fs.readFileSync(path.join(initFrom, 'init.bin')));
  if (u.pathname === '/' || u.pathname === '/index.html') return void res.writeHead(200, { 'content-type': 'text/html' }).end(pageHtml);
  if (u.pathname === '/solver.worker.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(bundle));
  const f = path.normalize(path.join(publicDir, decodeURIComponent(u.pathname)));
  if (f.startsWith(publicDir + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    const type = f.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    return void res.writeHead(200, { 'content-type': type }).end(fs.readFileSync(f));
  }
  res.writeHead(404).end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const loadStart = os.loadavg()[0];
const browser = await chromium.launch();
let info;
try {
  const page = await browser.newPage();
  page.on('console', (m) => console.error(`[page] ${m.text()}`));
  page.on('pageerror', (e) => console.error(`[page error] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.solverPageReady === true);
  const ua = await page.evaluate(() => navigator.userAgent);
  let v8 = null;
  try {
    v8 = (await (await browser.newBrowserCDPSession()).send('Browser.getVersion')).jsVersion;
  } catch {
    /* not available */
  }
  info = { kind: 'chromium', version: browser.version(), v8, userAgent: ua };
  const params = { scenario: name };
  for (const [k, key] of [['seed', 'seed'], ['to', 'to'], ['interval', 'interval'], ['keep', 'keep']]) if (opt(k) !== undefined) params[key] = k === 'keep' ? opt(k) : Number(opt(k));
  if (initFrom) params.initUrl = '/in/init.bin';
  await page.evaluate((p) => window.runSolver(p), params);
} finally {
  await browser.close();
  server.close();
}
const loadEnd = os.loadavg()[0];

const r = JSON.parse(received.get('result.json').toString('utf8'));
const dirName = opt('dir') ?? (r.seed !== r.defaultSeed ? `${r.scenario}-seed${r.seed}` : r.scenario);
const dir = path.join(outRoot, dirName);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'init.bin'), received.get('init.bin'));
fs.writeFileSync(path.join(dir, 'ignitions.json'), JSON.stringify(r.ignitions, null, 2));
for (const t of r.snapshotsWritten) fs.writeFileSync(path.join(dir, `snap-${t}.bin`), received.get(`snap-${t}.bin`));
fs.writeFileSync(path.join(dir, 'arrival.f32'), received.get('arrival.f32'));
fs.writeFileSync(path.join(dir, 'hashes.json'), JSON.stringify(r.hashes, null, 2));

let hashCheck;
if (r.expectedHashes) {
  const actual = Object.keys(r.hashes)
    .map(Number)
    .filter((t) => t > 0)
    .sort((a, b) => a - b)
    .map((t) => `${t}:${r.hashes[String(t)]}`)
    .join(' ');
  hashCheck = { expected: r.expectedHashes, actual, equal: actual === r.expectedHashes };
}
function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repo }).trim();
  } catch {
    return 'unknown';
  }
}
const g = r.fireGrid;
const times = r.snapshotTimesS;
const rd = (x) => Math.round(x);
const meta = {
  fixture: dirName,
  scenario: r.scenario,
  description: r.description,
  runner: 'run-solver-browser.mjs (T1.5 d): the TypeScript solver in a module Web Worker, Chromium via Playwright',
  exportedAt: new Date().toISOString(),
  gitCommit: gitCommit(),
  engine: { ...info, workerUserAgent: r.engine.userAgent, workerHardwareConcurrency: r.engine.hardwareConcurrency, crossOriginIsolated: r.engine.crossOriginIsolated, headless: true, launch: 'chromium.launch() with no options' },
  machine: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, os: `${os.platform()} ${os.release()}` },
  load: { loadavg1AtStart: loadStart, loadavg1AtEnd: loadEnd },
  initFrom: initFrom ?? null,
  seed: r.seed,
  tier: r.tier,
  tierRunning: r.tierRunning,
  gridMode: r.gridMode,
  extentM: r.extentM,
  startCivil: r.startCivil,
  startTimeUtcMs: r.startTimeUtcMs,
  durationS: r.durationS,
  runToS: r.runTo,
  snapshotIntervalS: r.interval,
  snapshotTimesS: times,
  snapshotsWritten: r.snapshotsWritten,
  fireGrid: { nx: g.nx, ny: g.ny, cellSize: g.cellSize, x0: g.x0, y0: g.y0, origin: g.origin },
  terrainGridMatchesFireGrid: r.terrainGridMatchesFireGrid,
  options: r.options,
  ignitions: r.ignitions,
  arrival: { file: 'arrival.f32', encoding: 'float32 little-endian, row-major (index = j*nx + i), -1 = unburnt', cells: received.get('arrival.f32').length / 4, burntCells: r.arrivalBurntCells, burntAreaM2: r.arrivalBurntCells * g.cellSize * g.cellSize, atTimeS: r.arrivalAtTimeS },
  sizesBytes: { initBin: received.get('init.bin').length, snapshot60: r.snapBytes['60'] ?? r.snapBytes[String(times[1] ?? times[0])], snapshots: r.snapBytes },
  timingMs: {
    scenarioBuild: rd(r.timingMs.scenarioBuild),
    simConstruct: rd(r.timingMs.simConstruct),
    spinUp: rd(r.timingMs.spinUp),
    advance: rd(r.timingMs.advance),
    spinUpPlusAdvance: rd(r.timingMs.spinUpPlusAdvance),
    snapshotEncodeAndWrite: rd(r.timingMs.snapshotEncode),
    processTotal: rd(r.timingMs.workerTotal),
    note: 'performance.now() inside the worker; as in export.ts the per-snapshot encode and hash run inside advance; one shared container: indicative only',
    unrounded: r.timingMs,
  },
  simSecondsPerWallSecond: r.simSecondsPerWallSecond,
  memory: r.memory,
  expectedHashCheck: hashCheck,
};
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(
  JSON.stringify({
    fixture: dirName,
    engine: `${info.kind} ${info.version} (V8 ${info.v8})`,
    ok: hashCheck ? hashCheck.equal : true,
    snapshots: times.length,
    burntCells: r.arrivalBurntCells,
    cells: meta.arrival.cells,
    runMs: rd(r.timingMs.spinUpPlusAdvance),
    simSecondsPerWallSecond: Math.round(r.simSecondsPerWallSecond * 10) / 10,
    initBytes: meta.sizesBytes.initBin,
    snapBytes: meta.sizesBytes.snapshot60,
  }),
);
process.exit(hashCheck && !hashCheck.equal ? 3 : 0);
