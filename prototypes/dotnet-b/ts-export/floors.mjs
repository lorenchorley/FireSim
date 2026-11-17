#!/usr/bin/env node
/**
 * Aggregates the store of floors-run.mjs into the tables of reports/3-floors.md and the JSON reports/3-floors.json (stage `3-floors`).
 *
 *   node floors.mjs --store DIR --json OUT.json [--md OUT.md]
 *
 * Metrics are those of bars.mjs (definitions in its header), candidate against the noise-free Node 22 reference of the same scenario and seed, at the horizons
 * 900 s, 1,800 s, 1 h, 2 h and 4 h, read from the 4 h arrival raster (a cell is burnt by H iff 0 <= arrival <= H). The three scenarios have embers on, so the
 * bars are those of plan 10.3 "embers on": 1 % of ever-burning cells, area within 2 %, median arrival difference 30 s (there is no 95th-percentile bar; the
 * 60 s of the embers-off row is shown beside it as a reference). Each tier's verdict takes the largest metric-to-bar ratio ("worst fraction of a bar").
 */
import fs from 'node:fs';
import path from 'node:path';
import { BARS, HORIZONS, METRICS, barFractions, barMetrics, firstDivergence, quantileSorted, readArrival, verdict, worstFraction } from './bars.mjs';

// Seeds that are not part of the card's matrix (the T3.1a glimpse, katoomba3-standard-4h seed 11 with noise seed 1): shown on their own, not pooled.
const EXTRA_SEEDS = new Set([11]);

const opt = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const store = opt('store');
if (!store || !opt('json')) {
  console.error('usage: floors.mjs --store DIR --json OUT.json [--md OUT.md]');
  process.exit(2);
}
let EMB = true; // the bars that apply to the scenario being aggregated: embers on (the three main scenarios) or off (the -noembers variants)
const TIER = { 'katoomba6-fast-4h-noembers': 'fast, Katoomba 6 km, embers off', 'katoomba3-standard-4h-noembers': 'standard, Katoomba 3 km, embers off', 'katoomba6-fast-4h': 'fast, Katoomba 6 km', 'katoomba3-standard-4h': 'standard, Katoomba 3 km', 'warrumbungles6-fast-4h': 'fast, Warrumbungles 6 km' };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const stats = (xs) => {
  const v = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: NaN, min: NaN, median: NaN, p90: NaN, max: NaN };
  const mid = v.length >> 1;
  return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, min: v[0], median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, p90: quantileSorted(v, 0.9), max: v[v.length - 1] };
};
const dirs = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((x) => fs.statSync(path.join(d, x)).isDirectory()).sort() : []);
const ledger = fs.existsSync(path.join(store, 'ledger.jsonl')) ? fs.readFileSync(path.join(store, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];

const out = { scenarios: [], conditions: {}, ledger: { jobs: ledger.length, secondsInJobs: Math.round(ledger.reduce((a, l) => a + (l.seconds ?? 0), 0)) } };
const gridS = Array.from({ length: 48 }, (_, i) => 300 * (i + 1));

function measure(ref, cand, cellSize) {
  const byH = {};
  for (const h of HORIZONS) {
    const m = barMetrics(ref, cand, h, cellSize);
    byH[h] = { ...m, fractions: barFractions(m, EMB), worstFraction: worstFraction(m, EMB), worstFractionEmbersOff: worstFraction(m, false) };
  }
  return { horizons: byH, first: firstDivergence(ref, cand, { gridS, embers: EMB }) };
}

for (const scenario of dirs(store)) {
  EMB = !scenario.endsWith('-noembers');
  const sc = { scenario, tier: TIER[scenario] ?? scenario, embers: EMB, bars: EMB ? BARS.embersOn : BARS.embersOff, seeds: {}, pooled: {} };
  for (const seedDir of dirs(path.join(store, scenario))) {
    const seed = Number(seedDir.replace('seed', ''));
    const base = path.join(store, scenario, seedDir);
    if (!fs.existsSync(path.join(base, 'ref', 'meta.json'))) continue;
    const ref = readArrival(path.join(base, 'ref', 'arrival.f32'));
    const refMeta = readJson(path.join(base, 'ref', 'meta.json'));
    const cs = refMeta.fireGrid.cellSize;
    const entry = { seed, cellSizeM: cs, cells: ref.length, refBurntCells: refMeta.arrival.burntCells, refBurntHa: (refMeta.arrival.burntCells * cs * cs) / 1e4, refBurntByHorizonHa: {}, noise: { draws: [] }, chrome: null, chromeinit: null };
    for (const h of HORIZONS) entry.refBurntByHorizonHa[h] = (ref.reduce((a, x) => a + (x >= 0 && x <= h ? 1 : 0), 0) * cs * cs) / 1e4;
    for (const kind of dirs(base).filter((k) => k.startsWith('noise'))) {
      const cand = readArrival(path.join(base, kind, 'arrival.f32'));
      const meta = readJson(path.join(base, kind, 'meta.json'));
      entry.noise.draws.push({ kind, noiseSeed: meta.noise?.seed, ...measure(ref, cand, cs), identicalToRef: Buffer.compare(fs.readFileSync(path.join(base, kind, 'arrival.f32')), fs.readFileSync(path.join(base, 'ref', 'arrival.f32'))) === 0, noiseCalls: meta.noise ? Object.values(meta.noise.calls ?? {}).reduce((a, b) => a + b, 0) : undefined, noiseNudged: meta.noise ? Object.values(meta.noise.nudged ?? {}).reduce((a, b) => a + b, 0) : undefined });
    }
    // per horizon summaries over the draws of this seed
    entry.noise.summary = {};
    for (const h of HORIZONS) {
      const s = { draws: entry.noise.draws.length };
      for (const k of [...METRICS, 'areaSignedPct', 'worstFraction', 'maxAbsS']) s[k] = stats(entry.noise.draws.map((d) => d.horizons[h][k]));
      s.drawsAtOrAboveBar = entry.noise.draws.filter((d) => d.horizons[h].worstFraction >= 1).length;
      entry.noise.summary[h] = s;
    }
    const exact = entry.noise.draws.map((d) => d.first.exactS ?? Infinity);
    const snap = entry.noise.draws.map((d) => d.first.snapshotS ?? Infinity);
    entry.noise.firstDivergence = { exactS: stats(exact.filter(Number.isFinite)), snapshotS: stats(snap.filter(Number.isFinite)), drawsIdenticalToRef: entry.noise.draws.filter((d) => d.identicalToRef).length, perDraw: entry.noise.draws.map((d) => ({ kind: d.kind, exactS: d.first.exactS, snapshotS: d.first.snapshotS, firstExceedS: d.first.firstExceedS })) };
    for (const arm of ['chrome', 'chromeinit']) {
      const d = path.join(base, arm);
      if (!fs.existsSync(path.join(d, 'meta.json'))) continue;
      const cand = readArrival(path.join(d, 'arrival.f32'));
      const meta = readJson(path.join(d, 'meta.json'));
      const e = { ...measure(ref, cand, cs), identicalToRef: Buffer.compare(fs.readFileSync(path.join(d, 'arrival.f32')), fs.readFileSync(path.join(base, 'ref', 'arrival.f32'))) === 0, engine: meta.engine, initFrom: meta.initFrom };
      const hashesRef = readJson(path.join(base, 'ref', 'hashes.json'));
      const hashesC = readJson(path.join(d, 'hashes.json'));
      const times = Object.keys(hashesRef).map(Number).sort((a, b) => a - b);
      const differing = times.filter((t) => hashesRef[t] !== hashesC[t]);
      e.hashes = { snapshots: times.length, equal: times.length - differing.length, firstDifferingS: differing[0] ?? null, differingTimes: differing.length <= 12 ? differing : `${differing.length} of ${times.length}` };
      if (fs.existsSync(path.join(d, 'compare.json'))) {
        const c = readJson(path.join(d, 'compare.json'));
        e.arrays = {
          initIdenticalExceptWallClock: c.init?.identicalExceptWallClock ?? null,
          initDifferingScalars: c.init?.differingScalarCount ?? null,
          initDifferingArrays: c.init ? Object.keys(c.init.differingArrays ?? {}).length : null,
          snapshotsCompared: (c.snapshots ?? []).map((s) => ({ t: s.t, arraysCompared: s.arraysCompared, arraysDiffering: s.arraysDiffering, differingScalarCount: s.differingScalarCount })),
          firstSnapshotWithDifferingArraysS: c.growth?.firstSnapshotWithDifferingArraysS ?? null,
          largestArrayDiffAtLastSnapshot: (() => {
            const last = (c.snapshots ?? []).at(-1);
            if (!last?.differingArrays) return null;
            return Object.fromEntries(Object.entries(last.differingArrays).map(([k, v]) => [k, { differing: v.differing, of: v.n, maxAbs: v.maxAbs }]));
          })(),
        };
      }
      entry[arm] = e;
    }
    sc.seeds[seed] = entry;
  }
  // pooled over seeds and draws, per horizon
  for (const h of HORIZONS) {
    const matrixSeeds = Object.values(sc.seeds).filter((e) => !EXTRA_SEEDS.has(e.seed));
    const draws = matrixSeeds.flatMap((e) => e.noise.draws.map((d) => d.horizons[h]));
    const p = { noiseDraws: draws.length };
    p.noiseDrawsAboveBar = Object.fromEntries(METRICS.filter((k) => (EMB ? BARS.embersOn : BARS.embersOff)[k] !== null).map((k) => [k, draws.filter((d) => d[k] > (EMB ? BARS.embersOn : BARS.embersOff)[k]).length]));
    p.noiseDrawsWithAnyDifference = draws.filter((d) => d.disagree > 0 || d.differing > 0).length;
    p.noiseDrawsWithStatusDifference = draws.filter((d) => d.disagree > 0).length;
    for (const k of [...METRICS, 'areaSignedPct', 'worstFraction']) p[`noise_${k}`] = stats(draws.map((d) => d[k]));
    p.noiseDrawsAtOrAboveBar = draws.filter((d) => d.worstFraction >= 1).length;
    p.noiseVerdictWorstDraw = verdict(p.noise_worstFraction.max);
    p.noiseVerdictMeanDraw = verdict(p.noise_worstFraction.mean);
    for (const arm of ['chrome', 'chromeinit']) {
      const es = Object.values(sc.seeds).filter((e) => !EXTRA_SEEDS.has(e.seed)).map((e) => e[arm]?.horizons[h]).filter(Boolean);
      p[`${arm}_seeds`] = es.length;
      p[`${arm}_worstFraction`] = es.length ? Math.max(...es.map((x) => x.worstFraction)) : null;
      p[`${arm}_verdict`] = es.length ? verdict(p[`${arm}_worstFraction`]) : null;
      for (const k of METRICS) p[`${arm}_max_${k}`] = es.length ? Math.max(...es.map((x) => (Number.isNaN(x[k]) ? 0 : x[k]))) : null;
    }
    sc.pooled[h] = p;
  }
  out.scenarios.push(sc);
}
fs.writeFileSync(opt('json'), JSON.stringify(out, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? (Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity') : v), 1));

// ---- markdown tables ----
const f = (x, d = 2) => (x === null || x === undefined ? 'n/a' : typeof x === 'string' ? x : Number.isNaN(x) ? 'NaN' : !Number.isFinite(x) ? String(x) : x.toFixed(d));
const hl = (h) => (h === 900 ? '900 s' : h === 1800 ? '1,800 s' : h === 3600 ? '1 h' : h === 7200 ? '2 h' : '4 h');
const lines = [];
const bar = BARS.embersOn;
lines.push(`Bars (embers on): cells ${bar.disagreePct} %, area ${bar.areaDiffPct} %, median ${bar.medianAbsS} s (embers off: ${BARS.embersOff.disagreePct} %, ${BARS.embersOff.areaDiffPct} %, ${BARS.embersOff.medianAbsS} s, p95 ${BARS.embersOff.p95AbsS} s).`);
for (const sc of out.scenarios) {
  lines.push('', `### ${sc.scenario} (${sc.tier})`, '', `Bars used (plan 10.3, embers ${sc.embers ? 'on' : 'off'}): cells ${sc.bars.disagreePct} %, area ${sc.bars.areaDiffPct} %, median ${sc.bars.medianAbsS} s${sc.bars.p95AbsS ? `, 95th percentile ${sc.bars.p95AbsS} s` : ''}.`, '');
  lines.push('Noise floor, per seed (mean / min / max over draws), by horizon.', '');
  lines.push('| seed | horizon | draws | cells differ, % of ever-burning | area difference, % (signed mean) | median arrival diff, s | 95th pct, s | worst fraction of a bar | draws at or above a bar |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const [seed, e] of Object.entries(sc.seeds)) for (const h of HORIZONS) {
    const s = e.noise.summary[h];
    const t = (st, d = 2) => `${f(st.mean, d)} / ${f(st.min, d)} / ${f(st.max, d)}`;
    lines.push(`| ${seed} | ${hl(h)} | ${s.draws} | ${t(s.disagreePct)} | ${t(s.areaDiffPct)} (${f(s.areaSignedPct.mean)}) | ${t(s.medianAbsS, 1)} | ${t(s.p95AbsS, 1)} | ${f(s.worstFraction.mean)} / ${f(s.worstFraction.max)} | ${s.drawsAtOrAboveBar} of ${s.draws} |`);
  }
  lines.push('', 'Pooled over the seeds of the matrix (all draws): each bar\'s metric as mean / median / 90th percentile / max, and the number of draws above that bar.', '');
  lines.push(`| horizon | draws | cells differ, % of ever-burning | area difference, % | median arrival diff, s | 95th pct, s | draws above the bar: cells / area / median${sc.bars.p95AbsS ? ' / 95th pct' : ''} | draws with any difference |`);
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const h of HORIZONS) {
    const p = sc.pooled[h];
    const t = (st, d = 2) => `${f(st.mean, d)} / ${f(st.median, d)} / ${f(st.p90, d)} / ${f(st.max, d)}`;
    lines.push(`| ${hl(h)} | ${p.noiseDraws} | ${t(p.noise_disagreePct)} | ${t(p.noise_areaDiffPct)} | ${t(p.noise_medianAbsS, 1)} | ${t(p.noise_p95AbsS, 1)} | ${p.noiseDrawsAboveBar.disagreePct} / ${p.noiseDrawsAboveBar.areaDiffPct} / ${p.noiseDrawsAboveBar.medianAbsS}${sc.bars.p95AbsS ? ` / ${p.noiseDrawsAboveBar.p95AbsS}` : ''} of ${p.noiseDraws} | ${p.noiseDrawsWithAnyDifference} of ${p.noiseDraws} |`);
  }
  lines.push('', 'First divergence of the noise draws, seconds into the fire. `any` = the first moment any cell\'s arrival time differs at all (even by a float32 step); `snapshot` = the next 300 s snapshot; `first above a bar` = the first 300 s grid time at which a metric is above its bar, median over the draws that get there (a draw that never does is not counted; `draws that ever go above` says how many).', '');
  lines.push('| seed | draws | bit-identical to the reference | any: min / median / max | snapshot: min / median / max | draws that ever go above: cells / area / median | first above a bar: cells / area / median (median over those draws) |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [seed, e] of Object.entries(sc.seeds)) {
    const fd = e.noise.firstDivergence;
    const ex = (k) => e.noise.draws.map((d) => d.first.firstExceedS[k]).filter((x) => x !== null && x !== undefined);
    const med = (k) => (ex(k).length ? f(stats(ex(k)).median, 0) : 'none');
    lines.push(`| ${seed}${EXTRA_SEEDS.has(Number(seed)) ? ' (T3.1a draw)' : ''} | ${e.noise.draws.length} | ${fd.drawsIdenticalToRef} | ${fd.exactS.n ? `${f(fd.exactS.min, 0)} / ${f(fd.exactS.median, 0)} / ${f(fd.exactS.max, 0)}` : 'none'} | ${fd.snapshotS.n ? `${f(fd.snapshotS.min, 0)} / ${f(fd.snapshotS.median, 0)} / ${f(fd.snapshotS.max, 0)}` : 'none'} | ${ex('disagreePct').length} / ${ex('areaDiffPct').length} / ${ex('medianAbsS').length} | ${med('disagreePct')} / ${med('areaDiffPct')} / ${med('medianAbsS')} |`);
  }
  if (Object.values(sc.seeds).some((e) => e.chrome)) {
    lines.push('', 'Engine floor: Chromium 153 against Node 22, no noise. Two arms: `own` = the browser builds its own scenario; `init` = the browser solver runs on Node\'s init.bin. Where both arms give the same numbers they are one row (`own = init`).', '');
    lines.push('', 'First divergence of Chromium from Node (own arm; seconds into the fire): the first moment any arrival time differs, and the first 300 s grid time above each bar (none = never, up to 4 h).', '');
    lines.push('| seed | any difference | snapshot | first above: cells / area / median |');
    lines.push('|---|---|---|---|');
    for (const [seed, e] of Object.entries(sc.seeds)) {
      if (!e.chrome) continue;
      const fx = e.chrome.first;
      lines.push(`| ${seed} | ${fx.exactS === null ? 'none (bit-identical raster)' : f(fx.exactS, 0)} | ${fx.snapshotS ?? 'none'} | ${f(fx.firstExceedS.disagreePct ?? 'none', 0)} / ${f(fx.firstExceedS.areaDiffPct ?? 'none', 0)} / ${f(fx.firstExceedS.medianAbsS ?? 'none', 0)} |`);
    }
    lines.push('', 'The two arms, by horizon:', '');
    lines.push('| seed | arm | horizon | cells differ, % | area diff, % (signed) | median s | 95th pct s | max s | worst fraction of a bar |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    const sameArms = (e, h) => e.chrome && e.chromeinit && ['disagreePct', 'areaSignedPct', 'medianAbsS', 'p95AbsS', 'maxAbsS', 'burntCand'].every((k) => Object.is(e.chrome.horizons[h][k], e.chromeinit.horizons[h][k]));
    for (const [seed, e] of Object.entries(sc.seeds)) for (const h of HORIZONS) {
      for (const arm of ['chrome', 'chromeinit']) {
        if (!e[arm] || (arm === 'chromeinit' && sameArms(e, h))) continue;
        const m = e[arm].horizons[h];
        lines.push(`| ${seed} | ${arm === 'chrome' ? (sameArms(e, h) ? 'own = init' : 'own') : 'init'} | ${hl(h)} | ${f(m.disagreePct, 3)} | ${f(m.areaDiffPct, 3)} (${f(m.areaSignedPct, 3)}) | ${f(m.medianAbsS, 3)} | ${f(m.p95AbsS, 3)} | ${f(m.maxAbsS, 3)} | ${f(m.worstFraction, 4)} |`);
      }
    }
  }
}
fs.writeFileSync(opt('md') ?? opt('json').replace(/\.json$/, '.tables.md'), lines.join('\n') + '\n');
console.log(`wrote ${opt('json')}; scenarios: ${out.scenarios.map((s) => `${s.scenario} (${Object.keys(s.seeds).length} seeds)`).join(', ')}`);
