/**
 * Per-cycle detector context (spec §10.1): built once per 60 s detector cycle from the SimStateView and shared by all
 * rules — front and head cells (head = front cells with aux.direction ≥ 0.8), outward normals, spatial hashes of the
 * front and the head, the head fire, U_ridge,median, clock values and a reusable per-tile top-K accumulator.
 * All buffers are allocated once per scenario (fire grid size); `prepare` is allocation-free apart from tiny objects.
 *
 * Interpretation notes (contract ambiguities, see the module README in index.ts):
 * - `SimStateView.time` is seconds from the scenario start (as FireField.arrivalTime, SpotFire.time, Insight.time);
 *   a value > 1e11 is taken as unix ms. Unix ms "now" = startMs + time·1000 when the engine knows startMs, else
 *   `weather.time` (the interpolated WeatherHour at t).
 * - `aux.front` lists fire-grid cell indices (entries < 0 or ≥ N are ignored; an empty list is rebuilt from
 *   burnState). `aux.frontNormalX/Y` are per cell (length N) or per `aux.front` entry; `aux.headIndex` is a cell
 *   index (or an index into `aux.front` when that cell is not burning).
 */
import type { GridSpec } from '../core/grid';
import { BurnState, type FuelMap, type SimStateView, type SpotFire, type Terrain, type TerrainDerived, type TerrainFeatures, type WeatherHour } from '../core/types';
import { RAD, wrapDeg } from '../core/units';
import type { ForecastAnalysis } from './forecast';
import { EXPLAIN_PARAMS } from './params';
import { StaticMaps } from './statics';
import { CellHash, TileTopK, Tiles, azimuthOf, medianFinite } from './util';

const P = EXPLAIN_PARAMS;

/** Serialisable engine memory shared by the stateful detectors (checkpointed with the engine, spec §12.4). */
export interface EngineMemory {
  /** Sim seconds of the last detector cycle (NaN before the first). */
  lastRunT: number;
  /** Sim seconds of the cycle before that (arrival windows of event cards). */
  prevRunT: number;
  /** Highest spot-fire id already processed (spot-fire, fuel-break spot variant). */
  spotMaxId: number;
  /** Number of spot fires already processed (when ids are not increasing). */
  spotSeen: number;
  /** Maximum head ROS (m/s) since the registered sunrise (night-slowdown). */
  dayMaxRos: number;
  dayKey: number;
  /** Mean front moisture at the first cycle after sunset, and that sunset (unix ms). */
  sunsetM: number;
  sunsetKey: number;
  /** Ring of [t, u, v] of the mean front 10 m wind (katabatic S17). */
  windHist: number[];
  /** Local dates already covered by daily cards. */
  highDroughtDay: string;
  afternoonDay: string;
  s13Day: string;
  /** Maximum Δθ seen since the registered sunrise ("breaking now"). */
  morningDThetaMax: number;
  morningKey: number;
  /** DMZ bookkeeping. */
  dmzT: number;
  dmzChange: number;
  dmzCells: number;
  dmzAreaHa: number;
  dmzX: number;
  dmzY: number;
}

export function freshMemory(): EngineMemory {
  return {
    lastRunT: NaN,
    prevRunT: NaN,
    spotMaxId: -Infinity,
    spotSeen: 0,
    dayMaxRos: 0,
    dayKey: NaN,
    sunsetM: NaN,
    sunsetKey: NaN,
    windHist: [],
    highDroughtDay: '',
    afternoonDay: '',
    s13Day: '',
    morningDThetaMax: 0,
    morningKey: NaN,
    dmzT: NaN,
    dmzChange: NaN,
    dmzCells: 0,
    dmzAreaHa: 0,
    dmzX: NaN,
    dmzY: NaN,
  };
}

export class CycleContext {
  readonly grid: GridSpec;
  readonly nx: number;
  readonly ny: number;
  readonly cs: number;
  readonly N: number;
  readonly tiles: Tiles;
  readonly acc: TileTopK;
  readonly frontHash: CellHash;
  readonly headHash: CellHash;
  /** Front cells [0, nFront) and their outward-normal / spread azimuths (deg). */
  readonly front: Int32Array;
  readonly frontNormal: Float32Array;
  readonly frontSpread: Float32Array;
  nFront = 0;
  /** Head cells [0, nHead) (indices into the fire grid). */
  readonly head: Int32Array;
  nHead = 0;
  /** The head fire (front cell of maximum ROS among head cells), −1 without fire. */
  headK = -1;
  headX = 0;
  headY = 0;
  headDir = NaN;
  headRos = 0;
  /** Scratch buffer (length N). */
  readonly scratch: Float32Array;
  readonly mark: Uint8Array;
  /** Outward normal / spread azimuth per fire cell, valid on the current front cells. */
  readonly cellNormal: Float32Array;
  readonly cellSpread: Float32Array;
  /** Spot fires not seen by an earlier cycle (set by the engine before the detectors run). */
  newSpots: SpotFire[] = [];
  /** Detector cycle counter (stamps per-cycle caches). */
  cycle = 0;
  /** Optional AFDRS FBI provider (spec §2.4 fire/ afdrsFbi, injected by the sim). */
  afdrsFbi: ((w: WeatherHour) => number) | null = null;
  /** Optional services the engine attaches (DMZ overlay). */
  services: { dmz?: (ctx: CycleContext, change: { time: number; toDir: number; postSpeed: number }) => void } = {};
  private readonly tileFireDistV: Float32Array;
  private readonly tileFireStamp: Int32Array;

  s!: SimStateView;
  mem!: EngineMemory;
  forecast: ForecastAnalysis | null = null;
  /** Seconds since the scenario start. */
  t = 0;
  /** unix ms now. */
  nowMs = 0;
  /** unix ms of the scenario start (NaN if unknown). */
  startMs = NaN;
  lat: number;
  lon: number;
  timeZone = 'Australia/Sydney';
  uRidgeMedian = NaN;
  /** Grid-point (ambient) wind. */
  ambientSpeed = 0;
  ambientFrom = 0;
  frontDistOk = false;
  /** Domain centre (m). */
  readonly cx: number;
  readonly cy: number;
  private frontNormalSrc: 'cell' | 'entry' | 'none' = 'none';

  constructor(
    readonly terrain: Terrain,
    readonly derived: TerrainDerived,
    readonly fuel: FuelMap,
    readonly features: TerrainFeatures,
    readonly statics: StaticMaps,
  ) {
    const g = (this.grid = terrain.grid);
    this.nx = g.nx;
    this.ny = g.ny;
    this.cs = g.cellSize;
    this.N = g.nx * g.ny;
    this.tiles = statics.tiles;
    this.acc = new TileTopK(this.tiles, 16);
    this.frontHash = new CellHash(g, P.engine.hashBucketM);
    this.headHash = new CellHash(g, P.engine.hashBucketM);
    this.front = new Int32Array(this.N);
    this.frontNormal = new Float32Array(this.N);
    this.frontSpread = new Float32Array(this.N);
    this.head = new Int32Array(this.N);
    this.scratch = new Float32Array(this.N);
    this.mark = new Uint8Array(this.N);
    this.cellNormal = new Float32Array(this.N);
    this.cellSpread = new Float32Array(this.N);
    this.tileFireDistV = new Float32Array(this.tiles.count);
    this.tileFireStamp = new Int32Array(this.tiles.count).fill(-1);
    this.lat = g.origin.lat;
    this.lon = g.origin.lon;
    this.cx = g.x0 + ((g.nx - 1) * g.cellSize) / 2;
    this.cy = g.y0 + ((g.ny - 1) * g.cellSize) / 2;
  }

  /** Build the per-cycle view. */
  prepare(s: SimStateView, mem: EngineMemory, startMs: number, forecast: ForecastAnalysis | null): void {
    this.cycle++;
    this.s = s;
    this.mem = mem;
    this.forecast = forecast;
    this.startMs = startMs;
    this.timeZone = s.series?.timezone || 'Australia/Sydney';
    // Clock.
    if (s.time > 1e11) {
      this.nowMs = s.time;
      const st = Number.isFinite(startMs) ? startMs : (s.series?.hours[0]?.time ?? s.time);
      this.t = (s.time - st) / 1000;
    } else {
      this.t = s.time;
      this.nowMs = Number.isFinite(startMs) ? startMs + s.time * 1000 : s.weather.time;
    }
    this.ambientSpeed = s.weather.windSpeed10;
    this.ambientFrom = s.weather.windDir10;
    const ur = s.atmosDiag?.uRidgeMedian;
    this.uRidgeMedian = ur !== undefined && Number.isFinite(ur) ? ur : medianFinite(s.uRidge, this.scratch);
    this.frontDistOk = s.aux.frontDist.length === this.N;
    this.buildFront();
    this.buildHead();
    this.frontHash.build(this.front, this.nFront);
    this.headHash.build(this.head, this.nHead);
  }

  private buildFront(): void {
    const s = this.s;
    const { N, nx, ny } = this;
    const bs = s.fire.burnState;
    const af = s.aux.front;
    const nxA = s.aux.frontNormalX;
    const nyA = s.aux.frontNormalY;
    this.frontNormalSrc = nxA.length === N && nyA.length === N ? 'cell' : nxA.length === af.length && nyA.length === af.length && af.length > 0 ? 'entry' : 'none';
    let n = 0;
    for (let a = 0; a < af.length; a++) {
      const k = af[a]!;
      if (k < 0 || k >= N) continue;
      this.front[n] = k;
      this.frontNormal[n] = this.normalFromAux(a, k);
      n++;
    }
    if (n === 0) {
      // Rebuild from the burn state: burning cells with an unburnt 4-neighbour.
      for (let k = 0; k < N; k++) {
        if (bs[k] !== BurnState.Burning) continue;
        const j = (k / nx) | 0;
        const i = k - j * nx;
        const open =
          (i > 0 && bs[k - 1] === BurnState.Unburnt) ||
          (i < nx - 1 && bs[k + 1] === BurnState.Unburnt) ||
          (j > 0 && bs[k - nx] === BurnState.Unburnt) ||
          (j < ny - 1 && bs[k + nx] === BurnState.Unburnt);
        if (!open) continue;
        this.front[n] = k;
        this.frontNormal[n] = NaN;
        n++;
      }
      this.frontNormalSrc = 'none';
    }
    this.nFront = n;
    const sd = s.fire.spreadDir;
    for (let a = 0; a < n; a++) {
      const k = this.front[a]!;
      let nrm = this.frontNormal[a]!;
      if (!(nrm === nrm)) nrm = this.geometricNormal(k);
      const sp = sd[k]!;
      this.frontSpread[a] = sp === sp ? sp : nrm;
      if (!(nrm === nrm)) nrm = this.frontSpread[a]!;
      this.frontNormal[a] = nrm;
      this.cellNormal[k] = nrm;
      this.cellSpread[k] = this.frontSpread[a]!;
    }
  }

  private normalFromAux(a: number, k: number): number {
    if (this.frontNormalSrc === 'none') return NaN;
    const idx = this.frontNormalSrc === 'cell' ? k : a;
    return azimuthOf(this.s.aux.frontNormalX[idx]!, this.s.aux.frontNormalY[idx]!);
  }

  /** Outward normal from the burnt/unburnt neighbourhood (unit vectors towards unburnt neighbours). */
  geometricNormal(k: number): number {
    const bs = this.s.fire.burnState;
    const { nx, ny } = this;
    const j = (k / nx) | 0;
    const i = k - j * nx;
    let sx = 0;
    let sy = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const b = bs[jj * nx + ii];
        const w = b === BurnState.Unburnt ? 1 : b === BurnState.NonFlammable ? 0 : -1;
        const r = Math.hypot(di, dj);
        sx += (w * di) / r;
        sy += (w * dj) / r;
      }
    }
    return azimuthOf(sx, sy);
  }

  private buildHead(): void {
    const s = this.s;
    const dir = s.aux.direction;
    const hasDir = dir.length === this.N;
    const ros = s.fire.ros;
    const thr = P.engine.headDirectionMin;
    let n = 0;
    let maxRos = 0;
    for (let a = 0; a < this.nFront; a++) {
      const r = ros[this.front[a]!]!;
      if (r > maxRos) maxRos = r;
    }
    for (let a = 0; a < this.nFront; a++) {
      const k = this.front[a]!;
      const isHead = hasDir && dir[k]! > 0 ? dir[k]! >= thr : ros[k]! >= thr * maxRos && maxRos > 0;
      if (isHead) this.head[n++] = k;
    }
    this.nHead = n;
    // The head fire.
    let hk = -1;
    const hi = s.aux.headIndex;
    if (hi >= 0 && hi < this.N && s.fire.burnState[hi] === BurnState.Burning) hk = hi;
    else if (hi >= 0 && hi < s.aux.front.length) {
      const k = s.aux.front[hi]!;
      if (k >= 0 && k < this.N) hk = k;
    }
    if (hk < 0) {
      let best = -1;
      for (let a = 0; a < n; a++) {
        const k = this.head[a]!;
        if (best < 0 || ros[k]! > ros[best]!) best = k;
      }
      if (best < 0 && this.nFront > 0) best = this.front[0]!;
      hk = best;
    }
    this.headK = hk;
    if (hk >= 0) {
      const g = this.grid;
      const j = (hk / g.nx) | 0;
      this.headX = g.x0 + (hk - j * g.nx) * g.cellSize;
      this.headY = g.y0 + j * g.cellSize;
      const sd = s.fire.spreadDir[hk]!;
      this.headDir = sd === sd ? sd : this.geometricNormal(hk);
      this.headRos = ros[hk]!;
    } else {
      this.headX = this.cx;
      this.headY = this.cy;
      this.headDir = NaN;
      this.headRos = 0;
    }
  }

  /** Distance (m) from cell k to the nearest burning cell (aux.frontDist, else the front hash; ∞ without fire). */
  distToFire(k: number, rMax = 1e9): number {
    if (this.nFront === 0) return Infinity;
    if (this.frontDistOk) {
      const d = this.s.aux.frontDist[k]!;
      if (d === d) return d;
    }
    const g = this.grid;
    const j = (k / g.nx) | 0;
    this.frontHash.nearest(g.x0 + (k - j * g.nx) * g.cellSize, g.y0 + j * g.cellSize, Math.min(rMax, 30000));
    return this.frontHash.lastDist;
  }

  /**
   * Lower bound (m) of the distance from any cell of tile t to the fire (tile centre distance − half diagonal),
   * cached per cycle; used to skip whole tiles in the all-cell detectors.
   */
  tileFireDist(t: number): number {
    if (this.tileFireStamp[t] === this.cycle) return this.tileFireDistV[t]!;
    let d = Infinity;
    if (this.nFront > 0) {
      const g = this.grid;
      const cpt = this.tiles.cellsPerTile;
      const x = g.x0 + (this.tiles.tx(t) + 0.5) * cpt * g.cellSize;
      const y = g.y0 + (this.tiles.ty(t) + 0.5) * cpt * g.cellSize;
      const half = 0.7072 * this.tiles.tileM;
      // Detectors only ask about ≤ 2 km, so search 3 km and report a lower bound beyond it.
      const R = 3000;
      this.frontHash.nearest(x, y, R);
      d = Math.max(0, Math.min(this.frontHash.lastDist, R) - half);
    }
    this.tileFireDistV[t] = d;
    this.tileFireStamp[t] = this.cycle;
    return d;
  }

  /** Fire-wind speed (m/s) at cell k. */
  windSpeed(k: number): number {
    return Math.hypot(this.s.windU[k]!, this.s.windV[k]!);
  }
  /** Azimuth the fire wind blows TOWARDS at cell k (NaN if calm). */
  windTo(k: number): number {
    return azimuthOf(this.s.windU[k]!, this.s.windV[k]!);
  }
  /** Background 10 m wind speed (m/s) at cell k (U_ridge at a crest cell, D42). */
  bgSpeed(k: number): number {
    return Math.hypot(this.s.windBgU[k]!, this.s.windBgV[k]!);
  }
  bgTo(k: number): number {
    return azimuthOf(this.s.windBgU[k]!, this.s.windBgV[k]!);
  }
  /** Local x, y (m) of cell k. */
  x(k: number): number {
    return this.grid.x0 + (k % this.nx) * this.cs;
  }
  y(k: number): number {
    return this.grid.y0 + ((k / this.nx) | 0) * this.cs;
  }
  /** Distance (m) from cell k to the head fire (∞ without fire). */
  distToHead(x: number, y: number): number {
    return this.headK < 0 ? Infinity : Math.hypot(x - this.headX, y - this.headY);
  }
  /** Upslope azimuth (aspect + 180°), NaN on flat cells. */
  upslope(k: number): number {
    const a = this.terrain.aspectDeg[k]!;
    return a === a ? wrapDeg(a + 180) : NaN;
  }
  /** Directional slope (deg, + uphill) along azimuth az at cell k. */
  slopeAlong(k: number, az: number): number {
    const r = az / RAD;
    return Math.atan(this.terrain.dzdx[k]! * Math.sin(r) + this.terrain.dzdy[k]! * Math.cos(r)) * RAD;
  }
  /** Spatial key of cell k's tile. */
  key(kind: string, k: number): string {
    return this.tiles.key(kind, this.tiles.ofCell(k));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stand-alone contexts (a rule's detect(s) called without the engine, e.g. in tests)
// ─────────────────────────────────────────────────────────────────────────────

const standalone = new WeakMap<Terrain, { ctx: CycleContext; mem: EngineMemory }>();

/** A prepared context for `s` with a fresh memory (cached per terrain object). */
export function standaloneContext(s: SimStateView): CycleContext {
  let e = standalone.get(s.terrain);
  if (!e || e.ctx.fuel !== s.fuel || e.ctx.features !== s.features) {
    const statics = new StaticMaps(s.terrain, s.derived, s.fuel, s.features);
    e = { ctx: new CycleContext(s.terrain, s.derived, s.fuel, s.features, statics), mem: freshMemory() };
    standalone.set(s.terrain, e);
  }
  e.ctx.prepare(s, e.mem, NaN, null);
  return e.ctx;
}
