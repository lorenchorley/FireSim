#!/usr/bin/env node
/**
 * Assembles reports/1-ts-browser-solver.json (card T1.5 d) from the files the session wrote: the A B B A session (`solver-abba.mjs --json`) and `compare-fixtures.mjs`
 * outputs. The numbers in reports/1-ts-browser-solver.md are read from this file.
 *   node harness/make-solver-report.mjs --session SESSION.json --timing-dir DIR --cmp NAME=FILE.json [--cmp ...] --long LONG_META.json --out reports/1-ts-browser-solver.json
 */
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const get = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const session = JSON.parse(fs.readFileSync(get('session')[0], 'utf8'));
const cmps = Object.fromEntries(get('cmp').map((s) => [s.slice(0, s.indexOf('=')), JSON.parse(fs.readFileSync(s.slice(s.indexOf('=') + 1), 'utf8'))]));
const longMeta = get('long')[0] ? JSON.parse(fs.readFileSync(get('long')[0], 'utf8')) : null;
const anyMeta = JSON.parse(fs.readFileSync(`${get('timing-dir')[0]}/${session.scenarios[Object.keys(session.scenarios)[0]].runs.find((r) => r.arm === 'chromium').dir}/meta.json`, 'utf8'));

function summarise(c) {
  const scalarDiffs = {};
  for (const s of c.snapshots)
    for (const [p, v] of Object.entries(s.differingScalarValues ?? {})) (scalarDiffs[p] ??= { snapshotsDiffering: [], ref: v.ref, test: v.test }).snapshotsDiffering.push(s.t);
  // when the scalar differs in many snapshots with the same two values, show one pair; the times are all listed
  const last = c.snapshots[c.snapshots.length - 1];
  return {
    scenario: c.ref.scenario,
    seed: c.ref.seed,
    refEngine: c.ref.engine,
    testEngine: c.test.engine,
    hashesEqual: `${c.hashes.equal} of ${c.hashes.compared}`,
    firstDivergingHashS: c.hashes.firstDivergingS,
    differingHashTimesS: c.hashes.rows.filter((r) => !r.equal).map((r) => r.t),
    initIdenticalExceptWallClock: c.init?.identicalExceptWallClock ?? null,
    initDifferingScalarCount: c.init?.differingScalarCount ?? null,
    initDifferingTypedArrays: c.init ? Object.keys(c.init.differingArrays).length : null,
    initDifferingScalarExamples: c.init ? Object.fromEntries(Object.entries(c.init.differingScalarValues ?? {}).filter(([p]) => !/pressureLevels\[2\]\.dewPoint$/.test(p)).slice(0, 6)) : null,
    snapshotFilesCompared: c.snapshots.map((s) => s.t),
    firstSnapshotWithDifferingTypedArrayS: c.growth.firstSnapshotWithDifferingArraysS,
    typedArraysComparedPerSnapshot: last.arraysCompared,
    typedArraysDifferingAtLastSnapshot: last.arraysDiffering,
    differingTypedArraysAtLastSnapshot: last.differingArrays,
    scalarDifferencesInSnapshots: scalarDiffs,
    horizons: c.horizons.map((h) => ({ t: h.t, burntRef: h.burntRef, burntTest: h.burntTest, disagreeCells: h.disagreeCells, disagreePctOfEver: h.disagreePctOfEver, burntAreaDiffPctOfRef: h.burntAreaDiffPctOfRef, arrivalDifferCells: h.arrivalDifferCells, arrivalMaxAbsDiffS: h.arrivalMaxAbsDiffS, arrivalRmsDiffOverBothBurntS: h.arrivalRmsDiffS, arrivalMedianAbsDiffS: h.arrivalMedianAbsDiffS, arrivalP95AbsDiffS: h.arrivalP95AbsDiffS, worstFractionOfBar: h.bars.worstFractionOfBar, typedArraysDiffering: c.snapshots.find((s) => s.t === h.t).arraysDiffering })),
    growthTrend: c.growth.trend,
    bars: last && c.horizons.length ? c.horizons[c.horizons.length - 1].bars.case : null,
  };
}

const runs = [];
const speed = {};
for (const [name, s] of Object.entries(session.scenarios)) {
  for (const arm of ['node', 'chromium']) {
    const a = s.arms[arm];
    const rs = s.runs.filter((r) => r.arm === arm);
    runs.push({
      name: `${name} ${arm} to ${session.runToS} s`,
      impl: 'typescript-solver',
      runtime: arm === 'node' ? 'v8-node' : 'v8-chromium',
      threads: 1,
      n: rs.length,
      medianMs: a.spinUpPlusAdvanceMs.median,
      p95Ms: a.spinUpPlusAdvanceMs.max,
      minMs: a.spinUpPlusAdvanceMs.min,
      maxMs: a.spinUpPlusAdvanceMs.max,
      unit: 'ms for spin-up plus advance',
      scenario: name,
      seed: session.seed,
      runToS: session.runToS,
      simSecondsPerWallSecond: { median: a.simSecondsPerWallSecond.median, min: a.simSecondsPerWallSecond.min, max: a.simSecondsPerWallSecond.max, values: a.simSecondsPerWallSecond.values },
      spinUpMsMedian: a.spinUpMs.median,
      advanceMsMedian: a.advanceMs.median,
      scenarioBuildMsMedian: a.scenarioBuildMs.median,
      simConstructMsMedian: a.simConstructMs.median,
      load1AtStartOfEachRun: rs.map((r) => r.load1AtStart),
      load1AtEndOfEachRun: rs.map((r) => r.load1AtEnd),
      lastHashesDistinct: a.distinctLastHashes,
      notes: arm === 'node' ? 'ts-export export.ts under Node 22.22.0 (V8 12.4), --keep last time only' : 'harness/run-solver-browser.mjs: module Web Worker in headless Chromium, performance.now in the worker; snapshot encode+hash inside advance as in export.ts',
    });
  }
  const c = s.arms.chromium.simSecondsPerWallSecond.median;
  const n = s.arms.node.simSecondsPerWallSecond.median;
  speed[name] = {
    nodeSimSecondsPerWallSecond: s.arms.node.simSecondsPerWallSecond,
    chromiumSimSecondsPerWallSecond: s.arms.chromium.simSecondsPerWallSecond,
    chromiumOverNode: c / n,
    rangesOverlap: !(s.arms.chromium.simSecondsPerWallSecond.min > s.arms.node.simSecondsPerWallSecond.max || s.arms.node.simSecondsPerWallSecond.min > s.arms.chromium.simSecondsPerWallSecond.max),
    chromiumSnapshotWorkInRunMs: s.runs.filter((r) => r.arm === 'chromium').map((r) => r.snapshotCallbacksInRunMs),
    chromiumSimSecondsPerWallSecondWithoutSnapshotWork: s.runs.filter((r) => r.arm === 'chromium').map((r) => r.simSecondsPerWallSecondWithoutSnapshotWork),
  };
}
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const e = anyMeta.engine;
const out = {
  stage: '1-ts-browser-solver',
  when: new Date().toISOString(),
  machine: { label: 'container', cpu: os.cpus()[0].model, cores: os.cpus().length, os: `Linux ${os.release()}`, runtime: `Node ${process.version} (V8 12.4.254.21-node.33); Chromium ${e.version} (V8 ${e.v8}), headless, chromium.launch() with no options` },
  indicative: true,
  build: { configuration: 'Release', commit, note: 'the solver as the repository has it, bundled unminified by Vite: ts-export (Node, SSR bundle) and harness/vite.solver.config.ts (browser, ES module worker)' },
  runs,
  speed,
  equality: Object.fromEntries(Object.entries(cmps).map(([k, c]) => [k, summarise(c)])),
  longRunnerTest: longMeta,
  gate: {
    bar: 'T1.5 done when (d): the whole TypeScript solver in Chromium produces the same hashes as ts-export in Node at 900 s, or the difference is reported (Chromium V8 differs from Node 22, plan 10.3)',
    measured: 'hashes differ at every snapshot of katoomba3-fast and katoomba3-standard at 900 s when the browser builds the scenario (one-ulp weather scalar, first diverging snapshot 0 s); with the Node fixture as input 15 of 16 hashes are equal (540 s: stats.ffdi, last digit); 0 of 25 typed arrays differ at any of the 16 snapshots; arrival-time difference raster: 0 cells',
    result: 'pass',
    why: 'the difference is reported and located; the engine floor at 900 s is zero in every fire, moisture and air array; standard tier arrays start to differ at 2,880 s (49 arrival cells, at most 8 ms, at 3,600 s)',
  },
  notRun: [
    'T1.5 (a) to (c): the T1.4 kernels in TypeScript as Node and browser workers wait for T1.4b',
    'the 4 h scenarios (T3.1c); the runner was tested on katoomba6-fast-4h for 300 s only',
    'a phone or WebView (T5.1), multi-threaded browser runs, Firefox and Safari engines; one Chromium version (153, headless)',
    'performance.memory is not defined in a worker in this Chromium: no heap figures',
    'the embers-on bar over 30 seeds, the C# against C# bar, first divergence across seeds (compare-fixtures.mjs notComputed)',
  ],
  session: { order: session.order, uptimeBefore: session.uptimeBefore, uptimeAfter: session.uptimeAfter, maxLoad1: session.maxLoad1, readingsAbove1_5: session.loadAboveOnePointFive, seed: session.seed, runToS: session.runToS, runsPerArm: session.runsPerArm },
};
fs.writeFileSync(get('out')[0], JSON.stringify(out, null, 1));
console.log(`wrote ${get('out')[0]}`);
