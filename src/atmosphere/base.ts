/**
 * Shared machinery of the 3-D `Atmosphere` and the fast-tier `DiagnosticWind` (spec §8.2, §8.3, §8.6, §8.8, §8.10):
 * stamp bookkeeping with the cached mass-consistent u_bg pair (plus extra 10-min stamps on fast direction changes),
 * time interpolation, κ scaling at z_ref, the fire-influence mask and coupling, sub-grid slope flows, ridge wind,
 * lee-separation blend, surface heat flux, the §5.2 near-surface temperature template and common diagnostics.
 */
import { G, airDensity, CP, KAPPA_VK, RD, dewPointC, pressureIsa, STABLE_NIGHT_PARAMS } from '../core/physics';
import type { Rng } from '../core/rng';
import type {
  AtmosDiagnostics,
  AtmosphereLike,
  FireWindContext,
  InsolationResult,
  StableNightState,
  TerrainDerived,
  TerrainFeatures,
} from '../core/simTypes';
import type { AtmosphereView, FuelMap, GridSpec, QualityTier, Terrain, WeatherHour, WeatherSeries, WindEdit } from '../core/types';
import { angleDiffDeg, clamp, smoothstep, DEG } from '../core/units';
import { sampleBilinear } from '../core/grid';
import { solarPosition, terrainDerived } from '../terrain';
import { buildAtmosGrid, levelFrac, type AtmosGrid, type AtmosGridOptions } from './grid';
import { MassConsistentSolver, resolveWindEdits, type BgWind, type ResolvedWindEdit } from './massConsistent';
import { ATMOS_PARAMS } from './params';
import { buildProfile, kappaLookup, kappaTable, pressureAt, type BackgroundProfile, type KappaTable } from './profile';
import { anabaticSpeed, katabaticSpeed, sensibleHeatFlux } from './surface';
import { briggsRise, cHaines, plumeColumn, pyroFirepowerThreshold, type PlumeResult } from './plume';
import { interpolateHour } from './weatherInterp';

/** Constructor extras beyond the spec signature (all optional). */
export interface AtmosphereOptions extends AtmosGridOptions {
  /** Coupling c_f used when FireWindContext carries none (contract adapter, default 1). */
  coupling?: number;
  /** Scenario start (unix ms) for wind edits; default: the first series stamp. */
  scenarioStartMs?: number;
  windEdits?: WindEdit[];
}

/** FireWindContext plus optional fields this module can use (requested contract additions, see index.ts). */
export type FireWindContextExt = FireWindContext & {
  coupling?: number;
  /** Optional head mask (1 on head cells) and head directions for the pyrogenic head correction (§8.8). */
  headMask?: Uint8Array;
  headDirX?: Float32Array;
  headDirY?: Float32Array;
};

/** One weather stamp of the current sequence with its (lazily) solved background. */
export interface Stamp {
  hour: WeatherHour;
  profile: BackgroundProfile;
  bg: BgWind | null;
  kappa: KappaTable | null;
  /** U_bg10 (κ·u_bg at z_ref) and the complex κ(z_ref) (re, im) at every fire cell. */
  fireBgU: Float32Array | null;
  fireBgV: Float32Array | null;
  fireKre: Float32Array | null;
  fireKim: Float32Array | null;
}

const stampKey = (w: WeatherHour): string =>
  `${w.time}|${w.windSpeed10.toFixed(4)}|${w.windDir10.toFixed(3)}|${w.temperature.toFixed(3)}|${(w.pressureLevels ?? []).length}`;

/** Median of the first n entries (in-place quickselect; the array is scratch). */
function median(a: Float32Array, n: number): number {
  if (n <= 0) return 0;
  const select = (kth: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const pivot = a[(lo + hi) >> 1]!;
      let i = lo;
      let j = hi;
      while (i <= j) {
        while (a[i]! < pivot) i++;
        while (a[j]! > pivot) j--;
        if (i <= j) {
          const t = a[i]!;
          a[i] = a[j]!;
          a[j] = t;
          i++;
          j--;
        }
      }
      if (kth <= j) hi = j;
      else if (kth >= i) lo = i;
      else return a[kth]!;
    }
    return a[kth]!;
  };
  if (n % 2) return select((n - 1) >> 1);
  const hiV = select(n >> 1);
  let loV = -Infinity;
  for (let q = 0; q < n >> 1; q++) if (a[q]! > loV) loV = a[q]!;
  return 0.5 * (loV + hiV);
}

export abstract class AtmosBase implements AtmosphereLike {
  readonly tier: QualityTier;
  readonly grid: AtmosGrid;
  protected readonly terrain: Terrain;
  protected readonly fuel: FuelMap;
  protected readonly features: TerrainFeatures;
  protected readonly derived: TerrainDerived;
  protected readonly series: WeatherSeries;
  protected readonly rng: Rng;
  protected readonly mc: MassConsistentSolver;
  protected edits: ResolvedWindEdit[] = [];
  protected coupling: number;
  // ── stamps ──
  protected seq: Stamp[] = [];
  protected seg = 0;
  protected wgt = 0;
  protected time = NaN;
  protected hourNow: WeatherHour | null = null;
  // ── fire-cell sampling stencil (static) ──
  protected readonly nf: number;
  protected readonly zRef: Float32Array;
  /** Horizontal bilinear stencil of every fire cell: 4 columns and weights. */
  protected readonly stC: Int32Array;
  protected readonly stW: Float32Array;
  /** Trilinear stencil (8 flat centre indices and weights) of every fire cell's z_ref sample point (§8.8). */
  protected readonly st8O: Int32Array;
  protected readonly st8W: Float32Array;
  // ── surface heating ──
  protected night: StableNightState;
  protected kbdi = 0;
  protected cloud = 0;
  protected sunElevation = -90;
  protected heatingOn = false;
  protected readonly qhFire: Float32Array;
  protected readonly qhCol: Float64Array;
  protected readonly albedo: Float32Array;
  protected readonly cosSlope: Float32Array;
  /** Downslope unit vector (east, north) = û(aspect); 0 on flat cells (aspect NaN). */
  protected readonly downX: Float32Array;
  protected readonly downY: Float32Array;
  /** Hydraulic slope-flow speed S (m/s, §8.6) per cell for the current heating: > 0 upslope (Q_h > 0) flow,
   *  < 0 downslope (Q_h < 0) flow; recomputed by setSurfaceHeating. */
  protected readonly slopeS: Float32Array;
  protected readonly valleyCols: Int32Array;
  protected qValley = 0;
  protected heatSinceSunrise = 0;
  protected lastSunUp = false;
  // ── fire heat ──
  protected firePowerW = 0;
  protected burningArea = 0;
  protected fireSrcZ = 0;
  protected fireSrcX = 0;
  protected fireSrcY = 0;
  // ── fire-wind outputs / diagnostics ──
  protected readonly fireInfluence: Float32Array;
  protected readonly slopeFlow: Float32Array;
  protected uRidgeMedian = 0;
  protected readonly crestCache = new Map<number, Int32Array>();
  protected readonly scratchA: Float32Array;
  protected readonly scratchB: Float32Array;
  protected readonly scratchR: Float32Array;
  protected readonly airTScratch: Float32Array;
  /** Static ISA pressure ratio p(z_cell)/p(z_gp) per fire cell (× the stamp's surface pressure → hPa). */
  protected readonly pRatio: Float32Array;
  /** κ table level heights of a J = 1 column (level centres). */
  protected readonly levelZ: Float64Array;
  protected simTime = 0;
  /** Last diagnostics(): C-Haines used the 2 m values because 850 hPa lies below the grid-point surface (§8.10). */
  cHainesSurface = false;

  constructor(
    terrain: Terrain,
    hiRes: { grid: GridSpec; elevation: Float32Array } | undefined,
    fuel: FuelMap,
    features: TerrainFeatures,
    tier: QualityTier,
    extent: number,
    series: WeatherSeries,
    rng: Rng,
    opts: AtmosphereOptions = {},
  ) {
    this.tier = tier;
    this.terrain = terrain;
    this.fuel = fuel;
    this.features = features;
    this.series = series;
    this.rng = rng;
    this.derived = terrainDerived(terrain);
    this.grid = buildAtmosGrid(terrain, hiRes, fuel, tier, extent, opts);
    this.mc = new MassConsistentSolver(this.grid);
    this.coupling = opts.coupling ?? 1;
    const start = opts.scenarioStartMs ?? series.hours[0]?.time ?? 0;
    if (opts.windEdits) this.edits = resolveWindEdits(opts.windEdits, start);
    const tpl = series.nightTemplate ?? ATMOS_PARAMS.defaultNightTemplate;
    this.night = { dTheta: 0, dThetaAtSunrise: 0, tSunrise: null, dThetaMax: tpl.dThetaMax, hInv: tpl.hInv, gate: 0, tBreak: null, sn: 0 };
    const g = this.grid;
    const fg = terrain.grid;
    this.nf = fg.nx * fg.ny;
    const nf = this.nf;
    this.levelZ = Float64Array.from(g.zetaC);
    // ── stencil ──
    this.zRef = new Float32Array(nf);
    this.stC = new Int32Array(4 * nf);
    this.stW = new Float32Array(4 * nf);
    const zRefAsl = this.buildStencil();
    [this.st8O, this.st8W] = this.verticalStencil(zRefAsl);
    // ── surface ──
    this.qhFire = new Float32Array(nf);
    this.qhCol = new Float64Array(g.plane);
    this.albedo = new Float32Array(nf);
    this.cosSlope = new Float32Array(nf);
    this.downX = new Float32Array(nf);
    this.downY = new Float32Array(nf);
    this.slopeS = new Float32Array(nf);
    for (let k = 0; k < nf; k++) {
      this.albedo[k] = ATMOS_PARAMS.albedo[fuel.type[k] as keyof typeof ATMOS_PARAMS.albedo] ?? ATMOS_PARAMS.albedoDefault;
      this.cosSlope[k] = Math.max(ATMOS_PARAMS.minCosSlope, Math.cos(terrain.slopeDeg[k]! * DEG));
      const asp = terrain.aspectDeg[k]!;
      if (Number.isFinite(asp)) {
        this.downX[k] = Math.sin(asp * DEG);
        this.downY[k] = Math.cos(asp * DEG);
      }
    }
    const vc: number[] = [];
    for (let c = 0; c < g.plane; c++) if (g.zs[c]! - g.zFloor[c]! < ATMOS_PARAMS.valleyColumnMaxHav) vc.push(c);
    this.valleyCols = Int32Array.from(vc);
    this.fireInfluence = new Float32Array(nf);
    this.slopeFlow = new Float32Array(nf);
    this.scratchA = new Float32Array(nf);
    this.scratchB = new Float32Array(nf);
    this.scratchR = new Float32Array(nf);
    this.airTScratch = new Float32Array(nf);
    this.pRatio = new Float32Array(nf);
    const pgp = pressureIsa(series.sourceElevation ?? g.zMin);
    for (let k = 0; k < nf; k++) this.pRatio[k] = pressureIsa(terrain.elevation[k]! + 2) / pgp;
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Configuration extras (not in AtmosphereLike)
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Replace the user wind edits (§8.3); cached stamps at or after an edit are re-solved lazily. */
  setWindEdits(edits: WindEdit[], scenarioStartMs: number): void {
    this.edits = resolveWindEdits(edits, scenarioStartMs);
    for (const s of this.seq) {
      s.bg = null;
      s.kappa = null;
      s.fireBgU = s.fireBgV = s.fireKre = s.fireKim = null;
    }
    if (Number.isFinite(this.time)) this.setTime(this.time);
  }

  /**
   * Update the stable-night state (§5.2a: cold-pool Δθ, h_inv, sn) without touching the surface fluxes — e.g. every
   * atmosphere step between the 600 s setSurfaceHeating calls, or for tests with surface heating off.
   */
  setNightState(night: StableNightState): void {
    const o = this.night;
    // Negligible changes keep the current nudging/cold-pool fields (deterministic early-out; they cost O(n)).
    if (Math.abs(night.dTheta - o.dTheta) < 0.02 && Math.abs(night.sn - o.sn) < 0.005 && night.hInv === o.hInv) return;
    this.night = { ...night };
    this.onHeatingChanged();
  }

  /** Coupling c_f fallback when the FireWindContext does not carry it. */
  setCoupling(c: number): void {
    this.coupling = c;
  }

  get spunUp(): boolean {
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Stamps and time
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  setAmbient(a: WeatherHour, b: WeatherHour): void {
    const P = ATMOS_PARAMS;
    const hours: WeatherHour[] = [a];
    const dt = b.time - a.time;
    if (dt > P.subStampS * 1000 && Math.abs(angleDiffDeg(a.windDir10, b.windDir10)) > P.subStampDirDeg) {
      const n = Math.ceil(dt / (P.subStampS * 1000));
      for (let q = 1; q < n; q++) hours.push(interpolateHour(a, b, q / n));
    }
    if (b.time > a.time) hours.push(b);
    const old = new Map<string, Stamp>();
    for (const s of this.seq) old.set(stampKey(s.hour), s);
    this.seq = hours.map((h) => old.get(stampKey(h)) ?? this.makeStamp(h));
    this.seg = 0;
    this.wgt = 0;
    this.setTime(Number.isFinite(this.time) ? clamp(this.time, a.time, Math.max(a.time, b.time)) : a.time);
  }

  protected makeStamp(h: WeatherHour): Stamp {
    return { hour: h, profile: buildProfile(h, this.series, this.grid.zMin, this.grid.relief), bg: null, kappa: null, fireBgU: null, fireBgV: null, fireKre: null, fireKim: null };
  }

  setTime(t: number): void {
    this.time = t;
    const s = this.seq;
    if (!s.length) return;
    let i = 0;
    while (i < s.length - 2 && t >= s[i + 1]!.hour.time) i++;
    this.seg = i;
    const a = s[i]!;
    const b = s[Math.min(i + 1, s.length - 1)]!;
    this.ensureSolved(i);
    if (b !== a) this.ensureSolved(i + 1);
    const span = b.hour.time - a.hour.time;
    this.wgt = span > 0 ? clamp((t - a.hour.time) / span, 0, 1) : 0;
    this.hourNow = b === a ? a.hour : interpolateHour(a.hour, b.hour, this.wgt);
    this.onTimeChanged();
  }

  protected ensureSolved(i: number): void {
    const st = this.seq[i]!;
    if (st.bg) return;
    let warm: Float64Array | null = null;
    if (i > 0) {
      this.ensureSolved(i - 1);
      warm = this.seq[i - 1]!.bg!.phi;
    }
    st.bg = this.mc.solve(st.profile, this.edits, warm);
    this.deriveStamp(st);
  }

  /** Per-stamp derived arrays: κ table, U_bg10 and κ at the fire cells; subclass hook for dynamics arrays. */
  protected deriveStamp(st: Stamp): void {
    const bg = st.bg!;
    st.kappa = kappaTable(st.profile, this.levelZ);
    const nf = this.nf;
    const fu = new Float32Array(nf);
    const fv = new Float32Array(nf);
    const kr = new Float32Array(nf);
    const ki = new Float32Array(nf);
    this.sampleFire(bg.uc, bg.vc, fu, fv);
    const tab = st.kappa;
    for (let k = 0; k < nf; k++) {
      const z = this.zRef[k]!;
      const re = kappaLookup(tab.re, z);
      const im = kappaLookup(tab.im, z);
      kr[k] = re;
      ki[k] = im;
      const u = fu[k]!;
      const v = fv[k]!;
      fu[k] = re * u - im * v;
      fv[k] = re * v + im * u;
    }
    st.fireBgU = fu;
    st.fireBgV = fv;
    st.fireKre = kr;
    st.fireKim = ki;
    this.onStampDerived(st);
  }

  /** Subclass hook: per-stamp arrays (θ_env etc.). */
  protected onStampDerived(_st: Stamp): void {}
  /** Subclass hook: the interpolation weight or pair changed. */
  protected onTimeChanged(): void {}

  protected get stampA(): Stamp {
    return this.seq[this.seg]!;
  }
  protected get stampB(): Stamp {
    return this.seq[Math.min(this.seg + 1, this.seq.length - 1)]!;
  }
  /** Current interpolated ambient (grid-point weather at the set time). */
  get ambient(): WeatherHour {
    return this.hourNow ?? this.series.hours[0]!;
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Fire-cell stencil
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Horizontal stencil and z_ref (§8.8): z_ref = max(50 m, H_o,eff + 20 m, z₁ + Δz₁/2) AGL; the sample point is
   * z_ASL = max(z_cell + z_ref, z_s,atm + z₁) (the fire cell's real elevation, not the smoothed atmosphere terrain).
   * Returns the sample heights (m ASL).
   */
  private buildStencil(): Float64Array {
    const g = this.grid;
    const fg = this.terrain.grid;
    const P = ATMOS_PARAMS;
    const { nx, ny, dx } = g;
    const hEff = this.fuel.canopyHeightEff;
    const zAslOut = new Float64Array(this.nf);
    for (let j = 0; j < fg.ny; j++) {
      const y = fg.y0 + j * fg.cellSize;
      for (let i = 0; i < fg.nx; i++) {
        const k = j * fg.nx + i;
        const x = fg.x0 + i * fg.cellSize;
        const fx = clamp((x - g.grid.x0) / dx, 0, nx - 1);
        const fy = clamp((y - g.grid.y0) / dx, 0, ny - 1);
        const i0 = Math.min(Math.floor(fx), Math.max(0, nx - 2));
        const j0 = Math.min(Math.floor(fy), Math.max(0, ny - 2));
        const tx = fx - i0;
        const ty = fy - j0;
        const c00 = j0 * nx + i0;
        const c01 = nx > 1 ? c00 + 1 : c00;
        const c10 = ny > 1 ? c00 + nx : c00;
        const c11 = nx > 1 && ny > 1 ? c00 + nx + 1 : c00;
        const cs = [c00, c01, c10, c11];
        const ws = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
        let zsA = 0;
        let Jb = 0;
        for (let q = 0; q < 4; q++) {
          zsA += ws[q]! * g.zs[cs[q]!]!;
          Jb += ws[q]! * g.J[cs[q]!]!;
          this.stC[4 * k + q] = cs[q]!;
          this.stW[4 * k + q] = ws[q]!;
        }
        let hO = hEff ? hEff[k]! : this.fuel.canopyHeight[k]!;
        if (!Number.isFinite(hO)) hO = 0;
        const z1 = g.zetaC[0]! * Jb;
        const zRef = Math.max(P.zRefMin, hO + P.zRefCanopyAdd, g.zetaF[1]! * Jb);
        this.zRef[k] = zRef;
        zAslOut[k] = Math.max(this.terrain.elevation[k]! + zRef, zsA + z1);
      }
    }
    return zAslOut;
  }

  /**
   * Trilinear stencil of a height per fire cell (m ASL): the 4 columns of the horizontal stencil, each linearly
   * interpolated between its two bracketing level centres (clamped to the lowest/highest centre). Returns 8 flat
   * centre indices and weights per cell.
   */
  protected verticalStencil(zAsl: ArrayLike<number>): [Int32Array, Float32Array] {
    const g = this.grid;
    const nf = this.nf;
    const o8 = new Int32Array(8 * nf);
    const w8 = new Float32Array(8 * nf);
    for (let k = 0; k < nf; k++) {
      for (let q = 0; q < 4; q++) {
        const c = this.stC[4 * k + q]!;
        const w = this.stW[4 * k + q]!;
        const kf = levelFrac(g, c, zAsl[k]! - g.zs[c]!);
        const k0 = g.nz > 1 ? Math.min(Math.floor(kf), g.nz - 2) : 0;
        const t = g.nz > 1 ? kf - k0 : 0;
        o8[8 * k + 2 * q] = k0 * g.plane + c;
        w8[8 * k + 2 * q] = w * (1 - t);
        o8[8 * k + 2 * q + 1] = (g.nz > 1 ? k0 + 1 : k0) * g.plane + c;
        w8[8 * k + 2 * q + 1] = w * t;
      }
    }
    return [o8, w8];
  }

  /** Sample two centre fields at every fire cell through an 8-point stencil (default: the z_ref stencil). */
  protected sampleFire(fu: Float32Array, fv: Float32Array, outU: Float32Array, outV: Float32Array, o8: Int32Array = this.st8O, w8: Float32Array = this.st8W): void {
    const nf = this.nf;
    // Unrolled: V8 does not unroll the 8-term inner loop, and the gather dominates (≈ 1.5× faster).
    for (let k = 0; k < nf; k++) {
      const b = 8 * k;
      let w = w8[b]!;
      let o = o8[b]!;
      let su = w * fu[o]!;
      let sv = w * fv[o]!;
      w = w8[b + 1]!;
      o = o8[b + 1]!;
      su += w * fu[o]!;
      sv += w * fv[o]!;
      w = w8[b + 2]!;
      o = o8[b + 2]!;
      su += w * fu[o]!;
      sv += w * fv[o]!;
      w = w8[b + 3]!;
      o = o8[b + 3]!;
      su += w * fu[o]!;
      sv += w * fv[o]!;
      w = w8[b + 4]!;
      o = o8[b + 4]!;
      su += w * fu[o]!;
      sv += w * fv[o]!;
      w = w8[b + 5]!;
      o = o8[b + 5]!;
      su += w * fu[o]!;
      sv += w * fv[o]!;
      w = w8[b + 6]!;
      o = o8[b + 6]!;
      su += w * fu[o]!;
      sv += w * fv[o]!;
      w = w8[b + 7]!;
      o = o8[b + 7]!;
      su += w * fu[o]!;
      sv += w * fv[o]!;
      outU[k] = su;
      outV[k] = sv;
    }
  }

  /** Sample one centre field at every fire cell through an 8-point stencil (unrolled like sampleFire). */
  protected sampleFire1(f: Float32Array, out: Float32Array, o8: Int32Array, w8: Float32Array): void {
    const nf = this.nf;
    for (let k = 0; k < nf; k++) {
      const b = 8 * k;
      out[k] =
        w8[b]! * f[o8[b]!]! +
        w8[b + 1]! * f[o8[b + 1]!]! +
        w8[b + 2]! * f[o8[b + 2]!]! +
        w8[b + 3]! * f[o8[b + 3]!]! +
        w8[b + 4]! * f[o8[b + 4]!]! +
        w8[b + 5]! * f[o8[b + 5]!]! +
        w8[b + 6]! * f[o8[b + 6]!]! +
        w8[b + 7]! * f[o8[b + 7]!]!;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Surface heating (§8.6)
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  setSurfaceHeating(sun: InsolationResult, w: WeatherHour, kbdi: number, night: StableNightState): void {
    this.heatingOn = true;
    this.night = { ...night };
    this.kbdi = kbdi;
    this.cloud = Number.isFinite(w.cloudCover) ? clamp(w.cloudCover! / 100, 0, 1) : 0;
    this.sunElevation = sun.sunElevation;
    const up = sun.sunElevation > 0;
    if (up && !this.lastSunUp) this.heatSinceSunrise = 0;
    this.lastSunUp = up;
    const airT = this.airTScratch;
    this.templateAirT(w, airT);
    const g = this.grid;
    const nf = this.nf;
    const qsw = sun.total;
    this.qhCol.fill(0);
    for (let k = 0; k < nf; k++) {
      const sw = qsw[k]!;
      const q = sensibleHeatFlux(sw > 0 ? sw : 0, this.albedo[k]!, airT[k]! + 273.15, this.cloud, Number.isFinite(kbdi) ? kbdi : 0);
      this.qhFire[k] = q;
      this.qhCol[g.colOfFire[k]!]! += q / this.cosSlope[k]!;
    }
    for (let c = 0; c < g.plane; c++) this.qhCol[c] = g.fireCount[c]! > 0 ? this.qhCol[c]! / g.fireCount[c]! : 0;
    this.updateSlopeFlowSpeeds(airT);
    let qv = 0;
    for (let q = 0; q < this.valleyCols.length; q++) qv += this.qhCol[this.valleyCols[q]!]!;
    this.qValley = this.valleyCols.length ? qv / this.valleyCols.length : 0;
    this.onHeatingChanged();
  }

  /**
   * Hydraulic slope-flow speed S per cell (§8.6, [V WindNinja cellDiurnal compute_S]) from the current Q_h:
   * upslope S = [Q_h g Δz_u/((C_d + E)ρc_pT)]^{1/3} with Δz_u = valleyDrop; downslope
   * S = [−Q_h g L sin α/(ρc_pT (C_d + E))]^{1/3}(1 − e^{−L/L_e})^{1/3} with Δz_d = crestRise, L = crestDist,
   * sin α = min(Δz_d/L, sin slope). ρ and T from the §5.2 template at the heating time (ρT = p/R_d, so S depends
   * on T only through the pressure). Flat cells (aspect NaN) get 0.
   */
  private updateSlopeFlowSpeeds(airT: Float32Array): void {
    const f = this.features;
    const slope = this.terrain.slopeDeg;
    const pSfc = this.stampA ? this.stampA.profile.pSfc : pressureIsa(this.series.sourceElevation ?? this.grid.zMin);
    for (let k = 0; k < this.nf; k++) {
      const qh = this.qhFire[k]!;
      let S = 0;
      if (qh !== 0 && (this.downX[k] !== 0 || this.downY[k] !== 0)) {
        const tK = airT[k]! + 273.15;
        const rho = airDensity(airT[k]!, pSfc * this.pRatio[k]!);
        if (qh > 0) S = anabaticSpeed(qh, f.valleyDrop[k]!, rho, tK);
        else {
          const dzd = f.crestRise[k]!;
          const L = f.crestDist[k]!;
          const sinA = Math.min(L > 0 ? dzd / L : 0, Math.sin(slope[k]! * DEG));
          S = -katabaticSpeed(qh, dzd, L, sinA, rho, tK);
        }
      }
      this.slopeS[k] = Number.isFinite(S) ? S : 0;
    }
  }

  /** Integrate the valley-column heating since sunrise (break ETA, §8.10); called by step(). */
  protected accumulateHeating(dt: number): void {
    this.simTime += dt;
    if (this.heatingOn && this.sunElevation > 0 && this.qValley > 0) this.heatSinceSunrise += this.qValley * dt;
  }

  /** Subclass hook after setSurfaceHeating (night state, fluxes). */
  protected onHeatingChanged(): void {}

  /**
   * §5.2 near-surface air temperature template (°C) at every fire cell for a weather hour: lapse Γ (D43) from the
   * grid point, cold pool −Δθ(1 − hav/h_inv) below h_inv above the valley floor.
   */
  protected templateAirT(w: WeatherHour, out: Float32Array): void {
    const zs = this.series.sourceElevation ?? this.grid.zMin;
    const relief = this.terrain.maxElevation - this.terrain.minElevation;
    const sunEl = this.heatingOn ? this.sunElevation : solarPosition(w.time, this.series.location.lat, this.series.location.lon).elevation;
    const blh = w.boundaryLayerHeight && w.boundaryLayerHeight > 0 ? w.boundaryLayerHeight : ATMOS_PARAMS.defaultMixedLayer;
    const gamma = 6.5 + 3.3 * smoothstep(5, 15, sunEl) * smoothstep(0.75 * relief, 1.25 * relief, blh);
    const dTh = this.night.dTheta;
    const hInv = Math.max(1, this.night.hInv);
    const hav = this.derived.heightAboveValley;
    const z = this.terrain.elevation;
    const Ts = w.temperature;
    // Same continuous form as fuel/moisture cellAir(): the isothermal shift z → z_inv is weighted by the stable-night
    // strength sn = clamp(Δθ/3 K, 0, 1), so the pool fades out continuously as Δθ → 0 (D49) and both modules agree.
    const sn = Math.min(1, Math.max(0, dTh) / STABLE_NIGHT_PARAMS.snScaleK);
    for (let k = 0; k < this.nf; k++) {
      const h = Math.max(0, hav[k]!);
      if (dTh > 0 && h < hInv) {
        const zq = z[k]! + sn * (hInv - h);
        out[k] = Ts - (gamma * (zq - zs)) / 1000 - dTh * (1 - h / hInv);
      } else out[k] = Ts - (gamma * (z[k]! - zs)) / 1000;
    }
  }

  airAt(fireGrid: GridSpec, outT: Float32Array, outRho: Float32Array): void {
    this.checkFireGrid(fireGrid);
    const w = this.ambient;
    this.templateAirT(w, outT);
    this.addAirAnomaly(outT);
    // ρ = p/(R_d T) with p = p_sfc(z_gp)·(ISA ratio to the cell) (airDensity of core/physics, inlined).
    const c = (this.stampA.profile.pSfc * 100) / RD;
    const pr = this.pRatio;
    for (let k = 0; k < this.nf; k++) outRho[k] = (c * pr[k]!) / (outT[k]! + 273.15);
  }

  /** 3-D tiers add the resolved θ′ anomaly relative to the cold-pool template (°C, in place). */
  protected addAirAnomaly(_outT: Float32Array): void {}

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Wind for the fire (§8.8)
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  protected checkFireGrid(fg: GridSpec): void {
    if (fg.nx * fg.ny !== this.nf) throw new Error('atmosphere: fire grid does not match the terrain grid');
  }

  /** U_bg10 at every fire cell for the current time (linear combination of the stamp pair). */
  protected blendBgFire(outU: Float32Array, outV: Float32Array): void {
    const A = this.stampA;
    const B = this.stampB;
    const a = this.wgt;
    const au = A.fireBgU!;
    const av = A.fireBgV!;
    const bu = B.fireBgU!;
    const bv = B.fireBgV!;
    for (let k = 0; k < this.nf; k++) {
      outU[k] = au[k]! + (bu[k]! - au[k]!) * a;
      outV[k] = av[k]! + (bv[k]! - av[k]!) * a;
    }
  }

  /** kCrest per fire cell for the 22.5° sector of a wind direction (cached). */
  protected crestCells(windFromDeg: number): Int32Array {
    const sector = ((Math.round(windFromDeg / 22.5) % 16) + 16) % 16;
    let arr = this.crestCache.get(sector);
    if (!arr) {
      arr = new Int32Array(this.nf);
      const dir = sector * 22.5;
      for (let k = 0; k < this.nf; k++) arr[k] = this.features.crest(k, dir)?.kCrest ?? -1;
      this.crestCache.set(sector, arr);
    }
    return arr;
  }

  /** Tier-specific part: write U_fire and U_fireInd given U_bg10 (in outBg; may be modified, e.g. night decoupling). */
  protected abstract fireWindTier(
    outU: Float32Array,
    outV: Float32Array,
    outBgU: Float32Array,
    outBgV: Float32Array,
    outIndU: Float32Array,
    outIndV: Float32Array,
    ctx: FireWindContextExt,
    cf: number,
    resolvedU: Float32Array | null,
    resolvedV: Float32Array | null,
  ): { resolvedU: Float32Array | null; resolvedV: Float32Array | null };

  surfaceWindForFire(
    fireGrid: GridSpec,
    outU: Float32Array,
    outV: Float32Array,
    outBgU: Float32Array,
    outBgV: Float32Array,
    outIndU: Float32Array,
    outIndV: Float32Array,
    outRidge: Float32Array,
    ctxIn: FireWindContext,
  ): void {
    this.checkFireGrid(fireGrid);
    const ctx = ctxIn as FireWindContextExt;
    const P = ATMOS_PARAMS;
    const nf = this.nf;
    const cf = ctx.coupling ?? this.coupling;
    this.blendBgFire(outBgU, outBgV);
    // Ridge wind (D42): |U_bg10| at the crest cell of crest(k); median over ridge cells.
    const crest = this.crestCells(this.ambient.windDir10);
    const ridgeSp = this.scratchR;
    let nr = 0;
    const ridge = this.features.ridge;
    for (let k = 0; k < nf; k++) {
      const kc = crest[k]!;
      if (kc >= 0) {
        const a = outBgU[kc]!;
        const b = outBgV[kc]!;
        outRidge[k] = Math.sqrt(a * a + b * b);
      } else outRidge[k] = NaN;
      if (ridge[k]) {
        const a = outBgU[k]!;
        const b = outBgV[k]!;
        ridgeSp[nr++] = Math.sqrt(a * a + b * b);
      }
    }
    if (nr === 0) {
      for (let k = 0; k < nf; k++) {
        const a = outBgU[k]!;
        const b = outBgV[k]!;
        ridgeSp[nr++] = Math.sqrt(a * a + b * b);
      }
    }
    this.uRidgeMedian = median(ridgeSp, nr);
    // Fire-influence mask m_f.
    const zPlume = Number.isFinite(ctx.plumeTopAGL) && ctx.plumeTopAGL > 0 ? ctx.plumeTopAGL : P.plumeTopDefault;
    const mfScale = Math.max(2 * zPlume, P.fireMaskMin);
    const fireOn = ctx.firePowerW > 0 && !!ctx.frontDist;
    const mfA = this.fireInfluence;
    if (!fireOn) mfA.fill(0);
    else {
      const fd = ctx.frontDist;
      const inv = 1 / mfScale;
      for (let k = 0; k < nf; k++) {
        const m = 1 - fd[k]! * inv; // NaN/Infinity distance → 0 below
        mfA[k] = m > 0 ? (m < 1 ? m : 1) : 0;
      }
    }
    const res = this.fireWindTier(outU, outV, outBgU, outBgV, outIndU, outIndV, ctx, cf, null, null);
    // Sub-grid slope-flow top-up (§8.6) — fire wind and background (no fire terms):
    //   S_top = min(3, max(0, S − U_resolved·ŝ))·(1 − smoothstep(3, 8, U_ridge,median)) along the fall line ŝ;
    //   by day (Q_h > 0) max(0, S_top − 1.5)·û(ψ_up) is added, at night S_top·û(aspect) in full.
    const slopeOn = ctx.slopeFlowOn && this.heatingOn;
    const fade = slopeOn ? 1 - smoothstep(P.slopeFade0, P.slopeFade1, this.uRidgeMedian) : 0;
    const S = this.slopeS;
    const dxA = this.downX;
    const dyA = this.downY;
    const ru = res.resolvedU;
    const rv = res.resolvedV;
    const sf = this.slopeFlow;
    const cap = P.slopeFlowCap;
    const off = P.anabaticOffset;
    for (let k = 0; k < nf; k++) {
      let sTop = 0;
      const sk = S[k]!;
      if (fade > 0 && sk !== 0) {
        const up = sk > 0;
        const sgn = up ? -1 : 1; // flow direction along the downslope vector
        const ex = sgn * dxA[k]!;
        const ey = sgn * dyA[k]!;
        const along = ru ? ru[k]! * ex + rv![k]! * ey : 0;
        sTop = Math.min(cap, Math.max(0, (up ? sk : -sk) - along)) * fade;
        const add = up ? Math.max(0, sTop - off) : sTop;
        if (add > 0) {
          const du = ex * add;
          const dv = ey * add;
          outU[k] = outU[k]! + du;
          outV[k] = outV[k]! + dv;
          outBgU[k] = outBgU[k]! + du;
          outBgV[k] = outBgV[k]! + dv;
        }
      }
      sf[k] = sTop;
    }
    // Lee-separation blend (§7.9): U ← (1 − s)U + s·0.3·U_ridge·û(ψ_up) (flat cells: lee = 0, no blend).
    const sep = ctx.sep;
    if (sep) {
      for (let k = 0; k < nf; k++) {
        const s = sep[k]!;
        if (!(s > 0)) continue;
        const ur = outRidge[k]!;
        if (!Number.isFinite(ur) || (dxA[k] === 0 && dyA[k] === 0)) continue;
        const e = P.leeEddyFraction * ur;
        outU[k] = (1 - s) * outU[k]! - s * dxA[k]! * e;
        outV[k] = (1 - s) * outV[k]! - s * dyA[k]! * e;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Fire heat bookkeeping
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Accumulate P_fire, burning area and the heat-weighted source point (both tiers). */
  protected fireTotals(heatKwM2: Float32Array): void {
    const fg = this.terrain.grid;
    const a = fg.cellSize * fg.cellSize;
    let P = 0;
    let A = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let k = 0; k < this.nf; k++) {
      const q = heatKwM2[k]!;
      if (!(q > 0)) continue;
      const i = k % fg.nx;
      const j = (k - i) / fg.nx;
      const wq = q * a * 1000;
      P += wq;
      A += a;
      sx += wq * (fg.x0 + i * fg.cellSize);
      sy += wq * (fg.y0 + j * fg.cellSize);
      sz += wq * this.terrain.elevation[k]!;
    }
    this.firePowerW = P;
    this.burningArea = A;
    if (P > 0) {
      this.fireSrcX = sx / P;
      this.fireSrcY = sy / P;
      this.fireSrcZ = sz / P;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Turbulence (§9.3 similarity inputs)
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Physical wind (u, v) at z_ref-like height AGL at (x, y); tier-specific. */
  protected abstract windAt(x: number, y: number, zAgl: number, out: Float32Array): void;

  private readonly turbTmp = new Float32Array(3);

  sampleTurb(x: number, y: number, _zAGL: number, out: Float32Array): void {
    const g = this.grid;
    const P = ATMOS_PARAMS;
    const w = this.ambient;
    const day = this.sunNow() > P.daySunDeg;
    const zi = day ? (w.boundaryLayerHeight && w.boundaryLayerHeight > 0 ? w.boundaryLayerHeight : P.defaultMixedLayer) : P.nightZi;
    const c = this.columnAt(x, y);
    const qh = this.heatingOn ? this.qhCol[c]! : 0;
    const tK = w.temperature + 273.15;
    const rho = P.rhoRef;
    const wStar = qh > 0 ? Math.cbrt(((G / tK) * (qh / (rho * CP))) * zi) : 0;
    const z0 = g.z0[c]!;
    const d = g.disp[c]!;
    const zr = Math.max(P.zRefMin, d + 10 * z0);
    this.windAt(x, y, zr, this.turbTmp);
    const U = Math.hypot(this.turbTmp[0]!, this.turbTmp[1]!);
    const uStar = (KAPPA_VK * U) / Math.log(Math.max(1.01, (zr - d) / z0));
    out[0] = zi;
    out[1] = wStar;
    out[2] = uStar;
  }

  private sunCacheT = NaN;
  private sunCacheEl = -90;
  /** Sun elevation (deg): the last setSurfaceHeating's, or (heating never set) from the ambient time. */
  protected sunNow(): number {
    if (this.heatingOn) return this.sunElevation;
    const t = this.ambient.time;
    if (t !== this.sunCacheT) {
      this.sunCacheT = t;
      this.sunCacheEl = solarPosition(t, this.series.location.lat, this.series.location.lon).elevation;
    }
    return this.sunCacheEl;
  }

  /** Nearest atmosphere column of a local point. */
  protected columnAt(x: number, y: number): number {
    const g = this.grid;
    const i = clamp(Math.round((x - g.grid.x0) / g.dx), 0, g.nx - 1);
    const j = clamp(Math.round((y - g.grid.y0) / g.dx), 0, g.ny - 1);
    return j * g.nx + i;
  }

  /** Fire-grid terrain elevation at a point (bilinear). */
  protected groundAt(x: number, y: number): number {
    return sampleBilinear(this.terrain.grid, this.terrain.elevation, x, y);
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Diagnostics (§8.10) — common part
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /** θ at z ASL in column c (tier-specific: 3-D model or background + cold-pool template). */
  protected abstract thetaAt(c: number, zAsl: number): number;

  protected plume(): PlumeResult | null {
    if (!(this.firePowerW > 0)) return null;
    const p = this.stampA.profile;
    const tK = this.ambient.temperature + 273.15;
    const rho = airDensity(this.ambient.temperature, pressureAt(p, this.fireSrcZ));
    return plumeColumn(p, this.firePowerW, this.burningArea, this.fireSrcZ, rho, tK);
  }

  protected commonDiagnostics(maxUpdraft: number): AtmosDiagnostics {
    const P = ATMOS_PARAMS;
    const A = this.stampA;
    const p = A.profile;
    const w = this.ambient;
    const upper = p.source;
    // C-Haines from the pressure levels (model/preset only) [V Mills & McCaw 2010]; where 850 hPa lies below the
    // grid-point surface the 2 m values replace it and `cHainesSurface` flags it (§8.10).
    let ch: number | null = null;
    this.cHainesSurface = false;
    if (!p.synthetic && (upper === 'model' || upper === 'preset')) {
      const lv = w.pressureLevels ?? [];
      const l850 = lv.find((l) => l.hPa === 850);
      const l700 = lv.find((l) => l.hPa === 700);
      if (l700) {
        const below = !l850 || !Number.isFinite(l850.height) || l850.height < p.zgp;
        this.cHainesSurface = below;
        const t850 = below ? w.temperature : l850!.temperature;
        const td850 = below
          ? (w.dewPoint ?? dewPointC(w.temperature, w.relativeHumidity))
          : (l850!.dewPoint ?? dewPointC(l850!.temperature, l850!.relativeHumidity));
        const v = cHaines(t850, l700.temperature, td850).ch;
        ch = Number.isFinite(v) ? v : null;
      }
    }
    // Inversion over valley columns.
    let dThetaMax = 0;
    let topASL = NaN;
    for (let q = 0; q < this.valleyCols.length; q++) {
      const c = this.valleyCols[q]!;
      const zf = this.grid.zFloor[c]!;
      const d = this.thetaAt(c, zf + 300) - this.thetaAt(c, zf + 10);
      if (d > dThetaMax) {
        dThetaMax = d;
        topASL = zf + this.night.hInv;
      }
    }
    const present = dThetaMax >= P.inversionPresentK;
    // Break ETA: heat deficit c_p∫ρ(θ_top − θ)dz vs heating since sunrise, extrapolated with the current flux.
    let breakEta: number | null = null;
    if (present && this.sunElevation > 0 && this.qValley > 0) {
      let deficit = 0;
      let nc = 0;
      for (let q = 0; q < this.valleyCols.length; q++) {
        const c = this.valleyCols[q]!;
        const zf = this.grid.zFloor[c]!;
        const top = zf + Math.max(this.night.hInv, P.breakMinDepth);
        const thTop = this.thetaAt(c, top);
        let s = 0;
        for (let z = zf + 5; z < top; z += 10) s += Math.max(0, thTop - this.thetaAt(c, z)) * 10;
        deficit += CP * P.rhoRef * s;
        nc++;
      }
      deficit /= Math.max(1, nc);
      breakEta = Math.max(0, (deficit - this.heatSinceSunrise) / this.qValley);
    }
    // Mixed layer (parcel method on the median-elevation column).
    const cMed = this.medianColumn();
    const zs = this.grid.zs[cMed]!;
    const th0 = this.thetaAt(cMed, zs + this.grid.zetaC[0]! * this.grid.J[cMed]!);
    let mlTop = 0;
    for (let z = 20; z < this.grid.Hp; z += 20) {
      if (this.thetaAt(cMed, zs + z) > th0 + P.mixedLayerParcelK) break;
      mlTop = z;
    }
    const pl = this.plume();
    // Briggs cross-check height when the 1-D plume is not available.
    let plumeTop = NaN;
    let lcl = NaN;
    if (pl) {
      plumeTop = pl.topASL;
      lcl = pl.lclASL;
      if (!Number.isFinite(plumeTop)) {
        const U = Math.hypot(w.windSpeed10, 0);
        const b = briggsRise(P.chiC * this.firePowerW, U, p.nSquared, P.rhoRef, w.temperature + 273.15);
        plumeTop = this.fireSrcZ + b.rise;
      }
    }
    // PFT (P2, behind ATMOS_PARAMS.pftEnabled): model/preset upper air only.
    let pft: number | null = null;
    if (P.pftEnabled && pl && !p.synthetic && (upper === 'model' || upper === 'preset')) {
      const r = pyroFirepowerThreshold(p, pl, this.fireSrcZ);
      pft = r && Number.isFinite(r.pft) ? r.pft : null;
    }
    const nfSrc = upper === 'none' ? 'none' : upper;
    return {
      spunUp: this.spunUp,
      synthetic: p.synthetic,
      upperAirSource: nfSrc,
      inversion: { present, dTheta: dThetaMax, topASL: present ? topASL : NaN, mixedLayerTopAGL: mlTop, breakEta },
      cHaines: ch,
      pft,
      frH: p.froude,
      nSquared: p.nSquared,
      plumeTopASL: plumeTop,
      plumeLclASL: lcl,
      firePowerMW: this.firePowerW / 1e6,
      maxUpdraft,
      uRidgeMedian: this.uRidgeMedian,
      fireInfluence: this.fireInfluence,
      heatFlux: this.qhFire,
      slopeFlow: this.slopeFlow,
      kappa: this.kappaNow(ATMOS_PARAMS.zRefMin),
    };
  }

  /** κ(z) magnitude interpolated in time between the stamp pair (like u_bg). */
  protected kappaNow(z: number): number {
    const A = this.stampA;
    const B = this.stampB;
    if (!A?.kappa || !B?.kappa) return 1;
    return kappaLookup(A.kappa.mag, z) * (1 - this.wgt) + kappaLookup(B.kappa.mag, z) * this.wgt;
  }

  private medCol = -1;
  private medianColumn(): number {
    if (this.medCol >= 0) return this.medCol;
    const g = this.grid;
    const idx = Array.from({ length: g.plane }, (_, c) => c).sort((a, b) => g.zs[a]! - g.zs[b]!);
    this.medCol = idx[idx.length >> 1]!;
    return this.medCol;
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Checkpoint helpers
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  protected baseCheckpoint(): BaseCheckpoint {
    return {
      seq: this.seq.map((s) => ({
        hour: s.hour,
        phi: s.bg ? s.bg.phi.slice() : null,
      })),
      time: this.time,
      night: { ...this.night },
      kbdi: this.kbdi,
      cloud: this.cloud,
      sunElevation: this.sunElevation,
      heatingOn: this.heatingOn,
      qhFire: this.qhFire.slice(),
      qhCol: this.qhCol.slice(),
      slopeS: this.slopeS.slice(),
      qValley: this.qValley,
      heatSinceSunrise: this.heatSinceSunrise,
      lastSunUp: this.lastSunUp,
      firePowerW: this.firePowerW,
      burningArea: this.burningArea,
      fireSrc: [this.fireSrcX, this.fireSrcY, this.fireSrcZ],
      fireInfluence: this.fireInfluence.slice(),
      slopeFlow: this.slopeFlow.slice(),
      uRidgeMedian: this.uRidgeMedian,
      coupling: this.coupling,
      simTime: this.simTime,
      rng: this.rng.state,
    };
  }

  protected baseRestore(c: BaseCheckpoint): void {
    this.seq = c.seq.map((s) => {
      const st = this.makeStamp(s.hour);
      if (s.phi) {
        st.bg = this.mc.fromPotential(st.profile, this.edits, s.phi);
        this.deriveStamp(st);
      }
      return st;
    });
    this.night = { ...c.night };
    this.kbdi = c.kbdi;
    this.cloud = c.cloud;
    this.sunElevation = c.sunElevation;
    this.heatingOn = c.heatingOn;
    this.qhFire.set(c.qhFire);
    this.qhCol.set(c.qhCol);
    this.slopeS.set(c.slopeS);
    this.qValley = c.qValley;
    this.heatSinceSunrise = c.heatSinceSunrise;
    this.lastSunUp = c.lastSunUp;
    this.firePowerW = c.firePowerW;
    this.burningArea = c.burningArea;
    [this.fireSrcX, this.fireSrcY, this.fireSrcZ] = c.fireSrc;
    this.fireInfluence.set(c.fireInfluence);
    this.slopeFlow.set(c.slopeFlow);
    this.uRidgeMedian = c.uRidgeMedian;
    this.coupling = c.coupling;
    this.simTime = c.simTime;
    this.rng.state = c.rng;
    this.time = NaN;
    if (Number.isFinite(c.time)) this.setTime(c.time);
    this.onHeatingChanged();
  }

  abstract addFireHeat(fireGrid: GridSpec, heatKwM2: Float32Array, crownShare: Float32Array): void;
  abstract step(dt: number): void;
  abstract maxStableDt(): number;
  abstract sample(x: number, y: number, zAGL: number, out: Float32Array): void;
  abstract view(): AtmosphereView;
  abstract diagnostics(): AtmosDiagnostics;
  abstract checkpoint(): unknown;
  abstract restore(c: unknown): void;
}

export interface BaseCheckpoint {
  /** Stamps with the converged potential of each solved background (u_bg is rebuilt from it, bitwise). */
  seq: { hour: WeatherHour; phi: Float64Array | null }[];
  time: number;
  night: StableNightState;
  kbdi: number;
  cloud: number;
  sunElevation: number;
  heatingOn: boolean;
  qhFire: Float32Array;
  qhCol: Float64Array;
  slopeS: Float32Array;
  qValley: number;
  heatSinceSunrise: number;
  lastSunUp: boolean;
  firePowerW: number;
  burningArea: number;
  fireSrc: [number, number, number];
  fireInfluence: Float32Array;
  slopeFlow: Float32Array;
  uRidgeMedian: number;
  coupling: number;
  simTime: number;
  rng: number;
}
