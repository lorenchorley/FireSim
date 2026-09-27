/**
 * SimStateView test double factory for the explain/ tests: synthetic terrain (terrain/testing surfaces or any
 * z = f(x, y)), a simple TerrainFeatures producer, a uniform fuel map, fire-field painting helpers (discs, lines),
 * a front / normal / direction / frontDist rebuild, uniform winds and a constant weather series. Everything is a
 * plain mutable object so each test can craft exactly the situation a detector needs.
 */
import { initialStableNight, lmstHour } from '../../core/physics';
import { makeGridSpec, type GridSpec } from '../../core/grid';
import {
  BurnState,
  FuelType,
  Landform,
  SpreadDriver,
  type AtmosDiagnostics,
  type CellEvaluation,
  type EmberStats,
  type FireAux,
  type FireField,
  type FuelMap,
  type SimStateView,
  type SpreadFactors,
  type Terrain,
  type TerrainDerived,
  type TerrainFeatures,
  type WeatherHour,
  type WeatherSeries,
} from '../../core/types';
import { windToUV, wrapDeg } from '../../core/units';
import { buildTerrain, solarPosition, terrainDerived, upslopeAzimuth } from '../../terrain';
import { FUEL_TYPES } from '../deps';
import { distanceTransform } from '../statics';

export const TEST_ORIGIN = { lat: -33.7, lon: 150.3 };
/** 15 Oct 2025 00:00 UTC = 10:00 AEST ≈ 10:01 LMST at 150.3° E. */
export const T_SPRING_10AM = Date.UTC(2025, 9, 15, 0, 0, 0);

export interface WorldOptions {
  /** Domain side (m); default 6030 = 201 cells of 30 m, so a cell sits on x = y = 0. */
  extentM?: number;
  cellSize?: number;
  /** z = f(x, y) in local metres (default flat 600 m). */
  elevation?: (x: number, y: number) => number;
  fuelType?: FuelType;
  /** Uniform 10 m wind (m/s, FROM deg). */
  windSpeed?: number;
  windDir?: number;
  moisture?: number;
  temperature?: number;
  rh?: number;
  cloud?: number;
  startMs?: number;
  droughtFactor?: number;
  kbdi?: number;
}

/** Simple TerrainFeatures from landforms (tests override masks directly where they need a feature). */
export function buildTestFeatures(terrain: Terrain, derived: TerrainDerived): TerrainFeatures {
  const g = terrain.grid;
  const N = g.nx * g.ny;
  const ridge = new Uint8Array(N);
  const saddle = new Uint8Array(N);
  const cliff = new Uint8Array(N);
  const drainage = new Uint8Array(N);
  const gullyAxis = new Float32Array(N).fill(NaN);
  for (let k = 0; k < N; k++) {
    const lf = terrain.landform[k] as Landform;
    if (lf === Landform.Ridge || lf === Landform.Peak || lf === Landform.Spur || derived.relPos[k]! >= 0.9) ridge[k] = 1;
    if (lf === Landform.Saddle) saddle[k] = 1;
    if (lf === Landform.Cliff) cliff[k] = 1;
  }
  const z = terrain.elevation;
  return {
    flowAcc: new Float32Array(N),
    drainage,
    trench: new Float32Array(N),
    gullyAxis,
    gullyBase: new Int32Array(N).fill(-1),
    saddle,
    ridge,
    cliff,
    narrowValley: new Uint8Array(N),
    slope30: Float32Array.from(terrain.slopeDeg),
    valleyDrop: new Float32Array(N),
    crestRise: new Float32Array(N),
    crestDist: new Float32Array(N),
    crest(k: number, windFromDeg: number) {
      const r = (windFromDeg * Math.PI) / 180;
      const j0 = (k / g.nx) | 0;
      const i0 = k - j0 * g.nx;
      for (let s = 1; s <= 600 / g.cellSize; s++) {
        const i = Math.round(i0 + Math.sin(r) * s);
        const j = Math.round(j0 + Math.cos(r) * s);
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null;
        const q = j * g.nx + i;
        if (ridge[q] && z[q]! > z[k]!) return { d: s * g.cellSize, zCrest: z[q]!, relief: z[q]! - (z[k]! - derived.heightAboveValley[k]!), kCrest: q };
      }
      return null;
    },
  };
}

export class TestWorld {
  readonly grid: GridSpec;
  readonly N: number;
  readonly terrain: Terrain;
  readonly derived: TerrainDerived;
  readonly features: TerrainFeatures;
  readonly fuel: FuelMap;
  readonly view: SimStateView;
  startMs: number;
  /** Per-cell factor overrides for factorsAt / evaluateCell. */
  factors: SpreadFactors = { base: 15.43 / 3600, wind: 4, moisture: 1.2, fuel: 1, slope: 1, terrain: 1, build: 1, fireWindShare: 0, direction: 1 };
  evaluation: Partial<CellEvaluation> = {};
  /** Known outward normal azimuth per cell (set by the painters; NaN = geometric from the burn state). */
  readonly normalAz: Float32Array;

  constructor(o: WorldOptions = {}) {
    const g = (this.grid = makeGridSpec(TEST_ORIGIN, o.extentM ?? 6030, o.cellSize ?? 30));
    const N = (this.N = g.nx * g.ny);
    this.normalAz = new Float32Array(N).fill(NaN);
    const zf = o.elevation ?? (() => 600);
    const z = new Float32Array(N);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) z[j * g.nx + i] = zf(g.x0 + i * g.cellSize, g.y0 + j * g.cellSize);
    this.terrain = buildTerrain(g, z, 'test');
    this.derived = terrainDerived(this.terrain);
    this.features = buildTestFeatures(this.terrain, this.derived);
    this.fuel = uniformFuel(g, o.fuelType ?? FuelType.DryForestShrubby);
    this.startMs = o.startMs ?? T_SPRING_10AM;
    const fire: FireField = {
      grid: g,
      arrivalTime: new Float32Array(N).fill(Infinity),
      burnState: new Uint8Array(N),
      ros: new Float32Array(N),
      intensity: new Float32Array(N),
      flameHeight: new Float32Array(N),
      spreadDir: new Float32Array(N).fill(NaN),
      driver: new Uint8Array(N),
      phase: new Uint8Array(N),
    };
    for (let k = 0; k < N; k++) if (this.fuel.type[k] === FuelType.NonFuel || this.fuel.type[k] === FuelType.Water) fire.burnState[k] = BurnState.NonFlammable;
    const aux: FireAux = {
      vls: new Float32Array(N),
      vlsActive: new Uint8Array(N),
      sep: new Float32Array(N),
      attach: new Float32Array(N),
      junction: new Float32Array(N).fill(1),
      build: new Float32Array(N).fill(1),
      heatFlux: new Float32Array(N),
      frontDist: new Float32Array(N).fill(Infinity),
      nc: new Float32Array(N),
      cfb: new Float32Array(N),
      direction: new Float32Array(N),
      debris: [],
      front: new Int32Array(0),
      frontNormalX: new Float32Array(N),
      frontNormalY: new Float32Array(N),
      headIndex: -1,
      leftDomain: false,
    };
    const ws = o.windSpeed ?? 10 / 3.6;
    const wd = o.windDir ?? 270;
    const weather: WeatherHour = {
      time: this.startMs,
      temperature: o.temperature ?? 22,
      relativeHumidity: o.rh ?? 45,
      windSpeed10: ws,
      windDir10: wd,
      cloudCover: o.cloud ?? 20,
      precipitation: 0,
    };
    const series = constantSeries(this.startMs - 48 * 3.6e6, 96 + 48, weather);
    const f = (v: number): Float32Array => new Float32Array(N).fill(v);
    const atmosDiag: AtmosDiagnostics = {
      spunUp: false,
      synthetic: true,
      upperAirSource: 'none',
      inversion: { present: false, dTheta: 0, topASL: NaN, mixedLayerTopAGL: NaN, breakEta: null },
      cHaines: null,
      pft: null,
      frH: NaN,
      nSquared: NaN,
      plumeTopASL: NaN,
      plumeLclASL: NaN,
      firePowerMW: 0,
      maxUpdraft: 0,
      uRidgeMedian: ws,
      fireInfluence: f(0),
      heatFlux: f(0),
      slopeFlow: f(0),
      kappa: 0.78,
    };
    const emberStats: EmberStats = {
      active: 0,
      leftDomain: 0,
      landings10min: 0,
      ignitions10min: 0,
      shortRange10min: 0,
      maxIgnitableDistance10min: 0,
      beyondEdgeHistogram: new Float32Array(30),
      ignitionCapableShare: 0,
    };
    const M = o.moisture ?? 12;
    const self = this;
    this.view = {
      time: 0,
      terrain: this.terrain,
      derived: this.derived,
      features: this.features,
      fuel: this.fuel,
      fire,
      aux,
      moisture: f(M),
      moistureAfdrs: f(M),
      moistureAnomaly: f(0),
      availability: f(0.9),
      windU: f(0),
      windV: f(0),
      windBgU: f(0),
      windBgV: f(0),
      fireIndU: f(0),
      fireIndV: f(0),
      uRidge: f(ws),
      surfaceHeatFlux: f(0),
      slopeFlowS: f(0),
      airT: f(weather.temperature),
      airRH: f(weather.relativeHumidity),
      weather,
      series,
      droughtFactor: o.droughtFactor ?? 5,
      kbdi: o.kbdi ?? 50,
      sunElevation: 0,
      lmstHour: 0,
      cloudFrac: (o.cloud ?? 20) / 100,
      night: initialStableNight(),
      spotFires: [],
      emberStats,
      atmosDiag,
      tier: 'fast',
      coupling: 1,
      factorsAt(k: number): SpreadFactors {
        return { ...self.factors, direction: aux.direction[k] || 1 };
      },
      evaluateCell(_k: number): CellEvaluation {
        const fa = self.factors;
        const ros = fa.base * fa.wind * fa.moisture * fa.fuel * fa.slope * fa.terrain;
        return {
          ros,
          rH: ros,
          rB: ros * 0.1,
          rF: ros * 0.3,
          headDir: wrapDeg((self.view.weather.windDir10 ?? 0) + 180),
          lb: 2,
          intensity: 1000,
          flameHeight: 2,
          phase: 1,
          factors: { ...fa },
          driver: SpreadDriver.Wind,
          validated: true,
          ...self.evaluation,
        };
      },
    };
    this.setWind(ws, wd);
    this.setTime(0);
  }

  /** Cell index of a local point (clamped). */
  cell(x: number, y: number): number {
    const g = this.grid;
    const i = Math.min(g.nx - 1, Math.max(0, Math.round((x - g.x0) / g.cellSize)));
    const j = Math.min(g.ny - 1, Math.max(0, Math.round((y - g.y0) / g.cellSize)));
    return j * g.nx + i;
  }
  x(k: number): number {
    return this.grid.x0 + (k % this.grid.nx) * this.grid.cellSize;
  }
  y(k: number): number {
    return this.grid.y0 + Math.floor(k / this.grid.nx) * this.grid.cellSize;
  }
  forEach(fn: (k: number, x: number, y: number) => void): void {
    for (let k = 0; k < this.N; k++) fn(k, this.x(k), this.y(k));
  }

  /** Uniform fire wind = background wind (m/s, FROM), also the ambient weather wind and U_ridge. */
  setWind(speed: number, dirFrom: number, opts: { bg?: boolean; weather?: boolean } = {}): void {
    const [u, v] = windToUV(speed, dirFrom);
    const s = this.view;
    s.windU.fill(u);
    s.windV.fill(v);
    if (opts.bg !== false) {
      s.windBgU.fill(u);
      s.windBgV.fill(v);
      s.uRidge.fill(speed);
      s.atmosDiag.uRidgeMedian = speed;
    }
    if (opts.weather !== false) {
      s.weather.windSpeed10 = speed;
      s.weather.windDir10 = dirFrom;
      for (const h of s.series.hours) {
        h.windSpeed10 = speed;
        h.windDir10 = dirFrom;
      }
    }
  }

  /** Simulation time (s from start): updates weather.time, sun elevation and LMST. */
  setTime(tSim: number): void {
    const s = this.view;
    s.time = tSim;
    const ms = this.startMs + tSim * 1000;
    s.weather.time = ms;
    s.sunElevation = solarPosition(ms, TEST_ORIGIN.lat, TEST_ORIGIN.lon).elevation;
    s.lmstHour = lmstHour(ms, TEST_ORIGIN.lon);
  }

  /**
   * Paint a burnt disc: cells within r burn (ring of width `ring` m Burning, interior BurntOut), arrival time t,
   * radial spread direction, `direction` = head factor relative to `headTo` (default the wind's TO direction).
   */
  igniteDisc(cx: number, cy: number, r: number, o: { t?: number; ros?: number; intensity?: number; flameHeight?: number; headTo?: number; ring?: number; driver?: SpreadDriver } = {}): void {
    const f = this.view.fire;
    const ring = o.ring ?? 2.5 * this.grid.cellSize;
    const headTo = o.headTo ?? wrapDeg(this.view.weather.windDir10 + 180);
    this.forEach((k, x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r || f.burnState[k] === BurnState.NonFlammable) return;
      f.burnState[k] = d > r - ring ? BurnState.Burning : BurnState.BurntOut;
      f.arrivalTime[k] = o.t ?? 0;
      f.ros[k] = o.ros ?? 0.02;
      f.intensity[k] = o.intensity ?? 800;
      f.flameHeight[k] = o.flameHeight ?? 1.5;
      f.driver[k] = o.driver ?? SpreadDriver.Wind;
      const az = d > 1e-6 ? wrapDeg((Math.atan2(x - cx, y - cy) * 180) / Math.PI) : headTo;
      f.spreadDir[k] = az;
      this.normalAz[k] = az;
      const c = Math.cos(((az - headTo) * Math.PI) / 180);
      this.view.aux.direction[k] = 0.1 + 0.9 * Math.max(0, c) ** 2;
    });
    this.refreshFront();
  }

  /**
   * Paint a straight burning line from (x0, y0) to (x1, y1), half-width w, spreading towards `spreadTo`
   * (unburnt ahead, burnt-out strip behind of depth `behind`).
   */
  igniteLine(x0: number, y0: number, x1: number, y1: number, spreadTo: number, o: { w?: number; behind?: number; t?: number; ros?: number; intensity?: number; flameHeight?: number; direction?: number } = {}): void {
    const f = this.view.fire;
    const w = o.w ?? 1.2 * this.grid.cellSize;
    const behind = o.behind ?? 90;
    const ux = Math.sin((spreadTo * Math.PI) / 180);
    const uy = Math.cos((spreadTo * Math.PI) / 180);
    const lx = x1 - x0;
    const ly = y1 - y0;
    const L = Math.hypot(lx, ly);
    this.forEach((k, x, y) => {
      if (f.burnState[k] === BurnState.NonFlammable) return;
      const t = ((x - x0) * lx + (y - y0) * ly) / (L * L);
      if (t < 0 || t > 1) return;
      const along = (x - x0) * ux + (y - y0) * uy; // signed offset along the spread direction
      if (along > w || along < -behind) return;
      f.burnState[k] = along > w - 1.6 * this.grid.cellSize ? BurnState.Burning : BurnState.BurntOut;
      f.arrivalTime[k] = o.t ?? 0;
      f.ros[k] = o.ros ?? 0.05;
      f.intensity[k] = o.intensity ?? 1000;
      f.flameHeight[k] = o.flameHeight ?? 2;
      f.spreadDir[k] = spreadTo;
      this.normalAz[k] = spreadTo;
      this.view.aux.direction[k] = o.direction ?? 1;
    });
    this.refreshFront();
  }

  /** Rebuild aux.front, outward normals (per cell), frontDist and headIndex from the burn state. */
  refreshFront(): void {
    const s = this.view;
    const f = s.fire;
    const bs = f.burnState;
    const g = this.grid;
    const front: number[] = [];
    const src = new Uint8Array(this.N);
    for (let k = 0; k < this.N; k++) {
      if (bs[k] !== BurnState.Burning) continue;
      src[k] = 1;
      const j = (k / g.nx) | 0;
      const i = k - j * g.nx;
      const open =
        (i > 0 && bs[k - 1] === BurnState.Unburnt) ||
        (i < g.nx - 1 && bs[k + 1] === BurnState.Unburnt) ||
        (j > 0 && bs[k - g.nx] === BurnState.Unburnt) ||
        (j < g.ny - 1 && bs[k + g.nx] === BurnState.Unburnt);
      if (!open) continue;
      front.push(k);
      const known = this.normalAz[k]!;
      if (known === known) {
        s.aux.frontNormalX[k] = Math.sin((known * Math.PI) / 180);
        s.aux.frontNormalY[k] = Math.cos((known * Math.PI) / 180);
        continue;
      }
      // Outward normal: towards unburnt neighbours.
      let sx = 0;
      let sy = 0;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const ii = i + di;
          const jj = j + dj;
          if ((!di && !dj) || ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
          const b = bs[jj * g.nx + ii];
          const wgt = b === BurnState.Unburnt ? 1 : b === BurnState.NonFlammable ? 0 : -1;
          const r = Math.hypot(di, dj);
          sx += (wgt * di) / r;
          sy += (wgt * dj) / r;
        }
      }
      const n = Math.hypot(sx, sy) || 1;
      s.aux.frontNormalX[k] = sx / n;
      s.aux.frontNormalY[k] = sy / n;
    }
    s.aux.front = Int32Array.from(front);
    const nearest = new Int32Array(this.N);
    distanceTransform(g, src, s.aux.frontDist, nearest);
    let head = -1;
    for (const k of front) if (head < 0 || s.aux.direction[k]! * f.ros[k]! > s.aux.direction[head]! * f.ros[head]!) head = k;
    s.aux.headIndex = head;
  }

  /** Cells (list) matching a predicate. */
  cells(pred: (k: number, x: number, y: number) => boolean): number[] {
    const out: number[] = [];
    this.forEach((k, x, y) => {
      if (pred(k, x, y)) out.push(k);
    });
    return out;
  }

  /** Upslope azimuth at k (NaN on flat). */
  upslope(k: number): number {
    return upslopeAzimuth(this.terrain, k);
  }
}

/** Uniform fuel map of one type with moderate (non-heavy) default hazards. */
export function uniformFuel(g: GridSpec, type: FuelType): FuelMap {
  const N = g.nx * g.ny;
  const row = FUEL_TYPES[type];
  const f = (v: number): Float32Array => new Float32Array(N).fill(v);
  return {
    grid: g,
    type: new Uint8Array(N).fill(type),
    surfaceHazard: f(Math.min(row.fhsMax.surface, 2.5)),
    nearSurfaceHazard: f(Math.min(row.fhsMax.nearSurface, 2.2)),
    nearSurfaceHeight: f(row.nearSurfaceHeight),
    elevatedHazard: f(Math.min(row.fhsMax.elevated, 2)),
    elevatedHeight: f(row.elevatedHeight),
    barkHazard: f(row.barkClass === 'none' ? 0 : 2),
    surfaceLoad: f(row.surface.load * 0.8),
    nearSurfaceLoad: f(row.nearSurface.load * 0.8),
    elevatedLoad: f(row.elevated.load * 0.8),
    barkLoad: f(row.bark.load),
    canopyHeight: f(row.canopyHeight),
    canopyCover: f(row.canopyCover),
    curing: f(80),
    timeSinceFire: f(NaN),
    lastFireKind: new Uint8Array(N),
    sources: ['test'],
    flags: new Uint16Array(N),
  };
}

/** A constant hourly series of `n` hours from t0 (each hour a copy of `w` with its own time). */
export function constantSeries(t0: number, n: number, w: WeatherHour): WeatherSeries {
  const hours: WeatherHour[] = [];
  for (let a = 0; a < n; a++) hours.push({ ...w, time: t0 + a * 3.6e6 });
  return { kind: 'fixture', source: 'test', location: { ...TEST_ORIGIN }, timezone: 'Australia/Sydney', hours };
}
