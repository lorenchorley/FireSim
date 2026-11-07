// Turns the row JSONs of run-batch.mjs into the committed data and the tables of the README.
//   node analyze.mjs <rundir> <studydir>
// Writes into <studydir>: data/rows.csv, data/rows.json.gz (every row, compact), data/convergence.json.gz (the saved summaries for
// 15c / 15d), data/convergence-diff.json (differences between rows), results/tables.json (all derived numbers) and prints markdown.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const [runDir, studyDir] = process.argv.slice(2);
if (!runDir || !studyDir) throw new Error('usage: analyze.mjs <rundir> <studydir>');
mkdirSync(resolve(studyDir, 'data'), { recursive: true });
mkdirSync(resolve(studyDir, 'results'), { recursive: true });

const rows = {};
for (const n of readdirSync(runDir)) {
  if (!n.endsWith('.json') || n.endsWith('.spec.json')) continue;
  const r = JSON.parse(readFileSync(resolve(runDir, n), 'utf8'));
  rows[r.spec.id] = r;
}
const ids = Object.keys(rows);
const ok = (id) => rows[id] && !rows[id].error;
const f = (x, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '-');
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => sum(a) / a.length;

// ── helpers ──
/** Wall seconds spent up to simulated time T (from the per-chunk samples), linear between samples. */
function wallAt(r, T) {
  const s = r.samples;
  let prevT = 0;
  let prevW = 0;
  for (const p of s) {
    if (p.t >= T - 1e-6) return prevW + ((p.wallS - prevW) * (T - prevT)) / (p.t - prevT);
    prevT = p.t;
    prevW = p.wallS;
  }
  return NaN;
}
/** Least-squares line of log y on log x: exponent and prefactor, and R^2. */
function powerFit(xs, ys) {
  const lx = xs.map(Math.log);
  const ly = ys.map(Math.log);
  const n = xs.length;
  const mx = mean(lx);
  const my = mean(ly);
  let num = 0;
  let den = 0;
  let tot = 0;
  for (let i = 0; i < n; i++) {
    num += (lx[i] - mx) * (ly[i] - my);
    den += (lx[i] - mx) ** 2;
    tot += (ly[i] - my) ** 2;
  }
  const b = num / den;
  const a = my - b * mx;
  let res = 0;
  for (let i = 0; i < n; i++) res += (ly[i] - (a + b * lx[i])) ** 2;
  return { exponent: b, prefactor: Math.exp(a), r2: tot > 0 ? 1 - res / tot : 1 };
}
// The laps of Simulation.stepOnce. `airAt` is NESTED inside `surfaceWind` (sim/perfStats.ts says so) and is left out of every total.
// Groups follow the app's own module ids (perfStats.ts PERF_LAP_MODULE); `stamps` (the hourly diagnostic-wind solve in the fast tier,
// the ambient update in the 3-D tiers) is counted with the air here, where the app files it under 'other'.
const PHASES = ['records', 'stamps', 'weatherNight', 'solarMoisture', 'fireMasks', 'surfaceWind', 'firePrepare', 'fireStep', 'fireHeat', 'atmosphere', 'embers', 'fireMinute', 'diagnostics', 'explain', 'snapshot', 'checkpoint'];
const GROUPS = {
  'air (3-D step; fast tier: hourly diagnostic solve)': ['atmosphere', 'stamps'],
  'fire to air coupling (wind on the fire grid, fire heat, pyrogenic solve)': ['surfaceWind', 'fireHeat'],
  'fire (prepare, level-set step, masks, minute tasks)': ['firePrepare', 'fireStep', 'fireMasks', 'fireMinute'],
  embers: ['embers'],
  'moisture, weather, records': ['solarMoisture', 'weatherNight', 'records'],
  'detectors and insight cards': ['diagnostics', 'explain'],
  'picture (snapshot) and checkpoints': ['snapshot', 'checkpoint'],
};
function shares(r) {
  const m = r.modulesMs;
  const tot = sum(PHASES.map((p) => m[p] ?? 0));
  const out = {};
  for (const p of PHASES) out[p] = (100 * (m[p] ?? 0)) / tot;
  const grp = {};
  for (const [g, list] of Object.entries(GROUPS)) grp[g] = sum(list.map((p) => out[p]));
  return { laps: out, groups: grp, totalMs: tot, otherMs: r.advanceWallS * 1000 - tot };
}

// ── rows.csv ──
const cols = [
  ['id', (r) => r.spec.id],
  ['site', (r) => r.spec.site],
  ['extent_m', (r) => r.spec.extent],
  ['cell_m', (r) => r.grid.cellSize],
  ['cells', (r) => r.grid.cells],
  ['tier', (r) => r.spec.tier],
  ['embers', (r) => (r.spec.embers ? 1 : 0)],
  ['max_embers', (r) => r.simOptions.maxEmbers],
  ['max_step_s', (r) => r.spec.maxStepS ?? 0],
  ['display_step_s', (r) => r.spec.snapshotInterval ?? 60],
  ['ignition', (r) => (r.spec.ignition ? 1 : 0)],
  ['sim_s', (r) => r.simTimeS],
  ['truncated_at_s', (r) => r.truncatedAtS ?? ''],
  ['wall_s', (r) => f(r.advanceWallS, 2)],
  ['wall_s_per_sim_h', (r) => f(r.wallPerSimHourS, 2)],
  ['sim_s_per_wall_s', (r) => f(r.simSPerWallS, 0)],
  ['outer_steps', (r) => r.steps],
  ['outer_steps_per_sim_h', (r) => f(r.stepsPerSimHour, 0)],
  ['fire_substeps', (r) => r.fireSubSteps ?? ''],
  ['fire_substeps_per_sim_h', (r) => f(r.fireSubStepsPerSimHour, 0)],
  ['construct_s', (r) => f(r.constructS, 2)],
  ['spinup_s', (r) => f(r.spinUpS, 2)],
  ['build_s', (r) => f(r.buildS, 2)],
  ['rss_baseline_mb', (r) => r.rssAfterModulesMB],
  ['rss_after_construct_mb', (r) => r.rssAfterConstructMB],
  ['peak_rss_sampled_mb', (r) => r.peak.rssSampledMB],
  ['max_rss_process_mb', (r) => r.peak.maxRssProcessMB],
  ['peak_heap_used_sampled_mb', (r) => r.peak.heapUsedSampledMB],
  ['end_rss_after_gc_mb', (r) => r.end.rssAfterGcMB],
  ['end_heap_used_after_gc_mb', (r) => r.end.heapUsedAfterGcMB],
  ['end_array_buffers_mb', (r) => r.end.arrayBuffersMB],
  ['snapshot_typed_bytes', (r) => r.snapshot.typedBytes],
  ['keyframe_bytes', (r) => r.snapshot.keyframeBytes],
  ['snapshot_build_ms', (r) => f(r.snapshot.buildMs, 1)],
  ['memory_report_total_bytes', (r) => r.memoryReport.totalBytes],
  ['checkpoint_bytes', (r) => r.memoryReport.checkpointBytes],
  ['history_total_bytes', (r) => r.history?.totalBytes ?? ''],
  ['history_thinned', (r) => r.history?.thinned ?? ''],
  ['final_area_ha', (r) => f(r.final.areaHa, 1)],
  ['final_perimeter_km', (r) => f(r.final.perimKm, 2)],
  ['final_spot_fires', (r) => r.final.spots],
  ['final_active_embers', (r) => r.final.embers],
  ['cpu_over_wall', (r) => f(r.cpuOverWall, 2)],
  ['load1_start', (r) => r.load.start[0]],
  ['load1_end', (r) => r.load.end[0]],
  ['load5_end', (r) => r.load.end[1]],
  ['final_hash', (r) => r.finalHash ?? ''],
];
const csv = [cols.map((c) => c[0]).join(',')];
for (const id of ids) if (ok(id)) csv.push(cols.map((c) => c[1](rows[id])).join(','));
writeFileSync(resolve(studyDir, 'data/rows.csv'), csv.join('\n') + '\n');

// ── rows.json.gz (compact) ──
const compact = {};
for (const id of ids) {
  const r = rows[id];
  if (r.error) {
    compact[id] = { spec: r.spec, error: String(r.error).split('\n').slice(0, 3).join(' | ') };
    continue;
  }
  const { summaryData: _s, stats, ...rest } = r;
  void _s;
  compact[id] = { ...rest, stats: stats.filter((_, i) => i % 10 === 9) }; // every 600 s
}
writeFileSync(resolve(studyDir, 'data/rows.json.gz'), gzipSync(JSON.stringify(compact)));

const T = { generatedFrom: 'analyze.mjs', rows: ids.length };

// ── 1. cell-size ladder: growth ──
function ladder(prefix, list, label) {
  const have = list.filter(ok);
  if (have.length < 2) return null;
  const rs = have.map((id) => rows[id]);
  const cells = rs.map((r) => r.grid.cells);
  const out = {
    label,
    rows: have.map((id) => {
      const r = rows[id];
      const base = rows[have[0]];
      return {
        id,
        cell_m: r.grid.cellSize,
        cells: r.grid.cells,
        wallPerSimHourS: r.wallPerSimHourS,
        simSPerWallS: r.simSPerWallS,
        timeRatioToFirst: r.wallPerSimHourS / base.wallPerSimHourS,
        cellsRatioToFirst: r.grid.cells / base.grid.cells,
        outerStepsPerH: r.stepsPerSimHour,
        subStepsPerH: r.fireSubStepsPerSimHour,
        subStepRatioToFirst: r.fireSubStepsPerSimHour / base.fireSubStepsPerSimHour,
        peakRssMB: r.peak.maxRssProcessMB,
        rssAboveBaselineMB: r.peak.rssSampledMB - r.rssAfterModulesMB,
        snapshotMB: r.snapshot.typedBytes / 1e6,
        areaHa: r.final.areaHa,
      };
    }),
    fits: {},
  };
  out.fits.timeVsCells = powerFit(cells, rs.map((r) => r.wallPerSimHourS));
  out.fits.subStepsVsCells = powerFit(cells, rs.map((r) => r.fireSubStepsPerSimHour));
  out.fits.rssAboveBaselineVsCells = powerFit(cells, rs.map((r) => Math.max(1, r.peak.rssSampledMB - r.rssAfterModulesMB)));
  out.fits.snapshotVsCells = powerFit(cells, rs.map((r) => r.snapshot.typedBytes));
  // per phase
  out.phaseMsPerH = {};
  for (const p of PHASES) {
    const ys = rs.map((r) => ((r.modulesMs[p] ?? 0) / (r.simTimeS / 3600)));
    if (ys.every((y) => y > 0)) out.phaseMsPerH[p] = { values: ys, fit: powerFit(cells, ys) };
  }
  return out;
}
T.ladderKat6 = ladder('L', ['L30', 'L20', 'L15', 'L10'], 'Katoomba 6 km, fast tier, 4 h');
T.ladderKat6Exact10m = ladder('L', ['L30', 'L20', 'L10'], 'Katoomba 6 km, fast tier, 4 h, without the 15 m row (its DEM is 5 m)');
T.ladderKat9 = ladder('X', ['X30', 'X20'], 'Katoomba 9 km, fast tier, 4 h (30 and 20 m only: 10 m ran 2 h)');
T.ladderWar6 = ladder('W', ['W30', 'W20', 'W10'], 'Warrumbungles 6 km, fast tier, 2 h');

// 2 h comparison across 9 km for 10 m, from the samples
if (ok('X10') && ok('X30') && ok('X20')) {
  T.kat9TwoHours = ['X30', 'X20', 'X10'].map((id) => ({ id, cells: rows[id].grid.cells, wallFirst2hS: wallAt(rows[id], 7200), subStepsNote: 'sub-steps are for the whole run', peakRssMB: rows[id].peak.maxRssProcessMB }));
}
// cost per simulated hour by hour of the run
T.hourly = {};
for (const id of ids.filter(ok)) {
  const r = rows[id];
  const h = [];
  for (let k = 1; k * 3600 <= r.simTimeS + 1e-6; k++) h.push(wallAt(r, k * 3600) - (k > 1 ? wallAt(r, (k - 1) * 3600) : 0));
  T.hourly[id] = h;
}

// ── 2. embers, step, cadence, tiers: table of what changed against L30 ──
const vs = (id, ref = 'L30') => {
  if (!ok(id) || !ok(ref)) return null;
  const r = rows[id];
  const b = rows[ref];
  return {
    id,
    wallPerSimHourS: r.wallPerSimHourS,
    ratioToRef: r.wallPerSimHourS / b.wallPerSimHourS,
    stepsPerH: r.stepsPerSimHour,
    subStepsPerH: r.fireSubStepsPerSimHour,
    emberShareMs: ((r.modulesMs.embers ?? 0) / (r.simTimeS / 3600)),
    peakRssMB: r.peak.maxRssProcessMB,
    areaHa: r.final.areaHa,
    areaRatioToRef: r.final.areaHa / b.final.areaHa,
    spots: r.final.spots,
    activeEmbers: r.final.embers,
    snapshotMB: r.snapshot.typedBytes / 1e6,
  };
};
T.knobs = ['L30', 'E-off', 'E-8000', 'E-32000', 'T-step5', 'T-step2', 'N-nosnap', 'N-display10'].map((id) => vs(id)).filter(Boolean);
T.knobs20 = ['L20', 'T-step5-c20'].map((id) => vs(id, 'L20')).filter(Boolean);
T.tiers = ['L30', 'A-std30', 'A-high30', 'L20', 'A-std20', 'A-high20', 'AA-fast', 'AA-std', 'AA-high'].filter(ok).map((id) => {
  const r = rows[id];
  const a = r.engine?.atmosphere;
  return {
    id,
    tier: r.spec.tier,
    fire: r.spec.ignition ? `${r.grid.cellSize} m` : 'none',
    airGrid: a ? `${a.nx}x${a.ny}x${a.nz} @ ${a.dxM.toFixed(0)} m` : '',
    wallPerSimHourS: r.wallPerSimHourS,
    simSPerWallS: r.simSPerWallS,
    outerStepsPerH: r.stepsPerSimHour,
    airMsPerOuterStep: (r.modulesMs.atmosphere ?? 0) / r.steps,
    airMsMeanReported: a?.meanStepMs ?? null,
    spinUpS: r.spinUpS,
    constructS: r.constructS,
    peakRssMB: r.peak.maxRssProcessMB,
    snapshotMB: r.snapshot.typedBytes / 1e6,
    atmosphereShare: shares(r).laps.atmosphere,
    simWindowS: r.simTimeS,
  };
});

// ── 3. phase shares ──
T.phases = {};
for (const id of ['L30', 'A-std30', 'A-high30', 'L10', 'L20', 'AA-std', 'W30', 'X30']) if (ok(id)) T.phases[id] = shares(rows[id]);

// Amdahl: speed-up for p parallel fraction on n cores (and the limit)
const amdahl = (p, n) => 1 / (1 - p + p / n);
T.amdahl = {};
for (const id of ['L30', 'A-std30', 'A-high30', 'L10']) {
  if (!ok(id)) continue;
  const s = shares(rows[id]);
  const air = s.groups['air (3-D step; fast tier: hourly diagnostic solve)'] / 100;
  const fire = s.groups['fire (prepare, level-set step, masks, minute tasks)'] / 100;
  const coup = s.groups['fire to air coupling (wind on the fire grid, fire heat, pyrogenic solve)'] / 100;
  const emb = s.groups.embers / 100;
  const sets = { 'air only': air, 'fire only': fire, 'air + coupling': air + coup, 'air + fire + coupling': air + fire + coup, 'everything but output and moisture': air + fire + coup + emb };
  T.amdahl[id] = Object.fromEntries(Object.entries(sets).map(([k, p]) => [k, { parallelShare: p, on4: amdahl(p, 4), on8: amdahl(p, 8), limit: 1 / (1 - p) }]));
}

// ── 4. noise ──
function spread(list, key) {
  const have = list.filter(ok);
  if (have.length < 2) return null;
  const v = have.map((id) => key(rows[id]));
  const m = mean(v);
  const sd = Math.sqrt(sum(v.map((x) => (x - m) ** 2)) / (v.length - 1));
  return { ids: have, values: v, mean: m, sd, cvPct: (100 * sd) / m, rangePct: (100 * (Math.max(...v) - Math.min(...v))) / m, loads: have.map((id) => [rows[id].load.start[0], rows[id].load.end[0]]), cpuOverWall: have.map((id) => rows[id].cpuOverWall), steps: have.map((id) => rows[id].steps), area: have.map((id) => rows[id].final.areaHa) };
}
T.noise = { L30: spread(['L30', 'L30-r2', 'L30-r3'], (r) => r.wallPerSimHourS), L10: spread(['L10', 'L10-r2', 'L10-r3'], (r) => r.wallPerSimHourS), L30rss: spread(['L30', 'L30-r2', 'L30-r3'], (r) => r.peak.maxRssProcessMB), L10rss: spread(['L10', 'L10-r2', 'L10-r3'], (r) => r.peak.maxRssProcessMB) };

// ── 5. determinism ──
function detCompare(a, b) {
  if (!ok(a) || !ok(b)) return null;
  const ha = rows[a].hashes;
  const hb = rows[b].hashes;
  const n = Math.min(ha.length, hb.length);
  let same = 0;
  let first = null;
  for (let i = 0; i < n; i++) {
    if (ha[i][0] === hb[i][0] && ha[i][1] === hb[i][1]) same++;
    else if (first === null) first = ha[i][0];
  }
  return { a, b, snapshotsA: ha.length, snapshotsB: hb.length, identical: same, firstDifferentAtS: first, finalHashEqual: rows[a].finalHash === rows[b].finalHash, finalHashes: [rows[a].finalHash, rows[b].finalHash], areaHa: [rows[a].final.areaHa, rows[b].final.areaHa] };
}
T.determinism = { fastSameSeedTwoProcesses: detCompare('D-fast-a', 'D-fast-b'), fastOtherChunking: detCompare('D-fast-a', 'D-fast-chunk60'), fastOtherSeed: detCompare('D-fast-a', 'D-fast-seed2'), standardSameSeedTwoProcesses: detCompare('D-std-a', 'D-std-b') };

// ── 6. convergence summaries (15c / 15d) ──
/** Per simulated hour: the mean (or `agg` of) a stat over the snapshots of that hour. */
function perHour(stats, get, agg) {
  const out = [];
  for (let h = 0; (h + 1) * 3600 <= stats[stats.length - 1].t + 1e-6; h++) {
    const v = stats.filter((s) => s.t > h * 3600 && s.t <= (h + 1) * 3600 + 1e-6).map(get);
    out.push(agg ? agg(...v) : mean(v));
  }
  return out;
}
function conv(idsList, label) {
  const have = idsList.filter((id) => ok(id) && rows[id].summaryData);
  if (have.length < 2) return null;
  const sd = (id) => rows[id].summaryData;
  const out = { label, rows: {} };
  for (const id of have) {
    const r = rows[id];
    out.rows[id] = {
      cellM: r.grid.cellSize,
      timesS: sd(id).timesS,
      areaHa: sd(id).areaHa,
      perimeterM: sd(id).perimeterM,
      appPerimeterKmAtMarks: sd(id).timesS.map((t) => (r.stats.find((s) => Math.abs(s.t - t) < 1e-6) ?? {}).perimKm ?? null),
      headRosAtMarks: sd(id).timesS.map((t) => (r.stats.find((s) => Math.abs(s.t - t) < 1e-6) ?? {}).headRos ?? null),
      maxRosAtMarks: sd(id).timesS.map((t) => (r.stats.find((s) => Math.abs(s.t - t) < 1e-6) ?? {}).maxRos ?? null),
      headRosSeries60s: r.stats.map((s) => [s.t, s.headRos]),
      headRosMeanPerHour: perHour(r.stats, (s) => s.headRos),
      headRosMaxPerHour: perHour(r.stats, (s) => s.headRos, Math.max),
      maxRosMeanPerHour: perHour(r.stats, (s) => s.maxRos),
      coarse: sd(id).coarse,
      spots: r.final.spots,
    };
  }
  // differences between every pair on the common coarse grid
  const pairs = [];
  const q = (v, p) => {
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  };
  for (let i = 0; i < have.length; i++) {
    for (let j = i + 1; j < have.length; j++) {
      const A = out.rows[have[i]];
      const B = out.rows[have[j]];
      const ca = A.coarse;
      const cb = B.coarse;
      const dt = [];
      let both = 0;
      let onlyA = 0;
      let onlyB = 0;
      for (let k = 0; k < ca.n * ca.n; k++) {
        const a = ca.burntFrac[k] >= 128;
        const b = cb.burntFrac[k] >= 128;
        if (a && b) {
          both++;
          if (ca.meanArrivalS[k] >= 0 && cb.meanArrivalS[k] >= 0) dt.push((cb.meanArrivalS[k] - ca.meanArrivalS[k]) / 60);
        } else if (a) onlyA++;
        else if (b) onlyB++;
      }
      const abs = dt.map(Math.abs);
      const last = A.areaHa.length - 1;
      pairs.push({
        a: have[i],
        b: have[j],
        areaRatioBoverA: A.areaHa.map((x, k) => (x > 0 ? B.areaHa[k] / x : null)),
        timesS: A.timesS,
        areaRatioAtEnd: B.areaHa[last] / A.areaHa[last],
        perimeterRatioAtEnd: B.perimeterM[last] / A.perimeterM[last],
        coarseBlocksBurntInBoth: both,
        coarseBlocksOnlyA: onlyA,
        coarseBlocksOnlyB: onlyB,
        jaccard: both / (both + onlyA + onlyB),
        arrivalErrorMinSigned_BminusA: { p05: q(dt, 0.05), p25: q(dt, 0.25), p50: q(dt, 0.5), p75: q(dt, 0.75), p95: q(dt, 0.95), n: dt.length },
        arrivalErrorMinAbs: { p50: q(abs, 0.5), p90: q(abs, 0.9), p95: q(abs, 0.95), max: abs.length ? Math.max(...abs) : null },
      });
    }
  }
  out.pairs = pairs;
  return out;
}
T.convergenceKat6 = conv(['L30', 'L20', 'L15', 'L10'], 'Katoomba 6 km, fast tier, 4 h, seed 1, embers 2000');
T.convergenceWar6 = conv(['W30', 'W20', 'W10'], 'Warrumbungles 6 km, fast tier, 2 h, seed 1, embers 2000');
T.convergenceKat6NoEmbers = conv(['LN30', 'LN20', 'LN15', 'LN10'], 'Katoomba 6 km, fast tier, EMBERS OFF, 4 h, seed 1');
T.convergenceWar6NoEmbers = conv(['WN30', 'WN20', 'WN10'], 'Warrumbungles 6 km, fast tier, EMBERS OFF, 2 h, seed 1');
T.convergenceStepNoEmbers = conv(['LN30', 'NT-step5', 'NT-step2'], 'Katoomba 6 km, 30 m cells, EMBERS OFF, solver step 10 s (automatic), 5 s, 2 s (rows named by their ids; the cell size is 30 m in all three)');
const GROUPS_OUT = { kat6: T.convergenceKat6, war6: T.convergenceWar6, kat6NoEmbers: T.convergenceKat6NoEmbers, war6NoEmbers: T.convergenceWar6NoEmbers, stepNoEmbers: T.convergenceStepNoEmbers };
/** Binary packing of the coarse raster: burnt share as Uint8 and mean arrival (s, 65535 = none) as little-endian Uint16, both base64. */
const pack = (c) => ({
  blockM: c.blockM,
  n: c.n,
  burntFracU8_b64: Buffer.from(Uint8Array.from(c.burntFrac)).toString('base64'),
  meanArrivalSecU16_b64: Buffer.from(new Uint8Array(Uint16Array.from(c.meanArrivalS, (v) => (v < 0 ? 65535 : Math.min(65534, v))).buffer)).toString('base64'),
});
const convOut = {
  note: 'Numerical-convergence summaries: the same model at finer fire cells (or smaller solver steps). NOT validation. coarse = blocks of coarse.blockM metres tiling the domain (row-major, row 0 = south, x to the east); burntFracU8 = share of the block burnt at the end (0..255); meanArrivalSecU16 = mean arrival time of the burnt cells of the block, seconds from the start (65535 = none). Decode: Buffer.from(b64, "base64"), then new Uint16Array(buf.buffer, buf.byteOffset, n*n).',
  groups: Object.fromEntries(Object.entries(GROUPS_OUT).filter(([, v]) => v).map(([k, v]) => [k, { ...v, pairs: undefined, rows: Object.fromEntries(Object.entries(v.rows).map(([id, r]) => [id, { ...r, coarse: pack(r.coarse) }])) }])),
};
writeFileSync(resolve(studyDir, 'data/convergence.json.gz'), gzipSync(JSON.stringify(convOut)));
const slim = (c) =>
  c
    ? {
        label: c.label,
        rows: Object.fromEntries(Object.entries(c.rows).map(([k, v]) => [k, { cellM: v.cellM, timesS: v.timesS, areaHa: v.areaHa, perimeterM: v.perimeterM, appPerimeterKmAtMarks: v.appPerimeterKmAtMarks, headRosMeanPerHour: v.headRosMeanPerHour, headRosMaxPerHour: v.headRosMaxPerHour, maxRosMeanPerHour: v.maxRosMeanPerHour, spots: v.spots }])),
        pairs: c.pairs,
      }
    : null;
writeFileSync(resolve(studyDir, 'data/convergence-diff.json'), JSON.stringify(Object.fromEntries(Object.entries(GROUPS_OUT).map(([k, v]) => [k, slim(v)])), null, 1));
for (const k of ['convergenceKat6', 'convergenceWar6', 'convergenceKat6NoEmbers', 'convergenceWar6NoEmbers', 'convergenceStepNoEmbers']) T[k] = slim(T[k]);

// ── 7. memory table ──
T.memory = ids.filter(ok).map((id) => {
  const r = rows[id];
  return { id, cells: r.grid.cells, baselineRssMB: r.rssAfterModulesMB, afterConstructMB: r.rssAfterConstructMB, peakRssSampledMB: r.peak.rssSampledMB, maxRssProcessMB: r.peak.maxRssProcessMB, peakHeapUsedSampledMB: r.peak.heapUsedSampledMB, endHeapUsedAfterGcMB: r.end.heapUsedAfterGcMB, endRssAfterGcMB: r.end.rssAfterGcMB, endArrayBuffersMB: r.end.arrayBuffersMB, memoryReportMB: r.memoryReport.totalBytes / 1e6, checkpointMB: r.memoryReport.checkpointBytes / 1e6, checkpoints: r.memoryReport.checkpoints, snapshotMB: r.snapshot.typedBytes / 1e6, keyframeMB: r.snapshot.keyframeBytes / 1e6, history: r.history ? { totalMB: r.history.totalBytes / 1e6, frames: r.history.frames, keyframes: r.history.keyframes, thinned: r.history.thinned, at: r.history.at } : null };
});

writeFileSync(resolve(studyDir, 'results/tables.json'), JSON.stringify(T, null, 1));

// ── markdown to stdout (the README pastes from this) ──
const md = [];
md.push('| row | site, extent | cell | fire cells | tier | embers cap | window | wall s per sim h | sim s per wall s | outer steps per h | fire sub-steps per h | peak RSS MB | end heap MB | snapshot MB | burnt ha at end | load1 start/end |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const id of ids.filter(ok)) {
  const r = rows[id];
  md.push(`| ${id} | ${r.spec.site} ${r.spec.extent / 1000} km | ${r.grid.cellSize} m | ${r.grid.cells} | ${r.spec.tier}${r.spec.ignition ? '' : ' (no fire)'} | ${r.spec.embers ? r.simOptions.maxEmbers : 'off'} | ${f(r.simTimeS / 3600, 1)} h${r.truncatedAtS ? ' (stopped)' : ''} | ${f(r.wallPerSimHourS, 1)} | ${f(r.simSPerWallS, 0)} | ${f(r.stepsPerSimHour, 0)} | ${f(r.fireSubStepsPerSimHour, 0)} | ${r.peak.maxRssProcessMB} | ${r.end.heapUsedAfterGcMB} | ${f(r.snapshot.typedBytes / 1e6, 2)} | ${f(r.final.areaHa, 0)} | ${r.load.start[0]}/${r.load.end[0]} |`);
}
for (const id of ids.filter((i) => !ok(i))) md.push(`| ${id} | FAILED | | | | | | | | | | | | | | |`);
writeFileSync(resolve(studyDir, 'results/rows-table.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
console.log('\n' + JSON.stringify({ ladderKat6: T.ladderKat6?.fits, ladderKat6Exact10m: T.ladderKat6Exact10m?.fits, ladderWar6: T.ladderWar6?.fits, noise: T.noise, determinism: T.determinism }, null, 1));
