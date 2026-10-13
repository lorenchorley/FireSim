/**
 * Spike S3 of docs/plans/air-slice-wind-detail-honest-speed.md (section 10, M0): how long does it take to build the
 * wind glyphs of workstream E (arrows and curved flow lines traced through the wind field), and is the plan's
 * "<= 8 ms p95 on a phone" believable? Nothing here changes the app. Not part of `npm test`: gated by FIRESIM_SPIKE.
 *
 *   FIRESIM_SPIKE=1 FIRESIM_SPIKE_OUT=docs/plans/spikes/S3-glyph-benchmark/results.txt nice -n 10 \
 *     npx vitest run tests/spikes/glyphBench.spike.test.ts
 *
 * Optional: FIRESIM_SPIKE_JSON=<file> writes the numbers as JSON; FIRESIM_SPIKE_QUICK=1 is a 2-minute smoke run
 * (its numbers are not for use). The note is docs/plans/spikes/S3-glyph-benchmark/README.md.
 *
 * What is built:
 *  1. Real AtmosphereView data: a real `Atmosphere` (standard and high tier; Katoomba 6 km, and the same DEM mirror-padded to
 *     12 km) spun up for 1200 s of model time. `view()` gives today's flat view (sampler v1); the engine's native
 *     terrain-following arrays give the plan's `layout: 'terrain-following'` view (sampler v2, plan 7.2).
 *  2. The glyph tracer of plan 9.3: jittered world-lattice seeds from an integer hash, RK2 midpoint, arc-length
 *     parameterised, calm dots, domain-edge stop, culling to a view box, flat Float32Array output in the StreakBatch layout
 *     (segment start, segment end, colour) plus the halo-batch copy.
 *  3. Timing (variants round-robin in one block, with the machine's load recorded beside every block), cost split, ns per
 *     call, allocation, the raster alternative and its accuracy, staging, the phone extrapolation.
 *
 * Calling convention. V8 boxes a double passed to, or returned from, a function it does not inline (one 16-byte
 * HeapNumber each). The tracer therefore talks to its field through a scratch Float64Array `pos` and never passes a double.
 * The variants that follow the plan's API (`wind(x, y, zAsl, out)`: v1, v2) box inside their adapters; that is the
 * measured difference between "as the plan writes it" and "allocation-free".
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
/** V8 tier of a function ("TurboFan", "Maglev", "Baseline", "Interpreted"), through %GetOptimizationStatus. */
let statusFn: ((fn: unknown) => number) | null = null;
function tierOf(fn: unknown): string {
  if (!statusFn) {
    v8.setFlagsFromString('--allow-natives-syntax');
    statusFn = new Function('f', 'return %GetOptimizationStatus(f);') as (fn: unknown) => number;
  }
  const st = statusFn(fn);
  return st & (1 << 6) ? 'TurboFan' : st & (1 << 5) ? 'Maglev' : st & (1 << 15) ? 'Baseline' : 'Interpreted';
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

/** Timings of several variants measured round-robin in one time window, plus what the machine was doing meanwhile. */
interface Block {
  sum: Record<string, Summary>;
  /** 1-minute load average line of /proc/loadavg before and after the timed loop. */
  load0: string;
  load1: string;
  /** CPU time of this process / wall time (below 1: it was descheduled). */
  cpuWall: number;
  /** Other processes' CPU and the hypervisor's steal time, as a percentage of one core. */
  othersPct: number;
  stealPct: number;
  /** All tracers were at the TurboFan tier when timing started. */
  tiered: boolean;
  /** GC events during the timed loop. */
  gcMinor: number;
  gcMajor: number;
  gcMs: number;
}
const BLOCKS: Block[] = [];

/**
 * Time several rebuild functions round-robin (one rebuild of each in turn, the starting variant rotating), so that load from
 * other processes and slow drift hit every variant alike. Warm-up first, then until every tracer is at TurboFan (`ready`).
 */
async function interleaved(rebuilds: Record<string, (i: number) => number>, reps = REPS, warm = WARM, ready?: () => boolean): Promise<Block> {
  const keys = Object.keys(rebuilds);
  for (let i = 0; i < warm; i++) for (const k of keys) rebuilds[k]!(i);
  if (ready) for (let extra = 0; extra < 800 && !ready(); extra++) for (const k of keys) rebuilds[k]!(warm + extra);
  const tiered = ready ? ready() : true;
  await flushGc();
  const g0 = gcEvents.length;
  const ms: Record<string, number[]> = {};
  for (const k of keys) ms[k] = new Array<number>(reps);
  const load0 = loadavg();
  const cpu0 = process.cpuUsage();
  const sys0 = cpuStat();
  const w0 = performance.now();
  for (let i = 0; i < reps; i++) {
    for (let j = 0; j < keys.length; j++) {
      const k = keys[(i + j) % keys.length]!;
      const t0 = performance.now();
      rebuilds[k]!(warm + i);
      ms[k]![i] = performance.now() - t0;
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
  for (const k of keys) sum[k] = summarise(ms[k]!);
  const b: Block = {
    sum,
    load0,
    load1: load1s,
    cpuWall: own / wall,
    othersPct: (100 * Math.max(0, (sys1.busy - sys0.busy) * 10 - own)) / wall,
    stealPct: (100 * (sys1.steal - sys0.steal) * 10) / wall,
    tiered,
    gcMinor: ev.filter((e) => e.kind === 1).length,
    gcMajor: ev.filter((e) => e.kind === 4).length,
    gcMs: ev.reduce((a, e) => a + e.dur, 0),
  };
  BLOCKS.push(b);
  return b;
}

/** One variant on its own (a block with one key). */
async function single(rebuild: (i: number) => number, reps = REPS, warm = WARM, ready?: () => boolean): Promise<{ sum: Summary; block: Block }> {
  const b = await interleaved({ x: rebuild }, reps, warm, ready);
  return { sum: b.sum['x']!, block: b };
}

/** A block is LOADED when other processes used more than half a core or this process got under 90 % of its wall time. */
const loaded = (b: Block): boolean => b.othersPct > 50 || b.cpuWall < 0.9;
/** Beside every table row: load average before/after, other processes' % of a core, own cpu/wall, quiet or LOADED. */
const cond = (b: Block): string => `${f(load1(b.load0), 1)}/${f(load1(b.load1), 1)} ${f(b.othersPct, 0)}% ${f(b.cpuWall, 2)} ${loaded(b) ? 'LOADED' : 'quiet'}${b.tiered ? '' : ' NOT-TURBOFAN'}`;
const blockJson = (b: Block): Record<string, unknown> => ({ load0: b.load0, load1: b.load1, cpuWall: b.cpuWall, othersPct: b.othersPct, stealPct: b.stealPct, tiered: b.tiered, loaded: loaded(b) });

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
  s2?: TfSampler;
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
// Sampler v2 (plan 7.2)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Plan 7.2: per column of the 4-column stencil compute zeta = (zAsl - baseM - h0) / J with J = 1 - h0 / topM, clamp to the
 * first and last level, binary-search the level, interpolate linearly in zeta, blend the 4 columns bilinearly. Same
 * arithmetic as DiagnosticWind.sampleBg and Atmosphere.sampleAt. Two entry points over the same arrays:
 * `wind3`, the plan's API (doubles in, u v w out), and `windZ`, the same arithmetic hand-inlined for u and v with every
 * input in a scratch array, so that nothing is boxed.
 */
class TfSampler {
  private readonly nx: number; private readonly ny: number; private readonly nz: number; private readonly plane: number;
  private readonly x0: number; private readonly y0: number; private readonly invCell: number;
  private readonly topM: number; private readonly baseM: number;
  private readonly lv: Float32Array; private readonly h0: Float32Array;
  private readonly u: Float32Array; private readonly v: Float32Array; private readonly w: Float32Array;

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

  /** Plan API: (u, v, w) at a local point and an elevation (m ASL); out has 3 slots. */
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
      const kf = this.level((zr - h0) / (1 - h0 / this.topM));
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

  /** Hand-inlined, no boxing: pos[0], pos[1], pos[2] = x, y, zAsl in; (u, v) out. The clamps use Math.min/Math.max (see Dem). */
  windZ(pos: Float64Array, out: Float32Array): void {
    const nx = this.nx;
    const nz = this.nz;
    const lv = this.lv;
    let fx = (pos[0]! - this.x0) * this.invCell;
    let fy = (pos[1]! - this.y0) * this.invCell;
    fx = Math.max(0, Math.min(nx - 1, fx));
    fy = Math.max(0, Math.min(this.ny - 1, fy));
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 > nx - 2) i0 = nx - 2;
    if (j0 > this.ny - 2) j0 = this.ny - 2;
    const tx = fx - i0;
    const ty = fy - j0;
    const zr = pos[2]! - this.baseM;
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
}


/**
 * Render DEM bilinear lookup with the scratch-array convention (same arithmetic as HeightField.heightAt). The clamp is
 * written with Math.max/Math.min on purpose: the ternary `fx < 0 ? 0 : fx > mx ? mx : fx` of HeightField.heightAt mixes
 * integer constants with a double, and once V8 has seen integral inputs (a raster built on texel centres) it boxes that
 * double (one 16-byte HeapNumber per call) in the optimised code. Measured in sections 05 and 11.
 */
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
    fx = Math.max(0, Math.min(this.mx, fx));
    fy = Math.max(0, Math.min(this.my, fy));
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
  /** pos[0], pos[1] = x, y (m) in; wind (u, v) in out[0], out[1] (v1 and v2 also write out[2]). */
  windP(pos: Float64Array, out: Float32Array): void;
  /** pos[0], pos[1] = x, y in; the render DEM elevation (m ASL) in pos[2], for the lift of the drawn polyline. */
  groundP(pos: Float64Array): void;
}

/** Today's sampler (`AtmosphereSampler.wind`, plan API: doubles in) on today's flat view. u, v, w; zeros under the terrain. */
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

/** Sampler v2 as the plan writes it (plan API, doubles in, u v w). */
class FieldV2 implements GlyphField {
  private readonly hf: HeightField;
  private readonly s: TfSampler;
  private readonly h: number;
  constructor(hf: HeightField, s: TfSampler, h: number) {
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

/** Sampler v2 hand-inlined: positions through the scratch array, DEM lookup without boxing, u and v only. Allocation-free. */
class FieldV2P implements GlyphField {
  private readonly dem: Dem;
  private readonly s: TfSampler;
  private readonly h: number;
  constructor(dem: Dem, s: TfSampler, h: number) {
    this.dem = dem;
    this.s = s;
    this.h = h;
  }
  windP(pos: Float64Array, out: Float32Array): void {
    this.dem.atP(pos);
    pos[2] += this.h;
    this.s.windZ(pos, out);
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
    fx = Math.max(0, Math.min(nr - 1, fx));
    fy = Math.max(0, Math.min(nr - 1, fy));
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
  /** Glyph range [g0, g1) and the segment cursor of this call: a rebuild can be cut into slices that resume where the last stopped. */
  g0: number;
  g1: number;
  seg0: number;
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
 * Traces glyphs g0 .. g1-1 and appends their segments from seg0 (a whole rebuild is g0 = 0, g1 = n, seg0 = 0, calls = 0; a
 * slice resumes at the cursor the previous slice left). Returns the segment cursor. Uses nothing but its argument (it is
 * copied through Function.prototype.toString).
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
  let seg = c.seg0;
  let calls = 0;
  for (let g = c.g0; g < c.g1; g++) {
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
  if (write && c.g1 >= c.n) {
    // The halo underlay is a second StreakBatch with the same geometry: copy, do not recompute (after the last slice).
    c.A2.set(A.subarray(0, 3 * seg));
    c.B2.set(B.subarray(0, 3 * seg));
  }
  c.seg0 = seg;
  c.calls += calls;
  c.total = seg;
  return seg;
}

/**
 * An independently compiled copy of a function. V8 caches `new Function` by source text and then shares type feedback
 * between the copies, so the text is made unique with a counter: every copy starts cold and learns only from its own calls
 * (an earlier version shared feedback and let integer-valued test inputs make the tracer box its doubles).
 */
let freshCount = 0;
function fresh<T extends (...a: never[]) => unknown>(fn: T): T {
  return new Function(`"use strict"; return (${fn.toString()});\n// copy ${++freshCount}`)() as T;
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
    g0: 0,
    g1: 0,
    seg0: 0,
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

type Kind = 'v1' | 'v2' | 'v2p' | 'r1' | 'r2';
const KIND_LABEL: Record<Kind, string> = {
  v1: 'today (u,v,w; flat view; plan API)',
  v2: 'plan 7.2 (u,v,w; plan API)',
  v2p: 'plan 7.2 hand-inlined (u,v; no boxing)',
  r1: 'raster 1x',
  r2: 'raster 2x',
};

const VIEWPORT = { w: 412, h: 868 }; // CSS px, a phone in portrait (the plan's 412 px wide screen)
const MARGIN = 1.5; // plan 9.3: bounding box plus 25 % margin on each side
const VFOV = (50 * Math.PI) / 180;
const PXM = (2 * Math.tan(VFOV / 2)) / VIEWPORT.h; // radians per pixel (uPixelMetres at distance 1)
const N_BOXES = 16;

interface RigCfg {
  c: Case;
  kind: Kind;
  cap: number;
  segs: number;
  /** Height above the render DEM (m). */
  h: number;
  /** Size of one model cell on screen (px): sets metres per pixel (plan: L3 is 32 to 90). */
  cellPx: number;
  /** For the cost split: no output / colour by sampleRamp per segment / replay recorded results / record results. */
  write?: boolean;
  naive?: boolean;
  replay?: Float32Array;
  record?: boolean;
  /** Always use view box 0 (the replay needs it). */
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
  /** Lattice spacing (m). */
  spacing: number;
  /** seeds + trace for the i-th view box */
  rebuild: (i: number) => number;
  /** The same work cut into slices of at most `budgetMs` (the clock is read every `chunk` glyphs); returns each slice's duration. */
  rebuildSliced: (i: number, budgetMs: number, chunk?: number) => number[];
  seedOnly: (i: number) => number;
  raster?: FieldRaster;
  direct?: GlyphField;
  record?: FieldRecord;
}

function samplersOf(c: Case): { v1: AtmosphereSampler; s2: TfSampler; dem: Dem } {
  c.v1 ??= new AtmosphereSampler(c.flat, c.tf.baseM, null);
  c.s2 ??= new TfSampler(c.tf);
  c.dem ??= new Dem(c.hf);
  return { v1: c.v1, s2: c.s2, dem: c.dem };
}

function halton(i: number, b: number): number {
  let fr = 1;
  let r = 0;
  for (let k = i + 1; k > 0; k = Math.floor(k / b)) {
    fr /= b;
    r += fr * (k % b);
  }
  return r;
}

function makeRig(cfg: RigCfg): Rig {
  const { c, kind } = cfg;
  const sm = samplersOf(c);
  let field: GlyphField;
  let raster: FieldRaster | undefined;
  let direct: GlyphField | undefined;
  if (cfg.field) field = cfg.field;
  else if (kind === 'v1') field = new FieldV1(c.hf, sm.v1, cfg.h);
  else if (kind === 'v2') field = new FieldV2(c.hf, sm.s2, cfg.h);
  else if (kind === 'v2p') field = new FieldV2P(sm.dem, sm.s2, cfg.h);
  else {
    // The raster is filled with the hand-inlined direct sampler.
    direct = new FieldV2P(sm.dem, sm.s2, cfg.h);
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
  // View: phone portrait, top-down, one model cell = cellPx pixels, 16 boxes spread over the domain (Halton).
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
    ctx.g0 = 0;
    ctx.g1 = n;
    ctx.seg0 = 0;
    ctx.calls = 0;
    if (cfg.replay) (field as FieldReplay).idx = 0;
    return trace(ctx);
  };
  const rebuildSliced = (i: number, budgetMs: number, chunk = 32): number[] => {
    const slices: number[] = [];
    let t0 = performance.now();
    const n = seedOnly(i);
    ctx.n = n;
    ctx.seg0 = 0;
    ctx.calls = 0;
    for (let g = 0; g < n; g += chunk) {
      ctx.g0 = g;
      ctx.g1 = Math.min(n, g + chunk);
      trace(ctx);
      const now = performance.now();
      if (now - t0 >= budgetMs) {
        slices.push(now - t0); // in the app: return to the frame loop here
        t0 = performance.now();
      }
    }
    const last = performance.now() - t0;
    if (last > 0.001) slices.push(last);
    return slices;
  };
  const rig: Rig = { cfg, field, ctx, trace, seeds, spacing: S, rebuild, rebuildSliced, seedOnly };
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
const MATRIX_KINDS: Kind[] = ['v1', 'v2', 'v2p', 'r1', 'r2'];

/** The 3-D air step (10 s of model time), the one phone data point: 17.5 ms here and 41.1 ms on the phone (spike brief). */
function airStep(eng: Atmosphere, n: number): Summary {
  for (let i = 0; i < 5; i++) eng.step(10);
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    eng.step(10);
    ms.push(performance.now() - t0);
  }
  return summarise(ms);
}
const TURBOFAN = (rigs: Rig[]) => (): boolean => rigs.every((r) => tierOf(r.trace) === 'TurboFan');

describe.skipIf(!ENABLED)('S3 glyph benchmark (FIRESIM_SPIKE)', () => {
  const cases = new Map<string, Case>();
  const std6 = (): Case => cases.get('std6')!;
  /** A separate engine, only stepped, to time the air step at the start and at the end of the run (the cases above stay as built). */
  let cal: Case | undefined;
  let loadStart = '';

  beforeAll(async () => {
    gcObserver.observe({ entryTypes: ['gc'] });
    loadStart = loadavg();
    log('S3 glyph benchmark: sampler v1/v2, glyph tracer, raster alternative');
    log(`date ${new Date().toISOString()}  node ${process.version}  v8 ${process.versions.v8}  ${process.platform}/${process.arch}`);
    log(`cpu ${cpus()[0]?.model ?? '?'} x${cpus().length}  memory ${(totalmem() / 2 ** 30).toFixed(1)} GiB`);
    log(`load average at start: ${loadStart}`);
    log(`mode ${QUICK ? 'QUICK (not for the note)' : 'full'}: warm-up ${WARM}, timed rebuilds ${REPS} (headline ${REPS_HEAD}), spin-up ${SPIN_S} s of model time`);
    log('beside every timed table: load average before/after the block, other processes\' CPU as % of one core, this process\' CPU time / wall time, quiet or LOADED');
    log();
    for (const d of CASES) {
      const c = await buildCase(d.name, d.label, d.tier, d.extent);
      cases.set(d.name, c);
      log(`built ${d.label}: ${c.nx}x${c.ny}x${c.nz} columns, dx ${f(c.dx, 1)} m, H' ${f(c.tf.topM, 0)} m, datum ${f(c.tf.baseM, 0)} m ASL, ${c.steps} steps in ${f(c.buildS, 1)} s`);
    }
    cal = await buildCase('cal', 'calibration', 'standard', 6000);
    const a0 = airStep(cal.engine, QUICK ? 8 : 30);
    RES['airStepStart'] = a0;
    log(`calibration, 3-D air step of a standard 6 km engine at the start: median ${f(a0.median)} ms, min ${f(a0.min)} ms (the brief quotes 17.5 ms for this machine); load average ${loadavg()}`);
    log();
  }, 1_800_000);

  afterAll(() => {
    log();
    const nLoaded = BLOCKS.filter(loaded).length;
    const med = summarise(BLOCKS.map((b) => b.othersPct)).median;
    log(`timed blocks: ${BLOCKS.length}; LOADED (other processes above half a core, or this process under 90 % of its wall time): ${nLoaded}; median other-process CPU ${f(med, 0)} % of a core; median hypervisor steal ${f(summarise(BLOCKS.map((b) => b.stealPct)).median, 1)} %`);
    RES['blocks'] = { total: BLOCKS.length, loaded: nLoaded, medianOthersPct: med };
    log(`load average at end: ${loadavg()}  (start: ${loadStart})`);
    if (process.env.FIRESIM_SPIKE_OUT) writeFileSync(process.env.FIRESIM_SPIKE_OUT, OUT.join('\n') + '\n');
    if (process.env.FIRESIM_SPIKE_JSON) writeFileSync(process.env.FIRESIM_SPIKE_JSON, JSON.stringify(RES, null, 1));
  });

  /** Allocation per steady-state rebuild (2000 x 10, standard 6 km) for every variant; run early and late to show the effect of JIT history. */
  const allocSection = async (title: string, key: string): Promise<void> => {
    log(`== ${title}`);
    log('   heap growth (process.memoryUsage().heapUsed) across windows of 40 glyphs, after a warm-up to TurboFan and a forced GC; the median of the windows is scaled to 2000 glyphs.');
    log('   Windows are short so that they fit in the young generation: a scavenge inside a window shows as a negative or small outlier, and the median ignores it.');
    const c = std6();
    const rows: string[][] = [['variant', 'bytes per rebuild', 'bytes per sampler call', 'GC events in a 300-rebuild series (minor / major / ms)', 'tiers: tracer / windP']];
    const res: Record<string, unknown> = {};
    const warmUp = async (rig: Rig): Promise<void> => {
      for (let i = 0; i < 150; i++) rig.rebuild(i);
      for (let extra = 0; extra < 800 && tierOf(rig.trace) !== 'TurboFan'; extra++) rig.rebuild(150 + extra);
      for (let i = 0; i < 30; i++) rig.rebuild(i);
      gc();
      gc();
      await flushGc();
    };
    /** What reading the heap size twice adds inside a window (same protocol as the windows: no arithmetic between the two reads). */
    const readOverhead = (): number =>
      summarise(
        Array.from({ length: 21 }, () => {
          const a0 = process.memoryUsage().heapUsed;
          const a1 = process.memoryUsage().heapUsed;
          return a1 - a0;
        }),
      ).median;
    const CHUNK = 40;
    const measureChunks = async (rig: Rig): Promise<number> => {
      await warmUp(rig);
      const overhead = readOverhead();
      const ctx = rig.ctx;
      const n = rig.seedOnly(0);
      ctx.n = n;
      const d: number[] = [];
      for (let g = 0; g + CHUNK < n; g += CHUNK) {
        ctx.g0 = g;
        ctx.g1 = g + CHUNK;
        ctx.seg0 = 0;
        ctx.calls = 0;
        const a0 = process.memoryUsage().heapUsed;
        rig.trace(ctx);
        const a1 = process.memoryUsage().heapUsed;
        d.push(a1 - a0 - overhead);
      }
      return summarise(d).median * (n / CHUNK);
    };
    // Seeds alone, whole rebuilds (they allocate nothing, so no scavenge can fall inside a window).
    const rigSeed = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h: 100, cellPx: 40 });
    await warmUp(rigSeed);
    const ovSeed = readOverhead();
    const dSeed: number[] = [];
    for (let i = 0; i < 41; i++) {
      const a0 = process.memoryUsage().heapUsed;
      rigSeed.seedOnly(200 + i);
      const a1 = process.memoryUsage().heapUsed;
      dSeed.push(a1 - a0 - ovSeed);
    }
    rows.push(['seeds only (lattice, hash, thinning), whole rebuilds', f(summarise(dSeed).median, 0), '-', '-', '-']);
    res['seeds'] = { bytes: summarise(dSeed).median };
    for (const kind of ['v1', 'v2', 'v2p', 'r1'] as Kind[]) {
      const rig = makeRig({ c, kind, cap: 2000, segs: 10, h: 100, cellPx: 40 });
      const bytes = await measureChunks(rig);
      const s1 = await single(rig.rebuild, REPS_HEAD, WARM, () => tierOf(rig.trace) === 'TurboFan');
      rows.push([`${kind}  ${KIND_LABEL[kind]}`, f(bytes, 0), f(bytes / rig.ctx.calls, 1), `${s1.block.gcMinor} / ${s1.block.gcMajor} / ${f(s1.block.gcMs, 2)}`, `${tierOf(rig.trace)} / ${tierOf(Object.getPrototypeOf(rig.field).windP)}`]);
      res[kind] = { bytes, calls: rig.ctx.calls, gcMinor: s1.block.gcMinor, gcMajor: s1.block.gcMajor, gcMs: s1.block.gcMs };
    }
    // Detector check: a deliberately allocating field (one fresh array per sample) must show up.
    const inner = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h: 100, cellPx: 40 }).field;
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
    const leakBytes = await measureChunks(leakRig);
    leakRig.rebuild(0);
    rows.push(['detector check: v2p plus one [x, y] array per sample', f(leakBytes, 0), f(leakBytes / leakRig.ctx.calls, 1), '-', tierOf(leakRig.trace)]);
    res['detector'] = { bytes: leakBytes };
    table(rows);
    log('A young generation of 16 MB (the V8 default for a desktop) is scavenged whenever it fills: bytes per rebuild / 16 MB = scavenges per rebuild; a phone WebView has a smaller one (not measured).');
    log();
    RES[key] = res;
  };

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('00 cold start: the first rebuilds of a fresh tracer (standard 6 km, 2000 x 10)', async () => {
    log('== 00 cold start (the sampler and the tracer are compiled from scratch in this process; standard 6 km, 2000 x 10)');
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
      const steady = await single(rig.rebuild, 30, 20, () => tierOf(rig.trace) === 'TurboFan');
      log(`${kind}: first 12 rebuilds (ms): ${first.map((x) => f(x, 1)).join(' ')}; steady median ${f(steady.sum.median)} ms; first = ${f(first[0]! / steady.sum.median, 1)}x  [${cond(steady.block)}]`);
      res[kind] = { first, steadyMedian: steady.sum.median };
      expect(first[0]).toBeGreaterThan(0);
    }
    // The same cold start cut into slices of a phone-equivalent frame budget: the slice count adapts by itself.
    const rigS = makeRig({ c, kind: 'v2p', cap: 2000, segs: 10, h: 100, cellPx: 40 });
    const per: string[] = [];
    for (let i = 0; i < 10; i++) {
      const sl = rigS.rebuildSliced(i, BUDGET_MS / PHONE_FACTOR);
      per.push(`${sl.length} (longest ${f(Math.max(...sl), 1)} ms)`);
    }
    log(`v2p cut into slices of ${f(BUDGET_MS / PHONE_FACTOR, 2)} ms (= ${BUDGET_MS} ms on the phone estimate), fresh tracer: slices per rebuild: ${per.join(', ')}`);
    res['sliced'] = per;
    log();
    RES['cold'] = res;
  }, 900_000);

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
      for (let j = 0; j < 40; j++) {
        for (let i = 0; i < 40; i++) {
          const x = c.dom.x0 + ((i + 0.5) / 40) * (c.dom.x1 - c.dom.x0);
          const y = c.dom.y0 + ((j + 0.5) / 40) * (c.dom.y1 - c.dom.y0);
          s2.wind3(x, y, c.hf.heightAt(x, y) + 100, out);
          const sp = Math.hypot(out[0]!, out[1]!);
          sum += sp;
          mx = Math.max(mx, sp);
        }
      }
      rows.push([c.label, `${c.nx}x${c.ny}`, f(c.dx, 0), String(c.nz), f(c.tf.topM, 0), f(relief, 0), `${f(sum / 1600, 1)} / ${f(mx, 1)}`, f((c.flat.u.byteLength * 5) / 1e6, 2), f((c.tf.u.byteLength * 3) / 1e6, 2)]);
      expect(sum / 1600).toBeGreaterThan(0.5);
    }
    table(rows);
    log('flat view MB counts u, v, w, theta, smoke; native MB counts the three wind arrays the sampler reads.');
    // How many glyphs does the plan's own lattice put on a phone? (plan 9.2: about 36 px apart at L3, power-of-two spacing in metres)
    const cnt: string[][] = [['lattice spacing (px)', 'glyphs inside the 412 x 868 screen', 'glyphs inside the box with 25 % margin each side']];
    for (const sp of [25.5, 36, 51]) cnt.push([`${sp}${sp === 36 ? ' (nominal)' : sp < 36 ? ' (pow2 rounded down)' : ' (pow2 rounded up)'}`, f((VIEWPORT.w * VIEWPORT.h) / (sp * sp), 0), f((VIEWPORT.w * MARGIN * VIEWPORT.h * MARGIN) / (sp * sp), 0)]);
    log('glyph counts the plan\'s L3 lattice puts on a phone in portrait (arithmetic: area / spacing squared):');
    table(cnt);
    log();
  });

  it('02 sampler v2 against the engine oracle and v1', () => {
    log('== 02 sampler correctness (6000 random points per case, heights 5 m to 2 km above the engine ground)');
    const rows: string[][] = [['case', 'v2 vs engine.sample: max |du,dv,dw| m/s', 'hand-inlined vs v2: max |du,dv| m/s', 'v1 vs engine: mean |dU| at 50 m', 'v1 vs engine at 100 m']];
    for (const c of cases.values()) {
      const sm = samplersOf(c);
      const eng = c.engine as unknown as { groundAt(x: number, y: number): number; sample(x: number, y: number, z: number, o: Float32Array): void };
      const rng = new Rng(11);
      const [o1, o2, o3, o4] = [0, 1, 2, 3].map(() => new Float32Array(3)) as [Float32Array, Float32Array, Float32Array, Float32Array];
      const pos = new Float64Array(3);
      const v1Err: Record<number, number> = { 50: 0, 100: 0 };
      let maxV2 = 0;
      let maxP = 0;
      let cnt = 0;
      for (let q = 0; q < 6000; q++) {
        const x = c.tf.grid.x0 + rng.next() * (c.nx - 1) * c.tf.grid.cellSize;
        const y = c.tf.grid.y0 + rng.next() * (c.ny - 1) * c.tf.grid.cellSize;
        const agl = q % 3 === 0 ? 5 + rng.next() * 2000 : q % 3 === 1 ? 50 : 100;
        const zAsl = eng.groundAt(x, y) + agl;
        eng.sample(x, y, agl, o1);
        sm.s2.wind3(x, y, zAsl, o2);
        maxV2 = Math.max(maxV2, Math.abs(o1[0]! - o2[0]!), Math.abs(o1[1]! - o2[1]!), Math.abs(o1[2]! - o2[2]!));
        pos[0] = x;
        pos[1] = y;
        pos[2] = zAsl;
        sm.s2.windZ(pos, o3);
        maxP = Math.max(maxP, Math.abs(o3[0]! - o2[0]!), Math.abs(o3[1]! - o2[1]!));
        if (agl === 50 || agl === 100) {
          sm.v1.wind(x, y, zAsl, agl, o4);
          v1Err[agl]! += Math.hypot(o4[0]! - o1[0]!, o4[1]! - o1[1]!);
          if (agl === 50) cnt++;
        }
      }
      rows.push([c.label, f(maxV2, 5), f(maxP, 6), f(v1Err[50]! / cnt, 3), f(v1Err[100]! / cnt, 3)]);
      expect(maxV2).toBeLessThan(2e-3);
      expect(maxP).toBeLessThan(1e-3);
    }
    table(rows);
    log('The engine ground (30 m fire grid, bilinear) gives zAsl, so that every sampler sees the same input. v1 differs from the engine near the ground because the flat view holds zeros below the terrain.');
    log();
  });

  it('03 tracer checks on analytic fields (straight, rotation, arc length, calm, edge, determinism)', () => {
    log('== 03 tracer checks');
    const dom: Dom = { x0: -3000, x1: 3000, y0: -3000, y1: 3000 };
    const run = (fn: (x: number, y: number, o: Float32Array) => void, seeds: [number, number][], segs: number, mpp: number): TraceCtx => {
      const ctx = makeCtx(new FieldFn(fn), seeds.length, segs, dom);
      seeds.forEach(([x, y], i) => {
        ctx.sx[i] = x;
        ctx.sy[i] = y;
        ctx.smpp[i] = mpp;
      });
      ctx.n = seeds.length;
      ctx.g1 = ctx.n;
      fresh(traceGlyphs)(ctx);
      return ctx;
    };
    // 1. Uniform wind: straight, equal segments.
    const uni = run((_x, _y, o) => { o[0] = 6; o[1] = 8; }, [[0, 0], [100, -50]], 10, 3.3);
    let dev = 0;
    let lenErr = 0;
    const ds = (40 * 3.3) / 10; // 10 m/s x 4 px = 40 px
    for (let k = 0; k < 10; k++) {
      const [ax, ay, bx, by] = [uni.A[3 * k]!, -uni.A[3 * k + 2]!, uni.B[3 * k]!, -uni.B[3 * k + 2]!];
      dev = Math.max(dev, Math.abs((bx - ax) * 0.8 - (by - ay) * 0.6));
      lenErr = Math.max(lenErr, Math.abs(Math.hypot(bx - ax, by - ay) - ds) / ds);
    }
    log(`uniform wind: max sideways deviation of a segment ${f(dev, 6)} m, max arc-length error ${f(lenErr * 100, 4)} %`);
    expect(dev).toBeLessThan(1e-3);
    expect(lenErr).toBeLessThan(1e-3);
    // 2. Solid-body rotation about (500, 0): radius recovered.
    const om = 0.02;
    const rotate = (x: number, y: number, o: Float32Array): void => {
      o[0] = -om * y;
      o[1] = om * (x - 500);
    };
    const rot = run(rotate, [[800, 0]], 12, 5);
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
    const a1 = run(rotate, [[800, 0], [100, 100]], 10, 5);
    const a2 = run(rotate, [[800, 0], [100, 100]], 10, 5);
    const same = Buffer.from(a1.A.buffer).equals(Buffer.from(a2.A.buffer)) && Buffer.from(a1.C.buffer).equals(Buffer.from(a2.C.buffer));
    log(`determinism: two runs give identical arrays: ${same}`);
    expect(same).toBe(true);
    // 6. Seeds: a seed depends only on its lattice indices, not on the box.
    const rig = makeRig({ c: std6(), kind: 'v2p', cap: 100000, segs: 6, h: 100, cellPx: 40 });
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
  it('04 ns per sampler call', async () => {
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
    const rb = Math.ceil((N * reps) / nTrace);
    const rows: string[][] = [['windAt', `positions as traced (${nTrace} requests), ns`, 'random positions, ns']];
    const res: Record<string, { random: number; traced: number }> = {};
    const fields = MATRIX_KINDS.map((k) => [k, makeRig({ c, kind: k, cap: 100, segs: 6, h: 100, cellPx: 40 }).field] as const);
    for (const [name, fld] of [['DEM lookup alone, HeightField.heightAt (plan API)', fields[0]![1]], ['DEM lookup alone, scratch-array convention', fields[2]![1]]] as const) {
      const a = nsPerCall(() => fresh(groundLoop)(fld, rx, ry, N, reps, pos), N * reps);
      const b = nsPerCall(() => fresh(groundLoop)(fld, tx, ty, nTrace, rb, pos), nTrace * rb);
      rows.push([name, f(b.ns, 1), f(a.ns, 1)]);
      res[name] = { random: a.ns, traced: b.ns };
    }
    for (const [kind, fld] of fields) {
      const a = nsPerCall(() => fresh(windLoop)(fld, rx, ry, N, reps, pos, out), N * reps);
      const b = nsPerCall(() => fresh(windLoop)(fld, tx, ty, nTrace, rb, pos, out), nTrace * rb);
      rows.push([`${kind}  ${KIND_LABEL[kind]}`, f(b.ns, 1), f(a.ns, 1)]);
      res[kind] = { random: a.ns, traced: b.ns };
    }
    table(rows);
    log(`plan 7.2 claim "1300 to 2600 particles per frame, well under 1 ms": 2600 samples x ${f(res['v2']!.traced, 0)} ns = ${f((2600 * res['v2']!.traced) / 1e6, 2)} ms (this machine, plan API incl. the DEM lookup)`);
    log(`machine during this test: load average ${loadavg().split(' ').slice(0, 3).join(' ')}`);
    log();
    RES['nsPerCall'] = res;
  }, 600_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('05 allocation, early (the JIT has seen little else)', async () => {
    await allocSection('05 allocation per steady-state rebuild, early in the run (2000 x 10, standard 6 km)', 'allocEarly');
  }, 1_800_000);

  it('06 rebuild matrix: caps 600/1200/2000 x segments 6/10/12, every variant (standard 6 km)', async () => {
    log('== 06 rebuild matrix: standard 6 km, h = 100 m, one model cell = 40 px, phone portrait view with 25 % margin');
    log('   the variants of a row group are timed round-robin in one block; cond = load average before/after, other processes\' CPU, own cpu/wall, quiet or LOADED');
    const c = std6();
    const rows: string[][] = [['glyphs x segs', 'variant', 'glyphs', 'segments', 'calls', 'min ms', 'median ms', 'p95 ms', 'max ms', 'cond']];
    const out: Record<string, unknown> = {};
    for (const cap of [600, 1200, 2000]) {
      for (const segs of [6, 10, 12]) {
        const rigs = Object.fromEntries(MATRIX_KINDS.map((k) => [k, makeRig({ c, kind: k, cap, segs, h: 100, cellPx: 40 })])) as Record<Kind, Rig>;
        const b = await interleaved(Object.fromEntries(MATRIX_KINDS.map((k) => [k, rigs[k].rebuild])), cap === 2000 && segs === 10 ? REPS_HEAD : REPS, WARM, TURBOFAN(Object.values(rigs)));
        for (const kind of MATRIX_KINDS) {
          const s = b.sum[kind]!;
          const rig = rigs[kind];
          rows.push([`${cap} x ${segs}`, kind, String(rig.ctx.n), String(rig.ctx.total), String(rig.ctx.calls), f(s.min), f(s.median), f(s.p95), f(s.max), cond(b)]);
          out[`${kind}:${cap}x${segs}`] = { ...s, glyphs: rig.ctx.n, segments: rig.ctx.total, calls: rig.ctx.calls, ...blockJson(b) };
        }
      }
    }
    table(rows);
    log('glyphs, segments and calls are for the last rebuild of the block. r1 and r2 rows are the trace only: the raster is built once per snapshot or height change (see 09).');
    log();
    RES['matrix'] = out;
  }, 3_600_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('07 cost split of one 2000 x 10 rebuild', async () => {
    log('== 07 cost split, standard 6 km, 2000 glyphs x 10 segments, fixed box (the variants of one table are timed round-robin)');
    const c = std6();
    const res: Record<string, unknown> = {};
    for (const kind of ['v2', 'v2p', 'r1'] as Kind[]) {
      const cfg = { c, kind, cap: 2000, segs: 10, h: 100, cellPx: 40, fixedBox: true };
      const recRig = makeRig({ ...cfg, record: true });
      recRig.rebuild(0);
      const rec = recRig.record!;
      const nCalls = rec.idx;
      const full = makeRig(cfg);
      const noWrite = makeRig({ ...cfg, write: false });
      const replay = makeRig({ ...cfg, write: false, replay: rec.uv.slice(0, 2 * nCalls) });
      const naive = makeRig({ ...cfg, naive: true });
      const b = await interleaved({ full: full.rebuild, noWrite: noWrite.rebuild, replay: replay.rebuild, seeds: (i) => full.seedOnly(i), naive: naive.rebuild }, REPS_HEAD, WARM, TURBOFAN([full, noWrite, replay, naive]));
      // The sampler alone on the recorded request stream.
      const xs = rec.xs.slice(0, nCalls);
      const ys = rec.ys.slice(0, nCalls);
      const samp = nsPerCall(() => fresh(windLoop)(full.field, xs, ys, nCalls, 1, new Float64Array(3), new Float32Array(3)), nCalls, 25);
      const m = (k: string): number => b.sum[k]!.median;
      const mn = (k: string): number => b.sum[k]!.min;
      const [out, sampler, arith] = [m('full') - m('noWrite'), m('noWrite') - m('replay'), m('replay') - m('seeds')];
      log(`-- ${kind}: ${KIND_LABEL[kind]}   [cond ${cond(b)}]`);
      table([
        ['part', 'median ms', 'min ms', 'share of median'],
        ['seeds (lattice, hash, thinning, metres per pixel)', f(m('seeds'), 3), f(mn('seeds'), 3), `${f((100 * m('seeds')) / m('full'), 0)} %`],
        ['tracing arithmetic (RK2, normalising, edge test, loop)', f(arith, 3), f(mn('replay') - mn('seeds'), 3), `${f((100 * arith) / m('full'), 0)} %`],
        [`sampler calls (${nCalls} x windAt${kind === 'r1' ? ', raster bilinear' : ' incl. DEM lookup'})`, f(sampler, 3), f(mn('noWrite') - mn('replay'), 3), `${f((100 * sampler) / m('full'), 0)} %`],
        ['output (DEM lift, vertex write, colour table, near plane, halo copy)', f(out, 3), f(mn('full') - mn('noWrite'), 3), `${f((100 * out) / m('full'), 0)} %`],
        ['total rebuild', f(m('full'), 3), f(mn('full'), 3), '100 %'],
      ]);
      log(`replaying the ${nCalls} recorded requests through windAt alone: ${f(samp.ns, 1)} ns per call = ${f((samp.ns * nCalls) / 1e6, 3)} ms (the sampler line by subtraction: ${f((sampler / nCalls) * 1e6, 1)} ns per call)`);
      log(`segments written ${full.ctx.total}; output floats ${full.ctx.total * 10} (A, B, C) + ${full.ctx.total * 6} (halo copy A2, B2)`);
      log(`colour by sampleRamp + srgbToLinear per segment (as WindLayer does per streak) instead of the table: median ${f(m('naive'), 3)} ms (${m('naive') >= m('full') ? '+' : ''}${f(m('naive') - m('full'), 3)} ms)`);
      log();
      res[kind] = { seeds: m('seeds'), arith, sampler, output: out, total: m('full'), calls: nCalls, replayNs: samp.ns, naiveColour: m('naive'), segments: full.ctx.total, ...blockJson(b) };
    }
    RES['split'] = res;
  }, 1_800_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('08 staging: one rebuild cut into slices that fit a frame', async () => {
    const sliceMs = BUDGET_MS / PHONE_FACTOR;
    log(`== 08 staging: the clock is read every 32 glyphs and a slice ends when its budget is spent (here ${f(sliceMs, 2)} ms = ${BUDGET_MS} ms on the phone estimate; ${BUDGET_MS} ms here = ${BUDGET_MS * THROTTLE} ms at the 4x throttle)`);
    const c = std6();
    const rows: string[][] = [['variant', 'glyphs x segs', 'budget here ms', 'unsliced median ms', 'sliced total median ms', 'slices per rebuild (median / max)', 'slice ms: median / p95 / max', 'cond']];
    const res: Record<string, unknown> = {};
    for (const kind of ['v2p', 'r1'] as Kind[]) {
      for (const [cap, segs] of [[2000, 10], [1200, 10], [600, 10]] as const) {
        for (const budget of [sliceMs, BUDGET_MS]) {
          const rig = makeRig({ c, kind, cap, segs, h: 100, cellPx: 40 });
          const counts: number[] = [];
          const all: number[] = [];
          const b = await interleaved(
            {
              whole: rig.rebuild,
              sliced: (i) => {
                const sl = rig.rebuildSliced(i, budget);
                counts.push(sl.length);
                all.push(...sl);
                return sl.length;
              },
            },
            REPS,
            WARM,
            () => tierOf(rig.trace) === 'TurboFan',
          );
          const keep = counts.slice(-REPS);
          const slices = summarise(all.slice(-keep.reduce((x, y) => x + y, 0)));
          const sc = summarise(keep);
          rows.push([kind, `${cap} x ${segs}`, f(budget, 2), f(b.sum['whole']!.median), f(b.sum['sliced']!.median), `${sc.median} / ${sc.max}`, `${f(slices.median)} / ${f(slices.p95)} / ${f(slices.max)}`, cond(b)]);
          res[`${kind}:${cap}x${segs}:${f(budget, 1)}`] = { whole: b.sum['whole'], sliced: b.sum['sliced'], slices: sc, slice: slices, ...blockJson(b) };
        }
      }
    }
    table(rows);
    log('A slice overshoots its budget by at most the time of 32 glyphs. The first slice of a rebuild includes the seeds.');
    log();
    RES['staging'] = res;
  }, 1_800_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('09 raster alternative: build cost and what it gives up', async () => {
    log('== 09 raster alternative (all grids), 2000 glyphs x 10 segments, h = 100 m; direct and raster traces are timed round-robin');
    const rows: string[][] = [['case', 'raster', 'texels', 'build median ms', 'build p95 ms', 'trace median ms', 'trace p95 ms', 'new snapshot: build + trace median ms', 'direct v2p median ms', 'direct v2p p95 ms', 'cond']];
    const resRaster: Record<string, unknown> = {};
    for (const c of cases.values()) {
      const [direct, r1, r2] = (['v2p', 'r1', 'r2'] as Kind[]).map((kind) => makeRig({ c, kind, cap: 2000, segs: 10, h: 100, cellPx: 40 })) as [Rig, Rig, Rig];
      const b = await interleaved(
        { direct: direct.rebuild, trace1: r1.rebuild, trace2: r2.rebuild, build1: () => (r1.raster!.build(r1.direct!), 0), build2: () => (r2.raster!.build(r2.direct!), 0) },
        REPS_HEAD,
        WARM,
        TURBOFAN([direct, r1, r2]),
      );
      for (const [kind, R, tr, bd] of [['r1', r1.raster!, 'trace1', 'build1'], ['r2', r2.raster!, 'trace2', 'build2']] as const) {
        const [sB, sT, sD] = [b.sum[bd]!, b.sum[tr]!, b.sum['direct']!];
        rows.push([c.label, kind === 'r1' ? '1x (model grid)' : '2x finer', String(R.nr * R.nr), f(sB.median, 3), f(sB.p95, 3), f(sT.median, 3), f(sT.p95, 3), f(sB.median + sT.median, 3), f(sD.median, 3), f(sD.p95, 3), cond(b)]);
        resRaster[`${c.name}:${kind}`] = { texels: R.nr * R.nr, build: sB, trace: sT, direct: sD, ...blockJson(b) };
      }
    }
    table(rows);
    log();
    RES['raster'] = resRaster;

    // Accuracy: end points of the raster-traced glyphs against the direct sampler, same seeds, same rules.
    log('-- accuracy: distance between the end point of each glyph traced through the raster and through the direct v2 sampler');
    log('   (2000 glyphs x 10 segments in each of 16 view boxes; same seeds and rules; px = distance / the glyph\'s own metres per pixel;');
    log('    cell = size of one model cell on screen; length = mean path length of the direct glyphs)');
    const acc: string[][] = [['case', 'h (m)', 'cell (px)', 'raster', 'length m', 'mean m', 'p95 m', 'p99 m', 'max m', 'mean % of length', 'mean px', 'p95 px', 'p99 px', 'max px', '% of glyphs over 3 px', 'glyphs']];
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
                d.push(dd);
                dPx.push(dd / direct.ctx.smpp[k]!);
                lens.push(direct.ctx.len[k]!);
                rel.push(direct.ctx.len[k]! > 1 ? dd / direct.ctx.len[k]! : 0);
              }
            }
            const sd = summarise(d);
            const sp = summarise(dPx);
            const p99 = percentile([...d].sort((x, y) => x - y), 0.99);
            const p99Px = percentile([...dPx].sort((x, y) => x - y), 0.99);
            const over3 = (100 * dPx.filter((x) => x > 3).length) / dPx.length;
            const meanLen = lens.reduce((a, x) => a + x, 0) / lens.length;
            const meanRel = rel.reduce((a, x) => a + x, 0) / rel.length;
            acc.push([c.label, String(h), String(cellPx), kind === 'r1' ? '1x' : '2x', f(meanLen, 0), f(sd.mean, 1), f(sd.p95, 1), f(p99, 1), f(sd.max, 0), f(meanRel * 100, 1), f(sp.mean, 2), f(sp.p95, 2), f(p99Px, 2), f(sp.max, 1), f(over3, 2), String(d.length)]);
            resAcc[`${c.name}:h${h}:cell${cellPx}:${kind}`] = { mean: sd.mean, p95: sd.p95, p99, max: sd.max, meanRelPct: meanRel * 100, meanPx: sp.mean, p95Px: sp.p95, p99Px, maxPx: sp.max, over3Pct: over3, meanLen };
          }
        }
      }
    }
    table(acc);
    log();
    RES['rasterAccuracy'] = resAcc;
  }, 3_600_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('10 other grids and heights (2000 x 10)', async () => {
    log('== 10 other grids and heights (2000 glyphs x 10 segments; the variants of one group are timed round-robin)');
    const rows: string[][] = [['case', 'h (m)', 'variant', 'median ms', 'p95 ms', 'segments', 'calls', 'cond']];
    const res: Record<string, unknown> = {};
    for (const c of cases.values()) {
      const kinds: Kind[] = ['v1', 'v2', 'v2p', 'r1'];
      const rigs = Object.fromEntries(kinds.map((k) => [k, makeRig({ c, kind: k, cap: 2000, segs: 10, h: 100, cellPx: 40 })])) as Record<Kind, Rig>;
      const b = await interleaved(Object.fromEntries(kinds.map((k) => [k, rigs[k].rebuild])), REPS, WARM, TURBOFAN(Object.values(rigs)));
      for (const kind of kinds) {
        const s = b.sum[kind]!;
        rows.push([c.label, '100', kind, f(s.median), f(s.p95), String(rigs[kind].ctx.total), String(rigs[kind].ctx.calls), cond(b)]);
        res[`${c.name}:h100:${kind}`] = { ...s, ...blockJson(b) };
      }
    }
    const hs = [10, 50, 100, 300, 1000, 2000];
    const rigs = hs.map((h) => makeRig({ c: std6(), kind: 'v2p', cap: 2000, segs: 10, h, cellPx: 40 }));
    const b = await interleaved(Object.fromEntries(hs.map((h, i) => [`h${h}`, rigs[i]!.rebuild])), REPS, WARM, TURBOFAN(rigs));
    hs.forEach((h, i) => {
      const s = b.sum[`h${h}`]!;
      rows.push([std6().label, String(h), 'v2p', f(s.median), f(s.p95), String(rigs[i]!.ctx.total), String(rigs[i]!.ctx.calls), cond(b)]);
      res[`std6:h${h}:v2p`] = { ...s, ...blockJson(b) };
    });
    table(rows);
    log();
    RES['grids'] = res;
  }, 1_800_000);

  it('11 allocation again, after all other timing tests', async () => {
    await allocSection('11 allocation per steady-state rebuild again, after every other test (2000 x 10, standard 6 km)', 'allocLate');
  }, 1_800_000);

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it('12 extrapolation to a phone and to the 4x throttle', async () => {
    log('== 12 extrapolation');
    // Check of the one data point against this run: the 3-D air step of the calibration engine, timed again at the end.
    const air = airStep(cal!.engine, QUICK ? 8 : 30);
    const air0 = RES['airStepStart'] as Summary;
    log(`3-D air step of a standard 6 km engine: at the start median ${f(air0.median)} ms (min ${f(air0.min)}), at the end median ${f(air.median)} ms (min ${f(air.min)}); the brief quotes 17.5 ms for this machine and 41.1 ms for the phone.`);
    log(`Factor used: ${f(PHONE_FACTOR, 2)}; with this run's medians it would be ${f(41.1 / air0.median, 2)} (start) and ${f(41.1 / air.median, 2)} (end). Load average now: ${loadavg().split(' ').slice(0, 3).join(' ')}`);
    RES['airStep'] = air;
    log(`phone factor ${f(PHONE_FACTOR, 2)} = 41.1 ms (phone) / 17.5 ms (this machine) for the 3-D air step: ONE data point, and the code differs (stencil and multigrid, not a branchy sampler).`);
    log(`4x throttle = 4 x this machine's time. Budgets: ${BUDGET_MS} ms on the phone (plan 9.8), ${BUDGET_MS * THROTTLE} ms at the throttle. Margin: a phone estimate of at most budget / ${MARGIN_FACTOR} = ${f(BUDGET_MS / MARGIN_FACTOR, 1)} ms.`);
    log('The machine is shared and its timings carry interference, which inflates them. The classes take that into account:');
    log('"fits with margin" / "fits": even the p95 of this loaded run x 2.35 is within 5.3 / 8 ms, so a quiet machine can only do better (safe).');
    log('"over (needs Nx)": even the FASTEST rebuild x 2.35 exceeds 8 ms; N is the speed-up that a quiet machine would need over that rebuild to fit (the claim is only as good as the load estimate).');
    log('"undecided": the fastest rebuild fits but the loaded p95 does not.');
    log(`The same rules at the 4x throttle use 4 x the time here against 32 ms, so the last column is the question "is the time here within ${BUDGET_MS} ms": the throttle budget is ${f(THROTTLE / PHONE_FACTOR, 2)}x looser than the phone budget.`);
    const m = RES['matrix'] as Record<string, Summary> | undefined;
    if (!m) {
      log('(matrix missing: run the whole file)');
      return;
    }
    const rows: string[][] = [['glyphs x segs', 'variant', 'here: min / median / p95 ms', 'phone estimate: min / median / p95 ms', 'p95 at the 4x throttle ms', 'against 8 ms on the phone', 'against 32 ms at 4x throttle']];
    const out: Record<string, unknown> = {};
    for (const kind of MATRIX_KINDS) {
      for (const cap of [600, 1200, 2000]) {
        for (const segs of [6, 10, 12]) {
          const s = m[`${kind}:${cap}x${segs}`]!;
          const [pMin, pMed, pP95] = [s.min * PHONE_FACTOR, s.median * PHONE_FACTOR, s.p95 * PHONE_FACTOR];
          const cls = pP95 <= BUDGET_MS / MARGIN_FACTOR ? 'fits with margin' : pP95 <= BUDGET_MS ? 'fits' : pMin > BUDGET_MS ? `over (needs ${f(pMin / BUDGET_MS, 1)}x)` : 'undecided';
          const thMin = s.min * THROTTLE;
          const thP95 = s.p95 * THROTTLE;
          const clsTh = thP95 <= BUDGET_MS * THROTTLE ? 'fits' : thMin > BUDGET_MS * THROTTLE ? `over (needs ${f(thMin / (BUDGET_MS * THROTTLE), 1)}x)` : 'undecided';
          rows.push([`${cap} x ${segs}`, kind, `${f(s.min)} / ${f(s.median)} / ${f(s.p95)}`, `${f(pMin, 1)} / ${f(pMed, 1)} / ${f(pP95, 1)}`, f(thP95, 1), cls, clsTh]);
          out[`${kind}:${cap}x${segs}`] = { here: s, phone: { min: pMin, median: pMed, p95: pP95 }, throttleP95: thP95, cls, clsTh };
        }
      }
    }
    table(rows);
    // How many glyphs fit? Cost is close to linear in the glyph count: scale the 2000-glyph block (an assumption: fixed costs bend it a little).
    const fit: string[][] = [['variant', 'segments', 'median us per glyph here', 'glyphs that fit 8 ms (phone p95 estimate)', 'glyphs that fit 5.3 ms (with margin)', 'glyphs that fit 32 ms at the 4x throttle']];
    const fitOut: Record<string, unknown> = {};
    for (const kind of MATRIX_KINDS) {
      for (const segs of [6, 10, 12]) {
        const s = m[`${kind}:2000x${segs}`]!;
        const g = (budget: number, factor: number): number => Math.floor((2000 * budget) / (s.p95 * factor));
        fit.push([kind, String(segs), f((s.median * 1000) / 2000, 2), String(g(BUDGET_MS, PHONE_FACTOR)), String(g(BUDGET_MS / MARGIN_FACTOR, PHONE_FACTOR)), String(g(BUDGET_MS * THROTTLE, THROTTLE))]);
        fitOut[`${kind}:${segs}`] = { usPerGlyph: (s.median * 1000) / 2000, g8: g(BUDGET_MS, PHONE_FACTOR), g53: g(BUDGET_MS / MARGIN_FACTOR, PHONE_FACTOR), gTh: g(BUDGET_MS * THROTTLE, THROTTLE) };
      }
    }
    table(fit);
    log('(linear scaling of the p95 of the 2000-glyph block; the raster rows are the trace only, without the once-per-snapshot raster build)');
    log();
    RES['extrapolation'] = out;
    RES['fit'] = fitOut;
  });
});
