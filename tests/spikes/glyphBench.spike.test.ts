/**
 * Spike S3 of docs/plans/air-slice-wind-detail-honest-speed.md (section 10, M0): how long does it take to build the
 * wind glyphs of workstream E (arrows and curved flow lines traced through the wind field), and is the plan's
 * "<= 8 ms p95 on a phone" believable? Nothing here changes the app. Not part of `npm test`: it is gated by
 * FIRESIM_SPIKE and takes several minutes.
 *
 *   FIRESIM_SPIKE=1 nice -n 10 npx vitest run tests/spikes/glyphBench.spike.test.ts
 *
 * Optional environment (development conveniences):
 *   FIRESIM_SPIKE_OUT=<file>     also write the report to this file
 *   FIRESIM_SPIKE_JSON=<file>    write the numbers as JSON
 *   FIRESIM_SPIKE_CASES=a,b      only build these cases (std6, std12, high6, high12)
 *   FIRESIM_SPIKE_QUICK=1        few repetitions (checks the harness; the numbers are not for the note)
 *   FIRESIM_SPIKE_MAXLOAD=2.5    1-minute load average above which a timed series is repeated (up to ATTEMPTS)
 *   FIRESIM_SPIKE_ATTEMPTS=3
 *
 * What is built (docs/plans/spikes/S3-glyph-benchmark/README.md has the method and the findings):
 *  1. Real AtmosphereView data: a real `Atmosphere` (standard and high tier; Katoomba 6 km, and the same DEM
 *     mirror-padded to 12 km) is spun up for 1200 s of model time. `view()` gives today's flat view (sampler v1) and the
 *     engine's native terrain-following arrays give the plan's `layout: 'terrain-following'` view (sampler v2).
 *  2. Sampler v2 (plan 7.2) as the plan writes it, and a hand-inlined version of the same arithmetic.
 *  3. The glyph tracer of plan 9.3: jittered world-lattice seeds from an integer hash, RK2 midpoint,
 *     arc-length parameterised, calm dots, domain-edge stop, culling to a view box, flat Float32Array output in the
 *     StreakBatch layout (segment start, segment end, colour) plus the halo-batch copy.
 *  4. Timing, cost split, ns per call, allocation, the raster alternative and its accuracy, the phone extrapolation.
 *
 * Calling convention. V8 boxes a double that is passed to, or returned from, a function that is not inlined (one
 * 16-byte HeapNumber each). So the tracer talks to its field through a scratch Float64Array `pos` (x, y in; the DEM
 * height out at pos[2]) and never passes a double. The variants that follow the plan's API (v1, v2: `wind(x, y, zAsl,
 * out)`) box inside their adapters; that is the measured difference between "as the plan writes it" and "allocation-free".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import v8 from 'node:v8';
import vm from 'node:vm';
import { PerformanceObserver } from 'node:perf_hooks';
import { Rng } from '../../src/core/rng';
import { makeGridSpec, type GridSpec } from '../../src/core/grid';
import type { AtmosphereView, Terrain } from '../../src/core/types';
import { Atmosphere } from '../../src/atmosphere/atmosphere';
import { featuresDouble, fuelDouble, hour, nightState, seriesOf } from '../../src/atmosphere/testUtils';
import { buildTerrain, insolation } from '../../src/terrain';
import { loadDemoDem } from '../../src/data';
import { AtmosphereSampler } from '../../src/render/atmosphereSampler';
import { HeightField } from '../../src/render/heightfield';
import { decimateGrid, hash01 } from '../../src/render/fields';
import { WIND_RAMP, sampleRamp, srgbToLinear, type Rgb } from '../../src/render/palette';

const ENABLED = Boolean(process.env.FIRESIM_SPIKE);
const QUICK = Boolean(process.env.FIRESIM_SPIKE_QUICK);
const MAX_LOAD = Number(process.env.FIRESIM_SPIKE_MAXLOAD ?? 2.5);
const ATTEMPTS = Number(process.env.FIRESIM_SPIKE_ATTEMPTS ?? 3);
const CASE_FILTER = process.env.FIRESIM_SPIKE_CASES ? process.env.FIRESIM_SPIKE_CASES.split(',') : null;

/** One data point: the 3-D air step takes 17.5 ms on this machine and 41.1 ms on the user's phone (spike brief). */
const PHONE_FACTOR = 41.1 / 17.5;
const THROTTLE = 4;
const BUDGET_MS = 8;
const MARGIN_FACTOR = 1.5;

const WARM = QUICK ? 8 : 40;
const REPS = QUICK ? 12 : 100;
const REPS_HEAD = QUICK ? 20 : 300;
const SPIN_S = QUICK ? 300 : 1200;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Report plumbing
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const OUT: string[] = [];
const RES: Record<string, unknown> = {};
function log(s = ''): void {
  OUT.push(s);
  process.stderr.write(s + '\n');
}
const f = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : 'NaN');
function table(rows: string[][]): void {
  const w: number[] = [];
  for (const r of rows) r.forEach((c, i) => (w[i] = Math.max(w[i] ?? 0, c.length)));
  rows.forEach((r, k) => {
    log(r.map((c, i) => (i === 0 ? c.padEnd(w[i]!) : c.padStart(w[i]!))).join('  '));
    if (k === 0) log(w.map((n) => '-'.repeat(n)).join('  '));
  });
}
const loadavg = (): string => {
  try {
    return readFileSync('/proc/loadavg', 'utf8').trim();
  } catch {
    return 'n/a';
  }
};
const load1 = (s: string): number => Number.parseFloat(s.split(' ')[0] ?? 'NaN');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** System-wide CPU jiffies (10 ms each): busy (user, nice, system, irq, softirq) and steal. */
function cpuStat(): { busy: number; steal: number } {
  try {
    const p = readFileSync('/proc/stat', 'utf8').split('\n')[0]!.split(/\s+/).slice(1).map(Number);
    return { busy: p[0]! + p[1]! + p[2]! + p[5]! + p[6]!, steal: p[7] ?? 0 };
  } catch {
    return { busy: 0, steal: 0 };
  }
}

// GC control and observation (the harness runs without --expose-gc, so the flag is set at run time).
let gcFn: (() => void) | null = null;
function gc(): void {
  if (!gcFn) {
    v8.setFlagsFromString('--expose-gc');
    gcFn = vm.runInNewContext('gc') as () => void;
  }
  gcFn();
}
interface GcEvent {
  kind: number;
  start: number;
  dur: number;
}
const gcEvents: GcEvent[] = [];
const gcObserver = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    const d = (e as unknown as { detail?: { kind?: number } }).detail;
    gcEvents.push({ kind: d?.kind ?? 0, start: e.startTime, dur: e.duration });
  }
});
const flushGc = (): Promise<void> => sleep(30);

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}
interface Summary {
  n: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
}
function summarise(a: number[]): Summary {
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, min: s[0]!, median: percentile(s, 0.5), p95: percentile(s, 0.95), max: s[s.length - 1]!, mean: s.reduce((x, y) => x + y, 0) / s.length };
}

interface KeyGc {
  minor: number;
  major: number;
  /** Time (ms) of GC events that overlapped this variant's timed windows. */
  ms: number;
  /** Timed rebuilds that overlapped a GC event. */
  hits: number;
}

/** Timings of several variants measured round-robin in the same time window, plus what the machine was doing meanwhile. */
interface Block {
  keys: string[];
  ms: Record<string, number[]>;
  sum: Record<string, Summary>;
  gc: Record<string, KeyGc>;
  load0: string;
  load1: string;
  /** CPU time of this process / wall time (1 = never descheduled; GC and compiler threads can push it above 1). */
  cpuWall: number;
  /** Other processes' CPU and the hypervisor's steal time, as a percentage of one core, over the block. */
  othersPct: number;
  stealPct: number;
  wallMs: number;
}

/**
 * Time several rebuild functions round-robin: warm-up for all, then `reps` rounds in which each variant is timed once
 * (the starting variant rotates). Slow drift and other load then hit every variant alike, so the comparisons between
 * variants are fair even on a shared machine.
 */
async function interleaved(rebuilds: Record<string, (i: number) => number>, reps = REPS, warm = WARM): Promise<Block> {
  const keys = Object.keys(rebuilds);
  for (let i = 0; i < warm; i++) for (const k of keys) rebuilds[k]!(i);
  await flushGc();
  const g0 = gcEvents.length;
  const ms: Record<string, number[]> = {};
  const st: Record<string, number[]> = {};
  for (const k of keys) {
    ms[k] = new Array<number>(reps);
    st[k] = new Array<number>(reps);
  }
  const load0 = loadavg();
  const cpu0 = process.cpuUsage();
  const sys0 = cpuStat();
  const w0 = performance.now();
  for (let i = 0; i < reps; i++) {
    for (let j = 0; j < keys.length; j++) {
      const k = keys[(i + j) % keys.length]!;
      const t0 = performance.now();
      rebuilds[k]!(warm + i);
      const t1 = performance.now();
      ms[k]![i] = t1 - t0;
      st[k]![i] = t0;
    }
  }
  const wall = performance.now() - w0;
  const cpu = process.cpuUsage(cpu0);
  const sys1 = cpuStat();
  const load1s = loadavg();
  await flushGc();
  const ev = gcEvents.slice(g0);
  const own = (cpu.user + cpu.system) / 1000;
  const sum: Record<string, Summary> = {};
  const gcInfo: Record<string, KeyGc> = {};
  for (const k of keys) {
    sum[k] = summarise(ms[k]!);
    let hits = 0;
    let gms = 0;
    for (let i = 0; i < reps; i++) {
      const a0 = st[k]![i]!;
      const a1 = a0 + ms[k]![i]!;
      let hit = false;
      for (const e of ev) {
        const ov = Math.min(a1, e.start + e.dur) - Math.max(a0, e.start);
        if (ov > 0) {
          hit = true;
          gms += ov;
        }
      }
      if (hit) hits++;
    }
    gcInfo[k] = { minor: 0, major: 0, ms: gms, hits };
  }
  const minor = ev.filter((e) => e.kind === 1).length;
  const major = ev.filter((e) => e.kind === 4).length;
  for (const k of keys) {
    gcInfo[k]!.minor = minor;
    gcInfo[k]!.major = major;
  }
  return {
    keys,
    ms,
    sum,
    gc: gcInfo,
    load0,
    load1: load1s,
    cpuWall: own / wall,
    othersPct: (100 * Math.max(0, (sys1.busy - sys0.busy) * 10 - own)) / wall,
    stealPct: (100 * (sys1.steal - sys0.steal) * 10) / wall,
    wallMs: wall,
  };
}

/** One variant on its own (a Block with one key). */
async function single(rebuild: (i: number) => number, reps = REPS, warm = WARM): Promise<{ sum: Summary; block: Block; gc: KeyGc }> {
  const b = await interleaved({ x: rebuild }, reps, warm);
  return { sum: b.sum['x']!, block: b, gc: b.gc['x']! };
}

/** "load before/after | others % | cpu/wall" of a block, for the report. */
const cond = (b: Block): string => `${f(load1(b.load0), 1)}/${f(load1(b.load1), 1)} ${f(b.othersPct, 0)}% ${f(b.cpuWall, 2)}`;
const blockJson = (b: Block): Record<string, unknown> => ({ load0: b.load0, load1: b.load1, cpuWall: b.cpuWall, othersPct: b.othersPct, stealPct: b.stealPct, wallMs: b.wallMs });

/**
 * Wait (up to `maxWaitMs`) until other processes use less than a quarter of a core, so that the timings that follow are
 * not taken against somebody else's test run. Logs what it found; it never skips the measurement.
 */
async function quiet(label: string, maxWaitMs = 240_000): Promise<void> {
  const t0 = performance.now();
  for (;;) {
    const a = cpuStat();
    const w0 = performance.now();
    await sleep(2000);
    const b = cpuStat();
    const wall = performance.now() - w0;
    const others = Math.max(0, (b.busy - a.busy) * 10) / wall; // this process is asleep, so everything is somebody else's
    const waited = performance.now() - t0;
    if (others < 0.25 || waited > maxWaitMs) {
      log(`[quiet] before ${label}: other processes use ${f(others, 2)} cores (waited ${f(waited / 1000, 0)} s), load average ${loadavg()}`);
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Data: real engine fields
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Terrain-following copy of the engine's native arrays: what the plan's `layout: 'terrain-following'` view carries (7.2). */
interface TfView {
  grid: GridSpec;
  nz: number;
  /** zeta centres (m along the terrain-following coordinate), as the engine's `levels`. */
  levels: Float32Array;
  /** h0: terrain height above the datum (m), per column. */
  terrainHeight: Float32Array;
  /** Native collocated wind, index k * plane + column. */
  u: Float32Array;
  v: Float32Array;
  w: Float32Array;
  /** H' (m) and the ASL datum zMin (m). */
  topM: number;
  baseM: number;
}

interface Dom {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface Case {
  name: string;
  label: string;
  tier: 'standard' | 'high';
  extent: number;
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  engine: Atmosphere;
  flat: AtmosphereView;
  tf: TfView;
  hf: HeightField;
  dom: Dom;
  buildS: number;
  steps: number;
  v1?: AtmosphereSampler;
  s2?: SamplerV2;
  s2t?: SamplerV2T;
  dem?: Dem;
}

/** Katoomba 10 m DEM cropped to `extent`; beyond the bundled 9 km the DEM is mirror-padded (benchmark only). */
async function demTerrain(extent: number, cell: number): Promise<{ terrain: Terrain; hiRes: { grid: GridSpec; elevation: Float32Array } }> {
  const dem = await loadDemoDem('katoomba');
  if (!dem) throw new Error('Katoomba DEM missing');
  const src = dem.grid;
  const nHi = Math.round(extent / src.cellSize);
  const off = Math.floor((src.nx - nHi) / 2);
  const period = 2 * (src.nx - 1);
  const reflect = (p: number): number => {
    const r = ((p % period) + period) % period;
    return r > src.nx - 1 ? period - r : r;
  };
  const hiGrid = makeGridSpec(src.origin, extent, src.cellSize);
  const hiZ = new Float32Array(nHi * nHi);
  for (let j = 0; j < nHi; j++) for (let i = 0; i < nHi; i++) hiZ[j * nHi + i] = dem.elevation[reflect(j + off) * src.nx + reflect(i + off)]!;
  const fire = makeGridSpec(src.origin, extent, cell);
  const sum = new Float64Array(fire.nx * fire.ny);
  const cnt = new Float64Array(fire.nx * fire.ny);
  for (let j = 0; j < nHi; j++) {
    const fj = Math.min(fire.ny - 1, Math.max(0, Math.round((hiGrid.y0 + j * hiGrid.cellSize - fire.y0) / cell)));
    for (let i = 0; i < nHi; i++) {
      const fi = Math.min(fire.nx - 1, Math.max(0, Math.round((hiGrid.x0 + i * hiGrid.cellSize - fire.x0) / cell)));
      sum[fj * fire.nx + fi]! += hiZ[j * nHi + i]!;
      cnt[fj * fire.nx + fi]! += 1;
    }
  }
  const z = new Float32Array(fire.nx * fire.ny);
  for (let k = 0; k < z.length; k++) z[k] = sum[k]! / Math.max(1, cnt[k]!);
  const note = extent > src.cellSize * src.nx ? 'Katoomba DEM, mirror-padded (benchmark only)' : 'Katoomba DEM (test crop)';
  return { terrain: buildTerrain(fire, z, note), hiRes: { grid: hiGrid, elevation: hiZ } };
}

function terrainFollowingView(a: Atmosphere): TfView {
  const g = a.grid;
  const st = a.state;
  const levels = new Float32Array(g.nz);
  for (let k = 0; k < g.nz; k++) levels[k] = g.zetaC[k]!;
  const terrainHeight = new Float32Array(g.plane);
  for (let c = 0; c < g.plane; c++) terrainHeight[c] = g.zs[c]! - g.zMin;
  return { grid: g.grid, nz: g.nz, levels, terrainHeight, u: st.uc.slice(), v: st.vc.slice(), w: st.wc.slice(), topM: g.Hp, baseM: g.zMin };
}

async function buildCase(name: string, label: string, tier: 'standard' | 'high', extent: number): Promise<Case> {
  const t0 = performance.now();
  const { terrain, hiRes } = await demTerrain(extent, 30);
  const hrs = [0, 1].map((q) => hour(Date.UTC(2025, 9, 15, 2 + q), 10, 300)); // 10 m/s from 300 deg, 13:00 local, 15 Oct 2025
  const series = seriesOf(hrs, { sourceElevation: 715 });
  const engine = new Atmosphere(terrain, hiRes, fuelDouble(terrain.grid), featuresDouble(terrain), tier, extent, series, new Rng(3));
  engine.setAmbient(hrs[0]!, hrs[1]!);
  engine.setTime(hrs[0]!.time);
  engine.setSurfaceHeating(insolation(terrain, hrs[0]!.time), hrs[0]!, 60, nightState(0));
  let t = 0;
  let steps = 0;
  while (t < SPIN_S - 1e-9) {
    const dt = Math.min(engine.maxStableDt(), SPIN_S - t);
    engine.step(dt);
    t += dt;
    steps++;
  }
  const flat = engine.view();
  const tf = terrainFollowingView(engine);
  // Render DEM as the app builds it: the 10 m DEM decimated to the 'high' mesh size (400 samples per side).
  const rg = decimateGrid(hiRes.grid, hiRes.elevation, 400);
  const hf = new HeightField(rg.grid, rg.elevation, 1);
  const g = engine.grid;
  return {
    name,
    label,
    tier,
    extent,
    nx: g.nx,
    ny: g.ny,
    nz: g.nz,
    dx: g.dx,
    engine,
    flat,
    tf,
    hf,
    dom: { x0: hf.xMin, x1: hf.xMax, y0: hf.yMin, y1: hf.yMax },
    buildS: (performance.now() - t0) / 1000,
    steps,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Sampler v2 (plan 7.2) and variants
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Plan 7.2, as written: per column of the 4-column stencil compute zeta = (zAsl - baseM - h0) / J with J = 1 - h0 / topM,
 * clamp to the first and last level, binary-search the level, interpolate linearly in zeta, blend the 4 columns
 * bilinearly. Same arithmetic as DiagnosticWind.sampleBg and Atmosphere.sampleAt. API like v1: doubles in.
 */
class SamplerV2 {
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly plane: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly invCell: number;
  private readonly topM: number;
  private readonly baseM: number;
  private readonly lv: Float32Array;
  private readonly h0: Float32Array;
  private readonly u: Float32Array;
  private readonly v: Float32Array;
  private readonly w: Float32Array;

  constructor(view: TfView) {
    this.nx = view.grid.nx;
    this.ny = view.grid.ny;
    this.nz = view.nz;
    this.plane = view.grid.nx * view.grid.ny;
    this.x0 = view.grid.x0;
    this.y0 = view.grid.y0;
    this.invCell = 1 / view.grid.cellSize;
    this.topM = view.topM;
    this.baseM = view.baseM;
    this.lv = view.levels;
    this.h0 = view.terrainHeight;
    this.u = view.u;
    this.v = view.v;
    this.w = view.w;
  }

  /** Fractional level index (0 .. nz-1) of a zeta: clamped at both ends, binary search between. */
  private level(zeta: number): number {
    const lv = this.lv;
    const nz = this.nz;
    if (zeta <= lv[0]!) return 0;
    if (zeta >= lv[nz - 1]!) return nz - 1;
    let lo = 0;
    let hi = nz - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (lv[m]! <= zeta) lo = m;
      else hi = m;
    }
    return lo + (zeta - lv[lo]!) / (lv[lo + 1]! - lv[lo]!);
  }

  /** (u, v, w) at a local point and an elevation (m ASL); out must have 3 slots. */
  wind3(x: number, y: number, zAsl: number, out: Float32Array): void {
    const nx = this.nx;
    let fx = (x - this.x0) * this.invCell;
    let fy = (y - this.y0) * this.invCell;
    fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx;
    fy = fy < 0 ? 0 : fy > this.ny - 1 ? this.ny - 1 : fy;
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 > nx - 2) i0 = nx - 2;
    if (j0 > this.ny - 2) j0 = this.ny - 2;
    const tx = fx - i0;
    const ty = fy - j0;
    const zr = zAsl - this.baseM;
    const plane = this.plane;
    const nz2 = this.nz - 2;
    let su = 0;
    let sv = 0;
    let sw = 0;
    for (let q = 0; q < 4; q++) {
      const c = (j0 + (q >> 1)) * nx + i0 + (q & 1);
      const wq = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
      const h0 = this.h0[c]!;
      const zeta = (zr - h0) / (1 - h0 / this.topM);
      const kf = this.level(zeta);
      let k0 = kf | 0;
      if (k0 > nz2) k0 = nz2;
      const t = kf - k0;
      const o = k0 * plane + c;
      su += wq * (this.u[o]! + (this.u[o + plane]! - this.u[o]!) * t);
      sv += wq * (this.v[o]! + (this.v[o + plane]! - this.v[o]!) * t);
      sw += wq * (this.w[o]! + (this.w[o + plane]! - this.w[o]!) * t);
    }
    out[0] = su;
    out[1] = sv;
    out[2] = sw;
  }

  /** (u, v) only: what a glyph tracer needs (one third less blending work than wind3). */
  wind2(x: number, y: number, zAsl: number, out: Float32Array): void {
    const nx = this.nx;
    let fx = (x - this.x0) * this.invCell;
    let fy = (y - this.y0) * this.invCell;
    fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx;
    fy = fy < 0 ? 0 : fy > this.ny - 1 ? this.ny - 1 : fy;
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 > nx - 2) i0 = nx - 2;
    if (j0 > this.ny - 2) j0 = this.ny - 2;
    const tx = fx - i0;
    const ty = fy - j0;
    const zr = zAsl - this.baseM;
    const plane = this.plane;
    const nz2 = this.nz - 2;
    let su = 0;
    let sv = 0;
    for (let q = 0; q < 4; q++) {
      const c = (j0 + (q >> 1)) * nx + i0 + (q & 1);
      const wq = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
      const h0 = this.h0[c]!;
      const zeta = (zr - h0) / (1 - h0 / this.topM);
      const kf = this.level(zeta);
      let k0 = kf | 0;
      if (k0 > nz2) k0 = nz2;
      const t = kf - k0;
      const o = k0 * plane + c;
      su += wq * (this.u[o]! + (this.u[o + plane]! - this.u[o]!) * t);
      sv += wq * (this.v[o]! + (this.v[o + plane]! - this.v[o]!) * t);
    }
    out[0] = su;
    out[1] = sv;
  }
}

/**
 * wind2 with three one-time precomputations (per view, microseconds): a level-index table instead of the binary search
 * (bins half the thinnest level, so at most one correction step), the reciprocal of J per column and the reciprocal of
 * the level spacing. Not in the plan; measured to see how much of the cost is the 4 searches.
 */
class SamplerV2T {
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly plane: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly invCell: number;
  private readonly baseM: number;
  private readonly lv: Float32Array;
  private readonly h0: Float32Array;
  private readonly invJ: Float64Array;
  private readonly invDl: Float64Array;
  private readonly tab: Uint8Array;
  private readonly binInv: number;
  private readonly u: Float32Array;
  private readonly v: Float32Array;

  constructor(view: TfView) {
    this.nx = view.grid.nx;
    this.ny = view.grid.ny;
    this.nz = view.nz;
    this.plane = view.grid.nx * view.grid.ny;
    this.x0 = view.grid.x0;
    this.y0 = view.grid.y0;
    this.invCell = 1 / view.grid.cellSize;
    this.baseM = view.baseM;
    this.lv = view.levels;
    this.h0 = view.terrainHeight;
    this.u = view.u;
    this.v = view.v;
    this.invJ = new Float64Array(this.plane);
    for (let c = 0; c < this.plane; c++) this.invJ[c] = 1 / (1 - view.terrainHeight[c]! / view.topM);
    this.invDl = new Float64Array(view.nz);
    let minDl = Infinity;
    for (let k = 0; k < view.nz - 1; k++) {
      const dl = view.levels[k + 1]! - view.levels[k]!;
      this.invDl[k] = 1 / dl;
      minDl = Math.min(minDl, dl);
    }
    const bin = minDl / 2;
    this.binInv = 1 / bin;
    const top = view.levels[view.nz - 1]!;
    this.tab = new Uint8Array(Math.ceil(top / bin) + 2);
    let k = 0;
    for (let b = 0; b < this.tab.length; b++) {
      while (k < view.nz - 2 && view.levels[k + 1]! <= b * bin) k++;
      this.tab[b] = k;
    }
  }

  private level(zeta: number): number {
    const lv = this.lv;
    if (zeta <= lv[0]!) return 0;
    if (zeta >= lv[this.nz - 1]!) return this.nz - 1;
    let k = this.tab[(zeta * this.binInv) | 0]!;
    while (lv[k + 1]! <= zeta) k++;
    return k + (zeta - lv[k]!) * this.invDl[k]!;
  }

  wind2(x: number, y: number, zAsl: number, out: Float32Array): void {
    const nx = this.nx;
    let fx = (x - this.x0) * this.invCell;
    let fy = (y - this.y0) * this.invCell;
    fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx;
    fy = fy < 0 ? 0 : fy > this.ny - 1 ? this.ny - 1 : fy;
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 > nx - 2) i0 = nx - 2;
    if (j0 > this.ny - 2) j0 = this.ny - 2;
    const tx = fx - i0;
    const ty = fy - j0;
    const zr = zAsl - this.baseM;
    const plane = this.plane;
    const nz2 = this.nz - 2;
    let su = 0;
    let sv = 0;
    for (let q = 0; q < 4; q++) {
      const c = (j0 + (q >> 1)) * nx + i0 + (q & 1);
      const wq = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
      const zeta = (zr - this.h0[c]!) * this.invJ[c]!;
      const kf = this.level(zeta);
      let k0 = kf | 0;
      if (k0 > nz2) k0 = nz2;
      const t = kf - k0;
      const o = k0 * plane + c;
      su += wq * (this.u[o]! + (this.u[o + plane]! - this.u[o]!) * t);
      sv += wq * (this.v[o]! + (this.v[o + plane]! - this.v[o]!) * t);
    }
    out[0] = su;
    out[1] = sv;
  }
}

/** Render DEM bilinear lookup with the scratch-array convention (same arithmetic as HeightField.heightAt). */
class Dem {
  private readonly e: Float32Array;
  private readonly nx: number;
  private readonly mx: number;
  private readonly my: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly inv: number;
  constructor(hf: HeightField) {
    this.e = hf.elevation;
    this.nx = hf.grid.nx;
    this.mx = hf.grid.nx - 1;
    this.my = hf.grid.ny - 1;
    this.x0 = hf.grid.x0;
    this.y0 = hf.grid.y0;
    this.inv = 1 / hf.grid.cellSize;
  }
  /** pos[2] = elevation (m ASL) at (pos[0], pos[1]). */
  atP(pos: Float64Array): void {
    let fx = (pos[0]! - this.x0) * this.inv;
    let fy = (pos[1]! - this.y0) * this.inv;
    fx = fx < 0 ? 0 : fx > this.mx ? this.mx : fx;
    fy = fy < 0 ? 0 : fy > this.my ? this.my : fy;
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 >= this.mx) i0 = this.mx - 1;
    if (j0 >= this.my) j0 = this.my - 1;
    const tx = fx - i0;
    const ty = fy - j0;
    const e = this.e;
    const k = j0 * this.nx + i0;
    pos[2] = (e[k]! * (1 - tx) + e[k + 1]! * tx) * (1 - ty) + (e[k + this.nx]! * (1 - tx) + e[k + this.nx + 1]! * tx) * ty;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Glyph fields: windAt(x, y) at the chosen height above the render DEM, in several implementations
// ─────────────────────────────────────────────────────────────────────────────────────────────────

interface GlyphField {
  /** pos[0], pos[1] = x, y (m) in; wind (u, v) in out[0], out[1] (the u,v,w variants also write out[2]). */
  windP(pos: Float64Array, out: Float32Array): void;
  /** pos[0], pos[1] = x, y in; the render DEM elevation (m ASL) in pos[2], for the lift of the drawn polyline. */
  groundP(pos: Float64Array): void;
}

/** Today's sampler (`AtmosphereSampler.wind`, plan API: doubles in) on today's flat view. u, v, w; flat levels with zeros under the terrain. */
class FieldV1 implements GlyphField {
  private readonly hf: HeightField;
  private readonly s: AtmosphereSampler;
  private readonly h: number;
  constructor(hf: HeightField, s: AtmosphereSampler, h: number) {
    this.hf = hf;
    this.s = s;
    this.h = h;
  }
  windP(pos: Float64Array, out: Float32Array): void {
    const x = pos[0]!;
    const y = pos[1]!;
    this.s.wind(x, y, this.hf.heightAt(x, y) + this.h, this.h, out);
  }
  groundP(pos: Float64Array): void {
    pos[2] = this.hf.heightAt(pos[0]!, pos[1]!);
  }
}

/** Sampler v2 as the plan writes it (doubles in), three components (apples to apples with v1). */
class FieldV2 implements GlyphField {
  private readonly hf: HeightField;
  private readonly s: SamplerV2;
  private readonly h: number;
  constructor(hf: HeightField, s: SamplerV2, h: number) {
    this.hf = hf;
    this.s = s;
    this.h = h;
  }
  windP(pos: Float64Array, out: Float32Array): void {
    const x = pos[0]!;
    const y = pos[1]!;
    this.s.wind3(x, y, this.hf.heightAt(x, y) + this.h, out);
  }
  groundP(pos: Float64Array): void {
    pos[2] = this.hf.heightAt(pos[0]!, pos[1]!);
  }
}

/** Sampler v2 as the plan writes it, u and v only. */
class FieldV2uv implements GlyphField {
  private readonly hf: HeightField;
  private readonly s: SamplerV2;
  private readonly h: number;
  constructor(hf: HeightField, s: SamplerV2, h: number) {
    this.hf = hf;
    this.s = s;
    this.h = h;
  }
  windP(pos: Float64Array, out: Float32Array): void {
    const x = pos[0]!;
    const y = pos[1]!;
    this.s.wind2(x, y, this.hf.heightAt(x, y) + this.h, out);
  }
  groundP(pos: Float64Array): void {
    pos[2] = this.hf.heightAt(pos[0]!, pos[1]!);
  }
}

/** Sampler v2 with the level table (doubles in). */
class FieldV2t implements GlyphField {
  private readonly hf: HeightField;
  private readonly s: SamplerV2T;
  private readonly h: number;
  constructor(hf: HeightField, s: SamplerV2T, h: number) {
    this.hf = hf;
    this.s = s;
    this.h = h;
  }
  windP(pos: Float64Array, out: Float32Array): void {
    const x = pos[0]!;
    const y = pos[1]!;
    this.s.wind2(x, y, this.hf.heightAt(x, y) + this.h, out);
  }
  groundP(pos: Float64Array): void {
    pos[2] = this.hf.heightAt(pos[0]!, pos[1]!);
  }
}

/**
 * Sampler v2 with the same arithmetic and the same binary search, written as one method that takes no double argument
 * and calls nothing that returns one (DEM lookup through the scratch array, level search inline): allocation-free.
 */
class FieldV2P implements GlyphField {
  private readonly dem: Dem;
  private readonly h: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly plane: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly invCell: number;
  private readonly topM: number;
  private readonly baseM: number;
  private readonly lv: Float32Array;
  private readonly h0: Float32Array;
  private readonly u: Float32Array;
  private readonly v: Float32Array;
  constructor(dem: Dem, view: TfView, h: number) {
    this.dem = dem;
    this.h = h;
    this.nx = view.grid.nx;
    this.ny = view.grid.ny;
    this.nz = view.nz;
    this.plane = view.grid.nx * view.grid.ny;
    this.x0 = view.grid.x0;
    this.y0 = view.grid.y0;
    this.invCell = 1 / view.grid.cellSize;
    this.topM = view.topM;
    this.baseM = view.baseM;
    this.lv = view.levels;
    this.h0 = view.terrainHeight;
    this.u = view.u;
    this.v = view.v;
  }
  windP(pos: Float64Array, out: Float32Array): void {
    this.dem.atP(pos);
    const nx = this.nx;
    const nz = this.nz;
    const lv = this.lv;
    let fx = (pos[0]! - this.x0) * this.invCell;
    let fy = (pos[1]! - this.y0) * this.invCell;
    fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx;
    fy = fy < 0 ? 0 : fy > this.ny - 1 ? this.ny - 1 : fy;
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 > nx - 2) i0 = nx - 2;
    if (j0 > this.ny - 2) j0 = this.ny - 2;
    const tx = fx - i0;
    const ty = fy - j0;
    const zr = pos[2]! + this.h - this.baseM;
    const plane = this.plane;
    const nz2 = nz - 2;
    let su = 0;
    let sv = 0;
    for (let q = 0; q < 4; q++) {
      const c = (j0 + (q >> 1)) * nx + i0 + (q & 1);
      const wq = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
      const h0 = this.h0[c]!;
      const zeta = (zr - h0) / (1 - h0 / this.topM);
      let kf: number;
      if (zeta <= lv[0]!) kf = 0;
      else if (zeta >= lv[nz - 1]!) kf = nz - 1;
      else {
        let lo = 0;
        let hi = nz - 1;
        while (hi - lo > 1) {
          const m = (lo + hi) >> 1;
          if (lv[m]! <= zeta) lo = m;
          else hi = m;
        }
        kf = lo + (zeta - lv[lo]!) / (lv[lo + 1]! - lv[lo]!);
      }
      let k0 = kf | 0;
      if (k0 > nz2) k0 = nz2;
      const t = kf - k0;
      const o = k0 * plane + c;
      su += wq * (this.u[o]! + (this.u[o + plane]! - this.u[o]!) * t);
      sv += wq * (this.v[o]! + (this.v[o + plane]! - this.v[o]!) * t);
    }
    out[0] = su;
    out[1] = sv;
  }
  groundP(pos: Float64Array): void {
    this.dem.atP(pos);
  }
}

/**
 * The alternative design: once per rebuild the field is resampled to a 2-D raster at the chosen height above ground
 * (texel spacing = the model's column spacing divided by `res`), and the tracer does bilinear lookups on it.
 * u and v are interleaved.
 */
class FieldRaster implements GlyphField {
  readonly nr: number;
  readonly res: number;
  readonly uv: Float32Array;
  private readonly dem: Dem;
  private readonly x0: number;
  private readonly y0: number;
  private readonly step: number;
  private readonly invStep: number;
  private readonly tmp = new Float32Array(3);
  private readonly tpos = new Float64Array(3);
  constructor(dem: Dem, grid: GridSpec, res: number) {
    this.dem = dem;
    this.res = res;
    this.nr = (grid.nx - 1) * res + 1;
    this.x0 = grid.x0;
    this.y0 = grid.y0;
    this.step = grid.cellSize / res;
    this.invStep = res / grid.cellSize;
    this.uv = new Float32Array(2 * this.nr * this.nr);
  }
  /** Fill from a direct field (the cost of this call is the "raster build"). */
  build(src: GlyphField): void {
    const nr = this.nr;
    const t = this.tmp;
    const p = this.tpos;
    let o = 0;
    for (let j = 0; j < nr; j++) {
      p[1] = this.y0 + j * this.step;
      for (let i = 0; i < nr; i++) {
        p[0] = this.x0 + i * this.step;
        src.windP(p, t);
        this.uv[o++] = t[0]!;
        this.uv[o++] = t[1]!;
      }
    }
  }
  windP(pos: Float64Array, out: Float32Array): void {
    const nr = this.nr;
    let fx = (pos[0]! - this.x0) * this.invStep;
    let fy = (pos[1]! - this.y0) * this.invStep;
    fx = fx < 0 ? 0 : fx > nr - 1 ? nr - 1 : fx;
    fy = fy < 0 ? 0 : fy > nr - 1 ? nr - 1 : fy;
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 > nr - 2) i0 = nr - 2;
    if (j0 > nr - 2) j0 = nr - 2;
    const tx = fx - i0;
    const ty = fy - j0;
    const o = 2 * (j0 * nr + i0);
    const o2 = o + 2 * nr;
    const m = this.uv;
    const a0 = m[o]! * (1 - tx) + m[o + 2]! * tx;
    const a1 = m[o + 1]! * (1 - tx) + m[o + 3]! * tx;
    const b0 = m[o2]! * (1 - tx) + m[o2 + 2]! * tx;
    const b1 = m[o2 + 1]! * (1 - tx) + m[o2 + 3]! * tx;
    out[0] = a0 * (1 - ty) + b0 * ty;
    out[1] = a1 * (1 - ty) + b1 * ty;
  }
  groundP(pos: Float64Array): void {
    this.dem.atP(pos);
  }
}

/** Records every request of an inner field (positions and results) for the cost split. */
class FieldRecord implements GlyphField {
  idx = 0;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly uv: Float32Array;
  private readonly inner: GlyphField;
  constructor(inner: GlyphField, cap: number) {
    this.inner = inner;
    this.xs = new Float64Array(cap);
    this.ys = new Float64Array(cap);
    this.uv = new Float32Array(2 * cap);
  }
  windP(pos: Float64Array, out: Float32Array): void {
    this.inner.windP(pos, out);
    this.xs[this.idx] = pos[0]!;
    this.ys[this.idx] = pos[1]!;
    this.uv[2 * this.idx] = out[0]!;
    this.uv[2 * this.idx + 1] = out[1]!;
    this.idx++;
  }
  groundP(pos: Float64Array): void {
    this.inner.groundP(pos);
  }
}

/** Plays back recorded results in order: the tracer then pays for its own arithmetic but not for the sampler. */
class FieldReplay implements GlyphField {
  idx = 0;
  private readonly uv: Float32Array;
  constructor(uv: Float32Array) {
    this.uv = uv;
  }
  windP(_pos: Float64Array, out: Float32Array): void {
    out[0] = this.uv[2 * this.idx]!;
    out[1] = this.uv[2 * this.idx + 1]!;
    this.idx++;
  }
  groundP(pos: Float64Array): void {
    pos[2] = 0;
  }
}

/** Analytic fields for the correctness checks of the tracer. */
class FieldFn implements GlyphField {
  private readonly fn: (x: number, y: number, out: Float32Array) => void;
  constructor(fn: (x: number, y: number, out: Float32Array) => void) {
    this.fn = fn;
  }
  windP(pos: Float64Array, out: Float32Array): void {
    this.fn(pos[0]!, pos[1]!, out);
  }
  groundP(pos: Float64Array): void {
    pos[2] = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Seeds: jittered world lattice, integer hash, culled to the view box
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const SALT_SEL = 0x51ed;
const SALT_X = 0x9e37;
const SALT_Y = 0x7f4a;
const JITTER = 0.8;

interface Seeds {
  sx: Float64Array;
  sy: Float64Array;
  smpp: Float64Array;
}

/**
 * Lattice points of spacing S (m, a power of two) inside the box, each jittered inside its own cell by an integer hash
 * of its indices (no Math.random, so a seed does not move when the box does; `hash01` is the hash of render/fields.ts).
 * When the box holds more than `want` points, selection sampling (Knuth's algorithm S, driven by the same hash) keeps
 * exactly `want`, evenly spread. (The real engine would thin with a fixed hash threshold per level so that panning never
 * reshuffles; the count here is exact so that "2000 glyphs" means 2000.) Metres per pixel at a seed = distance to the
 * camera x pxm (plan 9.3).
 */
function seedLattice(s: Seeds, bx0: number, by0: number, bx1: number, by1: number, S: number, want: number, dom: Dom, camX: number, camY: number, camH: number, pxm: number): number {
  const i0 = Math.floor(bx0 / S);
  const i1 = Math.floor(bx1 / S);
  const j0 = Math.floor(by0 / S);
  const j1 = Math.floor(by1 / S);
  const total = (i1 - i0 + 1) * (j1 - j0 + 1);
  let left = total;
  let need = Math.min(want, total);
  const h2 = camH * camH;
  let n = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const take = need >= left || hash01(i, j, SALT_SEL) * left < need;
      left--;
      if (!take) continue;
      need--;
      const px = (i + 0.5 + JITTER * (hash01(i, j, SALT_X) - 0.5)) * S;
      const py = (j + 0.5 + JITTER * (hash01(i, j, SALT_Y) - 0.5)) * S;
      if (px < dom.x0 || px > dom.x1 || py < dom.y0 || py > dom.y1) continue;
      const dx = px - camX;
      const dy = py - camY;
      s.sx[n] = px;
      s.sy[n] = py;
      s.smpp[n] = pxm * Math.sqrt(h2 + dx * dx + dy * dy);
      n++;
    }
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The tracer (self-contained: benchmarked through fresh copies so that every variant gets its own JIT feedback)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

interface TraceCtx {
  field: GlyphField;
  /** Seeds in use. */
  n: number;
  segs: number;
  sx: Float64Array;
  sy: Float64Array;
  smpp: Float64Array;
  /** Domain: x0, x1, y0, y1 (the glyphs stop at the edge). */
  dom: Float64Array;
  minPx: number;
  maxPx: number;
  pxPerMs: number;
  calm: number;
  vex: number;
  /** false: trace only, no output (the cost split). */
  write: boolean;
  /** true: colour each segment with sampleRamp + srgbToLinear instead of the table. */
  naive: boolean;
  colourFn: ((speed: number, C: Float32Array, o: number) => void) | null;
  /** Output in the StreakBatch layout: start (x, y_world, -y), end, colour; plus the halo batch copy. */
  A: Float32Array;
  B: Float32Array;
  C: Float32Array;
  A2: Float32Array;
  B2: Float32Array;
  gStart: Int32Array;
  gCount: Int32Array;
  /** End point and path length of every glyph (accuracy checks). */
  ex: Float64Array;
  ey: Float64Array;
  len: Float64Array;
  lut: Float32Array;
  lutScale: number;
  /** Near plane: normal (x, y_world, z) and offset; a vertex with n.p + d < 0 ends the glyph. */
  near: Float64Array;
  w: Float32Array;
  /** Scratch for the calling convention: x, y in; ground height out. */
  pos: Float64Array;
  calls: number;
  total: number;
}

/**
 * Build all glyphs of the context: for every seed, RK2 midpoint through windAt with a step of lengthPx x metresPerPixel /
 * segs (arc-length parameterised: the step follows the unit direction). A seed with speed under `calm` becomes a dot.
 * Returns the number of segments written. Uses nothing but its argument (it is copied through Function.prototype.toString).
 */
function traceGlyphs(c: TraceCtx): number {
  const field = c.field;
  const w = c.w;
  const pos = c.pos;
  const segs = c.segs;
  const write = c.write;
  const naive = c.naive;
  const x0 = c.dom[0]!;
  const x1 = c.dom[1]!;
  const y0 = c.dom[2]!;
  const y1 = c.dom[3]!;
  const A = c.A;
  const B = c.B;
  const C = c.C;
  const lut = c.lut;
  const lutScale = c.lutScale;
  const vex = c.vex;
  const p0 = c.near[0]!;
  const p1 = c.near[1]!;
  const p2 = c.near[2]!;
  const pd = c.near[3]!;
  let seg = 0;
  let calls = 0;
  for (let g = 0; g < c.n; g++) {
    let px = c.sx[g]!;
    let py = c.sy[g]!;
    const mpp = c.smpp[g]!;
    pos[0] = px;
    pos[1] = py;
    field.windP(pos, w);
    calls++;
    let u = w[0]!;
    let v = w[1]!;
    let sp = Math.sqrt(u * u + v * v);
    c.gStart[g] = seg;
    const lift = Math.max(1.5, 3 * mpp);
    if (sp < c.calm) {
      // Calm: a dot (one short segment).
      if (write) {
        field.groundP(pos);
        const z = (pos[2]! + lift) * vex;
        const ia = 3 * seg;
        const ic = 4 * seg;
        A[ia] = px;
        A[ia + 1] = z;
        A[ia + 2] = -py;
        B[ia] = px + 2 * mpp;
        B[ia + 1] = z;
        B[ia + 2] = -py;
        C[ic] = lut[0]!;
        C[ic + 1] = lut[1]!;
        C[ic + 2] = lut[2]!;
        C[ic + 3] = lut[3]!;
      }
      c.gCount[g] = 1;
      c.ex[g] = px;
      c.ey[g] = py;
      c.len[g] = 2 * mpp;
      seg++;
      continue;
    }
    let lenPx = c.pxPerMs * sp;
    if (lenPx < c.minPx) lenPx = c.minPx;
    else if (lenPx > c.maxPx) lenPx = c.maxPx;
    const ds = (lenPx * mpp) / segs;
    const half = 0.5 * ds;
    let ox = px;
    let oy = py;
    let oz = 0;
    if (write) {
      field.groundP(pos);
      oz = (pos[2]! + lift) * vex;
    }
    let n = 0;
    for (let s = 0; s < segs; s++) {
      if (s > 0) {
        pos[0] = px;
        pos[1] = py;
        field.windP(pos, w);
        calls++;
        u = w[0]!;
        v = w[1]!;
        sp = Math.sqrt(u * u + v * v);
        if (!(sp > 1e-6)) break;
      }
      const k1 = half / sp;
      pos[0] = px + u * k1;
      pos[1] = py + v * k1;
      field.windP(pos, w);
      calls++;
      const u2 = w[0]!;
      const v2 = w[1]!;
      const sp2 = Math.sqrt(u2 * u2 + v2 * v2);
      if (!(sp2 > 1e-6)) break;
      const k2 = ds / sp2;
      const qx = px + u2 * k2;
      const qy = py + v2 * k2;
      if (qx < x0 || qx > x1 || qy < y0 || qy > y1) break;
      if (write) {
        pos[0] = qx;
        pos[1] = qy;
        field.groundP(pos);
        const qz = (pos[2]! + lift) * vex;
        if (p0 * qx + p1 * qz + p2 * -qy + pd < 0) break;
        const ia = 3 * seg;
        A[ia] = ox;
        A[ia + 1] = oz;
        A[ia + 2] = -oy;
        B[ia] = qx;
        B[ia + 1] = qz;
        B[ia + 2] = -qy;
        if (naive) c.colourFn!(sp2, C, 4 * seg);
        else {
          let bin = (sp2 * lutScale) | 0;
          if (bin > 63) bin = 63;
          bin <<= 2;
          const ic = 4 * seg;
          C[ic] = lut[bin]!;
          C[ic + 1] = lut[bin + 1]!;
          C[ic + 2] = lut[bin + 2]!;
          C[ic + 3] = lut[bin + 3]!;
        }
        ox = qx;
        oy = qy;
        oz = qz;
      }
      px = qx;
      py = qy;
      n++;
      seg++;
    }
    c.gCount[g] = n;
    c.ex[g] = px;
    c.ey[g] = py;
    c.len[g] = n * ds;
  }
  if (write) {
    // The halo underlay is a second StreakBatch with the same geometry: copy, do not recompute.
    c.A2.set(A.subarray(0, 3 * seg));
    c.B2.set(B.subarray(0, 3 * seg));
  }
  c.calls = calls;
  c.total = seg;
  return seg;
}

/** An independently compiled copy of a function: its type feedback is not shared with any other copy. */
function fresh<T extends (...a: never[]) => unknown>(fn: T): T {
  return new Function(`"use strict"; return (${fn.toString()});`)() as T;
}

const COLOUR_SCRATCH: Rgb = [0, 0, 0];
function naiveColour(speed: number, C: Float32Array, o: number): void {
  sampleRamp(WIND_RAMP, speed, COLOUR_SCRATCH);
  C[o] = srgbToLinear(COLOUR_SCRATCH[0]);
  C[o + 1] = srgbToLinear(COLOUR_SCRATCH[1]);
  C[o + 2] = srgbToLinear(COLOUR_SCRATCH[2]);
  C[o + 3] = 0.95;
}

function makeLut(): Float32Array {
  const lut = new Float32Array(64 * 4);
  const c: Rgb = [0, 0, 0];
  for (let b = 0; b < 64; b++) {
    sampleRamp(WIND_RAMP, (b / 63) * 25, c);
    lut[4 * b] = srgbToLinear(c[0]);
    lut[4 * b + 1] = srgbToLinear(c[1]);
    lut[4 * b + 2] = srgbToLinear(c[2]);
    lut[4 * b + 3] = 0.95;
  }
  return lut;
}
const LUT = makeLut();

function makeCtx(field: GlyphField, cap: number, segs: number, dom: Dom): TraceCtx {
  if (segs > 12) throw new Error('at most 12 segments per glyph (plan 9.3)');
  const nSeg = cap * 12;
  return {
    field,
    n: 0,
    segs,
    sx: new Float64Array(cap),
    sy: new Float64Array(cap),
    smpp: new Float64Array(cap),
    dom: Float64Array.of(dom.x0, dom.x1, dom.y0, dom.y1),
    minPx: 8,
    maxPx: 56,
    pxPerMs: 4,
    calm: 0.3,
    vex: 1,
    write: true,
    naive: false,
    colourFn: null,
    A: new Float32Array(3 * nSeg),
    B: new Float32Array(3 * nSeg),
    C: new Float32Array(4 * nSeg),
    A2: new Float32Array(3 * nSeg),
    B2: new Float32Array(3 * nSeg),
    gStart: new Int32Array(cap),
    gCount: new Int32Array(cap),
    ex: new Float64Array(cap),
    ey: new Float64Array(cap),
    len: new Float64Array(cap),
    lut: LUT,
    lutScale: 63 / 25,
    near: Float64Array.of(0, -1, 0, 1e6),
    w: new Float32Array(3),
    pos: new Float64Array(3),
    calls: 0,
    total: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Rigs: one configured rebuild (seeds + trace) per variant
// ─────────────────────────────────────────────────────────────────────────────────────────────────

type Kind = 'v1' | 'v2' | 'v2uv' | 'v2t' | 'v2p' | 'r1' | 'r2';
const KIND_LABEL: Record<Kind, string> = {
  v1: 'today (u,v,w; flat view; plan API)',
  v2: 'plan 7.2 (u,v,w; plan API)',
  v2uv: 'plan 7.2, u,v only',
  v2t: 'u,v + level table',
  v2p: 'u,v hand-inlined, no boxing',
  r1: 'raster 1x',
  r2: 'raster 2x',
};

const VIEWPORT = { w: 412, h: 868 }; // CSS px, a phone in portrait (the plan's 412 px wide screen)
const MARGIN = 1.5; // plan 9.3: bounding box plus 25 % margin on each side
const VFOV = (50 * Math.PI) / 180;
const PXM = (2 * Math.tan(VFOV / 2)) / VIEWPORT.h; // radians per pixel (uPixelMetres at distance 1)

interface RigCfg {
  c: Case;
  kind: Kind;
  cap: number;
  segs: number;
  /** Height above ground (m). */
  h: number;
  /** Size of one model cell on screen (px): sets metres per pixel (plan: L3 is 32 to 90). */
  cellPx: number;
  /** Variants for the cost split. */
  write?: boolean;
  naive?: boolean;
  replay?: Float32Array;
  record?: boolean;
  /** Always use box 0 (needed by the replay). */
  fixedBox?: boolean;
  /** Use this field instead of building one from `kind`. */
  field?: GlyphField;
}

interface Rig {
  cfg: RigCfg;
  field: GlyphField;
  ctx: TraceCtx;
  trace: (c: TraceCtx) => number;
  seeds: Seeds;
  spacing: number;
  boxW: number;
  boxH: number;
  mpp0: number;
  /** seeds + trace for the i-th view box */
  rebuild: (i: number) => number;
  seedOnly: (i: number) => number;
  raster?: FieldRaster;
  direct?: GlyphField;
  record?: FieldRecord;
}

function samplersOf(c: Case): { v1: AtmosphereSampler; s2: SamplerV2; s2t: SamplerV2T; dem: Dem } {
  c.v1 ??= new AtmosphereSampler(c.flat, c.tf.baseM, null);
  c.s2 ??= new SamplerV2(c.tf);
  c.s2t ??= new SamplerV2T(c.tf);
  c.dem ??= new Dem(c.hf);
  return { v1: c.v1, s2: c.s2, s2t: c.s2t, dem: c.dem };
}

function halton(i: number, b: number): number {
  let fr = 1;
  let r = 0;
  let k = i + 1;
  while (k > 0) {
    fr /= b;
    r += fr * (k % b);
    k = Math.floor(k / b);
  }
  return r;
}

const N_BOXES = 16;

function makeRig(cfg: RigCfg): Rig {
  const { c, kind } = cfg;
  const sm = samplersOf(c);
  let field: GlyphField;
  let raster: FieldRaster | undefined;
  let direct: GlyphField | undefined;
  if (cfg.field) field = cfg.field;
  else if (kind === 'v1') field = new FieldV1(c.hf, sm.v1, cfg.h);
  else if (kind === 'v2') field = new FieldV2(c.hf, sm.s2, cfg.h);
  else if (kind === 'v2uv') field = new FieldV2uv(c.hf, sm.s2, cfg.h);
  else if (kind === 'v2t') field = new FieldV2t(c.hf, sm.s2t, cfg.h);
  else if (kind === 'v2p') field = new FieldV2P(sm.dem, c.tf, cfg.h);
  else {
    direct = new FieldV2P(sm.dem, c.tf, cfg.h);
    raster = new FieldRaster(sm.dem, c.tf.grid, kind === 'r1' ? 1 : 2);
    raster.build(direct);
    field = raster;
  }
  let recorder: FieldRecord | undefined;
  if (cfg.record) {
    recorder = new FieldRecord(field, cfg.cap * 2 * 12 + 16);
    field = recorder;
  }
  if (cfg.replay) field = new FieldReplay(cfg.replay);
  const ctx = makeCtx(field, cfg.cap, cfg.segs, c.dom);
  ctx.write = cfg.write ?? true;
  ctx.naive = cfg.naive ?? false;
  ctx.colourFn = cfg.naive ? naiveColour : null;
  const trace = fresh(traceGlyphs);
  const seeds: Seeds = { sx: ctx.sx, sy: ctx.sy, smpp: ctx.smpp };
  // View: phone portrait, top-down, one model cell = cellPx pixels.
  const mpp0 = c.dx / cfg.cellPx;
  const camH = mpp0 / PXM;
  const domW = c.dom.x1 - c.dom.x0;
  const domH = c.dom.y1 - c.dom.y0;
  const boxW = Math.min(VIEWPORT.w * mpp0 * MARGIN, 0.92 * domW);
  const boxH = Math.min(VIEWPORT.h * mpp0 * MARGIN, 0.92 * domH);
  // Lattice: the largest power of two that still holds `cap` points in the box.
  const S = 2 ** Math.floor(Math.log2(Math.sqrt((boxW * boxH) / (cfg.cap * 1.05))));
  const cx: number[] = [];
  const cy: number[] = [];
  for (let k = 0; k < N_BOXES; k++) {
    cx.push(c.dom.x0 + boxW / 2 + halton(k, 2) * (domW - boxW));
    cy.push(c.dom.y0 + boxH / 2 + halton(k, 3) * (domH - boxH));
  }
  const seedOnly = (i: number): number => {
    const k = cfg.fixedBox ? 0 : i % N_BOXES;
    return seedLattice(seeds, cx[k]! - boxW / 2, cy[k]! - boxH / 2, cx[k]! + boxW / 2, cy[k]! + boxH / 2, S, cfg.cap, c.dom, cx[k]!, cy[k]!, camH, PXM);
  };
  const rebuild = (i: number): number => {
    const n = seedOnly(i);
    ctx.n = n;
    if (cfg.replay) (field as FieldReplay).idx = 0;
    return trace(ctx);
  };
  const rig: Rig = { cfg, field, ctx, trace, seeds, spacing: S, boxW, boxH, mpp0, rebuild, seedOnly };
  if (raster) {
    rig.raster = raster;
    rig.direct = direct;
  }
  if (recorder) rig.record = recorder;
  return rig;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Micro-benchmark loops (used through fresh copies too)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function windLoop(field: GlyphField, xs: Float64Array, ys: Float64Array, n: number, reps: number, pos: Float64Array, out: Float32Array): number {
  let s = 0;
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < n; i++) {
      pos[0] = xs[i]!;
      pos[1] = ys[i]!;
      field.windP(pos, out);
      s += out[0]!;
    }
  }
  return s;
}
function groundLoop(field: GlyphField, xs: Float64Array, ys: Float64Array, n: number, reps: number, pos: Float64Array): number {
  let s = 0;
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < n; i++) {
      pos[0] = xs[i]!;
      pos[1] = ys[i]!;
      field.groundP(pos);
      s += pos[2]!;
    }
  }
  return s;
}

/** ns per call of a loop (best of several trials: the least disturbed one). */
function nsPerCall(run: () => number, calls: number, trials = 7): { ns: number; sink: number } {
  let best = Infinity;
  let sink = 0;
  run();
  run();
  for (let t = 0; t < trials; t++) {
    const t0 = performance.now();
    sink += run();
    best = Math.min(best, ((performance.now() - t0) * 1e6) / calls);
  }
  return { ns: best, sink };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The spike
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const CASES: { name: string; label: string; tier: 'standard' | 'high'; extent: number }[] = [
  { name: 'std6', label: 'standard 6 km', tier: 'standard', extent: 6000 },
  { name: 'std12', label: 'standard 12 km', tier: 'standard', extent: 12000 },
  { name: 'high6', label: 'high 6 km', tier: 'high', extent: 6000 },
  { name: 'high12', label: 'high 12 km', tier: 'high', extent: 12000 },
];

const MATRIX_KINDS: Kind[] = ['v1', 'v2', 'v2uv', 'v2p', 'r1', 'r2'];

describe.skipIf(!ENABLED)('S3 glyph benchmark (FIRESIM_SPIKE)', () => {
  const cases = new Map<string, Case>();
  const std6 = (): Case => cases.get('std6')!;
  let loadStart = '';

  beforeAll(async () => {
    gcObserver.observe({ entryTypes: ['gc'] });
    loadStart = loadavg();
    log('S3 glyph benchmark: sampler v1/v2, glyph tracer, raster alternative');
    log(`date ${new Date().toISOString()}  node ${process.version}  v8 ${process.versions.v8}  ${process.platform}/${process.arch}`);
    const cp = cpus();
    log(`cpu ${cp[0]?.model ?? '?'} x${cp.length}  memory ${(totalmem() / 2 ** 30).toFixed(1)} GiB`);
    log(`load average at start: ${loadStart}  (limit for a timed series: ${MAX_LOAD}, attempts ${ATTEMPTS})`);
    log(`mode ${QUICK ? 'QUICK (not for the note)' : 'full'}: warm-up ${WARM}, timed rebuilds ${REPS} (headline ${REPS_HEAD}), spin-up ${SPIN_S} s of model time`);
    log();
    for (const d of CASES) {
      if (CASE_FILTER && !CASE_FILTER.includes(d.name)) continue;
      const c = await buildCase(d.name, d.label, d.tier, d.extent);
      cases.set(d.name, c);
      log(`built ${d.label}: ${c.nx}x${c.ny}x${c.nz} columns, dx ${f(c.dx, 1)} m, H' ${f(c.tf.topM, 0)} m, datum ${f(c.tf.baseM, 0)} m ASL, ${c.steps} steps in ${f(c.buildS, 1)} s`);
    }
    log();
  }, 1_800_000);

  afterAll(() => {
    log();
    log(`load average at end: ${loadavg()}  (start: ${loadStart})`);
    const file = process.env.FIRESIM_SPIKE_OUT;
    if (file) writeFileSync(file, OUT.join('\n') + '\n');
    const json = process.env.FIRESIM_SPIKE_JSON;
    if (json) writeFileSync(json, JSON.stringify(RES, null, 1));
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('00 cold start: the first rebuilds of a fresh tracer (JIT warm-up, standard 6 km, 2000 x 10)', async () => {
    log('== 00 cold start (sampler and tracer are compiled from scratch in this process; standard 6 km, 2000 x 10)');
    const c = std6();
    const res: Record<string, unknown> = {};
    for (const kind of ['v2p', 'r1'] as Kind[]) {
      const rig = makeRig({ c, kind, cap: 2000, segs: 10, h: 100, cellPx: 40 });
      const first: number[] = [];
      for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        rig.rebuild(i);
        first.push(performance.now() - t0);
      }
      const steady = await timedSeries(rig.rebuild, 30, 20);
      log(`${kind}: first 12 rebuilds (ms): ${first.map((x) => f(x, 1)).join(' ')}; steady median ${f(steady.sum.median)} ms; first = ${f(first[0]! / steady.sum.median, 1)}x`);
      res[kind] = { first, steadyMedian: steady.sum.median };
      expect(first[0]).toBeGreaterThan(0);
    }
    log();
    RES['cold'] = res;
  }, 600_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('01 the data: real views', () => {
    log('== 01 data');
    const rows: string[][] = [['case', 'columns', 'dx (m)', 'levels', "H' (m)", 'relief (m)', 'speed at 100 m above the render DEM: mean / max (m/s)', 'flat view MB', 'native MB']];
    for (const c of cases.values()) {
      let relief = 0;
      for (let k = 0; k < c.tf.terrainHeight.length; k++) relief = Math.max(relief, c.tf.terrainHeight[k]!);
      const s2 = samplersOf(c).s2;
      const out = new Float32Array(3);
      let sum = 0;
      let mx = 0;
      let n = 0;
      for (let j = 0; j < 40; j++) {
        for (let i = 0; i < 40; i++) {
          const x = c.dom.x0 + ((i + 0.5) / 40) * (c.dom.x1 - c.dom.x0);
          const y = c.dom.y0 + ((j + 0.5) / 40) * (c.dom.y1 - c.dom.y0);
          s2.wind3(x, y, c.hf.heightAt(x, y) + 100, out);
          const sp = Math.hypot(out[0]!, out[1]!);
          sum += sp;
          mx = Math.max(mx, sp);
          n++;
        }
      }
      const flatMb = (c.flat.u.byteLength * 5) / 1e6;
      const natMb = (c.tf.u.byteLength * 3) / 1e6;
      rows.push([c.label, `${c.nx}x${c.ny}`, f(c.dx, 0), String(c.nz), f(c.tf.topM, 0), f(relief, 0), `${f(sum / n, 1)} / ${f(mx, 1)}`, f(flatMb, 2), f(natMb, 2)]);
      expect(sum / n).toBeGreaterThan(0.5);
    }
    table(rows);
    log('flat view MB counts u, v, w, theta, smoke; native MB counts the three wind arrays the sampler reads.');
    log();
  });

  it('02 sampler v2 against the engine oracle, v1 and the variants', () => {
    log('== 02 sampler correctness (random points, heights 5 m to 2 km above the engine ground, 6000 per case)');
    const rows: string[][] = [['case', 'v2 vs engine.sample: max |du,dv,dw| m/s', 'v2t vs v2 max m/s', 'v2p vs v2 max m/s', 'v1 vs engine: mean |dU| at 50 m', 'v1 vs engine at 100 m', 'v2 vs engine at 50 m']];
    for (const c of cases.values()) {
      const sm = samplersOf(c);
      const eng = c.engine as unknown as { groundAt(x: number, y: number): number; sample(x: number, y: number, z: number, o: Float32Array): void };
      const rng = new Rng(11);
      const o1 = new Float32Array(3);
      const o2 = new Float32Array(3);
      const o3 = new Float32Array(3);
      const o4 = new Float32Array(3);
      const o5 = new Float32Array(3);
      const pos = new Float64Array(3);
      let maxV2 = 0;
      let maxT = 0;
      let maxP = 0;
      const v1Err: Record<number, number> = { 50: 0, 100: 0 };
      const v2Err: Record<number, number> = { 50: 0, 100: 0 };
      let cnt = 0;
      for (let q = 0; q < 6000; q++) {
        const x = c.tf.grid.x0 + rng.next() * (c.nx - 1) * c.tf.grid.cellSize;
        const y = c.tf.grid.y0 + rng.next() * (c.ny - 1) * c.tf.grid.cellSize;
        const agl = q % 3 === 0 ? 5 + rng.next() * 2000 : q % 3 === 1 ? 50 : 100;
        const zAsl = eng.groundAt(x, y) + agl;
        eng.sample(x, y, agl, o1);
        sm.s2.wind3(x, y, zAsl, o2);
        sm.s2t.wind2(x, y, zAsl, o3);
        maxV2 = Math.max(maxV2, Math.abs(o1[0]! - o2[0]!), Math.abs(o1[1]! - o2[1]!), Math.abs(o1[2]! - o2[2]!));
        maxT = Math.max(maxT, Math.abs(o3[0]! - o2[0]!), Math.abs(o3[1]! - o2[1]!));
        // v2p against v2uv at the same render-DEM height (h = agl above the render DEM)
        pos[0] = x;
        pos[1] = y;
        new FieldV2P(sm.dem, c.tf, agl).windP(pos, o5);
        new FieldV2uv(c.hf, sm.s2, agl).windP(pos, o4);
        maxP = Math.max(maxP, Math.abs(o5[0]! - o4[0]!), Math.abs(o5[1]! - o4[1]!));
        if (agl === 50 || agl === 100) {
          sm.v1.wind(x, y, zAsl, agl, o4);
          v1Err[agl]! += Math.hypot(o4[0]! - o1[0]!, o4[1]! - o1[1]!);
          v2Err[agl]! += Math.hypot(o2[0]! - o1[0]!, o2[1]! - o1[1]!);
          if (agl === 50) cnt++;
        }
      }
      rows.push([c.label, f(maxV2, 5), f(maxT, 6), f(maxP, 6), f(v1Err[50]! / cnt, 3), f(v1Err[100]! / cnt, 3), f(v2Err[50]! / cnt, 5)]);
      expect(maxV2).toBeLessThan(2e-3);
      expect(maxT).toBeLessThan(1e-3);
      expect(maxP).toBeLessThan(1e-3);
    }
    table(rows);
    log('The engine ground (30 m fire grid, bilinear) gives zAsl for the engine comparison so that every sampler sees the same input.');
    log('v2p vs v2 is compared at heights above the render DEM. v1 differs from the engine near the ground because the flat view holds zeros below the terrain.');
    log();
  });

  it('03 tracer checks on analytic fields (straight, rotation, arc length, calm, edge, determinism)', () => {
    log('== 03 tracer checks');
    const dom: Dom = { x0: -3000, x1: 3000, y0: -3000, y1: 3000 };
    const run = (fn: (x: number, y: number, o: Float32Array) => void, seeds: [number, number][], segs: number, mpp: number, d = dom): TraceCtx => {
      const ctx = makeCtx(new FieldFn(fn), seeds.length, segs, d);
      seeds.forEach(([x, y], i) => {
        ctx.sx[i] = x;
        ctx.sy[i] = y;
        ctx.smpp[i] = mpp;
      });
      ctx.n = seeds.length;
      fresh(traceGlyphs)(ctx);
      return ctx;
    };
    // 1. Uniform wind: straight, equal segments.
    const uni = run((_x, _y, o) => { o[0] = 6; o[1] = 8; }, [[0, 0], [100, -50]], 10, 3.3);
    let dev = 0;
    let lenErr = 0;
    const ds = (40 * 3.3) / 10; // 10 m/s x 4 px = 40 px
    for (let k = 0; k < 10; k++) {
      const ax = uni.A[3 * k]!;
      const ay = -uni.A[3 * k + 2]!;
      const bx = uni.B[3 * k]!;
      const by = -uni.B[3 * k + 2]!;
      dev = Math.max(dev, Math.abs((bx - ax) * 0.8 - (by - ay) * 0.6));
      lenErr = Math.max(lenErr, Math.abs(Math.hypot(bx - ax, by - ay) - ds) / ds);
    }
    log(`uniform wind: max sideways deviation of a segment ${f(dev, 6)} m, max arc-length error ${f(lenErr * 100, 4)} %`);
    expect(dev).toBeLessThan(1e-3);
    expect(lenErr).toBeLessThan(1e-3);
    // 2. Solid-body rotation about (500, 0): radius recovered.
    const om = 0.02;
    const rot = run((x, y, o) => { o[0] = -om * y; o[1] = om * (x - 500); }, [[800, 0]], 12, 5);
    let rMax = 0;
    for (let k = 0; k < rot.gCount[0]!; k++) rMax = Math.max(rMax, Math.abs(Math.hypot(rot.B[3 * k]! - 500, -rot.B[3 * k + 2]!) - 300) / 300);
    log(`solid-body rotation, radius 300 m, ${rot.gCount[0]} segments: worst radius error ${f(rMax * 100, 4)} % (plan: within 1 %)`);
    expect(rMax).toBeLessThan(0.01);
    // 3. Calm: dots. 4. Edge: stops at the domain edge. 5. Determinism: byte-identical output.
    const calm = run((_x, _y, o) => { o[0] = 0.1; o[1] = 0; }, [[0, 0], [10, 10]], 10, 3);
    log(`calm field: segments per glyph ${calm.gCount[0]} and ${calm.gCount[1]} (a dot is one segment)`);
    expect(calm.gCount[0]).toBe(1);
    const edge = run((_x, _y, o) => { o[0] = 10; o[1] = 0; }, [[2950, 0]], 10, 3.3);
    let outside = 0;
    for (let k = 0; k < edge.gCount[0]!; k++) if (edge.B[3 * k]! > 3000) outside++;
    log(`seed 50 m from the east edge, wind east: ${edge.gCount[0]} of 10 segments written, ${outside} beyond the edge`);
    expect(edge.gCount[0]!).toBeLessThan(10);
    expect(outside).toBe(0);
    const a1 = run((x, y, o) => { o[0] = -om * y; o[1] = om * (x - 500); }, [[800, 0], [100, 100]], 10, 5);
    const a2 = run((x, y, o) => { o[0] = -om * y; o[1] = om * (x - 500); }, [[800, 0], [100, 100]], 10, 5);
    const same = Buffer.from(a1.A.buffer).equals(Buffer.from(a2.A.buffer)) && Buffer.from(a1.C.buffer).equals(Buffer.from(a2.C.buffer));
    log(`determinism: two runs give identical arrays: ${same}`);
    expect(same).toBe(true);
    // 6. Seeds: a seed depends only on its lattice indices, not on the box.
    const c = std6();
    const rig = makeRig({ c, kind: 'v2p', cap: 100000, segs: 6, h: 100, cellPx: 40 });
    const nBig = rig.seedOnly(0);
    const set = new Set<string>();
    for (let k = 0; k < nBig; k++) set.add(`${rig.seeds.sx[k]!.toFixed(6)},${rig.seeds.sy[k]!.toFixed(6)}`);
    const nShift = rig.seedOnly(1);
    let shared = 0;
    for (let k = 0; k < nShift; k++) if (set.has(`${rig.seeds.sx[k]!.toFixed(6)},${rig.seeds.sy[k]!.toFixed(6)}`)) shared++;
    log(`seeds without a cap: box 0 has ${nBig} seeds (spacing ${rig.spacing} m); box 1 has ${nShift}, of which ${shared} are points that box 0 also holds (the overlap of the two boxes)`);
    expect(shared).toBeGreaterThan(0);
    log();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('04 ns per sampler call', () => {
    log('== 04 ns per call (best of 7 trials of 1 million calls). windAt = render-DEM lookup + sampler at DEM + 100 m.');
    const c = std6();
    const N = 50_000;
    const reps = QUICK ? 4 : 20;
    const rng = new Rng(5);
    const rx = new Float64Array(N);
    const ry = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      rx[i] = c.dom.x0 + rng.next() * (c.dom.x1 - c.dom.x0);
      ry[i] = c.dom.y0 + rng.next() * (c.dom.y1 - c.dom.y0);
    }
    // Coherent positions: the request stream of a real 2000 x 10 rebuild.
    const rec = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h: 100, cellPx: 40, record: true, fixedBox: true });
    rec.rebuild(0);
    const nTrace = rec.record!.idx;
    const tx = rec.record!.xs.slice(0, nTrace);
    const ty = rec.record!.ys.slice(0, nTrace);
    const out = new Float32Array(3);
    const pos = new Float64Array(3);
    const kinds: Kind[] = ['v1', 'v2', 'v2uv', 'v2t', 'v2p', 'r1', 'r2'];
    const rb = Math.ceil((N * reps) / nTrace);
    const rows: string[][] = [['windAt', 'random positions ns', `as traced (${nTrace} requests) ns`]];
    const res: Record<string, { random: number; traced: number }> = {};
    const fields = kinds.map((k) => [k, makeRig({ c, kind: k, cap: 100, segs: 6, h: 100, cellPx: 40 }).field] as const);
    const demNaive = fields[0]![1];
    const demInline = fields[4]![1];
    for (const [name, fld] of [['DEM lookup only, HeightField.heightAt (plan API)', demNaive], ['DEM lookup only, scratch-array convention', demInline]] as const) {
      const gl1 = fresh(groundLoop);
      const gl2 = fresh(groundLoop);
      const a = nsPerCall(() => gl1(fld, rx, ry, N, reps, pos), N * reps);
      const b = nsPerCall(() => gl2(fld, tx, ty, nTrace, rb, pos), nTrace * rb);
      rows.push([name, f(a.ns, 1), f(b.ns, 1)]);
      res[name] = { random: a.ns, traced: b.ns };
    }
    for (const [kind, fld] of fields) {
      const loopA = fresh(windLoop);
      const loopB = fresh(windLoop);
      const a = nsPerCall(() => loopA(fld, rx, ry, N, reps, pos, out), N * reps);
      const b = nsPerCall(() => loopB(fld, tx, ty, nTrace, rb, pos, out), nTrace * rb);
      rows.push([`${kind}  ${KIND_LABEL[kind]}`, f(a.ns, 1), f(b.ns, 1)]);
      res[kind] = { random: a.ns, traced: b.ns };
    }
    table(rows);
    const v2 = res['v2']!;
    log(`plan 7.2 claim "1300 to 2600 particles per frame, well under 1 ms": 2600 samples x ${f(v2.traced, 0)} ns = ${f((2600 * v2.traced) / 1e6, 2)} ms (this machine, plan API incl. the DEM lookup)`);
    log();
    RES['nsPerCall'] = res;
  }, 600_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('05 rebuild matrix: caps 600/1200/2000 x segments 6/10/12, every variant (standard 6 km)', async () => {
    log('== 05 rebuild matrix: standard 6 km, h = 100 m, one model cell = 40 px, phone portrait view with 25 % margin');
    const c = std6();
    const rows: string[][] = [['glyphs x segs', 'variant', 'glyphs', 'segments', 'calls', 'min ms', 'median ms', 'p95 ms', 'max ms', 'load', 'cpu/wall']];
    const out: Record<string, unknown> = {};
    for (const cap of [600, 1200, 2000]) {
      for (const segs of [6, 10, 12]) {
        for (const kind of MATRIX_KINDS) {
          const rig = makeRig({ c, kind, cap, segs, h: 100, cellPx: 40 });
          const head = cap === 2000 && segs === 10;
          const s = await timedSeries(rig.rebuild, head ? REPS_HEAD : REPS);
          rows.push([`${cap} x ${segs}`, kind, String(rig.ctx.n), String(rig.ctx.total), String(rig.ctx.calls), f(s.sum.min), f(s.sum.median), f(s.sum.p95), f(s.sum.max), `${f(load1(s.load0), 1)}/${f(load1(s.load1), 1)}${s.loadOk ? '' : '!'}`, f(s.cpuWall, 2)]);
          out[`${kind}:${cap}x${segs}`] = { ...s.sum, glyphs: rig.ctx.n, segments: rig.ctx.total, calls: rig.ctx.calls, load0: s.load0, load1: s.load1, cpuWall: s.cpuWall, othersMs: s.othersMs, stealMs: s.stealMs, wallMs: s.wallMs, attempts: s.attempts, loadOk: s.loadOk, gcMinor: s.gcMinor, gcMajor: s.gcMajor, gcMs: s.gcMs, gcHits: s.gcHits };
        }
      }
    }
    table(rows);
    log('glyphs, segments and calls are for the last rebuild. load = 1-minute average before/after the series ("!" = above the limit after all attempts); cpu/wall = CPU time of this process over wall time (below 1 = descheduled).');
    log('r1 and r2 rows are the trace only: the raster is built once per snapshot or height change (see 07).');
    log();
    RES['matrix'] = out;
  }, 3_600_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('06 cost split of one 2000 x 10 rebuild', async () => {
    log('== 06 cost split, standard 6 km, 2000 glyphs x 10 segments, fixed box');
    const c = std6();
    const res: Record<string, unknown> = {};
    for (const kind of ['v2uv', 'v2p'] as Kind[]) {
      const cfg = { c, kind, cap: 2000, segs: 10, h: 100, cellPx: 40, fixedBox: true };
      const recRig = makeRig({ ...cfg, record: true });
      recRig.rebuild(0);
      const rec = recRig.record!;
      const nCalls = rec.idx;
      const uv = rec.uv.slice(0, 2 * nCalls);
      const full = makeRig(cfg);
      const noWrite = makeRig({ ...cfg, write: false });
      const replay = makeRig({ ...cfg, write: false, replay: uv });
      const sFull = await timedSeries(full.rebuild, REPS_HEAD);
      const sNoW = await timedSeries(noWrite.rebuild, REPS_HEAD);
      const sRep = await timedSeries(replay.rebuild, REPS_HEAD);
      const sSeed = await timedSeries((i) => full.seedOnly(i), REPS_HEAD);
      const naive = makeRig({ ...cfg, naive: true });
      const sNaive = await timedSeries(naive.rebuild, REPS_HEAD);
      // Sampler alone on the recorded request stream.
      const loop = fresh(windLoop);
      const o = new Float32Array(3);
      const pos = new Float64Array(3);
      const xs = rec.xs.slice(0, nCalls);
      const ys = rec.ys.slice(0, nCalls);
      const samp = nsPerCall(() => loop(full.field, xs, ys, nCalls, 1, pos, o), nCalls, 25);
      const m = (s: Series): number => s.sum.median;
      const mn = (s: Series): number => s.sum.min;
      const out = m(sFull) - m(sNoW);
      const sampler = m(sNoW) - m(sRep);
      const arith = m(sRep) - m(sSeed);
      log(`-- ${kind}: ${KIND_LABEL[kind]}`);
      table([
        ['part', 'median ms', 'min ms', 'share of median'],
        ['seeds (lattice, hash, thinning, metres per pixel)', f(m(sSeed), 3), f(mn(sSeed), 3), `${f((100 * m(sSeed)) / m(sFull), 0)} %`],
        ['tracing arithmetic (RK2, normalising, edge test, loop)', f(arith, 3), f(mn(sRep) - mn(sSeed), 3), `${f((100 * arith) / m(sFull), 0)} %`],
        [`sampler calls (${nCalls} x windAt incl. DEM lookup)`, f(sampler, 3), f(mn(sNoW) - mn(sRep), 3), `${f((100 * sampler) / m(sFull), 0)} %`],
        ['output (DEM lift, vertex write, colour table, near plane, halo copy)', f(out, 3), f(mn(sFull) - mn(sNoW), 3), `${f((100 * out) / m(sFull), 0)} %`],
        ['total rebuild', f(m(sFull), 3), f(mn(sFull), 3), '100 %'],
      ]);
      log(`replaying the ${nCalls} recorded requests through windAt alone: ${f(samp.ns, 1)} ns per call = ${f((samp.ns * nCalls) / 1e6, 3)} ms (the sampler line by subtraction: ${f((sampler / nCalls) * 1e6, 1)} ns per call)`);
      log(`segments written ${full.ctx.total}; output floats ${full.ctx.total * 10} (A, B, C) + ${full.ctx.total * 6} (halo copy A2, B2)`);
      log(`colour by sampleRamp + srgbToLinear per segment (as WindLayer does per streak) instead of the table: median ${f(m(sNaive), 3)} ms (${m(sNaive) >= m(sFull) ? '+' : ''}${f(m(sNaive) - m(sFull), 3)} ms)`);
      log();
      res[kind] = { seeds: m(sSeed), arith, sampler, output: out, total: m(sFull), calls: nCalls, replayNs: samp.ns, naiveColour: m(sNaive), segments: full.ctx.total };
    }
    RES['split'] = res;
  }, 1_800_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('07 raster alternative: build cost and what it gives up', async () => {
    log('== 07 raster alternative (all grids), 2000 glyphs x 10 segments, h = 100 m');
    const rows: string[][] = [['case', 'raster', 'texels', 'build median ms', 'build p95 ms', 'trace median ms', 'trace p95 ms', 'new snapshot: build + trace median ms', 'direct v2p median ms', 'direct v2p p95 ms']];
    const resRaster: Record<string, unknown> = {};
    for (const c of cases.values()) {
      const direct = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h: 100, cellPx: 40 });
      const sD = await timedSeries(direct.rebuild, REPS_HEAD);
      for (const kind of ['r1', 'r2'] as Kind[]) {
        const rig = makeRig({ c, kind, cap: 2000, segs: 10, h: 100, cellPx: 40 });
        const R = rig.raster!;
        const sB = await timedSeries(() => {
          R.build(rig.direct!);
          return 0;
        }, REPS);
        const sT = await timedSeries(rig.rebuild, REPS_HEAD);
        rows.push([c.label, kind === 'r1' ? '1x (model grid)' : '2x finer', String(R.nr * R.nr), f(sB.sum.median, 3), f(sB.sum.p95, 3), f(sT.sum.median, 3), f(sT.sum.p95, 3), f(sB.sum.median + sT.sum.median, 3), f(sD.sum.median, 3), f(sD.sum.p95, 3)]);
        resRaster[`${c.name}:${kind}`] = { texels: R.nr * R.nr, build: sB.sum, trace: sT.sum, direct: sD.sum };
      }
    }
    table(rows);
    log();
    RES['raster'] = resRaster;

    // Accuracy: end points of the raster-traced glyphs against the direct sampler, same seeds, same rules.
    log('-- accuracy: distance between the end point of each glyph traced through the raster and through the direct v2 sampler');
    log('   (2000 glyphs x 10 segments in each of 16 view boxes; same seeds and rules; px = distance / the glyph\'s own metres per pixel;');
    log('    cell = size of one model cell on screen; length = mean path length of the direct glyphs)');
    const acc: string[][] = [['case', 'h (m)', 'cell (px)', 'raster', 'length m', 'mean m', 'p95 m', 'max m', 'mean % of length', 'mean px', 'p95 px', 'max px', 'glyphs']];
    const resAcc: Record<string, unknown> = {};
    for (const c of cases.values()) {
      for (const h of [10, 50, 100, 300]) {
        for (const cellPx of [32, 60, 90]) {
          if (c.name !== 'std6' && !(h === 100 && cellPx === 60) && !(h === 10 && cellPx === 60)) continue;
          if (c.name === 'std6' && h === 300 && cellPx !== 60) continue;
          const direct = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h, cellPx, write: false });
          for (const kind of ['r1', 'r2'] as Kind[]) {
            const rg = makeRig({ c, kind, cap: 2000, segs: 10, h, cellPx, write: false });
            const d: number[] = [];
            const dPx: number[] = [];
            const rel: number[] = [];
            const lens: number[] = [];
            for (let b = 0; b < N_BOXES; b++) {
              direct.rebuild(b);
              rg.rebuild(b);
              const nG = direct.ctx.n;
              expect(rg.ctx.n).toBe(nG);
              for (let k = 0; k < nG; k++) {
                const dd = Math.hypot(rg.ctx.ex[k]! - direct.ctx.ex[k]!, rg.ctx.ey[k]! - direct.ctx.ey[k]!);
                const len = direct.ctx.len[k]!;
                d.push(dd);
                dPx.push(dd / direct.ctx.smpp[k]!);
                lens.push(len);
                rel.push(len > 1 ? dd / len : 0);
              }
            }
            const sd = summarise(d);
            const sp = summarise(dPx);
            const meanLen = lens.reduce((a, x) => a + x, 0) / lens.length;
            const meanRel = rel.reduce((a, x) => a + x, 0) / rel.length;
            acc.push([c.label, String(h), String(cellPx), kind === 'r1' ? '1x' : '2x', f(meanLen, 0), f(sd.mean, 1), f(sd.p95, 1), f(sd.max, 0), f(meanRel * 100, 1), f(sp.mean, 2), f(sp.p95, 2), f(sp.max, 1), String(d.length)]);
            resAcc[`${c.name}:h${h}:cell${cellPx}:${kind}`] = { mean: sd.mean, p95: sd.p95, max: sd.max, meanRelPct: meanRel * 100, meanPx: sp.mean, p95Px: sp.p95, maxPx: sp.max, meanLen };
          }
        }
      }
    }
    table(acc);
    log();
    RES['rasterAccuracy'] = resAcc;
  }, 3_600_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('08 allocation per steady-state rebuild (2000 x 10, standard 6 km)', async () => {
    log('== 08 allocation per rebuild (heap growth over a few rebuilds with no GC in between; the cost of reading the heap size is subtracted)');
    const c = std6();
    const rows: string[][] = [['variant', 'bytes per rebuild', 'bytes per sampler call', 'GC events in a 300-rebuild series (minor / major / ms)', 'rebuilds that overlapped a GC']];
    const res: Record<string, unknown> = {};
    const measure = async (rebuild: (i: number) => number): Promise<number> => {
      for (let i = 0; i < 80; i++) rebuild(i);
      for (const reps of [3, 2, 1]) {
        gc();
        gc();
        await flushGc();
        const e0 = gcEvents.length;
        const h0 = process.memoryUsage().heapUsed;
        const h00 = process.memoryUsage().heapUsed;
        const overhead = h00 - h0;
        const a = process.memoryUsage().heapUsed;
        for (let i = 0; i < reps; i++) rebuild(100 + i);
        const b = process.memoryUsage().heapUsed;
        await flushGc();
        if (gcEvents.length === e0) return (b - a - overhead) / reps;
      }
      return NaN;
    };
    const rigSeed = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h: 100, cellPx: 40 });
    const seedBytes = await measure((i) => rigSeed.seedOnly(i));
    rows.push(['seeds only (lattice, hash, thinning)', f(seedBytes, 0), '-', '-', '-']);
    res['seeds'] = { bytes: seedBytes };
    for (const kind of ['v1', 'v2', 'v2uv', 'v2t', 'v2p', 'r1'] as Kind[]) {
      const rig = makeRig({ c, kind, cap: 2000, segs: 10, h: 100, cellPx: 40 });
      const bytes = await measure(rig.rebuild);
      const s = await timedSeries(rig.rebuild, REPS_HEAD);
      rows.push([`${kind}  ${KIND_LABEL[kind]}`, f(bytes, 0), f(bytes / rig.ctx.calls, 1), `${s.gcMinor} / ${s.gcMajor} / ${f(s.gcMs, 2)}`, String(s.gcHits)]);
      res[kind] = { bytes, calls: rig.ctx.calls, gcMinor: s.gcMinor, gcMajor: s.gcMajor, gcMs: s.gcMs, gcHits: s.gcHits };
    }
    // Detector check: a deliberately allocating field (one fresh array per sample) must show up.
    const base = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h: 100, cellPx: 40 });
    const inner = base.field;
    const leaky: GlyphField = {
      windP(pos, out) {
        const t = [pos[0]!, pos[1]!];
        pos[0] = t[0]!;
        inner.windP(pos, out);
        out[2] = t.length;
      },
      groundP: (pos) => inner.groundP(pos),
    };
    const leakRig = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h: 100, cellPx: 40, field: leaky });
    const leakBytes = await measure(leakRig.rebuild);
    rows.push(['detector check: v2p plus one [x, y] array per sample', f(leakBytes, 0), f(leakBytes / leakRig.ctx.calls, 1), '-', '-']);
    table(rows);
    log('A 16 MB young generation (V8 default here) is scavenged whenever it fills, so bytes per rebuild / 16 MB = scavenges per rebuild.');
    log();
    RES['alloc'] = res;
  }, 1_800_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('09 other grids and heights (2000 x 10)', async () => {
    log('== 09 other grids and heights (2000 glyphs x 10 segments)');
    const rows: string[][] = [['case', 'h (m)', 'variant', 'median ms', 'p95 ms', 'segments', 'calls']];
    const res: Record<string, unknown> = {};
    for (const c of cases.values()) {
      for (const kind of ['v1', 'v2uv', 'v2p'] as Kind[]) {
        const rig = makeRig({ c, kind, cap: 2000, segs: 10, h: 100, cellPx: 40 });
        const s = await timedSeries(rig.rebuild, REPS);
        rows.push([c.label, '100', kind, f(s.sum.median), f(s.sum.p95), String(rig.ctx.total), String(rig.ctx.calls)]);
        res[`${c.name}:h100:${kind}`] = s.sum;
      }
    }
    const c = std6();
    for (const h of [10, 50, 300, 1000, 2000]) {
      const rig = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h, cellPx: 40 });
      const s = await timedSeries(rig.rebuild, REPS);
      rows.push([c.label, String(h), 'v2p', f(s.sum.median), f(s.sum.p95), String(rig.ctx.total), String(rig.ctx.calls)]);
      res[`std6:h${h}:v2p`] = s.sum;
    }
    table(rows);
    log();
    RES['grids'] = res;
  }, 1_800_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('10 extrapolation to a phone and to the 4x throttle', () => {
    log('== 10 extrapolation');
    log(`phone factor ${f(PHONE_FACTOR, 2)} = 41.1 ms (phone) / 17.5 ms (this machine) for the 3-D air step: ONE data point, and the code differs (stencil and multigrid, not a branchy sampler).`);
    log(`4x throttle = 4 x this machine's time. Budget: ${BUDGET_MS} ms p95 on a phone (plan 9.8), 32 ms at the throttle. "With margin": phone estimate <= budget / ${MARGIN_FACTOR} = ${f(BUDGET_MS / MARGIN_FACTOR, 1)} ms.`);
    const m = RES['matrix'] as Record<string, Summary & { glyphs: number }> | undefined;
    if (!m) {
      log('(matrix missing: run the whole file)');
      return;
    }
    const rows: string[][] = [['glyphs x segs', 'variant', 'p95 here ms', 'phone p95 est ms (x2.35)', 'throttle p95 ms (x4)', 'fits 8 ms', 'fits with margin', 'frames of <= 8 ms (phone)', 'frames of <= 32 ms (throttle)']];
    const out: Record<string, unknown> = {};
    for (const kind of MATRIX_KINDS) {
      for (const cap of [600, 1200, 2000]) {
        for (const segs of [6, 10, 12]) {
          const s = m[`${kind}:${cap}x${segs}`];
          if (!s) continue;
          const ph = s.p95 * PHONE_FACTOR;
          const th = s.p95 * THROTTLE;
          rows.push([`${cap} x ${segs}`, kind, f(s.p95), f(ph), f(th), ph <= BUDGET_MS ? 'yes' : 'no', ph <= BUDGET_MS / MARGIN_FACTOR ? 'yes' : 'no', String(Math.ceil(ph / BUDGET_MS)), String(Math.ceil(th / 32))]);
          out[`${kind}:${cap}x${segs}`] = { here: s.p95, phone: ph, throttle: th };
        }
      }
    }
    table(rows);
    log();
    RES['extrapolation'] = out;
  });
});
