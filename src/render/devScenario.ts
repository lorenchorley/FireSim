/**
 * SYNTHETIC data for the render dev harness (dev.html) and render tests — NOT a fire model.
 *
 * - fabricateFuel: a plausible FuelMap from canopy cover/height and terrain (forest where the canopy is dense, wet
 *   forest / rainforest in sheltered gullies, heath on exposed ridges, grass on cleared flats, rock on cliffs).
 * - SyntheticFire: arrival times from a Dijkstra sweep with an elliptical wind ROS and a doubling-per-10° slope factor
 *   (so the fire runs up gullies and slopes), one spot fire, and per-snapshot fire fields, embers blown downwind, and
 *   a fake atmosphere (ambient profile, ridge speed-up, anabatic flow, fire indraft, a bent-over warm plume with
 *   smoke, a cold valley pool) so every render layer can be exercised and screenshotted.
 */
import { makeGridSpec, sampleBilinear, type GridSpec } from '../core/grid';
import {
  BurnState,
  FuelType,
  SpreadDriver,
  type AtmosphereView,
  type EmberParticles,
  type FireField,
  type FuelMap,
  type Ignition,
  type Insight,
  type SimSnapshot,
  type SpotFire,
  type Terrain,
  type WeatherHour,
} from '../core/types';
import { clamp, windToUV } from '../core/units';
import { solarPosition } from '../terrain';
import { hash01, nearestCell } from './fields';

// ─────────────────────────────────────────────────────────────────────────────
// Fuel
// ─────────────────────────────────────────────────────────────────────────────

interface TypeDefaults {
  surface: number;
  nearSurface: number;
  nsHeight: number;
  elevated: number;
  elHeight: number;
  bark: number;
  loads: [number, number, number, number];
}

const DEFAULTS: Partial<Record<FuelType, TypeDefaults>> = {
  [FuelType.DryForestShrubby]: { surface: 3, nearSurface: 2.5, nsHeight: 0.3, elevated: 3, elHeight: 1.5, bark: 3, loads: [12, 4, 5, 2] },
  [FuelType.WetForest]: { surface: 3.5, nearSurface: 2, nsHeight: 0.4, elevated: 2.5, elHeight: 3, bark: 2, loads: [15, 3, 5, 3] },
  [FuelType.Rainforest]: { surface: 2, nearSurface: 1, nsHeight: 0.2, elevated: 1, elHeight: 2, bark: 1, loads: [8, 1, 1, 0.5] },
  [FuelType.Heath]: { surface: 2, nearSurface: 3, nsHeight: 0.6, elevated: 3.5, elHeight: 1.4, bark: 0, loads: [5, 6, 10, 0] },
  [FuelType.GrassyWoodland]: { surface: 2, nearSurface: 2.5, nsHeight: 0.4, elevated: 1, elHeight: 1, bark: 2, loads: [6, 4, 1, 1] },
  [FuelType.Grassland]: { surface: 1, nearSurface: 3, nsHeight: 0.5, elevated: 0, elHeight: 0, bark: 0, loads: [4, 0, 0, 0] },
};

/** Plausible fuel map on `grid` from canopy (optional) and terrain. Deterministic. */
export function fabricateFuel(terrain: Terrain, grid: GridSpec, canopy: { height: Float32Array; cover: Float32Array } | null): FuelMap {
  const n = grid.nx * grid.ny;
  const f = (): Float32Array => new Float32Array(n);
  const fuel: FuelMap = {
    grid,
    type: new Uint8Array(n),
    surfaceHazard: f(),
    nearSurfaceHazard: f(),
    nearSurfaceHeight: f(),
    elevatedHazard: f(),
    elevatedHeight: f(),
    barkHazard: f(),
    surfaceLoad: f(),
    nearSurfaceLoad: f(),
    elevatedLoad: f(),
    barkLoad: f(),
    canopyHeight: f(),
    canopyCover: f(),
    curing: f(),
    timeSinceFire: f(),
    lastFireKind: new Uint8Array(n),
    sources: ['SYNTHETIC dev fuel map (render harness)'],
  };
  const tg = terrain.grid;
  const lowFlat = terrain.minElevation + 0.35 * (terrain.maxElevation - terrain.minElevation);
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const k = j * grid.nx + i;
      const x = grid.x0 + i * grid.cellSize;
      const y = grid.y0 + j * grid.cellSize;
      const kt = nearestCell(tg, x, y);
      const slope = terrain.slopeDeg[kt]!;
      const tpi = terrain.tpi[kt]!;
      const z = terrain.elevation[kt]!;
      let cover = canopy ? canopy.cover[k]! : clamp(0.55 - tpi / 120 + (hash01(i, j, 1) - 0.5) * 0.2, 0, 0.9);
      let height = canopy ? canopy.height[k]! : 18 + 10 * clamp(-tpi / 60, -1, 1);
      let t: FuelType;
      if (slope > 55) t = FuelType.NonFuel;
      else if (cover > 0.6 && tpi < -35 && height > 20) t = cover > 0.8 && tpi < -60 ? FuelType.Rainforest : FuelType.WetForest;
      else if (cover > 0.3) t = FuelType.DryForestShrubby;
      else if (slope < 6 && z < lowFlat) t = FuelType.Grassland;
      else if (cover > 0.15 && slope < 12) t = FuelType.GrassyWoodland;
      else t = FuelType.Heath;
      if (t === FuelType.Grassland) {
        cover = Math.min(cover, 0.05);
        height = Math.min(height, 12);
      }
      const d = DEFAULTS[t];
      fuel.type[k] = t;
      fuel.canopyCover[k] = cover;
      fuel.canopyHeight[k] = height;
      // Years since fire: smooth patches 2–35 years, with a recent hazard-reduction burn block.
      const tsf = 2 + 33 * smoothNoise(x / 1800, y / 1800, 5);
      fuel.timeSinceFire[k] = Math.hypot(x - 1800, y + 1500) < 700 ? 1.5 : tsf;
      if (d) {
        const age = clamp(fuel.timeSinceFire[k]! / 15, 0.25, 1);
        fuel.surfaceHazard[k] = d.surface * age;
        fuel.nearSurfaceHazard[k] = d.nearSurface * age;
        fuel.nearSurfaceHeight[k] = d.nsHeight;
        fuel.elevatedHazard[k] = d.elevated * age;
        fuel.elevatedHeight[k] = d.elHeight * (0.7 + 0.6 * hash01(i, j, 2));
        fuel.barkHazard[k] = d.bark;
        fuel.surfaceLoad[k] = d.loads[0] * age;
        fuel.nearSurfaceLoad[k] = d.loads[1] * age;
        fuel.elevatedLoad[k] = d.loads[2] * age;
        fuel.barkLoad[k] = d.loads[3];
        fuel.curing[k] = t === FuelType.Grassland || t === FuelType.GrassyWoodland ? 85 : 0;
      }
    }
  }
  return fuel;
}

/** Deterministic value noise 0–1 (bilinear over a hashed lattice). */
export function smoothNoise(x: number, y: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash01(i, j, seed);
  const b = hash01(i + 1, j, seed);
  const c = hash01(i, j + 1, seed);
  const d = hash01(i + 1, j + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fire
// ─────────────────────────────────────────────────────────────────────────────

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, pri: number): void {
    const k = this.k;
    const p = this.p;
    k.push(key);
    p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par]! <= p[i]!) break;
      [k[par], k[i]] = [k[i]!, k[par]!];
      [p[par], p[i]] = [p[i]!, p[par]!];
      i = par;
    }
  }
  pop(): [number, number] {
    const k = this.k;
    const p = this.p;
    const top: [number, number] = [k[0]!, p[0]!];
    const lk = k.pop()!;
    const lp = p.pop()!;
    if (k.length) {
      k[0] = lk;
      p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && p[l]! < p[m]!) m = l;
        if (r < k.length && p[r]! < p[m]!) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!];
        [p[m], p[i]] = [p[i]!, p[m]!];
        i = m;
      }
    }
    return top;
  }
}

const SPEED: Partial<Record<FuelType, number>> = {
  [FuelType.Grassland]: 3.2,
  [FuelType.GrassyWoodland]: 1.8,
  [FuelType.DryForestShrubby]: 1,
  [FuelType.DryForestGrassy]: 1.1,
  [FuelType.Heath]: 1.6,
  [FuelType.WetForest]: 0.45,
  [FuelType.Rainforest]: 0.12,
  [FuelType.AlpineHeathGrass]: 1.4,
  [FuelType.SnowGumWoodland]: 0.9,
};

export interface SyntheticFireOptions {
  /** Ignition point (local m). Default: chosen automatically upwind of the centre, low in the terrain. */
  ignition?: [number, number];
  windSpeed?: number;
  /** Direction FROM (deg). */
  windDir?: number;
  /** Scenario start (unix ms). */
  startTime: number;
  duration?: number;
  snapshotInterval?: number;
  temperature?: number;
  relativeHumidity?: number;
}

export class SyntheticFire {
  readonly terrain: Terrain;
  readonly fuel: FuelMap;
  readonly grid: GridSpec;
  readonly arrival: Float32Array;
  readonly ros: Float32Array;
  readonly dir: Float32Array;
  readonly intensity: Float32Array;
  readonly flame: Float32Array;
  readonly driver: Uint8Array;
  readonly phase: Uint8Array;
  readonly ignition: [number, number];
  readonly spot: SpotFire;
  readonly opts: Required<Omit<SyntheticFireOptions, 'ignition'>>;
  readonly weatherBase: WeatherHour;
  private readonly cache = new Map<number, SimSnapshot>();
  private readonly moisture: Float32Array;

  constructor(terrain: Terrain, fuel: FuelMap, o: SyntheticFireOptions) {
    this.terrain = terrain;
    this.fuel = fuel;
    this.grid = fuel.grid;
    this.opts = {
      windSpeed: o.windSpeed ?? 8,
      windDir: o.windDir ?? 295,
      startTime: o.startTime,
      duration: o.duration ?? 6 * 3600,
      snapshotInterval: o.snapshotInterval ?? 300,
      temperature: o.temperature ?? 34,
      relativeHumidity: o.relativeHumidity ?? 14,
    };
    const n = this.grid.nx * this.grid.ny;
    this.arrival = new Float32Array(n).fill(Infinity);
    this.ros = new Float32Array(n);
    this.dir = new Float32Array(n);
    this.intensity = new Float32Array(n);
    this.flame = new Float32Array(n);
    this.driver = new Uint8Array(n);
    this.phase = new Uint8Array(n);
    this.ignition = o.ignition ?? this.autoIgnition();
    this.weatherBase = {
      time: o.startTime,
      temperature: this.opts.temperature,
      relativeHumidity: this.opts.relativeHumidity,
      windSpeed10: this.opts.windSpeed,
      windDir10: this.opts.windDir,
      windGust10: this.opts.windSpeed * 1.5,
      cloudCover: 5,
    };
    // Spot fire ~1 km downwind of the ignition, 2.5 h in.
    const [wu, wv] = windToUV(1, this.opts.windDir);
    const sx = this.ignition[0] + wu * 2600;
    const sy = this.ignition[1] + wv * 2600;
    this.spot = { id: 1, x: sx, y: sy, time: 2.6 * 3600, distance: 900, travel: 1100 };
    this.sweep();
    this.moisture = this.makeMoisture();
  }

  private heightAt(x: number, y: number): number {
    return sampleBilinear(this.terrain.grid, this.terrain.elevation, x, y);
  }

  /** Burnable, low-lying cell 1.5–2.5 km upwind of the centre. */
  private autoIgnition(): [number, number] {
    const g = this.grid;
    const [wu, wv] = windToUV(1, this.opts.windDir);
    let best: [number, number] = [-wu * 1800, -wv * 1800];
    let bestZ = Infinity;
    for (let s = 0; s < 400; s++) {
      const d = 1400 + 1200 * hash01(s, 1);
      const a = (hash01(s, 2) - 0.5) * 1.2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ux = -(wu * ca - wv * sa);
      const uy = -(wu * sa + wv * ca);
      const x = ux * d;
      const y = uy * d;
      const k = nearestCell(g, x, y);
      const t = this.fuel.type[k] as FuelType;
      if (!SPEED[t] || t === FuelType.Rainforest || t === FuelType.WetForest) continue;
      const z = this.heightAt(x, y);
      if (z < bestZ) {
        bestZ = z;
        best = [x, y];
      }
    }
    return best;
  }

  private sweep(): void {
    const g = this.grid;
    const { nx, ny, cellSize: h } = g;
    const U = this.opts.windSpeed * 3.6;
    const [wu, wv] = windToUV(1, this.opts.windDir); // unit vector the wind blows towards
    const lb = 1 + 0.45 * (U / 10) ** 1.15;
    const e = Math.sqrt(1 - 1 / (lb * lb));
    const headBase = 0.004 + 0.0021 * U ** 1.35; // m/s, dry forest
    const z = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = this.heightAt(g.x0 + i * h, g.y0 + j * h);
    const src = new Int8Array(nx * ny); // 1 main, 2 spot
    const heap = new MinHeap();
    const kIgn = nearestCell(g, this.ignition[0], this.ignition[1]);
    this.arrival[kIgn] = 0;
    src[kIgn] = 1;
    heap.push(kIgn, 0);
    const kSpot = nearestCell(g, this.spot.x, this.spot.y);
    if (SPEED[this.fuel.type[kSpot] as FuelType]) {
      this.arrival[kSpot] = this.spot.time;
      src[kSpot] = 2;
      heap.push(kSpot, this.spot.time);
      this.driver[kSpot] = SpreadDriver.Spotting;
    }
    const stencil: [number, number][] = [];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if ((di || dj) && Math.abs(di * dj) !== 4 && !(Math.abs(di) === 2 && dj === 0) && !(Math.abs(dj) === 2 && di === 0)) stencil.push([di, dj]);
    const done = new Uint8Array(nx * ny);
    const tMax = this.opts.duration + 600;
    while (heap.size) {
      const [k, t] = heap.pop();
      if (done[k] || t > this.arrival[k]!) continue;
      done[k] = 1;
      if (t > tMax) break;
      const i = k % nx;
      const j = (k / nx) | 0;
      const sk = SPEED[this.fuel.type[k] as FuelType] ?? 0;
      for (const [di, dj] of stencil) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii;
        if (done[kk]) continue;
        const sn = SPEED[this.fuel.type[kk] as FuelType] ?? 0;
        if (sn <= 0 || sk <= 0) continue;
        const dx = di * h;
        const dy = dj * h;
        const dist = Math.hypot(dx, dy);
        const cosPhi = (dx * wu + dy * wv) / dist;
        const windR = (headBase * (1 - e)) / (1 - e * cosPhi);
        const theta = (Math.atan((z[kk]! - z[k]!) / dist) * 180) / Math.PI;
        const slopeF = clamp(Math.exp(0.069 * theta), 0.4, 9);
        const fuelF = (2 * sk * sn) / (sk + sn);
        const r = windR * slopeF * fuelF;
        const ta = t + dist / r;
        if (ta < this.arrival[kk]!) {
          this.arrival[kk] = ta;
          src[kk] = src[k]!;
          this.ros[kk] = r;
          this.dir[kk] = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
          // Driver from the factor decomposition.
          const windF = windR / (headBase * (1 - e));
          if (src[kk] === 2 && Math.hypot(ii * h + g.x0 - this.spot.x, jj * h + g.y0 - this.spot.y) < 200) this.driver[kk] = SpreadDriver.Spotting;
          else if (cosPhi < -0.3) this.driver[kk] = SpreadDriver.Backing;
          else if (slopeF > 2.2 && windF > 1.8) this.driver[kk] = SpreadDriver.WindAndSlope;
          else if (slopeF > 1.6 && slopeF > windF) this.driver[kk] = theta > 24 ? SpreadDriver.Eruptive : SpreadDriver.Slope;
          else if (fuelF > 1.5) this.driver[kk] = SpreadDriver.Fuel;
          else this.driver[kk] = SpreadDriver.Wind;
          heap.push(kk, ta);
        }
      }
    }
    // Smooth the Dijkstra arrival field a little (a level-set solver gives smooth fronts; the 16-neighbour sweep
    // leaves faceted ones).
    for (let pass = 0; pass < 2; pass++) {
      const a0 = this.arrival.slice();
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i;
          if (!Number.isFinite(a0[k]!) || k === kIgn || k === kSpot) continue;
          let s = 0;
          let c = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const v = a0[k + dj * nx + di]!;
              if (Number.isFinite(v)) {
                s += v;
                c++;
              }
            }
          }
          this.arrival[k] = s / c;
        }
      }
    }
    // Behaviour at arrival.
    for (let k = 0; k < nx * ny; k++) {
      if (!Number.isFinite(this.arrival[k]!)) continue;
      const t = this.fuel.type[k] as FuelType;
      const r = Math.max(this.ros[k]!, 0.003);
      this.ros[k] = r;
      const w = (this.fuel.surfaceLoad[k]! + this.fuel.nearSurfaceLoad[k]! + this.fuel.elevatedLoad[k]! + this.fuel.barkLoad[k]! * 0.5) / 10; // kg/m²
      const I = 18600 * w * r;
      this.intensity[k] = I;
      let fh: number;
      if (t === FuelType.Grassland) fh = clamp(0.6 + 2.2 * Math.sqrt(r), 0.5, 4);
      else if (t === FuelType.Heath) fh = clamp(0.8 + 3.5 * Math.sqrt(r), 0.5, 8);
      else fh = clamp(0.0193 * (r * 3600) ** 0.723 * Math.exp(0.64 * this.fuel.elevatedHeight[k]!) * 1.07, 0.5, 45);
      this.flame[k] = fh;
      this.phase[k] = I > 10000 ? 3 : I > 3500 ? 2 : 1;
    }
  }

  private makeMoisture(): Float32Array {
    const g = this.grid;
    const n = g.nx * g.ny;
    const m = new Float32Array(n);
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        const kt = nearestCell(this.terrain.grid, g.x0 + i * g.cellSize, g.y0 + j * g.cellSize);
        const asp = this.terrain.aspectDeg[kt]!;
        const sun = Number.isFinite(asp) ? Math.cos(((asp - 330) * Math.PI) / 180) : 0; // NNW/W faces driest
        const shelter = clamp(-this.terrain.tpi[kt]! / 40, -1, 1.5);
        m[k] = clamp(8 - 2.2 * sun + 3 * shelter + 3 * this.fuel.canopyCover[k]!, 3, 25);
      }
    }
    return m;
  }

  get times(): number[] {
    const out: number[] = [];
    for (let t = 0; t <= this.opts.duration; t += this.opts.snapshotInterval) out.push(t);
    return out;
  }

  ignitions(): Ignition[] {
    return [{ id: 'ign-1', kind: 'point', points: [this.ignition], time: 0, radius: 30, origin: 'observed' }];
  }

  insights(t: number): Insight[] {
    const out: Insight[] = [];
    // Head of the fire: the most recently burnt fast cell.
    const g = this.grid;
    let best = -1;
    let bestScore = 0;
    for (let k = 0; k < g.nx * g.ny; k++) {
      const a = this.arrival[k]!;
      if (!(a <= t && a > t - 900)) continue;
      const s = this.ros[k]!;
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    }
    if (best >= 0) {
      const x = g.x0 + (best % g.nx) * g.cellSize;
      const y = g.y0 + ((best / g.nx) | 0) * g.cellSize;
      out.push({
        id: 'ins-upslope',
        kind: 'upslope-run',
        severity: 'danger',
        time: t,
        x,
        y,
        title: 'Fire will speed up uphill',
        body: 'The head fire is climbing a steep slope with the wind behind it.',
        factors: [{ label: 'Rate of spread', value: `${(bestScore * 3.6).toFixed(1)} km/h` }],
      });
    }
    if (t >= this.spot.time) {
      out.push({
        id: 'ins-spot',
        kind: 'spot-fire',
        severity: 'watch',
        time: this.spot.time,
        x: this.spot.x + 150,
        y: this.spot.y + 150,
        title: 'Spot fire ahead of the front',
        body: 'Embers started a new fire about 900 m ahead of the main front.',
        factors: [],
      });
    }
    out.push({
      id: 'ins-gully',
      kind: 'moist-gully',
      severity: 'info',
      time: 0,
      x: this.ignition[0] + 900,
      y: this.ignition[1] - 700,
      title: 'Shady gully = wetter, but not safe',
      body: 'Moist gullies slow a fire in mild weather.',
      factors: [],
    });
    return out;
  }

  /** Snapshot at simulation time t (s). Cached. */
  snapshotAt(t: number): SimSnapshot {
    const key = Math.round(t);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const g = this.grid;
    const n = g.nx * g.ny;
    const fire: FireField = {
      grid: g,
      arrivalTime: new Float32Array(n),
      burnState: new Uint8Array(n),
      ros: new Float32Array(n),
      intensity: new Float32Array(n),
      flameHeight: new Float32Array(n),
      spreadDir: new Float32Array(n),
      driver: new Uint8Array(n),
      phase: new Uint8Array(n),
    };
    let burning = 0;
    let burnt = 0;
    let maxRos = 0;
    let maxI = 0;
    for (let k = 0; k < n; k++) {
      const a = this.arrival[k]!;
      const tType = this.fuel.type[k] as FuelType;
      if (a <= t) {
        const residence = tType === FuelType.Grassland ? 180 : tType === FuelType.Heath ? 420 : 900;
        fire.arrivalTime[k] = a;
        fire.burnState[k] = t - a < residence ? BurnState.Burning : BurnState.BurntOut;
        fire.ros[k] = this.ros[k]!;
        fire.intensity[k] = this.intensity[k]!;
        fire.flameHeight[k] = this.flame[k]!;
        fire.spreadDir[k] = this.dir[k]!;
        fire.driver[k] = this.driver[k]!;
        fire.phase[k] = this.phase[k]!;
        if (fire.burnState[k] === BurnState.Burning) burning++;
        burnt++;
        if (this.ros[k]! > maxRos) maxRos = this.ros[k]!;
        if (this.intensity[k]! > maxI) maxI = this.intensity[k]!;
      } else {
        fire.arrivalTime[k] = Infinity;
        fire.burnState[k] = SPEED[tType] ? BurnState.Unburnt : BurnState.NonFlammable;
      }
    }
    const weather: WeatherHour = { ...this.weatherBase, time: this.opts.startTime + t * 1000 };
    const embers = this.makeEmbers(fire, t);
    const atmosphere = this.makeAtmosphere(fire, t);
    const spotFires = t >= this.spot.time ? [this.spot] : [];
    const snap: SimSnapshot = {
      time: t,
      fire,
      moisture: this.moisture,
      atmosphere,
      embers,
      spotFires,
      insights: [],
      stats: {
        time: t,
        burntAreaHa: (burnt * g.cellSize * g.cellSize) / 1e4,
        burningCells: burning,
        perimeterKm: 0,
        maxRos,
        maxIntensity: maxI,
        headDir: (this.opts.windDir + 180) % 360,
        headRos: maxRos,
        activeEmbers: embers.count,
        spotFires: spotFires.length,
        embersLeftDomain: 0,
        convectiveNumber: 4,
        weather,
        deadFuelMoistureMean: 8,
        ffdi: 48,
        fireDangerRating: 'Extreme',
        msPerSimMinute: 0,
      },
    };
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, snap);
    return snap;
  }

  private makeEmbers(fire: FireField, t: number): EmberParticles {
    const g = this.grid;
    const src: number[] = [];
    const w: number[] = [];
    let wsum = 0;
    for (let k = 0; k < g.nx * g.ny; k++) {
      if (fire.burnState[k] !== BurnState.Burning || fire.intensity[k]! < 1500) continue;
      src.push(k);
      const wi = Math.min(fire.intensity[k]!, 30000);
      w.push(wi);
      wsum += wi;
    }
    const count = Math.min(1800, Math.round(wsum / 700));
    const data = new Float32Array(count * 4);
    if (!src.length || count === 0) return { count: 0, data };
    const cdf: number[] = [];
    let acc = 0;
    for (const wi of w) cdf.push((acc += wi / wsum));
    const [wu, wv] = windToUV(1, this.opts.windDir);
    const seed = Math.round(t);
    for (let e = 0; e < count; e++) {
      const r = hash01(e, seed, 1);
      let lo = 0;
      let hi = cdf.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (cdf[m]! < r) lo = m + 1;
        else hi = m;
      }
      const k = src[lo]!;
      const x0 = g.x0 + (k % g.nx) * g.cellSize;
      const y0 = g.y0 + ((k / g.nx) | 0) * g.cellSize;
      const d = -Math.log(1 - 0.999 * hash01(e, seed, 2)) * 350 * (this.opts.windSpeed / 8);
      const lat = (hash01(e, seed, 3) - 0.5) * (60 + 0.35 * d);
      const x = x0 + wu * d - wv * lat;
      const y = y0 + wv * d + wu * lat;
      const ground = this.heightAt(x, y);
      const loft = (40 + 700 * (d / 1500) * Math.exp(-d / 1800)) * (0.4 + 0.9 * hash01(e, seed, 4));
      data[e * 4] = x;
      data[e * 4 + 1] = y;
      data[e * 4 + 2] = Math.max(ground + 3, this.heightAt(x0, y0) + loft * Math.min(1, d / 150 + 0.2));
      data[e * 4 + 3] = clamp(Math.exp(-d / 900) * (0.7 + 0.3 * hash01(e, seed, 5)), 0.05, 1);
    }
    return { count, data };
  }

  private makeAtmosphere(fire: FireField, t: number): AtmosphereView {
    const tr = this.terrain;
    const size = (tr.grid.nx - 1) * tr.grid.cellSize;
    const nx = 48;
    const cell = size / nx;
    const grid: GridSpec = { ...makeGridSpec(tr.grid.origin, size, cell), nx, ny: nx };
    grid.x0 = -((nx - 1) * cell) / 2;
    grid.y0 = grid.x0;
    const nz = 24;
    const top = 3000;
    const levels = new Float32Array(nz);
    for (let z = 0; z < nz; z++) levels[z] = top * ((z + 0.5) / nz) ** 1.5;
    const base = tr.minElevation;
    const plane = nx * nx;
    const terrainHeight = new Float32Array(plane);
    for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) terrainHeight[j * nx + i] = this.heightAt(grid.x0 + i * cell, grid.y0 + j * cell) - base;
    const u = new Float32Array(plane * nz);
    const v = new Float32Array(plane * nz);
    const w = new Float32Array(plane * nz);
    const th = new Float32Array(plane * nz);
    const smoke = new Float32Array(plane * nz);
    const surfaceU = new Float32Array(plane);
    const surfaceV = new Float32Array(plane);
    const [au, av] = windToUV(this.opts.windSpeed, this.opts.windDir);
    const sun = solarPosition(this.opts.startTime + t * 1000, tr.grid.origin.lat, tr.grid.origin.lon);
    const day = clamp(sun.elevation / 20, -1, 1);
    // Fire: centroid and power.
    let cx = 0;
    let cy = 0;
    let q = 0;
    const fg = fire.grid;
    for (let k = 0; k < fg.nx * fg.ny; k++) {
      if (fire.burnState[k] !== BurnState.Burning) continue;
      const ik = fire.intensity[k]!;
      cx += ik * (fg.x0 + (k % fg.nx) * fg.cellSize);
      cy += ik * (fg.y0 + ((k / fg.nx) | 0) * fg.cellSize);
      q += ik;
    }
    const hasFire = q > 0;
    if (hasFire) {
      cx /= q;
      cy /= q;
    }
    const power = Math.min(1, q / 2e6); // 0–1
    const wp = 4 + 10 * Math.sqrt(power);
    const plumeTop = 700 + 2200 * Math.sqrt(power);
    const groundC = hasFire ? this.heightAt(cx, cy) : base;
    // Plume trajectory samples (for theta, w and smoke).
    const traj: { x: number; y: number; z: number; s: number; a: number }[] = [];
    if (hasFire) {
      let x = cx;
      let y = cy;
      let h = 0;
      for (let s = 0; s < 400 && traj.length < 120; s++) {
        const f = clamp((Math.max(h, 1) / 10) ** (1 / 7), 0.6, 2.5);
        const rising = h < plumeTop;
        const wz = rising ? wp * Math.max(0.3, 1 - h / plumeTop) : 0;
        x += au * f * 20;
        y += av * f * 20;
        h = Math.min(plumeTop, h + wz * 20);
        if (s % 3 === 0) traj.push({ x, y, z: groundC + h, s: 110 + 0.3 * h + (rising ? 0 : 0.1 * (s * 20 - 0)), a: rising ? 1 : 0.6 });
        if (!rising && traj.length > 30 && Math.hypot(x - cx, y - cy) > 4500) break;
      }
    }
    // Cold-pool reference: low terrain.
    const valleyH = (tr.maxElevation - tr.minElevation) * 0.3;
    for (let zi = 0; zi < nz; zi++) {
      const zAsl = base + levels[zi]!;
      for (let j = 0; j < nx; j++) {
        for (let i = 0; i < nx; i++) {
          const k2 = j * nx + i;
          const k = zi * plane + k2;
          const x = grid.x0 + i * cell;
          const y = grid.y0 + j * cell;
          const agl = zAsl - (base + terrainHeight[k2]!);
          if (agl < 0) continue; // below ground: masked (0)
          const f = clamp((Math.max(agl, 1) / 10) ** (1 / 7), 0.6, 2.5);
          // Ridge speed-up near the surface.
          const ridge = 1 + 0.35 * clamp((terrainHeight[k2]! - valleyH * 1.5) / 400, -0.6, 1) * Math.exp(-agl / 300);
          let uu = au * f * ridge;
          let vv = av * f * ridge;
          let ww = 0;
          let tt = 0;
          // Anabatic (day) / katabatic (night) along the slope in the lowest ~150 m.
          const gx = (this.heightAt(x + 60, y) - this.heightAt(x - 60, y)) / 120;
          const gy = (this.heightAt(x, y + 60) - this.heightAt(x, y - 60)) / 120;
          const gl = Math.hypot(gx, gy);
          if (gl > 0.05) {
            const slopeWind = 1.8 * day * Math.exp(-agl / 120) * Math.min(1, gl * 2);
            uu += (gx / gl) * slopeWind;
            vv += (gy / gl) * slopeWind;
            ww += slopeWind * Math.min(0.5, gl) * 0.5;
          }
          // Cold pool in the valley bottom.
          if (terrainHeight[k2]! < valleyH) tt -= (day < 0 ? 4 : 1.2) * Math.exp(-agl / 90) * (1 - terrainHeight[k2]! / valleyH);
          // Sunlit slopes warm the air above them a little in the afternoon.
          if (day > 0 && gl > 0.1) tt += 0.8 * day * Math.exp(-agl / 60);
          if (hasFire) {
            // Indraft towards the fire near the surface.
            const dxF = x - cx;
            const dyF = y - cy;
            const rF = Math.hypot(dxF, dyF) + 1;
            const ind = 3.5 * power ** 0.5 * Math.exp(-rF / 900) * Math.exp(-agl / 250);
            uu -= (dxF / rF) * ind;
            vv -= (dyF / rF) * ind;
            // Plume.
            for (const p of traj) {
              const d2 = (x - p.x) ** 2 + (y - p.y) ** 2 + ((zAsl - p.z) * 1.4) ** 2;
              const g2 = Math.exp(-d2 / (2 * p.s * p.s));
              if (g2 < 1e-3) continue;
              const hr = (p.z - groundC) / plumeTop;
              tt = Math.max(tt, 14 * power ** 0.5 * g2 * Math.exp(-hr * 1.3) * p.a + tt * 0);
              ww = Math.max(ww, wp * g2 * p.a * (1 - 0.6 * hr));
              smoke[k]! += g2 * (0.6 + 0.8 * (1 - p.a)) * p.a * (0.15 + 0.85 * Math.sqrt(power)) * 2.2;
            }
          }
          u[k] = uu;
          v[k] = vv;
          w[k] = ww;
          th[k] = tt;
        }
      }
    }
    // 10 m wind: the lowest level above ground in each column.
    for (let j = 0; j < nx; j++) {
      for (let i = 0; i < nx; i++) {
        const k2 = j * nx + i;
        for (let zi = 0; zi < nz; zi++) {
          if (levels[zi]! >= terrainHeight[k2]!) {
            surfaceU[k2] = u[zi * plane + k2]! * 0.75;
            surfaceV[k2] = v[zi * plane + k2]! * 0.75;
            break;
          }
        }
      }
    }
    return { grid, nz, levels, terrainHeight, surfaceU, surfaceV, u, v, w, thetaAnomaly: th, smoke };
  }
}
