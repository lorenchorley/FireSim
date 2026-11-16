#!/usr/bin/env node
/**
 * Compares two fixture folders written by `ts-export/export.ts` (Node) or `harness/run-solver-browser.mjs` (Chromium), or by any later producer of the same
 * format (T3.1b noise runs, the C# exporter), and writes a JSON table: the reusable core of the engine floor (T3.1c) and of Fs.Compare's TypeScript side.
 *
 *   node prototypes/dotnet-b/harness/compare-fixtures.mjs REF_DIR TEST_DIR [--json OUT.json] [--horizons 300,900,..] [--quiet]
 *
 * REF_DIR is the reference (Node 22 for the engine floor): percentages and the bars' ratios are relative to it. Nothing is read from the repository's code: the codec
 * is decoded here from the format in ts-export/README.md (u32 header length, JSON header, 8-byte-aligned body, `$ta` and `$num` placeholders).
 *
 * What it computes (all of it from files both folders have):
 *  - hashes: for every snapshot time in both hashes.json, equal or not; `firstDivergingS` (the first time whose hash differs; null when all equal).
 *  - init: the two init.bin messages (the scenario both runs were built from): typed arrays and scalar leaves that differ, except the wall-clock
 *    `datasetSummary.builtAt` and `buildDurationMs`. If it differs, a difference in the results is not only the engine's.
 *  - snapshots: for every snapshot file both folders have (times in both meta.snapshotsWritten): the typed arrays that differ (count of differing elements, largest
 *    absolute difference, RMS of the differences where both are finite), the number of scalar leaves that differ (stats, spot fires, insights, ...).
 *    (`differingScalarValues` has the first thirty with both values). `engine` and `stats.msPerSimMinute` are left out, as the app's snapshotHash leaves them out. NaN equals NaN; -0 differs from +0.
 *  - horizons (default: every snapshot time that has files in both): the metrics of plan 10.3, from fire.arrivalTime ("burnt" = finite arrival):
 *    cells burnt in each run, burnt in either ("ever burning"), burnt in one only (`disagreeCells`, `disagreePctOfEver`), burnt area difference in % of the
 *    reference, and over the cells burnt in both: how many have a different arrival time, the largest and RMS difference, median and 95th percentile of the absolute
 *    difference (seconds). `bars` states the bar of 10.3 that applies (embers on or off from meta.options.embers) and the measured value as a fraction of it.
 *  - arrivalF32: the same metrics on arrival.f32 (the last snapshot's raster, -1 = unburnt).
 *  - growth: the first snapshot with a differing typed array (`firstSnapshotWithDifferingArraysS`; the hash alone also moves on a changed scalar) and whether the divergence grows over the horizons (differing arrival cells, largest and RMS arrival difference, per time).
 * Not computed (`notComputed` in the output): the embers-on bar "mean burnt area over 30 seeds within 12 %" (needs 30 seeds of each), the C# against C# bit-identity bar
 * (not a comparison of two engines of the TypeScript), and per-seed first-divergence tables across seeds (one pair of runs gives one first-divergence time).
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flags = new Set(['--quiet']);
const pos = [];
const named = {};
for (let i = 0; i < argv.length; i++) {
  if (flags.has(argv[i])) named[argv[i].slice(2)] = true;
  else if (argv[i].startsWith('--')) named[argv[i].slice(2)] = argv[++i];
  else pos.push(argv[i]);
}
if (pos.length !== 2) {
  console.error('usage: compare-fixtures.mjs REF_DIR TEST_DIR [--json OUT.json] [--horizons T,T,..] [--quiet]');
  process.exit(2);
}
const [refDir, testDir] = pos;

// ---- codec (decode only) ----
const KINDS = { f32: Float32Array, f64: Float64Array, i8: Int8Array, u8: Uint8Array, u8c: Uint8Array, i16: Int16Array, u16: Uint16Array, i32: Int32Array, u32: Uint32Array, i64: BigInt64Array, u64: BigUint64Array };
function decodeFrame(file) {
  const b = fs.readFileSync(file);
  const H = b.readUInt32LE(0);
  const tree = JSON.parse(b.subarray(4, 4 + H).toString('utf8'));
  const B = Math.ceil((4 + H) / 8) * 8;
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    if ('$ta' in v) {
      const C = KINDS[v.$ta];
      if (!C) throw new Error(`${file}: unknown array kind ${v.$ta}`);
      const start = b.byteOffset + B + v.o;
      return new C(b.buffer.slice(start, start + v.n * C.BYTES_PER_ELEMENT));
    }
    if ('$num' in v) return v.$num === 'NaN' ? NaN : v.$num === 'Infinity' ? Infinity : v.$num === '-Infinity' ? -Infinity : -0;
    const o = {};
    for (const k of Object.keys(v)) o[k] = walk(v[k]);
    return o;
  };
  return walk(tree);
}

// ---- generic tree difference ----
const isTA = (v) => ArrayBuffer.isView(v);
function diffArrays(a, b) {
  const n = Math.min(a.length, b.length);
  let differing = Math.abs(a.length - b.length);
  let maxAbs = 0;
  let sumSq = 0;
  let finiteDiffs = 0;
  const big = a instanceof BigInt64Array || a instanceof BigUint64Array;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (Object.is(x, y)) continue;
    if (x !== x && y !== y) continue; // NaN equals NaN
    differing++;
    if (!big && Number.isFinite(x) && Number.isFinite(y)) {
      const d = Math.abs(x - y);
      if (d > maxAbs) maxAbs = d;
      sumSq += d * d;
      finiteDiffs++;
    }
  }
  return { n: a.length, differing, maxAbs, rms: finiteDiffs ? Math.sqrt(sumSq / finiteDiffs) : 0 };
}
function diffTrees(a, b, skip, pathStr, out) {
  if (skip.has(pathStr)) return;
  if (isTA(a) || isTA(b)) {
    if (!(isTA(a) && isTA(b)) || a.constructor !== b.constructor) out.scalars.push(`${pathStr} (array kind or presence differs)`);
    else out.arrays[pathStr] = diffArrays(a, b);
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (!(Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && a !== a && b !== b))) {
      out.scalars.push(pathStr);
      out.values[pathStr] = [a, b];
    }
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return void out.scalars.push(`${pathStr} (array vs object)`);
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.scalars.push(`${pathStr}.length (${a.length} vs ${b.length})`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffTrees(a[i], b[i], skip, `${pathStr}[${i}]`, out);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = pathStr ? `${pathStr}.${k}` : k;
    if (!(k in a) || !(k in b)) {
      if (!skip.has(p)) out.scalars.push(`${p} (present in one only)`);
      continue;
    }
    diffTrees(a[k], b[k], skip, p, out);
  }
}
function treeDiff(a, b, skipPaths) {
  const out = { arrays: {}, scalars: [], values: {} };
  diffTrees(a, b, new Set(skipPaths), '', out);
  const differingArrays = Object.fromEntries(Object.entries(out.arrays).filter(([, v]) => v.differing > 0));
  const differingScalarValues = Object.fromEntries(out.scalars.slice(0, 30).filter((p) => p in out.values).map((p) => [p, { ref: out.values[p][0], test: out.values[p][1] }]));
  return { arrayCount: Object.keys(out.arrays).length, arrays: out.arrays, differingArrays, differingScalars: out.scalars, differingScalarValues };
}

// ---- the metrics of plan 10.3 on two arrival rasters ----
function pct(sorted, q) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
}
function arrivalMetrics(a, b, unburntIs) {
  const burnt = unburntIs === 'inf' ? (x) => Number.isFinite(x) : (x) => x >= 0;
  const cells = a.length;
  let burntA = 0, burntB = 0, either = 0, both = 0, disagree = 0, differ = 0, maxAbs = 0, sumSq = 0, sumSigned = 0;
  const abs = [];
  for (let i = 0; i < cells; i++) {
    const ba = burnt(a[i]);
    const bb = burnt(b[i]);
    if (ba) burntA++;
    if (bb) burntB++;
    if (ba || bb) either++;
    if (ba !== bb) disagree++;
    if (ba && bb) {
      both++;
      const d = b[i] - a[i];
      if (d !== 0) {
        differ++;
        sumSigned += d;
      }
      const m = Math.abs(d);
      abs.push(m);
      if (m > maxAbs) maxAbs = m;
      sumSq += d * d;
    }
  }
  abs.sort((x, y) => x - y);
  return {
    cells,
    burntRef: burntA,
    burntTest: burntB,
    burntEither: either,
    burntBoth: both,
    disagreeCells: disagree,
    disagreePctOfEver: either ? (100 * disagree) / either : 0,
    burntAreaDiffPctOfRef: burntA ? (100 * Math.abs(burntB - burntA)) / burntA : burntB ? 100 : 0,
    arrivalDifferCells: differ,
    arrivalMaxAbsDiffS: maxAbs,
    arrivalRmsDiffS: both ? Math.sqrt(sumSq / both) : 0,
    arrivalMeanSignedDiffS: differ ? sumSigned / differ : 0,
    arrivalMedianAbsDiffS: pct(abs, 0.5),
    arrivalP95AbsDiffS: pct(abs, 0.95),
  };
}
function barsOf(m, embersOn) {
  const bar = embersOn ? { cellsPct: 1, areaPct: 2, medianS: 30, p95S: null } : { cellsPct: 2.5, areaPct: 2.5, medianS: 30, p95S: 60 };
  const frac = (v, lim) => (lim === null ? null : v / lim);
  const f = {
    cells: frac(m.disagreePctOfEver, bar.cellsPct),
    area: frac(m.burntAreaDiffPctOfRef, bar.areaPct),
    median: frac(m.arrivalMedianAbsDiffS, bar.medianS),
    p95: frac(m.arrivalP95AbsDiffS, bar.p95S),
  };
  const worst = Math.max(...Object.values(f).filter((x) => x !== null));
  return { case: embersOn ? 'embers on, generator and draw order exact (<=1 % cells, area within 2 %, median <=30 s)' : 'embers off (<=2.5 % cells, area within 2.5 %, median <=30 s, p95 <=60 s)', limits: bar, fractionOfBar: f, worstFractionOfBar: worst, withinBars: worst <= 1 };
}

// ---- read the folders ----
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const metaOf = (d) => (fs.existsSync(path.join(d, 'meta.json')) ? readJson(path.join(d, 'meta.json')) : {});
const metaA = metaOf(refDir);
const metaB = metaOf(testDir);
const hashA = readJson(path.join(refDir, 'hashes.json'));
const hashB = readJson(path.join(testDir, 'hashes.json'));
const writtenOf = (d, meta, hashes) => (meta.snapshotsWritten ?? Object.keys(hashes).map(Number)).filter((t) => fs.existsSync(path.join(d, `snap-${t}.bin`)));
const filesA = new Set(writtenOf(refDir, metaA, hashA));
const filesB = new Set(writtenOf(testDir, metaB, hashB));
const hashTimes = Object.keys(hashA).filter((k) => k in hashB).map(Number).sort((x, y) => x - y);
const embersOn = (metaA.options?.embers ?? true) !== false;

const hashRows = hashTimes.map((t) => ({ t, ref: hashA[String(t)], test: hashB[String(t)], equal: hashA[String(t)] === hashB[String(t)] }));
const firstBad = hashRows.find((r) => !r.equal);
const hashes = {
  compared: hashRows.length,
  equal: hashRows.filter((r) => r.equal).length,
  differing: hashRows.filter((r) => !r.equal).length,
  onlyInRef: Object.keys(hashA).filter((k) => !(k in hashB)).length,
  onlyInTest: Object.keys(hashB).filter((k) => !(k in hashA)).length,
  allEqual: hashRows.every((r) => r.equal) && Object.keys(hashA).length === Object.keys(hashB).length,
  firstDivergingS: firstBad ? firstBad.t : null,
  rows: hashRows,
};

let init = null;
if (fs.existsSync(path.join(refDir, 'init.bin')) && fs.existsSync(path.join(testDir, 'init.bin'))) {
  const d = treeDiff(decodeFrame(path.join(refDir, 'init.bin')), decodeFrame(path.join(testDir, 'init.bin')), ['scenario.datasetSummary.builtAt', 'scenario.datasetSummary.buildDurationMs']);
  init = { identicalExceptWallClock: Object.keys(d.differingArrays).length === 0 && d.differingScalars.length === 0, arrayCount: d.arrayCount, differingArrays: d.differingArrays, differingScalars: d.differingScalars.slice(0, 40), differingScalarValues: d.differingScalarValues, differingScalarCount: d.differingScalars.length };
}

const horizonList = named.horizons ? named.horizons.split(',').map(Number) : [...filesA].filter((t) => filesB.has(t)).sort((x, y) => x - y);
const snapshots = [];
const horizons = [];
for (const t of horizonList) {
  if (!filesA.has(t) || !filesB.has(t)) continue;
  const a = decodeFrame(path.join(refDir, `snap-${t}.bin`)).snapshot;
  const b = decodeFrame(path.join(testDir, `snap-${t}.bin`)).snapshot;
  const d = treeDiff(a, b, ['stats.msPerSimMinute', 'engine']);
  snapshots.push({
    t,
    hashEqual: hashA[String(t)] === hashB[String(t)],
    arraysCompared: d.arrayCount,
    arraysDiffering: Object.keys(d.differingArrays).length,
    differingArrays: d.differingArrays,
    differingScalarCount: d.differingScalars.length,
    differingScalars: d.differingScalars.slice(0, 30),
    differingScalarValues: d.differingScalarValues,
    ...(t === Math.max(...horizonList) ? { allArrays: d.arrays } : {}),
  });
  const m = arrivalMetrics(a.fire.arrivalTime, b.fire.arrivalTime, 'inf');
  horizons.push({ t, ...m, bars: barsOf(m, embersOn) });
}
let arrivalF32 = null;
if (fs.existsSync(path.join(refDir, 'arrival.f32')) && fs.existsSync(path.join(testDir, 'arrival.f32'))) {
  const rd = (f) => {
    const b = fs.readFileSync(f);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const a = rd(path.join(refDir, 'arrival.f32'));
  const b = rd(path.join(testDir, 'arrival.f32'));
  if (a.length === b.length) {
    const m = arrivalMetrics(a, b, 'neg');
    arrivalF32 = { atTimeS: { ref: metaA.arrival?.atTimeS ?? null, test: metaB.arrival?.atTimeS ?? null }, identicalBytes: Buffer.compare(fs.readFileSync(path.join(refDir, 'arrival.f32')), fs.readFileSync(path.join(testDir, 'arrival.f32'))) === 0, ...m, bars: barsOf(m, embersOn) };
  } else arrivalF32 = { error: `arrival.f32 sizes differ: ${a.length} vs ${b.length} cells` };
}

// growth: a divergence that is real grows with time (chaotic spread) unless the fire has run out of fuel or domain
const series = horizons.map((h) => ({ t: h.t, arrivalDifferCells: h.arrivalDifferCells, arrivalMaxAbsDiffS: h.arrivalMaxAbsDiffS, arrivalRmsDiffS: h.arrivalRmsDiffS, disagreeCells: h.disagreeCells }));
const firstNonzero = series.findIndex((s) => s.arrivalDifferCells > 0 || s.disagreeCells > 0);
let trend = 'none';
if (firstNonzero >= 0) {
  const first = series[firstNonzero];
  const last = series[series.length - 1];
  const f = first.arrivalDifferCells + first.disagreeCells;
  const l = last.arrivalDifferCells + last.disagreeCells;
  trend = firstNonzero === series.length - 1 ? 'single-horizon' : l > 1.5 * f ? 'growing' : l < f / 1.5 ? 'shrinking' : 'flat';
}
const firstArrayDiv = snapshots.find((x) => x.arraysDiffering > 0);
const growth = {
  firstSnapshotWithDifferingArraysS: firstArrayDiv ? firstArrayDiv.t : null,
  snapshotsCompared: snapshots.length, firstHorizonWithArrivalDifferenceS: firstNonzero >= 0 ? series[firstNonzero].t : null, trend, series };

const result = {
  tool: 'harness/compare-fixtures.mjs',
  ref: { dir: refDir, fixture: metaA.fixture ?? null, scenario: metaA.scenario ?? null, seed: metaA.seed ?? null, engine: metaA.engine ?? (metaA.node ? { kind: 'node', version: metaA.node } : null), embersOn },
  test: { dir: testDir, fixture: metaB.fixture ?? null, scenario: metaB.scenario ?? null, seed: metaB.seed ?? null, engine: metaB.engine ?? (metaB.node ? { kind: 'node', version: metaB.node } : null) },
  sameScenarioSeedInterval: metaA.scenario === metaB.scenario && metaA.seed === metaB.seed && metaA.snapshotIntervalS === metaB.snapshotIntervalS && metaA.runToS === metaB.runToS,
  hashes,
  init,
  snapshots,
  horizons,
  arrivalF32,
  growth,
  notComputed: [
    'embers-on bar "mean burnt area over 30 seeds within 12 % of the reference mean" (needs 30 seeds of each engine; one pair of runs cannot give it)',
    'C# against C# bit-identity bar (compares two builds of the C# solver, not two engines of the TypeScript)',
    'first-divergence time per seed across seeds (one pair of runs gives one time; run the pair for each seed)',
    'agreement of fields other than arrival time and burnt status (rate of spread, intensity, moisture, air) as bar metrics: they are in `snapshots[].differingArrays` as counts of differing cells and largest and RMS differences, but 10.3 sets no bar for them',
  ],
};
if (named.json) fs.writeFileSync(named.json, JSON.stringify(result, null, 1));
if (!named.quiet) {
  const line = (s) => console.log(s);
  line(`ref ${refDir}\ntest ${testDir}`);
  line(`hashes: ${hashes.equal}/${hashes.compared} equal; first diverging snapshot: ${hashes.firstDivergingS === null ? 'none' : hashes.firstDivergingS + ' s'}`);
  if (init) line(`init: ${init.identicalExceptWallClock ? 'identical (except wall-clock fields)' : `DIFFERS: ${Object.keys(init.differingArrays).length} arrays, ${init.differingScalarCount} scalars`}`);
  line('t(s)  hash  arraysDiffering  arrivalDiffer  burntDisagree  disagree%  area%  maxAbs(s)  rms(s)  median(s)  p95(s)  worst/bar');
  for (const h of horizons) {
    const s = snapshots.find((x) => x.t === h.t);
    line(`${String(h.t).padStart(5)}  ${s.hashEqual ? 'eq ' : 'NE '}  ${String(s.arraysDiffering).padStart(5)}/${s.arraysCompared}  ${String(h.arrivalDifferCells).padStart(10)}  ${String(h.disagreeCells).padStart(10)}  ${h.disagreePctOfEver.toFixed(2).padStart(8)}  ${h.burntAreaDiffPctOfRef.toFixed(2).padStart(6)}  ${h.arrivalMaxAbsDiffS.toFixed(2).padStart(8)}  ${h.arrivalRmsDiffS.toFixed(2).padStart(7)}  ${h.arrivalMedianAbsDiffS.toFixed(2).padStart(8)}  ${h.arrivalP95AbsDiffS.toFixed(2).padStart(7)}  ${h.bars.worstFractionOfBar.toFixed(3)}`);
  }
  line(`first snapshot (of ${growth.snapshotsCompared} with files in both) with a differing typed array: ${growth.firstSnapshotWithDifferingArraysS === null ? 'none' : growth.firstSnapshotWithDifferingArraysS + ' s'}`);
  line(`growth: ${growth.trend}`);
}
process.exit(0);
