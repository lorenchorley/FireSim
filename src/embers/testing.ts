/**
 * Test support for the ember model (not used at run time): synthetic terrain, uniform fuel maps, analytic planar
 * fire fronts and the analytic wind / turbulence / landing callbacks that stand in for atmosphere/, fire/ and
 * fuel/moisture in the unit tests (spec §9.7 test list).
 */
import { makeGridSpec, type GridSpec } from '../core/grid';
import { BurnState, FuelFlag, FuelType, type FireAux, type FireField, type FuelFamily, type FuelMap, type LandingInfo, type Terrain } from '../core/types';
import { buildTerrain } from '../terrain';
import { Rng } from '../core/rng';
import type { QualityTier, SpotProvenance } from '../core/types';
import type { WindFn } from './plume';
import { EmberModel, type EmberEnvironment, type EmberLandingEvent, type LandingFn, type TurbFn } from './EmberModel';
import type { DeepPartial, EmberParams } from './params';

export const TEST_ORIGIN = { lat: -33.7, lon: 150.3 };

/** Square grid of `extent` metres centred on the origin. */
export const grid = (extent: number, cell = 30): GridSpec => makeGridSpec(TEST_ORIGIN, extent, cell);

/** Terrain from z = f(x, y). */
export function terrainFrom(g: GridSpec, f: (x: number, y: number) => number): Terrain {
  const z = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = f(g.x0 + i * g.cellSize, g.y0 + j * g.cellSize);
  return buildTerrain(g, z, 'synthetic test surface');
}

export const flatTerrain = (g: GridSpec, z0 = 500): Terrain => terrainFrom(g, () => z0);

export interface UniformFuel {
  type?: FuelType;
  barkHazard?: number;
  flags?: number;
  surfaceHazard?: number;
  nearSurfaceHazard?: number;
  canopyHeight?: number;
  curing?: number;
}

/** A FuelMap with the same fuel everywhere (defaults: DryForestShrubby, BH 3, stringybark, FHS_s 3.4, H_o 20 m). */
export function uniformFuel(g: GridSpec, o: UniformFuel = {}): FuelMap {
  const n = g.nx * g.ny;
  const f = (v: number): Float32Array => new Float32Array(n).fill(v);
  return {
    grid: g,
    type: new Uint8Array(n).fill(o.type ?? FuelType.DryForestShrubby),
    surfaceHazard: f(o.surfaceHazard ?? 3.4),
    nearSurfaceHazard: f(o.nearSurfaceHazard ?? 2.9),
    nearSurfaceHeight: f(0.2),
    elevatedHazard: f(3.3),
    elevatedHeight: f(2),
    barkHazard: f(o.barkHazard ?? 3),
    surfaceLoad: f(14.5),
    nearSurfaceLoad: f(1.9),
    elevatedLoad: f(4.9),
    barkLoad: f(2.67),
    canopyHeight: f(o.canopyHeight ?? 20),
    canopyCover: f(0.6),
    curing: f(o.curing ?? 100),
    timeSinceFire: f(NaN),
    lastFireKind: new Uint8Array(n),
    sources: ['test'],
    flags: new Uint16Array(n).fill(o.flags ?? FuelFlag.Stringybark),
  };
}

/** A FireAux with zero rasters. */
export function emptyAux(n: number): FireAux {
  const f = (): Float32Array => new Float32Array(n);
  return {
    vls: f(), vlsActive: new Uint8Array(n), sep: f(), attach: f(), junction: f(), build: f(), heatFlux: f(), frontDist: f(),
    nc: f(), cfb: f(), direction: f(), debris: [], front: new Int32Array(0), frontNormalX: f(), frontNormalY: f(), headIndex: -1,
    leftDomain: false,
  };
}

export interface PlanarFront {
  /** A point on the front at t = 0 (m). */
  x0: number;
  y0: number;
  /** Spread direction (azimuth towards, deg). */
  dirDeg: number;
  /** Normal ROS (m/s), arrival intensity (kW/m), flame height (m). */
  ros: number;
  intensity: number;
  flameHeight: number;
  /** Half-length of the front across the spread direction (m); Infinity = whole domain. */
  halfLength?: number;
  /** Cells behind the start line never burn (default true). */
  startLine?: boolean;
}

/** Arrival times of a planar front spreading at `ros` from the line through (x0, y0). */
export function planarFire(g: GridSpec, p: PlanarFront): FireField {
  const n = g.nx * g.ny;
  const nxv = Math.sin((p.dirDeg * Math.PI) / 180);
  const nyv = Math.cos((p.dirDeg * Math.PI) / 180);
  const arrival = new Float32Array(n).fill(Infinity);
  const L = p.halfLength ?? Infinity;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const dx = g.x0 + i * g.cellSize - p.x0;
      const dy = g.y0 + j * g.cellSize - p.y0;
      const along = dx * nxv + dy * nyv;
      const across = Math.abs(-dx * nyv + dy * nxv);
      if (across > L) continue;
      if ((p.startLine ?? true) && along < 0) continue;
      arrival[j * g.nx + i] = along / p.ros;
    }
  }
  return {
    grid: g,
    arrivalTime: arrival,
    burnState: new Uint8Array(n).fill(BurnState.Unburnt),
    ros: new Float32Array(n).fill(p.ros),
    intensity: new Float32Array(n).fill(p.intensity),
    flameHeight: new Float32Array(n).fill(p.flameHeight),
    spreadDir: new Float32Array(n).fill(p.dirDeg),
    driver: new Uint8Array(n),
    phase: new Uint8Array(n),
  };
}

/** Cells with tArr ≤ t + dt and t − tArr < window (the sim's burning / front list). */
export function burningAt(fire: FireField, t: number, dt: number, window: number): Int32Array {
  const out: number[] = [];
  const a = fire.arrivalTime;
  for (let k = 0; k < a.length; k++) {
    const ta = a[k]!;
    if (ta <= t + dt && t - ta < window) out.push(k);
  }
  return Int32Array.from(out);
}

/** Uniform wind (u, v, w). */
export const uniformWind = (u: number, v: number, w = 0): WindFn => (_x, _y, _z, out) => {
  out[0] = u;
  out[1] = v;
  out[2] = w;
};

/** Power-law wind profile U(z) = U10·(max(z, 2)/10)^α, capped at `cap`·U10, blowing FROM `dirFrom` (deg). */
export function powerLawWind(u10: number, dirFrom: number, alpha = 1 / 7, cap = 2.2): WindFn {
  const r = (dirFrom * Math.PI) / 180;
  const ex = -Math.sin(r);
  const ey = -Math.cos(r);
  return (_x, _y, z, out) => {
    const s = u10 * Math.min(cap, Math.pow(Math.max(z, 2) / 10, alpha));
    out[0] = s * ex;
    out[1] = s * ey;
    out[2] = 0;
  };
}

/** Turbulence callback returning constant [z_i, w*, u*]. */
export const constTurb = (zi: number, ws: number, us: number): TurbFn => (_x, _y, _z, out) => {
  out[0] = zi;
  out[1] = ws;
  out[2] = us;
};
export const noTurb: TurbFn = constTurb(0, 0, 0);

export interface LandingSetup {
  moisture: number;
  fuelTempC?: number;
  family?: FuelFamily;
  burnable?: (x: number, y: number) => boolean;
  surfaceHazard?: number;
  nearSurfaceHazard?: number;
  curing?: number;
  bedWindMs?: number;
  fuelType?: FuelType;
}

/**
 * Landing callback for a planar front: burnt when tArr ≤ now(), distToFront along the spread normal,
 * frontDir = spread direction for cells ahead (unit vector from the nearest front point to the landing point).
 */
export function planarLanding(g: GridSpec, fire: FireField, front: PlanarFront, now: () => number, s: LandingSetup): LandingFn {
  const nxv = Math.sin((front.dirDeg * Math.PI) / 180);
  const nyv = Math.cos((front.dirDeg * Math.PI) / 180);
  return (x, y): LandingInfo => {
    const i = Math.round((x - g.x0) / g.cellSize);
    const j = Math.round((y - g.y0) / g.cellSize);
    const k = i >= 0 && j >= 0 && i < g.nx && j < g.ny ? j * g.nx + i : -1;
    const t = now();
    const ta = k >= 0 ? fire.arrivalTime[k]! : Infinity;
    const along = (x - front.x0) * nxv + (y - front.y0) * nyv;
    const frontPos = Math.max(0, front.ros * t);
    const d = along - frontPos;
    return {
      moisture: s.moisture,
      fuelType: s.fuelType ?? FuelType.DryForestShrubby,
      burnable: s.burnable ? s.burnable(x, y) : true,
      burnt: ta <= t,
      fuelTempC: s.fuelTempC ?? 30,
      surfaceHazard: s.surfaceHazard ?? 3.4,
      nearSurfaceHazard: s.nearSurfaceHazard ?? 2.9,
      family: s.family ?? 'vesta2',
      curing: s.curing ?? 100,
      bedWindMs: s.bedWindMs ?? 1.5,
      distToFront: Math.abs(d),
      frontDirX: d >= 0 ? nxv : -nxv,
      frontDirY: d >= 0 ? nyv : -nyv,
      rosLocal: front.ros,
    };
  };
}

/** W-weighted quantile of values (q in [0, 1]). */
export function weightedQuantile(values: number[], weights: number[], q: number): number {
  const idx = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  let tot = 0;
  for (const w of weights) tot += w;
  let acc = 0;
  for (const i of idx) {
    acc += weights[i]!;
    if (acc >= q * tot) return values[i]!;
  }
  return values[idx[idx.length - 1]!] ?? NaN;
}

// ── line-fire validation harness (§9.7, §15 V9) ─────────────────────────────────────────────────────────────

export interface LineFireSpec {
  /** 10 m wind (km/h) from the west (power-law profile). */
  u10kmh: number;
  /** Normal ROS (m/h), arrival intensity (kW/m), flame height (m) of the head front (moving east). */
  rosMh: number;
  intensity: number;
  flameHeight: number;
  tier?: QualityTier;
  fuel?: UniformFuel;
  /** Landing fuel moisture (%) and fuel temperature (°C) [5, 35]. */
  moisture?: number;
  fuelTempC?: number;
  /** Simulated seconds [3600], atmosphere step [10 s], seed [7], domain extent [20 km], front half-length [1 km]. */
  seconds?: number;
  dt?: number;
  seed?: number;
  extent?: number;
  halfLength?: number;
  maxEmbers?: number;
  /** Turbulence scales [z_i 1500 m, w* 2 m/s, u* 0.8 m/s]. */
  turb?: [number, number, number];
  /** Analytic resolved plume updraft (m/s) above the moving front (3-D tiers stand-in for the atmosphere). */
  plumeW?: number;
  params?: DeepPartial<EmberParams>;
  env?: EmberEnvironment;
  /** Terrain elevation z(x, y) (default flat 500 m). */
  terrainFn?: (x: number, y: number) => number;
  /** Front start offset from the domain centre, against the spread direction (m) [extent/2 − 2000]. */
  frontOffset?: number;
  /** Spread direction (azimuth towards, deg) [90]; the wind blows the same way. */
  dirDeg?: number;
  /** Called after every atmosphere step with the end time (s). */
  onStep?: (t: number, model: EmberModel) => void;
}

export interface LineFireResult {
  model: EmberModel;
  events: EmberLandingEvent[];
  spots: { x: number; y: number; t: number; travel: number; prov: SpotProvenance }[];
  /** Wall time of the emit + step loop (ms). */
  ms: number;
  frontKm: number;
  hours: number;
}

/** A planar head front on a flat (or given) surface with the analytic callbacks: the §9.7 / V9 spotting runs. */
export function runLineFire(o: LineFireSpec): LineFireResult {
  const extent = o.extent ?? 20000;
  const g = grid(extent, 30);
  const terrain = o.terrainFn ? terrainFrom(g, o.terrainFn) : flatTerrain(g);
  const fuel = uniformFuel(g, o.fuel ?? {});
  const halfLength = o.halfLength ?? 1000;
  const dir = o.dirDeg ?? 90;
  const off = o.frontOffset ?? extent / 2 - 2000;
  const ux = Math.sin((dir * Math.PI) / 180);
  const uy = Math.cos((dir * Math.PI) / 180);
  const front: PlanarFront = {
    x0: -off * ux, y0: -off * uy, dirDeg: dir, ros: o.rosMh / 3600, intensity: o.intensity, flameHeight: o.flameHeight, halfLength,
  };
  const fire = planarFire(g, front);
  const aux = emptyAux(g.nx * g.ny);
  let now = 0;
  const events: EmberLandingEvent[] = [];
  const model = new EmberModel(terrain, fuel, { maxEmbers: o.maxEmbers ?? 4000, tier: o.tier ?? 'fast', params: o.params, onLanding: (e) => events.push(e) },
    new Rng(o.seed ?? 7));
  if (o.env) model.setEnvironment(o.env);
  const base = powerLawWind(o.u10kmh / 3.6, (dir + 180) % 360);
  const pw = o.plumeW ?? 0;
  const wind: WindFn = pw > 0
    ? (x, y, z, out) => {
        base(x, y, z, out);
        // distance from the tilted plume axis above the moving front (along / across the spread direction)
        const along = (x - front.x0) * ux + (y - front.y0) * uy - front.ros * now - (Math.hypot(out[0]!, out[1]!) / pw) * z;
        const across = Math.abs(-(x - front.x0) * uy + (y - front.y0) * ux);
        const d = Math.abs(along);
        out[2] = d < 300 && across < halfLength + 100 && z < 2500 ? pw * (1 - d / 300) * (1 - z / 2500) : 0;
      }
    : base;
  const [zi, ws, us] = o.turb ?? [1500, 2, 0.8];
  const turb = constTurb(zi, ws, us);
  const landing = planarLanding(g, fire, front, () => now, { moisture: o.moisture ?? 5, fuelTempC: o.fuelTempC ?? 35 });
  const spots: LineFireResult['spots'] = [];
  const dt = o.dt ?? 10;
  const T = o.seconds ?? 3600;
  const t0 = performance.now();
  for (let t = 0; t < T; t += dt) {
    now = t;
    model.emit(fire, fuel, burningAt(fire, t, dt, 200), dt, t, aux);
    now = t + dt;
    model.step(dt, wind, turb, landing, (x, y, travel, prov) => spots.push({ x, y, t: now, travel, prov }));
    o.onStep?.(t + dt, model);
  }
  return { model, events, spots, ms: performance.now() - t0, frontKm: (2 * halfLength) / 1000, hours: T / 3600 };
}

/** W-weighted quantile of the travel distance of ignition-capable (p ≥ pMin) landings, optionally one class. */
export function capableQuantile(events: EmberLandingEvent[], q: number, cls?: string, pMin = 0.05): number {
  const a = events.filter((e) => e.p >= pMin && (cls === undefined || e.emberClass === cls));
  return weightedQuantile(a.map((e) => e.travel), a.map((e) => e.weight), q);
}

/** McArthur Mk5 forest (§6.4): FFDI, R (m/h) and S (km) at fuel load W (t/ha), flat. */
export function mk5(tC: number, rh: number, u10kmh: number, df: number, w = 15): { ffdi: number; rosMh: number; flameHeight: number; spotKm: number } {
  const ffdi = 2 * Math.exp(-0.45 + 0.987 * Math.log(df) - 0.0345 * rh + 0.0338 * tC + 0.0234 * u10kmh);
  const r = 0.0012 * ffdi * w; // km/h
  return { ffdi, rosMh: 1000 * r, flameHeight: 13 * r + 0.24 * w - 2, spotKm: Math.max(0, r * (4.17 - 0.033 * w) - 0.36) };
}

/** AFDRS forest spotting envelope S(R) (§6.10, m; R m/h, U10 km/h). */
export function spottingEnvelope(rosMh: number, u10kmh: number, fhs: number): number {
  const raw = (r: number): number =>
    Math.abs(176.969 * Math.atan(fhs) * Math.sqrt(r / Math.pow(u10kmh, 0.25)) + 1568800 / fhs * Math.pow(r / Math.pow(u10kmh, 0.25), -1.5) - 3015.09);
  if (rosMh < 150) return 50;
  if (rosMh < 1000) return 50 + ((raw(1000) - 50) * (rosMh - 150)) / 850;
  return Math.max(raw(rosMh), raw(1000));
}
