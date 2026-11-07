// Prints the README's markdown tables from results/tables.json and data/rows.json.gz (run after analyze.mjs).
//   node make-tables.mjs <studydir> > results/tables.md
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const dir = process.argv[2];
const T = JSON.parse(readFileSync(resolve(dir, 'results/tables.json'), 'utf8'));
const R = JSON.parse(gunzipSync(readFileSync(resolve(dir, 'data/rows.json.gz'))).toString());
const f = (x, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '-');
const ok = (id) => R[id] && !R[id].error;
const out = [];
const P = (s = '') => out.push(s);
/** Marks the start of a named block (the README renderer cuts the output at these lines). */
const section = (name) => out.push(`@@${name}`);

// 0. the main table: every knob, one line per row
section('main');
P('| varied | row | site, extent | fire cell | air tier | ember cap | window | fire cells | wall s per sim hour | sim s per wall s | outer steps per hour | fire sub-steps per hour | peak RSS MB | one snapshot MB | burnt ha at the end |');
P('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const MAIN = [
  ['fire cell, 6 km', ['L30', 'L20', 'L15', 'L10']],
  ['fire cell, 6 km, embers off', ['LN30', 'LN20', 'LN15', 'LN10']],
  ['fire cell, 9 km', ['X30', 'X20', 'X10']],
  ['fire cell, other site', ['W30', 'W20', 'W10']],
  ['air tier, no fire', ['AA-fast', 'AA-std', 'AA-high']],
  ['air tier, with fire', ['A-std30', 'A-high30', 'X-std30', 'W-std30']],
  ['3-D air with finer cells', ['A-std20', 'A-high20', 'A-std10', 'A-high10']],
  ['embers', ['E-off', 'E-8000', 'E-32000']],
  ['solver step', ['T-step5', 'T-step2']],
  ['solver step, embers off', ['NT-step5', 'NT-step2']],
  ['display step', ['N-nosnap', 'N-display10']],
];
for (const [label, list] of MAIN) {
  list.filter(ok).forEach((id, i) => {
    const r = R[id];
    const note = id === 'L15' || id === 'LN15' ? ' (5 m DEM grid)' : '';
    P(`| ${i === 0 ? label : ''} | ${id} | ${r.spec.site} ${r.spec.extent / 1000} km | ${r.grid.cellSize} m${note} | ${r.spec.tier}${r.spec.ignition ? '' : ', no fire'} | ${r.spec.embers ? r.simOptions.maxEmbers : 'off'} | ${f(r.simTimeS / 3600, 0)} h | ${r.grid.cells.toLocaleString('en')} | ${f(r.wallPerSimHourS)} | ${f(r.simSPerWallS, 0)} | ${f(r.stepsPerSimHour, 0)} | ${f(r.fireSubStepsPerSimHour, 0)} | ${r.peak.maxRssProcessMB} | ${f(r.snapshot.typedBytes / 1e6, 2)} | ${f(r.final.areaHa, 0)} |`);
  });
}
P();

// 1. cell-size ladders
function ladderTable(ids, title) {
  const have = ids.filter(ok);
  if (!have.length) return;
  P(`**${title}**`);
  P();
  P('| fire cell | fire cells | wall s per sim hour | sim s per wall s | time vs the first row | outer steps per hour | level-set sub-steps per hour | peak RSS MB | one snapshot MB | burnt ha at the end |');
  P('|---|---|---|---|---|---|---|---|---|---|');
  const b = R[have[0]];
  for (const id of have) {
    const r = R[id];
    const note = id === 'L15' || id === 'LN15' ? ' (5 m DEM grid)' : '';
    P(`| ${r.grid.cellSize} m${note} | ${r.grid.cells.toLocaleString('en')} | ${f(r.wallPerSimHourS)} | ${f(r.simSPerWallS, 0)} | ${f(r.wallPerSimHourS / b.wallPerSimHourS, 2)}x (cells ${f(r.grid.cells / b.grid.cells, 2)}x) | ${f(r.stepsPerSimHour, 0)} | ${f(r.fireSubStepsPerSimHour, 0)} (${f(r.fireSubStepsPerSimHour / b.fireSubStepsPerSimHour, 2)}x) | ${r.peak.maxRssProcessMB} | ${f(r.snapshot.typedBytes / 1e6, 2)} | ${f(r.final.areaHa, 0)} |`);
  }
  P();
}
ladderTable(['L30', 'L20', 'L15', 'L10'], 'Katoomba 6 km, fast tier, embers 2000, 4 h');
ladderTable(['LN30', 'LN20', 'LN15', 'LN10'], 'Katoomba 6 km, fast tier, embers off, 4 h');
ladderTable(['X30', 'X20'], 'Katoomba 9 km, fast tier, 4 h');
ladderTable(['X10'], 'Katoomba 9 km, fast tier, 10 m (2 h only)');
ladderTable(['W30', 'W20', 'W10'], 'Warrumbungles 6 km, fast tier, embers 2000, 2 h');

// fits
section('fits');
P('**Fits (least squares on log-log, rows of the Katoomba 6 km ladder)**');
P();
P('| quantity | exponent against the number of fire cells | R^2 | rows |');
P('|---|---|---|---|');
for (const [name, L] of [['with the 15 m row', T.ladderKat6], ['30, 20, 10 m only', T.ladderKat6Exact10m]]) {
  if (!L) continue;
  for (const [k, label] of [['timeVsCells', 'wall time per simulated hour'], ['subStepsVsCells', 'level-set sub-steps per hour'], ['rssAboveBaselineVsCells', 'peak RSS above the baseline of about 340 MB'], ['snapshotVsCells', 'one snapshot']]) P(`| ${label} | ${f(L.fits[k].exponent, 2)} | ${f(L.fits[k].r2, 3)} | ${name} |`);
}
P();
if (T.ladderKat6) {
  P('**Wall seconds per simulated hour, by phase and cell size (Katoomba 6 km, fast tier, embers 2000, 4 h) and the exponent against the number of cells**');
  P();
  P('| phase (lap) | 30 m | 20 m | 15 m | 10 m | exponent |');
  P('|---|---|---|---|---|---|');
  for (const [p, v] of Object.entries(T.ladderKat6.phaseMsPerH)) P(`| ${p} | ${v.values.map((x) => f(x / 1000, 2)).join(' | ')} | ${f(v.fit.exponent, 2)} |`);
  P();
}

// 2. tiers
section('tiers');
P('**Air tiers, with and without the fire (Katoomba 6 km, 30 m cells unless noted)**');
P();
P('| row | tier | fire | air grid | wall s per sim hour | sim s per wall s | outer steps per hour | air ms per outer step | spin-up s (before t0) | window | peak RSS MB | one snapshot MB |');
P('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const t of T.tiers) P(`| ${t.id} | ${t.tier} | ${t.fire} | ${t.airGrid} | ${f(t.wallPerSimHourS)} | ${f(t.simSPerWallS, 0)} | ${f(t.outerStepsPerH, 0)} | ${f(t.airMsPerOuterStep)} | ${f(t.spinUpS)} | ${f(t.simWindowS / 3600, 0)} h | ${t.peakRssMB} | ${f(t.snapshotMB, 2)} |`);
for (const id of ['A-std10', 'A-high10']) {
  if (!ok(id)) continue;
  const r = R[id];
  const a = r.engine.atmosphere;
  P(`| ${id} | ${r.spec.tier} | ${r.grid.cellSize} m | ${a.nx}x${a.ny}x${a.nz} @ ${a.dxM.toFixed(0)} m | ${f(r.wallPerSimHourS)} | ${f(r.simSPerWallS, 0)} | ${f(r.stepsPerSimHour, 0)} | ${f(r.modulesMs.atmosphere / r.steps)} | ${f(r.spinUpS)} | ${f(r.simTimeS / 3600, 0)} h | ${r.peak.maxRssProcessMB} | ${f(r.snapshot.typedBytes / 1e6, 2)} |`);
}
P();

// 3. knobs
section('knobs');
P('**Embers, solver step and display cadence (Katoomba 6 km, 30 m cells, fast tier, 4 h)**');
P();
P('| row | what changes | wall s per sim hour | vs L30 | outer steps per hour | level-set sub-steps per hour | ember lap s per sim hour | burnt ha at the end | spot fires | peak RSS MB |');
P('|---|---|---|---|---|---|---|---|---|---|');
const what = { L30: 'nothing (cap 2000, automatic step 10 s, snapshot every 60 s)', 'E-off': 'embers off', 'E-8000': 'ember cap 8000', 'E-32000': 'ember cap 32000', 'T-step5': 'solver step limit 5 s', 'T-step2': 'solver step limit 2 s', 'N-nosnap': 'no snapshot receiver (no snapshots built)', 'N-display10': 'snapshot every 10 s' };
for (const k of T.knobs) P(`| ${k.id} | ${what[k.id]} | ${f(k.wallPerSimHourS)} | ${f(k.ratioToRef, 2)}x | ${f(k.stepsPerH, 0)} | ${f(k.subStepsPerH, 0)} | ${f(k.emberShareMs / 1000, 2)} | ${f(k.areaHa, 0)} | ${k.spots} | ${k.peakRssMB} |`);
for (const k of T.knobs20) P(`| ${k.id} | ${k.id === 'L20' ? '20 m cells (reference of the next row)' : '20 m cells, solver step limit 5 s'} | ${f(k.wallPerSimHourS)} | ${f(k.ratioToRef, 2)}x of L20 | ${f(k.stepsPerH, 0)} | ${f(k.subStepsPerH, 0)} | ${f(k.emberShareMs / 1000, 2)} | ${f(k.areaHa, 0)} | ${k.spots} | ${k.peakRssMB} |`);
P();

// 4. phases
section('phases');
P('**Share of wall time by phase (the laps of `Simulation.stepOnce`; Katoomba 6 km, 4 h)**');
P();
const cols = ['L30', 'L10', 'A-std30', 'A-high30'].filter((id) => T.phases[id]);
P(`| phase | ${cols.map((c) => `${c} (${R[c].spec.tier}, ${R[c].grid.cellSize} m)`).join(' | ')} |`);
P(`|---|${cols.map(() => '---').join('|')}|`);
for (const p of Object.keys(T.phases[cols[0]].laps)) P(`| ${p} | ${cols.map((c) => f(T.phases[c].laps[p], 1) + ' %').join(' | ')} |`);
P();
P(`| group (the app's module ids) | ${cols.join(' | ')} |`);
P(`|---|${cols.map(() => '---').join('|')}|`);
for (const g of Object.keys(T.phases[cols[0]].groups)) P(`| ${g} | ${cols.map((c) => f(T.phases[c].groups[g], 1) + ' %').join(' | ')} |`);
P();
section('amdahl');
P('**Amdahl bound: speed-up of the whole run if the named share were made N times faster, from the lap shares above (an upper bound; it assumes perfect scaling of that share and no extra cost for threads)**');
P();
P('| row | share made parallel | its share of the time | 4 cores | 8 cores | infinitely fast |');
P('|---|---|---|---|---|---|');
for (const id of Object.keys(T.amdahl)) for (const [k, v] of Object.entries(T.amdahl[id])) P(`| ${id} | ${k} | ${f(100 * v.parallelShare, 0)} % | ${f(v.on4, 2)}x | ${f(v.on8, 2)}x | ${f(v.limit, 1)}x |`);
P();

// 5. memory and history
section('memory');
P('**Memory and history**');
P();
P('| row | fire cells | RSS after the modules load (baseline) | peak RSS (OS high-water mark) | RSS after construction | end V8 heap used (after gc) | end ArrayBuffers | memoryReport total | checkpoints held (bytes) | one snapshot | one keyframe | history of the app after the run (frames / keyframes / thinned) |');
P('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const m of T.memory.filter((x) => ['L30', 'L20', 'L15', 'L10', 'X30', 'X20', 'X10', 'A-std30', 'A-high30', 'A-std10', 'A-high10', 'H-fast30', 'H-fast20', 'H-fast10', 'H-std30'].includes(x.id))) {
  P(`| ${m.id} | ${m.cells.toLocaleString('en')} | ${m.baselineRssMB} MB | ${m.maxRssProcessMB} MB | ${m.afterConstructMB} MB | ${m.endHeapUsedAfterGcMB} MB | ${m.endArrayBuffersMB} MB | ${f(m.memoryReportMB, 0)} MB | ${m.checkpoints} (${f(m.checkpointMB, 0)} MB) | ${f(m.snapshotMB, 2)} MB | ${f(m.keyframeMB, 2)} MB | ${m.history ? `${f(m.history.totalMB, 0)} MB (${m.history.frames} / ${m.history.keyframes} / ${m.history.thinned})` : ''} |`);
}
P();

// 6. noise
section('noise');
P('**Run-to-run spread (the same row three times, three separate processes; load average is the 1-minute figure at the start and end of each row)**');
P();
P('| row | wall s per sim hour (3 runs) | mean | standard deviation | range | peak RSS MB (3 runs) | load1 start/end | CPU time over wall time |');
P('|---|---|---|---|---|---|---|---|');
for (const [k, kr] of [['L30', 'L30rss'], ['L10', 'L10rss']]) {
  const n = T.noise[k];
  const m = T.noise[kr];
  if (!n) continue;
  P(`| ${k} | ${n.values.map((v) => f(v, 2)).join(', ')} | ${f(n.mean, 2)} | ${f(n.sd, 2)} (${f(n.cvPct, 1)} %) | ${f(n.rangePct, 1)} % | ${m.values.join(', ')} | ${n.loads.map((l) => `${l[0]}/${l[1]}`).join(', ')} | ${n.cpuOverWall.map((v) => f(v, 2)).join(', ')} |`);
}
P();

// 7. determinism
section('determinism');
P('**Determinism (snapshot hash of every 60 s snapshot, the V18 method: FNV-1a over the bytes of every typed array and the JSON of the rest, `engine` and the wall-clock stat left out)**');
P();
P('| comparison | snapshots compared | identical | first difference | final hashes | burnt ha |');
P('|---|---|---|---|---|---|');
for (const [k, d] of Object.entries(T.determinism)) if (d) P(`| ${k} (${d.a} vs ${d.b}) | ${d.snapshotsA} | ${d.identical} | ${d.firstDifferentAtS === null ? 'none' : d.firstDifferentAtS + ' s'} | ${d.finalHashes.join(' / ')} | ${d.areaHa.map((v) => f(v, 2)).join(' / ')} |`);
P();

// 8. convergence
function convTable(c, title, base) {
  if (!c) return;
  P(`**${title}**`);
  P();
  const ids = Object.keys(c.rows);
  P(`| row | cell | burnt ha at ${ids.length ? c.rows[ids[0]].timesS.filter((_, i) => [5, 11, 17, 23].includes(i)).map((t) => t / 3600 + ' h').join(', ') : ''} | perimeter km at the same times (contour of the 0/1 mask) | mean head rate of spread m/s, per hour | max band rate m/s, per hour (mean) |`);
  P('|---|---|---|---|---|---|');
  for (const id of ids) {
    const r = c.rows[id];
    const sel = [5, 11, 17, 23].filter((i) => i < r.timesS.length);
    P(`| ${id} | ${r.cellM} m | ${sel.map((i) => f(r.areaHa[i], 0)).join(' / ')} | ${sel.map((i) => f(r.perimeterM[i] / 1000, 1)).join(' / ')} | ${r.headRosMeanPerHour.map((v) => f(v, 2)).join(' / ')} | ${r.maxRosMeanPerHour.map((v) => f(v, 2)).join(' / ')} |`);
  }
  P();
  P('| pair (A, B) | burnt area B / A at the end | perimeter B / A | Jaccard of burnt 60 m blocks | arrival time B minus A, minutes: median (5th to 95th percentile) | abs arrival error minutes: median, 90th percentile |');
  P('|---|---|---|---|---|---|');
  for (const p of c.pairs) {
    const e = p.arrivalErrorMinSigned_BminusA;
    P(`| ${p.a} to ${p.b} | ${f(p.areaRatioAtEnd, 3)} | ${f(p.perimeterRatioAtEnd, 2)} | ${f(p.jaccard, 3)} | ${f(e.p50, 1)} (${f(e.p05, 1)} to ${f(e.p95, 1)}) | ${f(p.arrivalErrorMinAbs.p50, 1)}, ${f(p.arrivalErrorMinAbs.p90, 1)} |`);
  }
  P();
}
section('convKatNoEmbers');
convTable(T.convergenceKat6NoEmbers, 'Convergence, Katoomba 6 km, embers off (numerics of the front only)');
section('convKat');
convTable(T.convergenceKat6, 'Convergence, Katoomba 6 km, embers 2000 (one random realisation per row)');
section('convWarNoEmbers');
convTable(T.convergenceWar6NoEmbers, 'Convergence, Warrumbungles 6 km, embers off');
section('convWar');
convTable(T.convergenceWar6, 'Convergence, Warrumbungles 6 km, embers 2000');
section('convStep');
convTable(T.convergenceStepNoEmbers, 'Solver-step convergence, Katoomba 6 km, 30 m cells, embers off (A = automatic 10 s step)');

// 9. hourly cost
section('hourly');
P('**Wall seconds per simulated hour, hour by hour (the cost grows with the fire and moves with the wind change)**');
P();
P('| row | hour 1 | hour 2 | hour 3 | hour 4 |');
P('|---|---|---|---|---|');
for (const id of ['L30', 'L20', 'L10', 'A-std30', 'A-high30', 'X30', 'X20']) if (T.hourly[id]) P(`| ${id} | ${T.hourly[id].map((x) => f(x, 1)).join(' | ')} |`);
P();
// plain markdown (markers removed), or `--json`: the named blocks
const sections = {};
let cur = null;
for (const line of out) {
  if (line.startsWith('@@')) {
    cur = line.slice(2);
    sections[cur] = [];
  } else if (cur) sections[cur].push(line);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.join('\n').trim()]))));
else console.log(out.filter((l) => !l.startsWith('@@')).join('\n'));
