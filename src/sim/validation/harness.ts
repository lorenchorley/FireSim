/**
 * Harness of the coupled-model validation scenarios (spec docs/research/00-synthesis.md §15, V1–V22), headless in
 * Node: synthetic terrain / fuel / weather scenarios, a runner around `Simulation` with the §15 test hooks
 * ("moisture hook" = constant dead fuel moisture; "surface heating off"), and measurement helpers (ROS from the
 * arrival-time gradient along an axis, burnt extents, insight kinds). Not imported by application code.
 */
import { makeGridSpec, type GridSpec } from '../../core/grid';
import { DEFAULT_SIM_OPTIONS, FuelType, type FuelHistoryCompact, type FuelMap, type Ignition, type Insight, type QualityTier, type ScenarioData, type ScenarioEdit, type SimOptions, type SimSnapshot, type Terrain, type WeatherHour, type WeatherSeries } from '../../core/types';
import { azimuthToUnit } from '../../core/units';
import { uniformFuel } from '../../fire/spread/testing';
import { buildTerrain } from '../../terrain';
import type { EmberLandingEvent } from '../../embers';
import { createHeadKernelOut, headRosKernel } from '../../fire/models';
import { fuelParamsAt } from '../../fuel/fuelMap';
import { cellAt } from '../../core/grid';
import { Simulation, type SimulationTestHooks } from '../simulation';

export const ORIGIN = { lat: -33.715, lon: 150.285 };
export const DEG = Math.PI / 180;

export interface SynthOptions {
  extent?: number;
  cellSize?: number;
  /** z(x, y) (m ASL). Default flat 500 m. */
  elevation?: (x: number, y: number) => number;
  fuelType?: FuelType;
  /** Per-cell fuel type override (null keeps `fuelType`). */
  fuelOverride?: (x: number, y: number, k: number) => FuelType | null;
  /** Full custom fuel map on the fire grid (replaces fuelType / fuelOverride). */
  fuel?: (terrain: Terrain) => FuelMap;
  fuelHistory?: FuelHistoryCompact;
  /** Constant weather (defaults T 32 °C, RH 20 %, 20 km/h from 270°, cloud 0). */
  temperature?: number;
  rh?: number;
  windKmh?: number;
  windFromDeg?: number;
  cloud?: number;
  /** Per-hour override: h = hours from the start (may be negative), tMs = stamp time. */
  hour?: (h: number, tMs: number) => Partial<WeatherHour>;
  /** Scenario start (unix ms); default 2025-12-20 02:00 UTC (13:00 AEDT, ≈ 12:01 LMST). */
  start?: number;
  duration?: number;
  kbdi?: number;
  droughtFactor?: number;
  sourceElevation?: number;
  upperAirSource?: WeatherSeries['upperAirSource'];
  nightTemplate?: WeatherSeries['nightTemplate'];
  options?: Partial<SimOptions>;
  ignitions?: Ignition[];
  edits?: ScenarioEdit[];
  /** A complete weather series (e.g. a preset built for the synthetic site) replacing the constant weather. */
  weather?: WeatherSeries;
}

/** A fully synthetic scenario (analytic terrain, uniform or patterned fuel, hourly weather from −72 h to +30 h). */
export function synth(o: SynthOptions = {}): ScenarioData {
  const extent = o.extent ?? 3000;
  const cell = o.cellSize ?? 30;
  const grid = makeGridSpec(ORIGIN, extent, cell);
  const zf = o.elevation ?? (() => 500);
  const z = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) z[j * grid.nx + i] = zf(grid.x0 + i * cell, grid.y0 + j * cell);
  const terrain = buildTerrain(grid, z, 'synthetic');
  const fuel = o.fuel ? o.fuel(terrain) : uniformFuel(grid, o.fuelType ?? FuelType.DryForestShrubby, o.fuelOverride);
  const start = o.start ?? Date.UTC(2025, 11, 20, 2);
  const hours: WeatherHour[] = [];
  const dur = o.duration ?? 4 * 3600;
  const hEnd = Math.ceil(dur / 3600) + 6;
  for (let h = -72; h <= hEnd; h++) {
    const tMs = start + h * 3.6e6;
    const base: WeatherHour = {
      time: tMs,
      temperature: o.temperature ?? 32,
      relativeHumidity: o.rh ?? 20,
      windSpeed10: (o.windKmh ?? 20) / 3.6,
      windDir10: o.windFromDeg ?? 270,
      cloudCover: o.cloud ?? 0,
      precipitation: 0,
    };
    hours.push({ ...base, ...(o.hour ? o.hour(h, tMs) : {}), time: tMs });
  }
  const weather: WeatherSeries = o.weather ?? {
    kind: 'manual',
    source: 'synthetic',
    location: ORIGIN,
    sourceElevation: o.sourceElevation ?? 500,
    timezone: 'Australia/Sydney',
    hours,
    kbdi: o.kbdi ?? 100,
    droughtFactor: o.droughtFactor ?? 10,
    ...(o.upperAirSource ? { upperAirSource: o.upperAirSource } : {}),
    ...(o.nightTemplate ? { nightTemplate: o.nightTemplate } : {}),
  };
  return {
    id: 'synthetic-validation',
    name: 'Synthetic validation',
    origin: ORIGIN,
    extent,
    terrain,
    fuel,
    weather,
    startTime: start,
    duration: dur,
    ignitions: o.ignitions ?? [],
    edits: o.edits ?? [],
    ...(o.fuelHistory ? { fuelHistory: o.fuelHistory } : {}),
    options: { ...DEFAULT_SIM_OPTIONS, seed: 7, embers: false, maxEmbers: 2000, tier: 'fast', ...(o.options ?? {}) },
  };
}

export const point = (x: number, y: number, time = 0, radius = 15, id = 'p'): Ignition => ({ id, kind: 'point', points: [[x, y]], time, radius, origin: 'observed' });
export const line = (pts: [number, number][], time = 0, id = 'l'): Ignition => ({ id, kind: 'line', points: pts, time, origin: 'observed' });

export interface RunOptions {
  tier?: QualityTier;
  until: number;
  /** Constant dead fine fuel moisture (%) through the moisture hook. */
  moisturePct?: number;
  /** Constant fuel availability through the moisture hook (with moisturePct). */
  availability?: number;
  /** false = surface heating off. */
  heating?: boolean;
  /** Called after every `every` simulated seconds (default 60). */
  onTick?: (sim: Simulation, t: number) => void;
  every?: number;
  /** Keep the snapshots (default true). */
  keepSnaps?: boolean;
  /** Called on the Simulation right after construction (records, options). */
  setup?: (sim: Simulation) => void;
  /** Every ember landing inside the domain. */
  onLanding?: (ev: EmberLandingEvent) => void;
}

export interface RunResult {
  sim: Simulation;
  scenario: ScenarioData;
  snaps: Map<number, SimSnapshot>;
  insights: Insight[];
  wallS: number;
}

/** Run a scenario headless: construct, spin up, advance in `every`-second chunks (chunking never changes results). */
export function runSim(scenario: ScenarioData, o: RunOptions): RunResult {
  const snaps = new Map<number, SimSnapshot>();
  const insights: Insight[] = [];
  const hooks: SimulationTestHooks = {};
  if (o.moisturePct !== undefined) {
    const M = o.moisturePct;
    const FA = o.availability;
    hooks.moisture = (m, fa) => {
      m.fill(M);
      if (FA !== undefined) fa.fill(FA);
    };
  }
  if (o.heating === false) hooks.surfaceHeating = false;
  if (o.onLanding) hooks.emberLanding = o.onLanding;
  const c0 = performance.now();
  const sim = new Simulation(scenario, {
    tier: o.tier ?? 'fast',
    testHooks: hooks,
    hooks: {
      snapshot: (s) => {
        if (o.keepSnaps !== false) snaps.set(s.time, s);
        insights.push(...s.insights);
      },
    },
  });
  for (const i of sim.forecastInsights) insights.push(i);
  o.setup?.(sim);
  sim.spinUp();
  const every = o.every ?? 60;
  for (let t = every; t <= o.until + 1e-6; t += every) {
    sim.advance(t);
    o.onTick?.(sim, sim.time);
  }
  if (sim.time < o.until - 1e-6) sim.advance(o.until);
  return { sim, scenario, snaps, insights, wallS: (performance.now() - c0) / 1000 };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Measurements
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Bilinear sample of a fire-grid field at local (x, y); NaN outside or where any corner is not finite. */
export function sampleField(g: GridSpec, f: ArrayLike<number>, x: number, y: number): number {
  const fi = (x - g.x0) / g.cellSize;
  const fj = (y - g.y0) / g.cellSize;
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return NaN;
  const a = fi - i;
  const b = fj - j;
  const k = j * g.nx + i;
  const v00 = f[k]!;
  const v10 = f[k + 1]!;
  const v01 = f[k + g.nx]!;
  const v11 = f[k + g.nx + 1]!;
  return (1 - a) * (1 - b) * v00 + a * (1 - b) * v10 + (1 - a) * b * v01 + a * b * v11;
}

/**
 * ROS (m/s) from the arrival-time gradient along the ray from (x0, y0) toward azimuth `az`: least-squares slope of
 * distance vs arrival time over [d0, d1] (samples every `step` m). NaN when fewer than 3 samples have arrived.
 */
export function rosAlong(g: GridSpec, tArr: ArrayLike<number>, x0: number, y0: number, az: number, d0: number, d1: number, step = g.cellSize / 2): number {
  const [ux, uy] = azimuthToUnit(az);
  const ds: number[] = [];
  const ts: number[] = [];
  for (let d = d0; d <= d1 + 1e-9; d += step) {
    const t = sampleField(g, tArr, x0 + d * ux, y0 + d * uy);
    if (Number.isFinite(t)) {
      ds.push(d);
      ts.push(t);
    }
  }
  if (ds.length < 3) return NaN;
  const n = ds.length;
  const mt = ts.reduce((a, b) => a + b, 0) / n;
  const md = ds.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let q = 0; q < n; q++) {
    num += (ts[q]! - mt) * (ds[q]! - md);
    den += (ts[q]! - mt) ** 2;
  }
  return den > 0 ? num / den : NaN;
}

/** Largest projection of burnt cells (tArr ≤ T) on the unit vector of azimuth az, about (x0, y0). */
export function extentAlong(g: GridSpec, tArr: ArrayLike<number>, T: number, x0: number, y0: number, az: number, mask?: (k: number) => boolean): number {
  const [ux, uy] = azimuthToUnit(az);
  let d = -Infinity;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      if (!(tArr[k]! <= T) || (mask && !mask(k))) continue;
      const p = (g.x0 + i * g.cellSize - x0) * ux + (g.y0 + j * g.cellSize - y0) * uy;
      if (p > d) d = p;
    }
  }
  return d;
}

export const burntCount = (tArr: ArrayLike<number>, T: number, mask?: (k: number) => boolean): number => {
  let c = 0;
  for (let k = 0; k < tArr.length; k++) if (tArr[k]! <= T && (!mask || mask(k))) c++;
  return c;
};

export const kindsOf = (ins: readonly Insight[]): Set<string> => new Set(ins.map((i) => i.kind));

export function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : 0.5 * (s[m - 1]! + s[m]!);
}

export function quantile(v: number[], q: number): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!;
}

/** Mk2 flat head kernel (R0, R_w in m/h) at cell k for a 10 m wind (km/h) and moisture (%), with the sim's FA and DF. */
export function kernelAt(r: RunResult, k: number, uKmh: number, m: number): { r0: number; rw: number } {
  const K = createHeadKernelOut();
  const v = r.sim.stateView();
  headRosKernel(fuelParamsAt(r.sim.fuel, k), uKmh, m, v.availability[k]!, K, v.droughtFactor);
  return { r0: K.r0, rw: K.rw };
}

/** Mean |U_bg10| (km/h: the background 10 m wind the fire sees, no fire terms) on y = y0 for x ∈ [x0, x1]. */
export function localWindKmh(r: RunResult, x0: number, x1: number, y0: number): number {
  const v = r.sim.stateView();
  const g = r.scenario.terrain.grid;
  let s = 0;
  let n = 0;
  for (let x = x0; x <= x1 + 1e-9; x += g.cellSize) {
    const k = cellAt(g, x, y0);
    s += Math.hypot(v.windBgU[k]!, v.windBgV[k]!);
    n++;
  }
  return (3.6 * s) / Math.max(1, n);
}

export const cellXY = (g: GridSpec, k: number): [number, number] => {
  const i = k % g.nx;
  return [g.x0 + i * g.cellSize, g.y0 + ((k - i) / g.nx) * g.cellSize];
};

export const SLOW = typeof process !== 'undefined' && !!process.env['SLOW'];
export const log = (s: string): void => {
  if (typeof process !== 'undefined') process.stderr.write(`[validation] ${s}\n`);
};
