/**
 * Test / dev scenario builders for sim/ (Node, offline): the bundled demo sites through the production scenario
 * builder (`buildScenario`, demo DEM + canopy + SVTM + NPWS history, preset / replay weather), plus small helpers to
 * pick ignition points on the terrain. Not imported by application code.
 */
import { makeGridSpec } from '../../core/grid';
import { DEFAULT_SIM_OPTIONS, FuelType, type Ignition, type QualityTier, type ScenarioData, type SimOptions, type Terrain, type WeatherHour, type WeatherSeries } from '../../core/types';
import { uniformFuel } from '../../fire/spread/testing';
import { buildScenario } from '../../scenario';
import { DEMO_SITES } from '../../data/demoSites';
import { buildTerrain } from '../../terrain';
import { civilToUtc } from '../../scenario/time';

export interface DemoScenarioOptions {
  site?: string;
  /** 'preset' (default) or 'replay'. */
  preset?: string;
  replay?: string;
  /** Civil (Australia/Sydney) start for presets: [y, m, d, h]. */
  startCivil?: [number, number, number, number];
  /** Simulated duration (s). */
  duration?: number;
  extent?: number;
  tier?: 'auto' | QualityTier;
  options?: Partial<SimOptions>;
}

const cache = new Map<string, Promise<ScenarioData>>();

/** Build (and memoise per process) a demo-site scenario offline. The returned object is shared: do not mutate. */
export function demoScenario(o: DemoScenarioOptions = {}): Promise<ScenarioData> {
  const key = JSON.stringify(o);
  let p = cache.get(key);
  if (!p) {
    const site = o.site ?? 'katoomba';
    const centre = (DEMO_SITES.find((s) => s.id === site) ?? DEMO_SITES[0]!).centre;
    const [y, m, d, h] = o.startCivil ?? [2025, 12, 20, 11];
    const weather = o.replay
      ? ({ kind: 'replay', replayId: o.replay } as const)
      : ({ kind: 'preset', presetId: o.preset ?? 'hot-nw-sw-change', start: civilToUtc(y, m, d, h) } as const);
    p = buildScenario({
      centre,
      extent: o.extent ?? 9000,
      demoSiteId: site,
      weather,
      duration: o.duration ?? 3 * 3600,
      online: false,
      options: { ...(o.tier ? { tier: o.tier } : {}), ...(o.options ?? {}) },
    });
    cache.set(key, p);
  }
  return p;
}

/** A shallow copy of a scenario with different ignitions / options (arrays shared; the sim never mutates them). */
export function withIgnitions(s: ScenarioData, ignitions: Ignition[], options: Partial<SimOptions> = {}): ScenarioData {
  return { ...s, ignitions, options: { ...s.options, ...options } };
}

/** Local coordinates (m) of cell k. */
export function cellXY(t: Terrain, k: number): [number, number] {
  const g = t.grid;
  const i = k % g.nx;
  const j = (k - i) / g.nx;
  return [g.x0 + i * g.cellSize, g.y0 + j * g.cellSize];
}

/** Cell index of local (x, y) (nearest; clamped). */
export function cellOf(t: Terrain, x: number, y: number): number {
  const g = t.grid;
  const i = Math.min(g.nx - 1, Math.max(0, Math.round((x - g.x0) / g.cellSize)));
  const j = Math.min(g.ny - 1, Math.max(0, Math.round((y - g.y0) / g.cellSize)));
  return j * g.nx + i;
}

/** A point ignition record. */
export const pointIgnition = (id: string, x: number, y: number, time = 0, radius = 45): Ignition => ({
  id,
  kind: 'point',
  points: [[x, y]],
  time,
  radius,
  origin: 'observed',
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Synthetic scenario (unit tests): analytic terrain, uniform fuel, constant weather
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SyntheticScenarioOptions {
  extent?: number;
  cellSize?: number;
  /** z(x, y) (m); default: flat west half at 500 m, the east half rising at `slopeDeg`. */
  elevation?: (x: number, y: number) => number;
  slopeDeg?: number;
  fuelType?: number;
  /** Constant weather. */
  temperature?: number;
  rh?: number;
  windKmh?: number;
  windFromDeg?: number;
  cloud?: number;
  /** Scenario start (unix ms); default 2025-12-20 02:00 UTC (13:00 AEDT). */
  start?: number;
  duration?: number;
  kbdi?: number;
  droughtFactor?: number;
  options?: Partial<SimOptions>;
  ignitions?: Ignition[];
}

/** A small, fully synthetic ScenarioData (no assets), quick enough for unit tests of the orchestrator. */
export function syntheticScenario(o: SyntheticScenarioOptions = {}): ScenarioData {
  const extent = o.extent ?? 3000;
  const cell = o.cellSize ?? 30;
  const origin = { lat: -33.715, lon: 150.285 };
  const grid = makeGridSpec(origin, extent, cell);
  const tan = Math.tan(((o.slopeDeg ?? 15) * Math.PI) / 180);
  const zf = o.elevation ?? ((x: number) => 500 + Math.max(0, x) * tan);
  const z = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) z[j * grid.nx + i] = zf(grid.x0 + i * cell, grid.y0 + j * cell);
  const terrain = buildTerrain(grid, z, 'synthetic');
  const fuel = uniformFuel(grid, (o.fuelType ?? FuelType.DryForestShrubby) as FuelType);
  const start = o.start ?? Date.UTC(2025, 11, 20, 2);
  const hours: WeatherHour[] = [];
  const U = (o.windKmh ?? 20) / 3.6;
  for (let h = -72; h <= 24; h++) {
    hours.push({
      time: start + h * 3.6e6,
      temperature: o.temperature ?? 32,
      relativeHumidity: o.rh ?? 20,
      windSpeed10: U,
      windDir10: o.windFromDeg ?? 270,
      cloudCover: o.cloud ?? 0,
      precipitation: 0,
    });
  }
  const weather: WeatherSeries = {
    kind: 'manual',
    source: 'synthetic',
    location: origin,
    sourceElevation: 500,
    timezone: 'Australia/Sydney',
    hours,
    kbdi: o.kbdi ?? 100,
    droughtFactor: o.droughtFactor ?? 9,
  };
  return {
    id: 'synthetic',
    name: 'Synthetic slope',
    origin,
    extent,
    terrain,
    fuel,
    weather,
    startTime: start,
    duration: o.duration ?? 4 * 3600,
    ignitions: o.ignitions ?? [],
    edits: [],
    options: { ...DEFAULT_SIM_OPTIONS, seed: 7, maxEmbers: 1000, tier: 'fast', ...(o.options ?? {}) },
  };
}
