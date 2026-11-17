#!/usr/bin/env node
/**
 * Tier-difference and seed-difference study (stage 3a). Plain Node, reads only the fixtures' meta.json and arrival.f32.
 *
 *   node study.mjs --out FIXTURES_DIR [--json FILE]
 *
 * Pairs compared (A is the reference of the percentages):
 *   tier pairs, seed 11:   fast/standard, fast/high, standard/high, fast/high30, standard/high30   (high = 20 m fire cells as the builder makes them;
 *                          high30 = the high tier's engine options on the 30 m grid, so only the air model differs)
 *   seed pairs, one tier:  fast s11/s12, standard s11/s12
 * at the end of the run (1800 s) and at 900 s (cells with arrival <= 900).
 *
 * Measures, as defined in docs/plans/dotnet-option-b-prototype.md stage 3:
 *   differ%      cells burnt in exactly one of the two, as a percentage of the ever-burning cells (burnt in at least one)
 *   area%        (burnt area of B - burnt area of A) / burnt area of A, signed, in percent. Areas use each raster's own cells (cell size squared).
 *   median, p95  of |arrival(B) - arrival(A)| in seconds over the cells burnt in both (p95: nearest rank)
 * Also reported (JSON only): the maximum |dt| and the number of both-burnt cells whose arrival time changed at all.
 * Rasters on different grids (30 m against 20 m) are compared on the 30 m grid: each 30 m cell takes the value of the 20 m cell nearest to its
 * centre (nearest neighbour; no averaging). That adds a grid-sampling difference to the pair, which the high30 pairs do not have.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function opt(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const out = opt('out');
if (!out) {
  console.error('usage: study.mjs --out FIXTURES_DIR [--json FILE]');
  process.exit(2);
}

function load(name) {
  const dir = join(out, name);
  if (!existsSync(join(dir, 'meta.json'))) return null;
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const b = readFileSync(join(dir, 'arrival.f32'));
  const a = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return { name, meta, grid: meta.fireGrid, a };
}

/** B resampled (nearest neighbour) onto A's grid, when the grids differ. */
function onGridOf(A, B) {
  const ga = A.grid;
  const gb = B.grid;
  if (ga.nx === gb.nx && ga.ny === gb.ny && ga.cellSize === gb.cellSize) return B.a;
  const o = new Float32Array(ga.nx * ga.ny);
  for (let j = 0; j < ga.ny; j++) {
    const y = ga.y0 + j * ga.cellSize;
    const jb = Math.min(gb.ny - 1, Math.max(0, Math.round((y - gb.y0) / gb.cellSize)));
    for (let i = 0; i < ga.nx; i++) {
      const x = ga.x0 + i * ga.cellSize;
      const ib = Math.min(gb.nx - 1, Math.max(0, Math.round((x - gb.x0) / gb.cellSize)));
      o[j * ga.nx + i] = B.a[jb * gb.nx + ib];
    }
  }
  return o;
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN);

function compare(A, B, T) {
  const a = A.a;
  const b = onGridOf(A, B);
  const burntA = (v) => v >= 0 && v <= T;
  let ever = 0;
  let differ = 0;
  let both = 0;
  let nA = 0;
  let nB = 0;
  const d = [];
  for (let k = 0; k < a.length; k++) {
    const x = burntA(a[k]);
    const y = burntA(b[k]);
    if (x) nA++;
    if (y) nB++;
    if (x || y) ever++;
    if (x !== y) differ++;
    if (x && y) {
      both++;
      d.push(Math.abs(b[k] - a[k]));
    }
  }
  d.sort((p, q) => p - q);
  // burnt area from the raster's native cells (B may be on a finer grid)
  let nBnative = 0;
  for (const v of B.a) if (v >= 0 && v <= T) nBnative++;
  const areaA = nA * A.grid.cellSize ** 2;
  const areaB = nBnative * B.grid.cellSize ** 2;
  return {
    A: A.name,
    B: B.name,
    atS: T,
    everBurningCells: ever,
    cellsBurntBoth: both,
    burntCellsA: nA,
    burntCellsBnative: nBnative,
    differPct: ever ? (100 * differ) / ever : 0,
    areaDiffPctSigned: areaA ? (100 * (areaB - areaA)) / areaA : NaN,
    areaDiffPctAbs: areaA ? Math.abs((100 * (areaB - areaA)) / areaA) : NaN,
    medianAbsArrivalDiffS: pct(d, 50),
    p95AbsArrivalDiffS: pct(d, 95),
    maxAbsArrivalDiffS: d.length ? d[d.length - 1] : NaN,
    cellsWithAnyArrivalChange: d.filter((x) => x > 0).length,
    resampled: A.grid.cellSize !== B.grid.cellSize,
  };
}

const seedName = (tier, seed) => (seed === 11 ? `katoomba3-${tier}` : `katoomba3-${tier}-seed${seed}`);
const SEEDS = { fast: [11, 12, 13, 14, 15, 16], standard: [11, 12, 13, 14], high30: [11, 12, 13, 14], high: [11, 12], 'fast-noembers': [11, 12, 13], 'standard-noembers': [11, 12], 'high-noembers': [11], 'high30-noembers': [11, 12] };
const R = {};
for (const [tier, seeds] of Object.entries(SEEDS)) for (const s of seeds) R[seedName(tier, s)] = load(seedName(tier, s));
R['determinism-a'] = load('determinism-a');
R['determinism-b'] = load('determinism-b');
// input perturbation (a stand-in for last-bit libm differences): the same scenario with wind speed and temperature times (1 + eps)
const PERT = [
  ['katoomba3-fast', 'katoomba3-fast-pert1e-15'],
  ['katoomba3-fast', 'katoomba3-fast-pert1e-12'],
  ['katoomba3-fast-noembers', 'katoomba3-fast-noembers-pert1e-15'],
  ['katoomba3-fast-noembers', 'katoomba3-fast-noembers-pert1e-12'],
  ['katoomba3-fast-seed13', 'katoomba3-fast-seed13-pert1e-15'],
  ['katoomba3-fast-seed13', 'katoomba3-fast-seed13-pert1e-9'],
  ['katoomba3-fast-seed14', 'katoomba3-fast-seed14-pert1e-15'],
  ['katoomba3-fast-seed14', 'katoomba3-fast-seed14-pert1e-9'],
  ['katoomba3-standard', 'katoomba3-standard-pert1e-15'],
  ['katoomba3-standard-seed12', 'katoomba3-standard-seed12-pert1e-15'],
  ['katoomba3-standard-noembers', 'katoomba3-standard-noembers-pert1e-15'],
  ['katoomba3-high-noembers', 'katoomba3-high-noembers-pert1e-15'],
];
for (const [a, b] of PERT) {
  R[a] ??= load(a);
  R[b] = load(b);
}
const pairs = [
  ['tier', 'katoomba3-fast', 'katoomba3-standard'],
  ['tier', 'katoomba3-fast', 'katoomba3-high'],
  ['tier', 'katoomba3-standard', 'katoomba3-high'],
  ['tier', 'katoomba3-fast', 'katoomba3-high30'],
  ['tier', 'katoomba3-standard', 'katoomba3-high30'],
  ['tier no embers', 'katoomba3-fast-noembers', 'katoomba3-standard-noembers'],
  ['tier no embers', 'katoomba3-fast-noembers', 'katoomba3-high-noembers'],
  ['tier no embers', 'katoomba3-standard-noembers', 'katoomba3-high-noembers'],
  ['tier no embers', 'katoomba3-fast-noembers', 'katoomba3-high30-noembers'],
  ['tier no embers', 'katoomba3-standard-noembers', 'katoomba3-high30-noembers'],
  ['grid 30 m vs 20 m, no embers', 'katoomba3-high30-noembers', 'katoomba3-high-noembers'],
  ['grid 30 m vs 20 m', 'katoomba3-high30', 'katoomba3-high'],
  ['embers on vs off, fast', 'katoomba3-fast-noembers', 'katoomba3-fast'],
  ['same-seed rerun', 'determinism-a', 'determinism-b'],
];
// every pair of seeds within a tier (seed 11 against 12 is the named pair; the others give the spread of the noise floor)
for (const [tier, seeds] of Object.entries(SEEDS)) for (let i = 0; i < seeds.length; i++) for (let k = i + 1; k < seeds.length; k++) pairs.push([`seed ${tier}`, seedName(tier, seeds[i]), seedName(tier, seeds[k])]);
for (const [a, b] of PERT) pairs.push(['perturb', a, b]);
const rows = [];
for (const T of [1800, 900]) {
  for (const [kind, a, b] of pairs) {
    if (!R[a] || !R[b]) continue;
    rows.push({ kind, ...compare(R[a], R[b], T) });
  }
}
// summary of the seed pairs per tier: min / median / max of each measure
const summary = [];
for (const T of [1800, 900]) {
  for (const tier of Object.keys(SEEDS)) {
    const rs = rows.filter((r) => r.kind === `seed ${tier}` && r.atS === T);
    if (!rs.length) continue;
    const st = (key) => {
      const v = rs.map((r) => r[key]).sort((x, y) => x - y);
      return { min: v[0], median: v[Math.floor((v.length - 1) / 2)], max: v[v.length - 1] };
    };
    summary.push({ atS: T, tier, pairs: rs.length, differPct: st('differPct'), areaDiffPctAbs: st('areaDiffPctAbs'), medianAbsArrivalDiffS: st('medianAbsArrivalDiffS'), p95AbsArrivalDiffS: st('p95AbsArrivalDiffS') });
  }
}
// burnt area (ha) of every seed of a tier: mean, standard deviation, coefficient of variation
const ensembles = [];
for (const T of [1800, 900]) {
  for (const [tier, seeds] of Object.entries(SEEDS)) {
    const rs = seeds.map((sd) => R[seedName(tier, sd)]).filter(Boolean);
    if (rs.length < 2) continue;
    const ha = rs.map((r) => (r.a.reduce((n, v) => n + (v >= 0 && v <= T ? 1 : 0), 0) * r.grid.cellSize ** 2) / 10000);
    const mean = ha.reduce((x, y) => x + y, 0) / ha.length;
    const sdv = Math.sqrt(ha.reduce((x, y) => x + (y - mean) ** 2, 0) / (ha.length - 1));
    ensembles.push({ atS: T, tier, seeds: seeds.slice(0, rs.length), burntHa: ha, meanHa: mean, sdHa: sdv, cvPct: (100 * sdv) / mean });
  }
}
const f = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : 'n/a');
for (const T of [1800, 900]) {
  console.log(`\n### arrival rasters at ${T} s\n`);
  console.log('| kind | A (reference) | B | ever-burning cells | differ % | area diff % (B vs A) | median abs dt (s) | p95 abs dt (s) | notes |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows.filter((x) => x.atS === T)) {
    console.log(`| ${r.kind} | ${r.A} | ${r.B} | ${r.everBurningCells} | ${f(r.differPct)} | ${f(r.areaDiffPctSigned)} | ${f(r.medianAbsArrivalDiffS, 1)} | ${f(r.p95AbsArrivalDiffS, 1)} | ${r.resampled ? 'B resampled to 30 m (nearest)' : ''} |`);
  }
}
const j = opt('json');
console.log('\n### seed pairs, summary (min / median / max over all pairs of seeds of a tier)\n');
console.log('| at s | tier | pairs | differ % | |area diff| % | median abs dt (s) | p95 abs dt (s) |');
console.log('|---|---|---|---|---|---|---|');
const mm = (o, n = 2) => `${f(o.min, n)} / ${f(o.median, n)} / ${f(o.max, n)}`;
for (const r of summary) console.log(`| ${r.atS} | ${r.tier} | ${r.pairs} | ${mm(r.differPct)} | ${mm(r.areaDiffPctAbs)} | ${mm(r.medianAbsArrivalDiffS, 1)} | ${mm(r.p95AbsArrivalDiffS, 1)} |`);
console.log('\n### burnt area over the seeds of a tier (ha)\n');
console.log('| at s | tier | seeds | burnt ha per seed | mean | sd | cv % |');
console.log('|---|---|---|---|---|---|---|');
for (const e of ensembles) console.log(`| ${e.atS} | ${e.tier} | ${e.seeds.join(',')} | ${e.burntHa.map((x) => x.toFixed(1)).join(' ')} | ${f(e.meanHa, 1)} | ${f(e.sdHa, 1)} | ${f(e.cvPct, 1)} |`);
if (j) writeFileSync(j, JSON.stringify({ definitions: 'see study.mjs header', rows, seedSummary: summary, seedEnsembles: ensembles }, null, 2));
