/**
 * Test-only helpers for the atmosphere module (Node): synthetic and demo terrain, a minimal TerrainFeatures double
 * (the real one is produced by fire/terrainFeatures.ts), a fuel-map double, Open-Meteo fixture parsing into
 * WeatherHour/WeatherSeries (the real parser lives in scenario/), and simple weather builders.
 * Not imported by application code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeGridSpec, type GridSpec } from '../core/grid';
import { FuelType, type FuelMap, type PressureLevelData, type Terrain, type WeatherHour, type WeatherSeries } from '../core/types';
import type { StableNightState, TerrainFeatures } from '../core/simTypes';
import { buildTerrain } from '../terrain';
import { loadDemoDem } from '../data';
import { clamp, wrapDeg, DEG } from '../core/units';

export const TEST_ORIGIN = { lat: -33.715, lon: 150.285 };

/** Terrain from an analytic surface z(x, y) on a square grid. */
export function analyticTerrain(extent: number, cell: number, f: (x: number, y: number) => number, origin = TEST_ORIGIN): Terrain {
  const grid = makeGridSpec(origin, extent, cell);
  const z = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) z[j * grid.nx + i] = f(grid.x0 + i * cell, grid.y0 + j * cell);
  return buildTerrain(grid, z, 'analytic test surface');
}

export const flatTerrain = (extent = 6000, cell = 30, z0 = 700): Terrain => analyticTerrain(extent, cell, () => z0);

/** Katoomba demo: the bundled 10 m LiDAR DTM cropped to `extent`, block-averaged to the fire grid `cell`. */
export async function katoombaTerrain(extent = 6000, cell = 30): Promise<{ terrain: Terrain; hiRes: { grid: GridSpec; elevation: Float32Array } }> {
  const dem = await loadDemoDem('katoomba');
  if (!dem) throw new Error('Katoomba DTM missing');
  const src = dem.grid;
  // Crop the 10 m grid (centred) to the extent.
  const nHi = Math.round(extent / src.cellSize);
  const off = Math.floor((src.nx - nHi) / 2);
  const hiGrid = makeGridSpec(src.origin, extent, src.cellSize);
  const hiZ = new Float32Array(nHi * nHi);
  for (let j = 0; j < nHi; j++) for (let i = 0; i < nHi; i++) hiZ[j * nHi + i] = dem.elevation[(j + off) * src.nx + (i + off)]!;
  // Block average to the fire grid.
  const fire = makeGridSpec(src.origin, extent, cell);
  const sum = new Float64Array(fire.nx * fire.ny);
  const cnt = new Float64Array(fire.nx * fire.ny);
  for (let j = 0; j < nHi; j++) {
    const fj = clamp(Math.round((hiGrid.y0 + j * hiGrid.cellSize - fire.y0) / cell), 0, fire.ny - 1);
    for (let i = 0; i < nHi; i++) {
      const fi = clamp(Math.round((hiGrid.x0 + i * hiGrid.cellSize - fire.x0) / cell), 0, fire.nx - 1);
      sum[fj * fire.nx + fi]! += hiZ[j * nHi + i]!;
      cnt[fj * fire.nx + fi]! += 1;
    }
  }
  const z = new Float32Array(fire.nx * fire.ny);
  for (let k = 0; k < z.length; k++) z[k] = sum[k]! / Math.max(1, cnt[k]!);
  return { terrain: buildTerrain(fire, z, 'Katoomba LiDAR (test crop)'), hiRes: { grid: hiGrid, elevation: hiZ } };
}

/** Fuel-map double: uniform fuel type and canopy. */
export function fuelDouble(g: GridSpec, type: FuelType = FuelType.DryForestShrubby, canopyHeight = 20, cover = 0.5): FuelMap {
  const n = g.nx * g.ny;
  const f = (v: number): Float32Array => new Float32Array(n).fill(v);
  return {
    grid: g,
    type: new Uint8Array(n).fill(type),
    surfaceHazard: f(3),
    nearSurfaceHazard: f(3),
    nearSurfaceHeight: f(0.3),
    elevatedHazard: f(2),
    elevatedHeight: f(1.5),
    barkHazard: f(2),
    surfaceLoad: f(12),
    nearSurfaceLoad: f(5),
    elevatedLoad: f(3),
    barkLoad: f(1),
    canopyHeight: f(canopyHeight),
    canopyCover: f(cover),
    curing: f(0),
    timeSinceFire: f(NaN),
    lastFireKind: new Uint8Array(n),
    sources: ['test double'],
  };
}

/**
 * Minimal TerrainFeatures double: valleyDrop / crestRise / crestDist from D8 steepest-descent / ascent paths, ridge
 * from TPI and landform, crest() by marching toward windFrom (§7.9 rules, simplified). Enough for atmosphere tests.
 */
export function featuresDouble(t: Terrain): TerrainFeatures {
  const g = t.grid;
  const { nx, ny, cellSize: h } = g;
  const n = nx * ny;
  const z = t.elevation;
  const valleyDrop = new Float32Array(n);
  const crestRise = new Float32Array(n);
  const crestDist = new Float32Array(n);
  const ridge = new Uint8Array(n);
  const nbr = (k: number, dir: -1 | 1): number => {
    const i = k % nx;
    const j = (k - i) / nx;
    let best = k;
    let bz = z[k]!;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii;
        const dz = (z[kk]! - z[k]!) / Math.hypot(di, dj);
        if (dir < 0 ? z[kk]! < bz && dz < 0 : z[kk]! > bz && dz > 0) {
          if (dir < 0 ? z[kk]! < bz : z[kk]! > bz) {
            best = kk;
            bz = z[kk]!;
          }
        }
      }
    }
    return best;
  };
  const down = new Int32Array(n);
  const up = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    down[k] = nbr(k, -1);
    up[k] = nbr(k, 1);
  }
  for (let k = 0; k < n; k++) {
    let c = k;
    for (let s = 0; s < 400 && down[c] !== c; s++) c = down[c]!;
    valleyDrop[k] = z[k]! - z[c]!;
    c = k;
    let d = 0;
    for (let s = 0; s < 400 && up[c] !== c; s++) {
      const nxt = up[c]!;
      d += h * Math.hypot((nxt % nx) - (c % nx), Math.floor(nxt / nx) - Math.floor(c / nx));
      c = nxt;
    }
    crestRise[k] = z[c]! - z[k]!;
    crestDist[k] = d;
    ridge[k] = t.landform[k] === 1 || t.landform[k] === 9 || t.landform[k] === 2 ? 1 : 0;
  }
  const empty = (): Float32Array => new Float32Array(n);
  return {
    flowAcc: empty(),
    drainage: new Uint8Array(n),
    trench: empty(),
    gullyAxis: new Float32Array(n).fill(NaN),
    gullyBase: new Int32Array(n).fill(-1),
    saddle: new Uint8Array(n),
    ridge,
    cliff: new Uint8Array(n),
    narrowValley: new Uint8Array(n),
    slope30: Float32Array.from(t.slopeDeg),
    valleyDrop,
    crestRise,
    crestDist,
    crest(k: number, windFromDeg: number) {
      const i0 = k % nx;
      const j0 = (k - i0) / nx;
      const sx = Math.sin(windFromDeg * DEG);
      const sy = Math.cos(windFromDeg * DEG);
      let prevZ = z[k]!;
      for (let d = h; d <= 600; d += h) {
        const i = Math.round(i0 + (sx * d) / h);
        const j = Math.round(j0 + (sy * d) / h);
        if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
        const kk = j * nx + i;
        const i2 = Math.round(i0 + (sx * (d + h)) / h);
        const j2 = Math.round(j0 + (sy * (d + h)) / h);
        const beyond = i2 >= 0 && j2 >= 0 && i2 < nx && j2 < ny ? z[j2 * nx + i2]! : z[kk]!;
        if (ridge[kk] && z[kk]! > z[k]! && beyond <= z[kk]! && z[kk]! >= prevZ) return { d, zCrest: z[kk]!, relief: z[kk]! - (z[k]! - 0), kCrest: kk };
        prevZ = z[kk]!;
      }
      return null;
    },
  };
}

/** A calm night state (no cold pool) or one with Δθ. */
export function nightState(dTheta = 0, hInv = 150): StableNightState {
  return { dTheta, dThetaAtSunrise: dTheta, tSunrise: null, dThetaMax: 5, hInv, gate: 1, tBreak: null, sn: clamp(dTheta / 3, 0, 1) };
}

/** Simple hour with a 10 m wind, optional profile and levels. */
export function hour(time: number, speed10: number, dirFrom: number, extra: Partial<WeatherHour> = {}): WeatherHour {
  return { time, temperature: 20, relativeHumidity: 40, windSpeed10: speed10, windDir10: wrapDeg(dirFrom), cloudCover: 0, ...extra };
}

export function seriesOf(hours: WeatherHour[], extra: Partial<WeatherSeries> = {}): WeatherSeries {
  return { kind: 'fixture', source: 'test', location: TEST_ORIGIN, timezone: 'Australia/Sydney', hours, ...extra };
}

const FIX_DIR = fileURLToPath(new URL('../../tests/fixtures/live/', import.meta.url));

/** Parse an Open-Meteo fixture (hourly block) into a WeatherSeries (subset of the scenario/ parser, §11.2). */
export function parseOpenMeteoFixture(file: string): WeatherSeries {
  const j = JSON.parse(readFileSync(FIX_DIR + file, 'utf8')) as {
    latitude: number;
    longitude: number;
    elevation: number;
    utc_offset_seconds: number;
    hourly: Record<string, (number | null)[] | string[]>;
    hourly_units: Record<string, string>;
  };
  const H = j.hourly;
  const times = H.time as string[];
  const num = (key: string, i: number): number | undefined => {
    if (j.hourly_units[key] === undefined || j.hourly_units[key] === 'undefined') return undefined;
    const a = H[key] as (number | null)[] | undefined;
    const v = a?.[i];
    return v === null || v === undefined ? undefined : v;
  };
  const hours: WeatherHour[] = [];
  let nLevelsMax = 0;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]! + ':00Z') - j.utc_offset_seconds * 1000;
    const profile = [80, 100, 120, 180]
      .map((z) => ({ heightAGL: z, speed: num(`wind_speed_${z}m`, i), dir: num(`wind_direction_${z}m`, i) }))
      .filter((p) => p.speed !== undefined && p.dir !== undefined) as { heightAGL: number; speed: number; dir: number }[];
    const levels: PressureLevelData[] = [];
    for (const p of [925, 850, 700, 500]) {
      const T = num(`temperature_${p}hPa`, i);
      const Z = num(`geopotential_height_${p}hPa`, i);
      const ws = num(`wind_speed_${p}hPa`, i);
      const wd = num(`wind_direction_${p}hPa`, i);
      const rh = num(`relative_humidity_${p}hPa`, i);
      if (T === undefined || Z === undefined || ws === undefined || wd === undefined) continue;
      levels.push({ hPa: p, height: Z, temperature: T, relativeHumidity: rh ?? 50, windSpeed: ws, windDir: wd });
    }
    nLevelsMax = Math.max(nLevelsMax, levels.length);
    const w: WeatherHour = {
      time: t,
      temperature: num('temperature_2m', i) ?? 15,
      relativeHumidity: num('relative_humidity_2m', i) ?? 50,
      dewPoint: num('dew_point_2m', i),
      windSpeed10: num('wind_speed_10m', i) ?? 0,
      windDir10: num('wind_direction_10m', i) ?? 0,
      cloudCover: num('cloud_cover', i),
      shortwaveRadiation: num('shortwave_radiation', i),
      boundaryLayerHeight: num('boundary_layer_height', i),
      surfacePressure: num('surface_pressure', i),
    };
    if (profile.length) w.windProfile = profile;
    if (levels.length) w.pressureLevels = levels;
    hours.push(w);
  }
  return {
    kind: 'fixture',
    source: file,
    location: { lat: j.latitude, lon: j.longitude },
    sourceElevation: j.elevation,
    timezone: 'Australia/Sydney',
    hours,
    upperAirSource: nLevelsMax >= 3 ? 'model' : 'synthetic',
  };
}
