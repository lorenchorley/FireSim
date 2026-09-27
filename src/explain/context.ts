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
import { DEG, RAD } from '../core/units';
import type { ForecastAnalysis } from './forecast';
import { EXPLAIN_PARAMS } from './params';
import { StaticMaps, distanceTransform } from './statics';
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
  /** Directional slope θ (deg, + uphill) along the spread direction of each front entry. */
  readonly frontTheta: Float32Array;
  nFront = 0;
  /**
   * Front sampling stride of the per-front detectors: 1 up to `engine.maxFrontExamined` front cells, then the
   * smallest stride that keeps the examined set within it [H performance, spec §10.1 "front cells ≤ 20 000"].
   * Count thresholds scale with it (`kFor`).
   */
  fStride = 1;
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
  /** Per-cell visit stamps (compare with `nextStamp()`), so marking needs no clearing pass. */
  readonly stamp: Int32Array;
  private stampId = 0;
  /** Outward normal / spread azimuth per fire cell, valid on the current front cells. */
  readonly cellNormal: Float32Array;
  readonly cellSpread: Float32Array;
  /** Unit outward-normal vector per fire cell (valid on the current front cells). */
  readonly cellNx: Float32Array;
  readonly cellNy: Float32Array;
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
  /** Per-cycle tile distance transform (m, lower bound) used when aux.frontDist is absent. */
  private readonly tileDt: Float32Array;
  private readonly tileDtNearest: Int32Array;
  private readonly tileHasFire: Uint8Array;
  private tileDtCycle = -1;

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
    // K up to 32: "≥ 200 m of head" is 20 cells on a 10 m grid (plume-dominated).
    this.acc = new TileTopK(this.tiles, 32);
    this.frontHash = new CellHash(g, P.engine.hashBucketM);
    this.headHash = new CellHash(g, P.engine.hashBucketM);
    this.front = new Int32Array(this.N);
    this.frontNormal = new Float32Array(this.N);
    this.frontSpread = new Float32Array(this.N);
    this.frontTheta = new Float32Array(this.N);
    this.head = new Int32Array(this.N);
    this.scratch = new Float32Array(this.N);
    this.stamp = new Int32Array(this.N);
    this.cellNormal = new Float32Array(this.N);
    this.cellSpread = new Float32Array(this.N);
    this.cellNx = new Float32Array(this.N);
    this.cellNy = new Float32Array(this.N);
    this.tileFireDistV = new Float32Array(this.tiles.count);
    this.tileFireStamp = new Int32Array(this.tiles.count).fill(-1);
    this.tileDt = new Float32Array(this.tiles.count);
    this.tileDtNearest = new Int32Array(this.tiles.count);
    this.tileHasFire = new Uint8Array(this.tiles.count);
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
    this.uRidgeMedian = ur !== undefined && Number.isFinite(ur) ? ur : this.ridgeMedianFallback();
    this.frontDistOk = s.aux.frontDist.length === this.N;
    this.buildFront();
    this.fStride = Math.max(1, Math.ceil(this.nFront / P.engine.maxFrontExamined));
    this.buildHead();
    this.frontHash.build(this.front, this.nFront);
    this.headHash.build(this.head, this.nHead);
  }

  /**
   * U_ridge,median when the atmosphere does not report it (D42: median over ridge cells of |U_bg10| at the crest):
   * the per-tile ridge representatives, else a strided sample of `s.uRidge` (bounded cost).
   */
  private ridgeMedianFallback(): number {
    const reps = this.statics.ridgeReps;
    const buf = this.scratch;
    let n = 0;
    if (reps.length > 0) {
      for (let a = 0; a < reps.length; a++) buf[n++] = this.bgSpeed(reps[a]!);
    } else {
      const u = this.s.uRidge;
      const stride = Math.max(1, Math.ceil(u.length / 4096));
      for (let k = 0; k < u.length; k += stride) buf[n++] = u[k]!;
    }
    return medianFinite(buf.subarray(0, n));
  }

  private buildFront(): void {
    const s = this.s;
    const { N, nx, ny } = this;
    const bs = s.fire.burnState;
    const af = s.aux.front;
    const nxA = s.aux.frontNormalX;
    const nyA = s.aux.frontNormalY;
    this.frontNormalSrc = nxA.length === N && nyA.length === N ? 'cell' : nxA.length === af.length && nyA.length === af.length && af.length > 0 ? 'entry' : 'none';
    const src = this.frontNormalSrc;
    const cnx = this.cellNx;
    const cny = this.cellNy;
    let n = 0;
    for (let a = 0; a < af.length; a++) {
      const k = af[a]!;
      if (k < 0 || k >= N) continue;
      this.front[n] = k;
      let az = NaN;
      if (src !== 'none') {
        const idx = src === 'cell' ? k : a;
        const vx = nxA[idx]!;
        const vy = nyA[idx]!;
        const m = Math.sqrt(vx * vx + vy * vy);
        if (m > 1e-6) {
          az = azimuthOf(vx, vy);
          cnx[k] = vx / m;
          cny[k] = vy / m;
        }
      }
      this.frontNormal[n] = az;
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
    const dzdx = this.terrain.dzdx;
    const dzdy = this.terrain.dzdy;
    for (let a = 0; a < n; a++) {
      const k = this.front[a]!;
      let nrm = this.frontNormal[a]!;
      let vecOk = nrm === nrm;
      if (!vecOk) nrm = this.geometricNormal(k);
      const sp = sd[k]!;
      const spread = sp === sp ? sp : nrm;
      if (!(nrm === nrm)) nrm = spread;
      if (!vecOk) {
        if (nrm === nrm) {
          const r = nrm * DEG;
          cnx[k] = Math.sin(r);
          cny[k] = Math.cos(r);
        } else {
          cnx[k] = 0;
          cny[k] = 0;
        }
        vecOk = true;
      }
      this.frontSpread[a] = spread;
      this.frontNormal[a] = nrm;
      this.cellNormal[k] = nrm;
      this.cellSpread[k] = spread;
      // θ along the spread direction (reuse the normal's unit vector when the spread follows the normal).
      if (spread === spread) {
        let sx = cnx[k]!;
        let sy = cny[k]!;
        if (spread !== nrm) {
          const r = spread * DEG;
          sx = Math.sin(r);
          sy = Math.cos(r);
        }
        this.frontTheta[a] = Math.atan(dzdx[k]! * sx + dzdy[k]! * sy) * RAD;
      } else this.frontTheta[a] = NaN;
    }
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

  /** A "≥ K front cells" count threshold under the front sampling stride. */
  kFor(K: number): number {
    return Math.max(1, Math.ceil(K / this.fStride));
  }

  /** A fresh stamp value for `stamp` (cells stamped with it count as visited). */
  nextStamp(): number {
    if (++this.stampId >= 0x7fffffff) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    return this.stampId;
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
   * Lower bound (m) of the distance from any cell of tile t to the fire, cached per cycle; used to skip whole tiles
   * in the all-cell detectors. Exact tile minimum of aux.frontDist when the fire module provides it (§7.13), else a
   * chamfer distance transform on the 500 m tile grid (conservative: centre distance − one tile diagonal).
   */
  tileFireDist(t: number): number {
    if (this.tileFireStamp[t] === this.cycle) return this.tileFireDistV[t]!;
    let d = Infinity;
    if (this.nFront > 0) {
      if (this.frontDistOk) {
        const g = this.grid;
        const cpt = this.tiles.cellsPerTile;
        const i0 = Math.floor(this.tiles.tx(t) * cpt);
        const j0 = Math.floor(this.tiles.ty(t) * cpt);
        const i1 = Math.min(g.nx, Math.floor((this.tiles.tx(t) + 1) * cpt));
        const j1 = Math.min(g.ny, Math.floor((this.tiles.ty(t) + 1) * cpt));
        const fd = this.s.aux.frontDist;
        for (let j = j0; j < j1; j++) {
          for (let k = j * g.nx + i0, e = j * g.nx + i1; k < e; k++) {
            const v = fd[k]!;
            if (v < d) d = v;
          }
        }
        if (!(d === d)) d = 0;
      } else {
        if (this.tileDtCycle !== this.cycle) this.buildTileDt();
        d = this.tileDt[t]!;
      }
    }
    this.tileFireDistV[t] = d;
    this.tileFireStamp[t] = this.cycle;
    return d;
  }

  private buildTileDt(): void {
    const T = this.tiles;
    this.tileHasFire.fill(0);
    for (let a = 0; a < this.nFront; a++) this.tileHasFire[T.ofCell(this.front[a]!)] = 1;
    const tg = { nx: T.tnx, ny: T.tny, cellSize: T.tileM, x0: 0, y0: 0, origin: this.grid.origin };
    distanceTransform(tg, this.tileHasFire, this.tileDt, this.tileDtNearest);
    const diag = Math.SQRT2 * T.tileM;
    for (let t = 0; t < T.count; t++) this.tileDt[t] = Math.max(0, 0.92 * this.tileDt[t]! - diag);
    this.tileDtCycle = this.cycle;
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
  /** Upslope azimuth (aspect + 180°), NaN on flat cells (static cache). */
  upslope(k: number): number {
    return this.statics.upslopeAz[k]!;
  }
  /** Directional slope (deg, + uphill) along azimuth az at cell k. */
  slopeAlong(k: number, az: number): number {
    const r = az / RAD;
    return Math.atan(this.terrain.dzdx[k]! * Math.sin(r) + this.terrain.dzdy[k]! * Math.cos(r)) * RAD;
  }
  /**
   * Share (0–1) of the local ROS or wind that comes from sub-grid terms at cell k (spec §10.1 "the model can't see
   * this precisely" note): the attachment gain (G − 1)/G with G = 1 + (G_max − 1)·A·E (§7.6), the VLS lateral rate
   * R_VLS/ROS (§7.9), the lee-eddy weight s_sep of the fire wind (§8.8) and the slope-flow top-up S/|U_fire| (§8.6).
   */
  subgridShare(k: number): number {
    const s = this.s;
    const aux = s.aux;
    let sh = 0;
    const ae = aux.attach[k] ?? 0;
    if (ae > 0) {
      const G = 1 + (P.eruptive.gMax - 1) * ae;
      sh = (G - 1) / G;
    }
    if (aux.vlsActive[k]) {
      const v = Math.min(1, Math.max(0, ((aux.vls[k] ?? 0) - 0.5) / 0.5));
      const rv = (0.4 + 2.4 * v) / 3.6; // §7.9 mean lateral rate (m/s)
      const r = s.fire.ros[k]!;
      sh = Math.max(sh, r > 0 ? Math.min(1, rv / r) : 1);
    }
    const sep = aux.sep[k] ?? 0;
    if (sep > sh) sh = sep;
    if (s.slopeFlowS.length === this.N) {
      const top = Math.abs(s.slopeFlowS[k]!);
      if (top > 0) sh = Math.max(sh, Math.min(1, top / Math.max(0.1, this.windSpeed(k))));
    }
    return sh;
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
