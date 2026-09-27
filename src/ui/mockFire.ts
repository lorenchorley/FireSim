/**
 * A deliberately simple, plausible fire-spread solver for the UI mocks (NOT the simulation model).
 *
 * It computes fire arrival times on the terrain grid with a time-dependent Dijkstra (minimum travel time) over a
 * 16-neighbour stencil. The travel speed in each direction is a McArthur-style product
 *   R = R₀(fuel) · f_moisture · f_wind(ellipse) · f_slope(directional, kataburn downhill) · f_terrain
 * so fires grow as ellipses downwind, run uphill, slow in moist gullies and turn when the wind changes. Good enough
 * to exercise every UI path (insights, explanations, overlays, scrubbing) before the real engine lands.
 */
import { FuelType, SpreadDriver, type FuelMap, type SpreadFactors, type Terrain, type WeatherHour, type WeatherSeries, type WindEdit } from '../core/types';
import { DEG, RAD, angleDiffDeg, clamp, msToKmh, uvToWind, vectorAzimuthDeg, windToUV, wrapDeg } from '../core/units';
import { weatherAt } from './weatherSeries';
import { deadFuelMoisture, moisturePeriod } from './weatherCalc';
import { localHour } from './format';

export interface Seed {
  x: number;
  y: number;
  /** Simulation time (s) the seed is alight. */
  time: number;
}

export interface MockFireOptions {
  /** 0–1 fire–atmosphere coupling (adds a plume indraft/acceleration at high intensity). */
  coupling: number;
  /** Eruptive (steep gully) behaviour on/off. */
  mountainPhenomena: boolean;
}

export interface MockFireResult {
  arrival: Float32Array;
  ros: Float32Array;
  spreadDir: Float32Array;
  intensity: Float32Array;
  flameHeight: Float32Array;
  driver: Uint8Array;
  phase: Uint8Array;
  /** Factor decomposition at arrival, 6 floats per cell [base, wind, moisture, fuel, slope, terrain]. */
  factors: Float32Array;
}

/** Heat of combustion (kJ/kg) for Byram intensity. */
const H = 18_600;

/** No-wind, no-slope spread rate (m/s) at 8 % moisture for each fuel type (rough, for display only). */
const BASE_ROS: Record<FuelType, number> = {
  [FuelType.NonFuel]: 0,
  [FuelType.Water]: 0,
  [FuelType.Grassland]: 0.06,
  [FuelType.GrassyWoodland]: 0.045,
  [FuelType.DryForestShrubby]: 0.028,
  [FuelType.DryForestGrassy]: 0.03,
  [FuelType.WetForest]: 0.014,
  [FuelType.Rainforest]: 0.004,
  [FuelType.Heath]: 0.035,
  [FuelType.AlpineHeathGrass]: 0.04,
  [FuelType.SnowGumWoodland]: 0.03,
  [FuelType.PinePlantation]: 0.025,
  [FuelType.Urban]: 0.008,
};

export const isBurnable = (t: number): boolean => t !== FuelType.NonFuel && t !== FuelType.Water;

/** McArthur slope factor uphill (e^0.069θ) and the CSIRO "kataburn" form downhill (never below 0.5). */
export function slopeFactor(thetaDeg: number): number {
  const t = clamp(thetaDeg, -35, 35);
  if (t >= 0) return Math.exp(0.069 * t);
  const up = Math.exp(0.069 * -t);
  return up / (2 * up - 1);
}

/** Head-fire wind multiplier from the 10 m open wind (km/h). */
export const windFactor = (kmh: number): number => 1 + 0.6 * (Math.max(0, kmh) / 10) ** 2;

/** Length-to-breadth ratio of the wind-driven ellipse. */
export const lengthBreadth = (kmh: number): number => 1 + 0.0065 * Math.max(0, kmh) ** 1.5;

/** Moisture multiplier relative to 8 % (drier → faster); 0 above the extinction moisture (~30 %). */
export function moistureFactor(m: number): number {
  if (m >= 30) return 0;
  return clamp(Math.exp(-0.105 * (m - 8)), 0, 2.2) * (m > 22 ? (30 - m) / 8 : 1);
}

/** Fuel-structure multiplier from hazard scores relative to "high" (3) litter and elevated fuel. */
export function fuelFactor(fuel: FuelMap, k: number): number {
  const s = fuel.surfaceHazard[k]!;
  const ns = fuel.nearSurfaceHazard[k]!;
  const el = fuel.elevatedHazard[k]!;
  return clamp(0.2 * s + 0.1 * ns + 0.08 * el - 0.02, 0.2, 2.2);
}

/** Fine fuel available to the flaming front (t/ha). */
export const fineFuel = (fuel: FuelMap, k: number): number =>
  fuel.surfaceLoad[k]! + fuel.nearSurfaceLoad[k]! + 0.6 * fuel.elevatedLoad[k]! + 0.5 * fuel.barkLoad[k]!;

/**
 * Dead fine fuel moisture (%) at a cell: Matthews (2010) from T/RH, adjusted for aspect (north/west-facing slopes
 * drier in the afternoon, south-facing moister), gullies and canopy shade, plus user moisture edits.
 */
export function cellMoisture(terrain: Terrain, fuel: FuelMap, k: number, w: WeatherHour, hourLocal: number, delta = 0): number {
  const base = deadFuelMoisture(w.temperature, w.relativeHumidity, moisturePeriod(hourLocal, w.cloudCover ?? 0));
  const asp = terrain.aspectDeg[k]!;
  const slope = terrain.slopeDeg[k]!;
  let adj = 0;
  if (Number.isFinite(asp) && slope > 5) {
    const northness = Math.cos(asp * DEG); // +1 north-facing (sunny in the Southern Hemisphere)
    const day = hourLocal > 9 && hourLocal < 18 ? 1 : 0.3;
    adj -= northness * 1.6 * day * Math.min(1, slope / 25);
  }
  if (terrain.tpi[k]! < -8) adj += Math.min(4, -terrain.tpi[k]! / 12);
  adj += fuel.canopyCover[k]! * 1.5;
  if (fuel.type[k] === FuelType.WetForest) adj += 4;
  if (fuel.type[k] === FuelType.Rainforest) adj += 10;
  return clamp(base + adj + delta, 2, 40);
}

/** Minimal binary heap of (time, index). */
class Heap {
  private t: number[] = [];
  private k: number[] = [];
  get size(): number {
    return this.t.length;
  }
  push(time: number, k: number): void {
    const t = this.t;
    const kk = this.k;
    let i = t.length;
    t.push(time);
    kk.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (t[p]! <= time) break;
      t[i] = t[p]!;
      kk[i] = kk[p]!;
      i = p;
    }
    t[i] = time;
    kk[i] = k;
  }
  pop(): [number, number] {
    const t = this.t;
    const kk = this.k;
    const topT = t[0]!;
    const topK = kk[0]!;
    const lastT = t.pop()!;
    const lastK = kk.pop()!;
    const n = t.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && t[r]! < t[l]! ? r : l;
        if (t[c]! >= lastT) break;
        t[i] = t[c]!;
        kk[i] = kk[c]!;
        i = c;
      }
      t[i] = lastT;
      kk[i] = lastK;
    }
    return [topT, topK];
  }
}

/** 16-neighbour stencil (8 + knight moves) to reduce grid anisotropy. */
const STENCIL: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
];

export interface SolveInput {
  terrain: Terrain;
  fuel: FuelMap;
  weather: WeatherSeries;
  /** Scenario start (unix ms). */
  startTime: number;
  /** Stop expanding beyond this simulation time (s). */
  horizon: number;
  seeds: Seed[];
  windEdits: WindEdit[];
  /** Per-cell additive moisture change (percentage points) from fuel edits, or null. */
  moistureDelta: Float32Array | null;
  options: MockFireOptions;
}

/** Wind at a point and time including user wind edits (m/s, direction FROM). */
export function windAt(input: Pick<SolveInput, 'weather' | 'startTime' | 'windEdits'>, x: number, y: number, t: number): { speed: number; dir: number } {
  const w = weatherAt(input.weather, input.startTime + t * 1000);
  let speed = w.windSpeed10;
  let dir = w.windDir10;
  for (const e of input.windEdits) {
    if (t < e.time) continue;
    const d = Math.hypot(x - e.x, y - e.y);
    if (d >= e.radius) continue;
    const a = 1 - (d / e.radius) ** 2; // smooth blend to the ambient wind at the edge
    const [u0, v0] = windToUV(speed, dir);
    const [u1, v1] = windToUV(e.speed, e.dir);
    const [, nd] = uvToWind(u0 + (u1 - u0) * a, v0 + (v1 - v0) * a);
    speed = speed + (e.speed - speed) * a;
    dir = nd;
  }
  return { speed, dir };
}

/** Directional spread rate (m/s) and its factor decomposition for travel from cell k towards azimuth az. */
export function directionalRos(
  input: SolveInput,
  k: number,
  az: number,
  _t: number,
  cache: { wind: { speed: number; dir: number }; moisture: number },
): { ros: number; f: SpreadFactors; driver: SpreadDriver; thetaD: number } {
  const { terrain, fuel, options } = input;
  const type = fuel.type[k]!;
  const base = BASE_ROS[type as FuelType] ?? 0;
  const fM = moistureFactor(cache.moisture);
  const fF = fuelFactor(fuel, k);
  const kmh = msToKmh(cache.wind.speed);
  const lb = lengthBreadth(kmh);
  const e = Math.sqrt(Math.max(0, 1 - 1 / (lb * lb)));
  const windTo = wrapDeg(cache.wind.dir + 180);
  const phi = angleDiffDeg(az, windTo) * DEG;
  const fW = (windFactor(kmh) * (1 - e)) / (1 - e * Math.cos(phi));
  const s = terrain.dzdx[k]! * Math.sin(az * DEG) + terrain.dzdy[k]! * Math.cos(az * DEG);
  const thetaD = Math.atan(s) * RAD;
  const fS = slopeFactor(thetaD);
  let fT = 1;
  if (options.mountainPhenomena && thetaD > 24 && (terrain.curvature[k]! < 0 || terrain.tpi[k]! < -5)) fT = 1 + Math.min(0.8, (thetaD - 24) / 12);
  // Coupling: the plume draws air in and accelerates strong head fires a little.
  if (options.coupling > 0 && kmh > 20 && Math.abs(phi) < 0.6) fT *= 1 + 0.2 * options.coupling;
  const ros = base * fM * fF * fW * fS * fT;
  let driver: SpreadDriver;
  const lw = Math.log(Math.max(1e-6, fW));
  const ls = Math.log(Math.max(1e-6, fS));
  if (fT > 1.3 && thetaD > 24) driver = SpreadDriver.Eruptive;
  else if (fW < 0.9 && fS < 1.1) driver = SpreadDriver.Backing;
  else if (lw > 0.4 && ls > 0.4) driver = SpreadDriver.WindAndSlope;
  else if (ls > lw && ls > 0.3) driver = SpreadDriver.Slope;
  else if (lw > 0.3) driver = SpreadDriver.Wind;
  else if (fM > 1.3) driver = SpreadDriver.DryFuel;
  else driver = SpreadDriver.Fuel;
  return { ros, f: { base, wind: fW, moisture: fM, fuel: fF, slope: fS, terrain: fT }, driver, thetaD };
}

/** Solve arrival times from seeds up to `horizon` seconds. */
export function solveArrival(input: SolveInput): MockFireResult {
  const { terrain, fuel } = input;
  const g = terrain.grid;
  const { nx, ny, cellSize } = g;
  const n = nx * ny;
  const arrival = new Float32Array(n).fill(Infinity);
  const ros = new Float32Array(n);
  const spreadDir = new Float32Array(n);
  const intensity = new Float32Array(n);
  const flameHeight = new Float32Array(n);
  const driver = new Uint8Array(n);
  const phase = new Uint8Array(n);
  const factors = new Float32Array(n * 6);
  const done = new Uint8Array(n);
  const heap = new Heap();

  const stencil = STENCIL.map(([di, dj]) => {
    const d = Math.hypot(di, dj) * cellSize;
    return { di, dj, d, az: vectorAzimuthDeg(di, dj) };
  });

  for (const s of input.seeds) {
    const i = Math.round((s.x - g.x0) / cellSize);
    const j = Math.round((s.y - g.y0) / cellSize);
    if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
    const k = j * nx + i;
    if (!isBurnable(fuel.type[k]!)) continue;
    if (s.time < arrival[k]!) {
      arrival[k] = s.time;
      heap.push(s.time, k);
    }
  }

  // Weather-dependent quantities cached per 10-minute bucket (moisture) / per cell pop (wind with edits).
  let hourBucket = -1;
  let hourLocal = 12;
  let wNow: WeatherHour | null = null;
  while (heap.size) {
    const [t, k] = heap.pop();
    if (done[k] || t > arrival[k]!) continue;
    done[k] = 1;
    if (t > input.horizon) continue;
    const bucket = Math.floor(t / 600);
    if (bucket !== hourBucket) {
      hourBucket = bucket;
      wNow = weatherAt(input.weather, input.startTime + t * 1000);
      hourLocal = localHour(input.startTime + t * 1000, input.weather.timezone || 'Australia/Sydney');
    }
    const i = k % nx;
    const j = (k / nx) | 0;
    const x = g.x0 + i * cellSize;
    const y = g.y0 + j * cellSize;
    const cache = {
      wind: windAt(input, x, y, t),
      moisture: cellMoisture(terrain, fuel, k, wNow!, hourLocal, input.moistureDelta?.[k] ?? 0),
    };
    // Record the head-direction behaviour at this cell (for overlays / explanations).
    const head = directionalRos(input, k, wrapDeg(cache.wind.dir + 180), t, cache);
    let best = head;
    let bestAz = wrapDeg(cache.wind.dir + 180);
    // Upslope may be the fastest direction on steep ground in light wind.
    const up = vectorAzimuthDeg(terrain.dzdx[k]!, terrain.dzdy[k]!);
    if (terrain.slopeDeg[k]! > 3) {
      const u = directionalRos(input, k, up, t, cache);
      if (u.ros > best.ros) {
        best = u;
        bestAz = up;
      }
    }
    ros[k] = best.ros;
    spreadDir[k] = bestAz;
    driver[k] = best.driver;
    const w = fineFuel(fuel, k) * 0.1; // t/ha → kg/m²
    intensity[k] = H * w * best.ros;
    flameHeight[k] = 0.0775 * Math.pow(intensity[k]!, 0.46);
    phase[k] = intensity[k]! > 10_000 ? 3 : intensity[k]! > 2_000 ? 2 : 1;
    const f = best.f;
    factors.set([f.base, f.wind, f.moisture, f.fuel, f.slope, f.terrain], k * 6);

    for (const s of stencil) {
      const ii = i + s.di;
      const jj = j + s.dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const kk = jj * nx + ii;
      if (done[kk] || !isBurnable(fuel.type[kk]!)) continue;
      const r = directionalRos(input, k, s.az, t, cache).ros;
      if (r <= 1e-5) continue;
      const ta = t + s.d / r;
      if (ta < arrival[kk]!) {
        arrival[kk] = ta;
        heap.push(ta, kk);
      }
    }
  }
  // Cells popped after the horizon keep their tentative arrival only if within it.
  for (let k = 0; k < n; k++) if (arrival[k]! > input.horizon) arrival[k] = Infinity;
  return { arrival, ros, spreadDir, intensity, flameHeight, driver, phase, factors };
}
