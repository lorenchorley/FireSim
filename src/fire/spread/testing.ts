/**
 * Test / dev helpers of the spread module (not imported by application code): synthetic fire-grid terrain, uniform
 * fuel maps, a constant SpreadEnvironment (the sim's role in spec §12.2 steps 2–4, including the lee-separation blend
 * of §7.9 that atmosphere/ applies in `surfaceWindForFire`), and a small driver loop that calls the model in the
 * normative coupling order (refreshMasks every 60 s, prepare, step, minuteTasks every 60 s).
 */
import { makeGridSpec, type GridSpec } from '../../core/grid';
import { Rng } from '../../core/rng';
import type { SpreadEnvironment, TerrainFeatures } from '../../core/simTypes';
import { DEFAULT_SIM_OPTIONS, FuelType, type FuelMap, type SimOptions, type Terrain, type WeatherHour } from '../../core/types';
import { windToUV } from '../../core/units';
import { fuelAvailabilityMk2 } from '../../fuel/moisture/availability';
import { buildTerrain, terrainDerived } from '../../terrain';
import { computeTerrainFeatures } from '../terrainFeatures';
import { FireSpreadModel } from './FireSpreadModel';
import type { SpreadParamsOverride } from './params';

export const TEST_ORIGIN = { lat: -33.7, lon: 150.3 };

/** Terrain of z = f(x, y) (local m) on a square grid of side `extentM` (fire grid). */
export function syntheticTerrain(extentM: number, cellSize: number, f: (x: number, y: number) => number): Terrain {
  const g = makeGridSpec(TEST_ORIGIN, extentM, cellSize);
  const z = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = f(g.x0 + i * cellSize, g.y0 + j * cellSize);
  return buildTerrain(g, z, 'synthetic');
}

/**
 * Fuel map of one type everywhere (all per-cell values NaN → the type's steady-state row via fuelParamsAt), with an
 * optional per-cell type override (return null to keep the default).
 */
export function uniformFuel(grid: GridSpec, type: FuelType, override?: (x: number, y: number, k: number) => FuelType | null): FuelMap {
  const n = grid.nx * grid.ny;
  const nan = (): Float32Array => new Float32Array(n).fill(NaN);
  const t = new Uint8Array(n).fill(type);
  if (override) {
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const k = j * grid.nx + i;
        const o = override(grid.x0 + i * grid.cellSize, grid.y0 + j * grid.cellSize, k);
        if (o !== null) t[k] = o;
      }
    }
  }
  return {
    grid, type: t, surfaceHazard: nan(), nearSurfaceHazard: nan(), nearSurfaceHeight: nan(), elevatedHazard: nan(), elevatedHeight: nan(),
    barkHazard: nan(), surfaceLoad: nan(), nearSurfaceLoad: nan(), elevatedLoad: nan(), barkLoad: nan(), canopyHeight: nan(), canopyCover: nan(),
    curing: nan(), timeSinceFire: nan(), lastFireKind: new Uint8Array(n), sources: ['test'],
  };
}

export interface TestEnvOptions {
  windKmh?: number;
  windFromDeg?: number;
  moisturePct?: number;
  droughtFactor?: number;
  mountainPhenomena?: boolean;
  pyrogenicOn?: boolean;
  /** Per-cell U_ridge (m/s): 'crest' = |U_bg10| wherever features.crest(k, windFrom) exists (D42), else NaN. */
  uRidge?: 'crest' | 'none';
}

/** Constant environment (uniform open wind, moisture, FA = Mk2 logistic of DF). */
export function testEnv(grid: GridSpec, o: TestEnvOptions = {}, features?: TerrainFeatures): SpreadEnvironment {
  const n = grid.nx * grid.ny;
  const U = (o.windKmh ?? 0) / 3.6;
  const from = o.windFromDeg ?? 270;
  const [u, v] = windToUV(U, from);
  const fill = (x: number): Float32Array => new Float32Array(n).fill(x);
  const df = o.droughtFactor ?? 10;
  const uRidge = fill(NaN);
  if (o.uRidge === 'crest' && features) for (let k = 0; k < n; k++) if (features.crest(k, from)) uRidge[k] = U;
  const weather: WeatherHour = { time: Date.UTC(2019, 11, 20, 3), temperature: 30, relativeHumidity: 20, windSpeed10: U, windDir10: from };
  return {
    windU: fill(u), windV: fill(v), windBgU: fill(u), windBgV: fill(v), fireIndU: fill(0), fireIndV: fill(0), uRidge,
    moisture: fill(o.moisturePct ?? 8), availability: fill(fuelAvailabilityMk2(df)), fuelTempC: fill(35), airT: fill(30), airRho: fill(1.1),
    droughtFactor: df, kbdi: 100, weather, time: 0, sunElevation: 50, lmstHour: 14, cloudFrac: 0,
    mountainPhenomena: o.mountainPhenomena ?? false, pyrogenicOn: o.pyrogenicOn ?? false, coupling: 0,
  };
}

/** Apply the §7.9 lee-separation blend to the fire wind the way atmosphere/ does: U ← (1 − s)U + s·0.3·U_ridge·û_up. */
export function applyLeeSeparation(env: SpreadEnvironment, terrain: Terrain, sep: Float32Array, base: { u: Float32Array; v: Float32Array }): void {
  const n = sep.length;
  for (let k = 0; k < n; k++) {
    const s = sep[k]!;
    const ur = env.uRidge[k]!;
    if (!(s > 0) || !(ur === ur)) {
      env.windU[k] = base.u[k]!;
      env.windV[k] = base.v[k]!;
      continue;
    }
    const gx = terrain.dzdx[k]!;
    const gy = terrain.dzdy[k]!;
    const gn = Math.hypot(gx, gy);
    const ux = gn > 0 ? gx / gn : 0;
    const uy = gn > 0 ? gy / gn : 0;
    env.windU[k] = (1 - s) * base.u[k]! + s * 0.3 * ur * ux;
    env.windV[k] = (1 - s) * base.v[k]! + s * 0.3 * ur * uy;
  }
}

export interface Scenario {
  terrain: Terrain;
  features: TerrainFeatures;
  fuel: FuelMap;
  model: FireSpreadModel;
  env: SpreadEnvironment;
}

/** Terrain + features + fuel + model + environment in one call. */
export function makeScenario(
  terrain: Terrain, fuel: FuelMap, envOpts: TestEnvOptions = {}, opts: Partial<SimOptions> = {}, params?: SpreadParamsOverride, seed = 2,
): Scenario {
  const features = computeTerrainFeatures(terrain, terrainDerived(terrain));
  const so: SimOptions = { ...DEFAULT_SIM_OPTIONS, fireCellSize: terrain.grid.cellSize, mountainPhenomena: envOpts.mountainPhenomena ?? false, ...opts };
  const model = new FireSpreadModel(terrain, fuel, features, so, new Rng(seed), params);
  const env = testEnv(terrain.grid, envOpts, features);
  return { terrain, features, fuel, model, env };
}

export interface RunOptions {
  /** Atmosphere step Δt_a (s). */
  dtA?: number;
  /** Apply the lee-separation blend to the wind after each refreshMasks (emulates atmosphere/). */
  leeBlend?: boolean;
  /** Called after each step with the time (s); return true to stop. */
  onStep?: (t: number) => boolean | void;
}

/** Run the model from its current time for `duration` s in the §12.2 order. */
export function runScenario(s: Scenario, duration: number, o: RunOptions = {}): void {
  const dtA = o.dtA ?? 12;
  const { model, env } = s;
  const base = o.leeBlend ? { u: env.windU.slice(), v: env.windV.slice() } : null;
  const t0 = model.time;
  let nextMin = t0;
  model.refreshMoistureCache(env);
  let t = t0;
  while (t < t0 + duration - 1e-9) {
    const dt = Math.min(dtA, t0 + duration - t);
    env.time = t;
    if (t >= nextMin) {
      model.refreshMasks(env);
      if (base) applyLeeSeparation(env, s.terrain, model.aux().sep, base);
    }
    model.prepare(env);
    model.step(dt, env);
    t += dt;
    env.time = t;
    if (t >= nextMin) {
      model.minuteTasks(env);
      nextMin += 60;
    }
    if (o.onStep && o.onStep(t)) break;
  }
}
