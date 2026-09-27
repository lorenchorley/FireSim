/**
 * Test support for the ember model (not used at run time): synthetic terrain, uniform fuel maps, analytic planar
 * fire fronts and the analytic wind / turbulence / landing callbacks that stand in for atmosphere/, fire/ and
 * fuel/moisture in the unit tests (spec §9.7 test list).
 */
import { makeGridSpec, type GridSpec } from '../core/grid';
import { BurnState, FuelFlag, FuelType, type FireAux, type FireField, type FuelFamily, type FuelMap, type LandingInfo, type Terrain } from '../core/types';
import { buildTerrain } from '../terrain';
import type { WindFn } from './plume';
import type { LandingFn, TurbFn } from './EmberModel';

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
