#!/usr/bin/env node
/**
 * Card T1.5 (d): the timing session. The whole TypeScript solver in Node (`ts-export/run.mjs export`, arm N) against the same solver in a Chromium Web Worker
 * (`harness/run-solver-browser.mjs`, arm C), A B B A: for `--runs 3` the order is N C C N N C (three each, each arm once first and once last), one process per run,
 * the same scenario, seed and cadence, `--keep <to>` in both (a last-snapshot file is the only output either arm writes), so the work per run is the same.
 * Simulated seconds per wall second = runTo / ((spinUp + advance) / 1000), the figure of reports/1-profile.md. The 1-minute load average is recorded before and after
 * every run. Run the whole thing under the heavy lock:
 *
 *   flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/harness/solver-abba.mjs --out DIR --json OUT.json [--scenarios katoomba6-fast,katoomba3-standard] [--seed 13] [--to 1800] [--runs 3]
 *
 * Also checks, from the files the runs wrote, that every run of an arm gives the same hashes (determinism within the arm) and compares the arms' last snapshot
 * (compare-fixtures.mjs): the same data point as the equality check, at the end of the timing run.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const opt = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const out = opt('out');
if (!out) {
  console.error('usage: solver-abba.mjs --out DIR --json OUT.json [--scenarios a,b] [--seed 13] [--to 1800] [--runs 3]');
  process.exit(2);
}
const scenarios = opt('scenarios', 'katoomba6-fast,katoomba3-standard').split(',');
const seed = opt('seed', '13');
const to = opt('to', '1800');
const runs = Number(opt('runs', '3'));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const stats = (a) => ({ median: median(a), min: Math.min(...a), max: Math.max(...a), spreadPctOfMedian: (100 * (Math.max(...a) - Math.min(...a))) / median(a), values: a });
const uptimeText = () => spawnSync('uptime', { encoding: 'utf8' }).stdout.trim();

fs.mkdirSync(out, { recursive: true });
const session = { startedAt: new Date().toISOString(), uptimeBefore: uptimeText(), seed: Number(seed), runToS: Number(to), runsPerArm: runs, order: null, scenarios: {} };
const order = [];
for (let i = 0; i < 2 * runs; i++) order.push(...(i % 2 === 0 ? ['node', 'chromium'] : ['chromium', 'node']));
session.order = order.slice(0, 2 * runs).join(' ');
const seq = order.slice(0, 2 * runs);

for (const name of scenarios) {
  const rows = [];
  const count = { node: 0, chromium: 0 };
  for (const arm of seq) {
    const k = ++count[arm];
    const dir = `${name}-${arm}-${k}`;
    const args = arm === 'node' ? [path.join(repo, 'prototypes/dotnet-b/ts-export/run.mjs'), 'export', name] : [path.join(here, 'run-solver-browser.mjs'), name];
    args.push('--out', out, '--seed', seed, '--to', to, '--keep', to, '--dir', dir);
    const load0 = os.loadavg()[0];
    const r = spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const load1 = os.loadavg()[0];
    if (r.status !== 0) {
      console.error(`${dir} failed (${r.status}): ${r.stderr.slice(-800)}`);
      process.exit(1);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(out, dir, 'meta.json'), 'utf8'));
    const t = meta.timingMs;
    const runMs = arm === 'chromium' ? t.unrounded.spinUpPlusAdvance : t.spinUpPlusAdvance;
    rows.push({
      arm,
      run: k,
      dir,
      load1AtStart: load0,
      load1AtEnd: load1,
      scenarioBuildMs: arm === 'chromium' ? t.unrounded.scenarioBuild : t.scenarioBuild,
      simConstructMs: arm === 'chromium' ? t.unrounded.simConstruct : t.simConstruct,
      spinUpMs: arm === 'chromium' ? t.unrounded.spinUp : t.spinUp,
      advanceMs: arm === 'chromium' ? t.unrounded.advance : t.advance,
      spinUpPlusAdvanceMs: runMs,
      simSecondsPerWallSecond: Number(to) / (runMs / 1000),
      // Chromium only: the per-snapshot encode + hash share of the run (the Node exporter does not time its hash), and the speed without it
      ...(arm === 'chromium' ? { snapshotCallbacksInRunMs: t.unrounded.snapshotCallbacksInRun, simSecondsPerWallSecondWithoutSnapshotWork: Number(to) / ((runMs - t.unrounded.snapshotCallbacksInRun) / 1000), usedJSHeapSizeAtEndMB: meta.memory?.atEnd ? meta.memory.atEnd.usedJSHeapSize / 2 ** 20 : null } : {}),
      burntCells: meta.arrival.burntCells,
      lastHash: JSON.parse(fs.readFileSync(path.join(out, dir, 'hashes.json'), 'utf8'))[to],
      loadAvgNote: undefined,
    });
    console.error(`${dir}: ${runMs.toFixed(0)} ms, ${rows.at(-1).simSecondsPerWallSecond.toFixed(1)} sim s per wall s, load ${load0.toFixed(2)} -> ${load1.toFixed(2)}`);
  }
  const arms = {};
  for (const arm of ['node', 'chromium']) {
    const a = rows.filter((x) => x.arm === arm);
    arms[arm] = {
      simSecondsPerWallSecond: stats(a.map((x) => x.simSecondsPerWallSecond)),
      spinUpPlusAdvanceMs: stats(a.map((x) => x.spinUpPlusAdvanceMs)),
      spinUpMs: stats(a.map((x) => x.spinUpMs)),
      advanceMs: stats(a.map((x) => x.advanceMs)),
      scenarioBuildMs: stats(a.map((x) => x.scenarioBuildMs)),
      simConstructMs: stats(a.map((x) => x.simConstructMs)),
      distinctLastHashes: [...new Set(a.map((x) => x.lastHash))],
      distinctBurntCells: [...new Set(a.map((x) => x.burntCells))],
    };
  }
  const first = (arm) => rows.find((x) => x.arm === arm).dir;
  const cmp = spawnSync(process.execPath, [path.join(here, 'compare-fixtures.mjs'), path.join(out, first('node')), path.join(out, first('chromium')), '--quiet', '--json', path.join(out, `cmp-${name}.json`)], { encoding: 'utf8' });
  if (cmp.status !== 0) console.error(cmp.stderr);
  session.scenarios[name] = {
    runs: rows,
    arms,
    chromiumOverNodeSpeedRatio: arms.chromium.simSecondsPerWallSecond.median / arms.node.simSecondsPerWallSecond.median,
    comparisonFile: `cmp-${name}.json`,
  };
}
session.finishedAt = new Date().toISOString();
session.uptimeAfter = uptimeText();
const loads = Object.values(session.scenarios).flatMap((s) => s.runs.flatMap((r) => [r.load1AtStart, r.load1AtEnd]));
session.maxLoad1 = Math.max(...loads);
session.loadAboveOnePointFive = loads.filter((l) => l > 1.5).length + ' of ' + loads.length + ' readings';
const j = opt('json');
if (j) fs.writeFileSync(j, JSON.stringify(session, null, 1));
for (const [n, s] of Object.entries(session.scenarios)) {
  console.log(`${n}: node ${s.arms.node.simSecondsPerWallSecond.median.toFixed(1)} (${s.arms.node.simSecondsPerWallSecond.min.toFixed(1)}-${s.arms.node.simSecondsPerWallSecond.max.toFixed(1)}), chromium ${s.arms.chromium.simSecondsPerWallSecond.median.toFixed(1)} (${s.arms.chromium.simSecondsPerWallSecond.min.toFixed(1)}-${s.arms.chromium.simSecondsPerWallSecond.max.toFixed(1)}) sim s per wall s; chromium/node ${s.chromiumOverNodeSpeedRatio.toFixed(3)}`);
}
console.log(`max load1 ${session.maxLoad1.toFixed(2)}; ${session.loadAboveOnePointFive} above 1.5`);
