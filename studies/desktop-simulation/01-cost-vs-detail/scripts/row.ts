/**
 * One measurement row of study 01 (cost against detail), headless in Node. Loaded by launch.mjs through the repo's own Vite
 * (so src/ is imported as it is; nothing under src/ is changed or imports from here). Not built, not type-checked, not shipped.
 *
 * A row = one Simulation of a bundled demo site with one fixed scenario (same preset, start, ignition, seed in every row);
 * only the knob under study differs. The wall clock is read only around `sim.advance` (and `spinUp`, `new Simulation`,
 * one final `snapshot()` separately), so the bookkeeping here (memory samples, hashes, summaries) is not in the times.
 * Everything the row learns is returned as plain JSON; launch.mjs writes it to a file.
 */
import { loadavg, cpus } from 'node:os';
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
import { Simulation } from '../../../../src/sim/simulation';
import { demoScenario, pointIgnition, withIgnitions } from '../../../../src/sim/testing/scenarios';
import { snapshotHash } from '../../../../src/sim/testing/hash';
import { typedArrayFootprint } from '../../../../src/core/datasets';
import { SnapshotStore, keyframeBytes } from '../../../../src/ui/snapshotStore';
import type { SimSnapshot } from '../../../../src/core/types';

export interface RowSpec {
  id: string;
  site: string;
  extent: number;
  /** Fire cell (m). */
  cell: number;
  tier: 'fast' | 'standard' | 'high';
  /** null = no fire (the air alone). */
  ignition: { x: number; y: number; radius: number } | null;
  embers: boolean;
  /** Ember budget; undefined = the tier default (2000 fast, 4000 3-D). */
  maxEmbers?: number;
  /** SimOptions.maxStepS (s): upper bound on the solver step; undefined / 0 = automatic. */
  maxStepS?: number;
  /** Display step (s); default 60 as in the app. */
  snapshotInterval?: number;
  seed?: number;
  /** Simulated seconds to run after spin-up. */
  windowS: number;
  /** Seconds of simulated time per `advance` call (memory is sampled between calls). */
  chunkS?: number;
  /** Stop (and say so) when the advance loop has used this much wall time. */
  maxWallS?: number;
  /**
   * 'none' = no snapshot receiver (no snapshots built); 'last' = a receiver that keeps the stats of each snapshot only;
   * 'hash' = also hashes each snapshot (inside the timed loop: not a timing row); 'store' = the snapshots are pushed into the
   * app's own history (ui/snapshotStore.ts, 150 MB budget) between the timed chunks, so the history's size can be read.
   */
  hook: 'none' | 'last' | 'hash' | 'store';
  /** Keep the convergence summaries (areas, perimeters, a coarse arrival raster) in the result. */
  summary?: boolean;
  /** Edge (m) of the common coarse grid of the arrival raster. */
  coarseM?: number;
  /** Path to write a V8 CPU profile of the advance loop (inspector, 1 ms sampling). */
  cpuProfile?: string;
  startCivil?: [number, number, number, number];
  preset?: string;
  buildTier?: 'fast' | 'standard' | 'high';
  note?: string;
}

const mb = (b: number): number => Math.round((b / 1048576) * 10) / 10;
const mem = (): { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number } => {
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external, arrayBuffers: m.arrayBuffers };
};
const gc = (): void => {
  (globalThis as { gc?: () => void }).gc?.();
};
const load = (): number[] => loadavg().map((x) => Math.round(x * 100) / 100);

/** Length (m) of the 0.5 contour of a 0/1 mask on a grid of spacing h (marching squares, midpoints of the edges). */
export function contourLength(mask: Uint8Array, nx: number, ny: number, h: number): number {
  let segs1 = 0; // corner cut: h / sqrt 2
  let segs2 = 0; // straight cut: h
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const a = mask[k]!;
      const b = mask[k + 1]!;
      const c = mask[k + nx]!;
      const d = mask[k + nx + 1]!;
      const s = a + b + c + d;
      if (s === 0 || s === 4) continue;
      if (s === 1 || s === 3) segs1++;
      else if (a === d) segs1 += 2; // saddle
      else segs2++;
    }
  }
  return h * (segs1 / Math.SQRT2 + segs2);
}

export default async function run(spec: RowSpec): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { spec };
  gc();
  const m0 = mem();
  out.rssAfterModulesMB = mb(m0.rss);
  out.node = process.version;
  out.cpuModel = cpus()[0]?.model ?? '';
  out.cpuCount = cpus().length;

  // ── scenario (built through the production builder, offline; not part of the timings) ──
  const tScen = performance.now();
  const buildTier = spec.buildTier ?? (spec.tier === 'high' && spec.cell >= 30 ? 'standard' : spec.tier);
  const highAir = spec.tier === 'high' && buildTier !== 'high';
  const atmOpts = highAir ? { atmosCellSize: Math.round(Math.min(270, Math.max(100, spec.extent / 60))), atmosLevels: 24, atmosDz1: 25 } : {};
  const base = await demoScenario({
    site: spec.site,
    preset: spec.preset ?? 'hot-nw-sw-change',
    startCivil: spec.startCivil ?? [2025, 12, 20, 14],
    duration: 4 * 3600,
    extent: spec.extent,
    tier: buildTier,
    options: {
      fireCellSize: spec.cell,
      embers: spec.embers,
      seed: spec.seed ?? 1,
      snapshotInterval: spec.snapshotInterval ?? 60,
      ...(spec.maxEmbers !== undefined ? { maxEmbers: spec.maxEmbers } : {}),
      ...(spec.maxStepS ? { maxStepS: spec.maxStepS } : {}),
      ...atmOpts,
    },
  });
  const scenario = spec.ignition ? withIgnitions(base, [pointIgnition('a', spec.ignition.x, spec.ignition.y, 0, spec.ignition.radius)]) : withIgnitions(base, []);
  out.buildS = (performance.now() - tScen) / 1000;
  const g = scenario.terrain.grid;
  out.grid = { nx: g.nx, ny: g.ny, cells: g.nx * g.ny, cellSize: g.cellSize, extentM: g.nx * g.cellSize };
  out.hiRes = scenario.terrainHiRes ? { nx: scenario.terrainHiRes.grid.nx, cellSize: scenario.terrainHiRes.grid.cellSize } : null;
  out.scenarioWarnings = (scenario.weather.warnings ?? []).length;
  gc();
  const m1 = mem();
  out.rssAfterBuildMB = mb(m1.rss);
  out.heapAfterBuildMB = mb(m1.heapUsed);

  // ── simulation ──
  const stats: { t: number; areaHa: number; perimKm: number; headRos: number; maxRos: number; burning: number; embers: number; spots: number; msPerMin: number }[] = [];
  const hashes: [number, number][] = [];
  const pending: SimSnapshot[] = [];
  const store = spec.hook === 'store' ? new SnapshotStore() : null;
  const storeAt: { t: number; bytesMB: number; frames: number; keyframes: number; thinned: number }[] = [];
  let nSnaps = 0;
  const hooks =
    spec.hook === 'none'
      ? undefined
      : {
          snapshot: (s: SimSnapshot): void => {
            nSnaps++;
            if (store) pending.push(s);
            const st = s.stats;
            stats.push({ t: s.time, areaHa: st.burntAreaHa, perimKm: st.perimeterKm, headRos: st.headRos, maxRos: st.maxRos, burning: st.burningCells, embers: st.activeEmbers, spots: st.spotFires, msPerMin: st.msPerSimMinute });
            if (spec.hook === 'hash') hashes.push([s.time, snapshotHash(s)]);
          },
        };
  const load0 = load();
  const cpu0 = process.cpuUsage();
  const tNew = performance.now();
  const sim = new Simulation(scenario, { tier: spec.tier, ...(hooks ? { hooks } : {}) });
  out.constructS = (performance.now() - tNew) / 1000;
  out.simOptions = sim.options;
  out.warnings = sim.warnings.length;
  const tSpin = performance.now();
  sim.spinUp();
  out.spinUpS = (performance.now() - tSpin) / 1000;
  gc();
  const m2 = mem();
  out.rssAfterConstructMB = mb(m2.rss);
  out.heapAfterConstructMB = mb(m2.heapUsed);

  const session = spec.cpuProfile ? new Session() : null;
  if (session) {
    session.connect();
    session.post('Profiler.enable');
    session.post('Profiler.setSamplingInterval', { interval: 1000 });
    session.post('Profiler.start');
  }
  const chunk = spec.chunkS ?? 300;
  const samples: { t: number; wallS: number; rssMB: number; heapMB: number; extMB: number }[] = [];
  let peakRss = m2.rss;
  let peakHeap = m2.heapUsed;
  let peakExternal = m2.external;
  let wallS = 0;
  let truncatedAt: number | null = null;
  const cpuLoop0 = process.cpuUsage();
  const target = spec.windowS;
  for (let t = chunk; t <= target + 1e-6; t += chunk) {
    const c = performance.now();
    sim.advance(t);
    wallS += (performance.now() - c) / 1000;
    if (store) {
      for (const s of pending) store.push(s);
      pending.length = 0;
      if (sim.time % 1800 < 1e-6) storeAt.push({ t: sim.time, bytesMB: mb(store.totalBytes), frames: store.size, keyframes: store.keyframeCount, thinned: store.thinnedCount });
    }
    const m = mem();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
    peakExternal = Math.max(peakExternal, m.external);
    samples.push({ t: sim.time, wallS: Math.round(wallS * 100) / 100, rssMB: mb(m.rss), heapMB: mb(m.heapUsed), extMB: mb(m.external) });
    if (spec.maxWallS && wallS > spec.maxWallS && sim.time < target - 1e-6) {
      truncatedAt = sim.time;
      break;
    }
  }
  const cpuLoop = process.cpuUsage(cpuLoop0);
  if (session) {
    await new Promise<void>((res) => session.post('Profiler.stop', (_e, r) => (writeFileSync(spec.cpuProfile!, JSON.stringify(r.profile)), res())));
    session.disconnect();
  }
  const load1 = load();
  const simT = sim.time;
  out.simTimeS = simT;
  out.truncatedAtS = truncatedAt;
  out.advanceWallS = wallS;
  out.cpuUserS = cpuLoop.user / 1e6;
  out.cpuSystemS = cpuLoop.system / 1e6;
  out.cpuOverWall = (cpuLoop.user + cpuLoop.system) / 1e6 / wallS;
  out.wallPerSimHourS = wallS / (simT / 3600);
  out.simSPerWallS = simT / wallS;
  out.load = { start: load0, end: load1 };
  const cpuAll = process.cpuUsage(cpu0);
  out.processCpuSinceConstructS = (cpuAll.user + cpuAll.system) / 1e6;
  const perf = sim.perf();
  out.steps = perf.steps;
  out.stepsPerSimHour = perf.steps / (simT / 3600);
  const sub = (sim as unknown as { fire?: { ls?: { subCount?: number } } }).fire?.ls?.subCount ?? null;
  out.fireSubSteps = sub;
  out.fireSubStepsPerSimHour = sub === null ? null : sub / (simT / 3600);
  out.meanOuterStepS = simT / perf.steps;
  out.modulesMs = perf.modules;
  out.initMs = perf.init;
  out.peak = { rssSampledMB: mb(peakRss), heapUsedSampledMB: mb(peakHeap), externalSampledMB: mb(peakExternal), maxRssProcessMB: mb(process.resourceUsage().maxRSS * 1024) };
  out.samples = samples;

  // ── after the loop (not timed): memory at the end, one snapshot's size and cost, memory report ──
  const mEndRaw = mem();
  gc();
  const mEnd = mem();
  out.end = { rssRawMB: mb(mEndRaw.rss), rssAfterGcMB: mb(mEnd.rss), heapUsedAfterGcMB: mb(mEnd.heapUsed), externalMB: mb(mEnd.external), arrayBuffersMB: mb(mEnd.arrayBuffers) };
  const tSnap = performance.now();
  const final = sim.snapshot();
  const snapMs = performance.now() - tSnap;
  const fp = typedArrayFootprint(final);
  out.snapshot = { buildMs: snapMs, typedBytes: fp.bytes, keyframeBytes: keyframeBytes(final), byKey: fp.byKey, count: nSnaps, perSimHourAtDisplayStep: 3600 / (spec.snapshotInterval ?? 60) };
  if (store) {
    out.history = { totalBytes: store.totalBytes, newestBytes: store.newestBytes, keyframeBytes: store.keyframeBytes, frames: store.size, keyframes: store.keyframeCount, windFrames: store.windFrameCount, thinned: store.thinnedCount, spacingS: store.spacing, budgetBytes: store.maxBytes, at: storeAt };
  }
  const report = sim.memoryReport();
  out.memoryReport = { totalBytes: report.totalBytes, parts: report.parts, checkpoints: report.checkpoints, checkpointBytes: report.checkpointBytes };
  const eng = final.engine;
  out.engine = eng ? { atmosphere: eng.atmosphere, fire: eng.fire, embers: eng.embers, cadence: eng.cadence } : null;
  out.final = { areaHa: final.stats.burntAreaHa, perimKm: final.stats.perimeterKm, headRos: final.stats.headRos, maxRos: final.stats.maxRos, spots: final.stats.spotFires, embers: final.stats.activeEmbers, embersLeftDomain: final.stats.embersLeftDomain };
  out.stats = stats;
  if (spec.hook === 'hash') {
    out.hashes = hashes;
    out.finalHash = snapshotHash(final);
  }

  // ── convergence summaries from the final arrival-time raster (arrival times never change once set) ──
  if (spec.summary) {
    const fg = final.fire.grid;
    const at = final.fire.arrivalTime;
    const nx = fg.nx;
    const ny = fg.ny;
    const h = fg.cellSize;
    const times: number[] = [];
    for (let T = 600; T <= simT + 1e-6; T += 600) times.push(T);
    const areaHa: number[] = [];
    const perimM: number[] = [];
    const mask = new Uint8Array(nx * ny);
    for (const T of times) {
      let c = 0;
      for (let k = 0; k < at.length; k++) {
        const b = at[k]! <= T ? 1 : 0;
        mask[k] = b;
        c += b;
      }
      areaHa.push((c * h * h) / 1e4);
      perimM.push(contourLength(mask, nx, ny, h));
    }
    // Common coarse grid: blocks of coarseM metres tiling the domain [-extent/2, extent/2]; a fine cell belongs to the block of its centre.
    const B = spec.coarseM ?? 60;
    const extent = nx * h;
    const nb = Math.round(extent / B);
    const burntFrac = new Uint8Array(nb * nb); // 0..255 of the block's cells burnt by the end
    const meanArrivalS = new Float32Array(nb * nb).fill(NaN); // mean arrival of the burnt cells (s)
    const minArrivalS = new Float32Array(nb * nb).fill(NaN);
    const cnt = new Uint32Array(nb * nb);
    const tot = new Uint32Array(nb * nb);
    const sum = new Float64Array(nb * nb);
    for (let j = 0; j < ny; j++) {
      const y = fg.y0 + j * h + extent / 2;
      const bj = Math.min(nb - 1, Math.max(0, Math.floor(y / B)));
      for (let i = 0; i < nx; i++) {
        const x = fg.x0 + i * h + extent / 2;
        const bi = Math.min(nb - 1, Math.max(0, Math.floor(x / B)));
        const q = bj * nb + bi;
        const a = at[j * nx + i]!;
        tot[q]++;
        if (Number.isFinite(a)) {
          cnt[q]++;
          sum[q] += a;
          if (!(a >= minArrivalS[q]!)) minArrivalS[q] = a;
        }
      }
    }
    for (let q = 0; q < nb * nb; q++) {
      burntFrac[q] = tot[q] ? Math.round((255 * cnt[q]!) / tot[q]!) : 0;
      if (cnt[q]) meanArrivalS[q] = sum[q]! / cnt[q]!;
    }
    out.summaryData = {
      timesS: times,
      areaHa,
      perimeterM: perimM,
      coarse: { blockM: B, n: nb, burntFrac: Array.from(burntFrac), meanArrivalS: Array.from(meanArrivalS, (v) => (Number.isFinite(v) ? Math.round(v) : -1)), minArrivalS: Array.from(minArrivalS, (v) => (Number.isFinite(v) ? Math.round(v) : -1)) },
    };
  }
  return out;
}
