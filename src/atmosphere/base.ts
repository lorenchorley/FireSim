/**
 * Shared machinery of the 3-D `Atmosphere` and the fast-tier `DiagnosticWind` (spec §8.2, §8.3, §8.6, §8.8, §8.10):
 * stamp bookkeeping with the cached mass-consistent u_bg pair (plus extra 10-min stamps on fast direction changes),
 * time interpolation, κ scaling at z_ref, the fire-influence mask and coupling, sub-grid slope flows, ridge wind,
 * lee-separation blend, surface heat flux, the §5.2 near-surface temperature template and common diagnostics.
 */
import { G, airDensity, CP, KAPPA_VK, pressureIsa } from '../core/physics';
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
import { MassConsistentSolver, facesToCentres, resolveWindEdits, type BgWind, type ResolvedWindEdit } from './massConsistent';
import { ATMOS_PARAMS } from './params';
import { buildProfile, kappaLookup, kappaTable, pressureAt, type BackgroundProfile, type KappaTable } from './profile';
import { anabaticSpeed, katabaticSpeed, sensibleHeatFlux } from './surface';
import { briggsRise, cHaines, plumeColumn, type PlumeResult } from './plume';
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
  protected readonly stC: Int32Array;
  protected readonly stW: Float32Array;
  protected readonly stK: Int16Array;
  protected readonly stT: Float32Array;
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
  protected readonly isFast: boolean;

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
    this.isFast = tier === 'fast';
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
    this.stK = new Int16Array(4 * nf);
    this.stT = new Float32Array(4 * nf);
    this.buildStencil();
    // ── surface ──
    this.qhFire = new Float32Array(nf);
    this.qhCol = new Float64Array(g.plane);
    this.albedo = new Float32Array(nf);
    this.cosSlope = new Float32Array(nf);
    for (let k = 0; k < nf; k++) {
      this.albedo[k] = ATMOS_PARAMS.albedo[fuel.type[k] as keyof typeof ATMOS_PARAMS.albedo] ?? 0.15;
      this.cosSlope[k] = Math.max(0.2, Math.cos(terrain.slopeDeg[k]! * DEG));
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

  private buildStencil(): void {
    const g = this.grid;
    const fg = this.terrain.grid;
    const P = ATMOS_PARAMS;
    const { nx, ny, dx } = g;
    const hEff = this.fuel.canopyHeightEff;
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
        const cs = [c00, c00 + 1, c00 + nx, c00 + nx + 1];
        const ws = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
        let zsA = 0;
        let Jb = 0;
        for (let q = 0; q < 4; q++) {
          zsA += ws[q]! * g.zs[cs[q]!]!;
          Jb += ws[q]! * g.J[cs[q]!]!;
        }
        let hO = hEff ? hEff[k]! : this.fuel.canopyHeight[k]!;
        if (!Number.isFinite(hO)) hO = 0;
        const z1 = g.zetaC[0]! * Jb;
        const zRef = Math.max(P.zRefMin, hO + P.zRefCanopyAdd, g.zetaF[1]! * Jb);
        this.zRef[k] = zRef;
        const zCell = this.terrain.elevation[k]!;
        const zAsl = Math.max(zCell + zRef, zsA + z1);
        for (let q = 0; q < 4; q++) {
          const c = cs[q]!;
          const kf = levelFrac(g, c, zAsl - g.zs[c]!);
          const k0 = Math.min(Math.floor(kf), g.nz - 2);
          this.stC[4 * k + q] = c;
          this.stW[4 * k + q] = ws[q]!;
          this.stK[4 * k + q] = k0;
          this.stT[4 * k + q] = kf - k0;
        }
      }
    }
  }

  /** Sample two centre fields at every fire cell's z_ref point. */
  protected sampleFire(fu: Float32Array, fv: Float32Array, outU: Float32Array, outV: Float32Array): void {
    const plane = this.grid.plane;
    const stC = this.stC;
    const stW = this.stW;
    const stK = this.stK;
    const stT = this.stT;
    for (let k = 0; k < this.nf; k++) {
      let su = 0;
      let sv = 0;
      for (let q = 4 * k; q < 4 * k + 4; q++) {
        const w = stW[q]!;
        if (w === 0) continue;
        const o = stK[q]! * plane + stC[q]!;
        const t = stT[q]!;
        su += w * (fu[o]! + (fu[o + plane]! - fu[o]!) * t);
        sv += w * (fv[o]! + (fv[o + plane]! - fv[o]!) * t);
      }
      outU[k] = su;
      outV[k] = sv;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Surface heating (§8.6)
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  setSurfaceHeating(sun: InsolationResult, w: WeatherHour, kbdi: number, night: StableNightState): void {
    this.heatingOn = true;
    this.night = { ...night };
    this.kbdi = kbdi;
    this.cloud = clamp((w.cloudCover ?? 0) / 100, 0, 1);
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
      const q = sensibleHeatFlux(qsw[k] ?? 0, this.albedo[k]!, airT[k]! + 273.15, this.cloud, kbdi);
      this.qhFire[k] = q;
      this.qhCol[g.colOfFire[k]!]! += q / this.cosSlope[k]!;
    }
    for (let c = 0; c < g.plane; c++) this.qhCol[c] = g.fireCount[c]! > 0 ? this.qhCol[c]! / g.fireCount[c]! : 0;
    let qv = 0;
    for (let q = 0; q < this.valleyCols.length; q++) qv += this.qhCol[this.valleyCols[q]!]!;
    this.qValley = this.valleyCols.length ? qv / this.valleyCols.length : 0;
    this.onHeatingChanged();
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
    const sunEl = Number.isFinite(this.sunElevation) && this.sunElevation > -90 ? this.sunElevation : solarPosition(w.time, this.series.location.lat, this.series.location.lon).elevation;
    const blh = w.boundaryLayerHeight && w.boundaryLayerHeight > 0 ? w.boundaryLayerHeight : ATMOS_PARAMS.defaultMixedLayer;
    const gamma = 6.5 + 3.3 * smoothstep(5, 15, sunEl) * smoothstep(0.75 * relief, 1.25 * relief, blh);
    const dTh = this.night.dTheta;
    const hInv = Math.max(1, this.night.hInv);
    const hav = this.derived.heightAboveValley;
    const z = this.terrain.elevation;
    const Ts = w.temperature;
    for (let k = 0; k < this.nf; k++) {
      const h = hav[k]!;
      if (dTh > 0 && h < hInv) {
        const zInv = z[k]! - h + hInv;
        out[k] = Ts - (gamma * (zInv - zs)) / 1000 - dTh * (1 - h / hInv);
      } else out[k] = Ts - (gamma * (z[k]! - zs)) / 1000;
    }
  }

  airAt(fireGrid: GridSpec, outT: Float32Array, outRho: Float32Array): void {
    this.checkFireGrid(fireGrid);
    const w = this.ambient;
    this.templateAirT(w, outT);
    this.addAirAnomaly(outT);
    const ps = this.stampA.profile.pSfc;
    for (let k = 0; k < this.nf; k++) outRho[k] = airDensity(outT[k]!, ps * this.pRatio[k]!);
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

  /** Complex κ(z_ref) (re, im) at fire cell k for the current time → out[0..1]. */
  protected kappaAt(k: number, out: Float64Array): void {
    const a = this.wgt;
    const A = this.stampA;
    const B = this.stampB;
    out[0] = A.fireKre![k]! + (B.fireKre![k]! - A.fireKre![k]!) * a;
    out[1] = A.fireKim![k]! + (B.fireKim![k]! - A.fireKim![k]!) * a;
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
      outRidge[k] = kc >= 0 ? Math.hypot(outBgU[kc]!, outBgV[kc]!) : NaN;
      if (ridge[k]) ridgeSp[nr++] = Math.hypot(outBgU[k]!, outBgV[k]!);
    }
    if (nr === 0) for (let k = 0; k < nf; k++) ridgeSp[nr++] = Math.hypot(outBgU[k]!, outBgV[k]!);
    this.uRidgeMedian = median(ridgeSp, nr);
    // Fire-influence mask m_f.
    const zPlume = Number.isFinite(ctx.plumeTopAGL) && ctx.plumeTopAGL > 0 ? ctx.plumeTopAGL : P.plumeTopDefault;
    const mfScale = Math.max(2 * zPlume, P.fireMaskMin);
    const fireOn = ctx.firePowerW > 0;
    for (let k = 0; k < nf; k++) {
      const d = ctx.frontDist ? ctx.frontDist[k]! : Infinity;
      this.fireInfluence[k] = fireOn && Number.isFinite(d) ? clamp(1 - d / mfScale, 0, 1) : 0;
    }
    const res = this.fireWindTier(outU, outV, outBgU, outBgV, outIndU, outIndV, ctx, cf, null, null);
    // Sub-grid slope-flow top-up (§8.6) — fire wind and background (no fire terms).
    const slopeOn = ctx.slopeFlowOn && this.heatingOn;
    const fade = 1 - smoothstep(P.slopeFade0, P.slopeFade1, this.uRidgeMedian);
    const airT = this.airTScratch;
    if (slopeOn && fade > 0) this.templateAirT(this.ambient, airT);
    const pSfc = this.stampA.profile.pSfc;
    const f = this.features;
    const aspect = this.terrain.aspectDeg;
    const slope = this.terrain.slopeDeg;
    for (let k = 0; k < nf; k++) {
      let sTop = 0;
      if (slopeOn && fade > 0) {
        const qh = this.qhFire[k]!;
        const asp = aspect[k]!;
        if (qh !== 0 && Number.isFinite(asp)) {
          const tK = airT[k]! + 273.15;
          const rho = airDensity(airT[k]!, pSfc * this.pRatio[k]!);
          const ax = Math.sin(asp * DEG); // downslope unit vector (aspect = downhill azimuth)
          const ay = Math.cos(asp * DEG);
          let S: number;
          let sgn: number;
          if (qh > 0) {
            S = anabaticSpeed(qh, f.valleyDrop[k]!, rho, tK);
            sgn = -1; // upslope = −downslope
          } else {
            const dzd = f.crestRise[k]!;
            const L = f.crestDist[k]!;
            const sinA = Math.min(L > 0 ? dzd / L : 0, Math.sin(slope[k]! * DEG));
            S = katabaticSpeed(qh, dzd, L, sinA, rho, tK);
            sgn = 1;
          }
          const ru = res.resolvedU ? res.resolvedU[k]! : 0;
          const rv = res.resolvedV ? res.resolvedV[k]! : 0;
          const along = sgn * (ru * ax + rv * ay);
          sTop = Math.min(P.slopeFlowCap, Math.max(0, S - along)) * fade;
          const add = qh > 0 ? Math.max(0, sTop - P.anabaticOffset) : sTop;
          if (add > 0) {
            const dxu = sgn * ax * add;
            const dyu = sgn * ay * add;
            outU[k] = outU[k]! + dxu;
            outV[k] = outV[k]! + dyu;
            outBgU[k] = outBgU[k]! + dxu;
            outBgV[k] = outBgV[k]! + dyu;
          }
        }
      }
      this.slopeFlow[k] = sTop;
      // Lee-separation blend (§7.9): U ← (1 − s)U + s·0.3·U_ridge·û(ψ_up).
      const s = ctx.sep ? ctx.sep[k]! : 0;
      if (s > 0) {
        const ur = outRidge[k]!;
        const asp = aspect[k]!;
        if (Number.isFinite(ur) && Number.isFinite(asp)) {
          const e = 0.3 * ur; // [H D25] eddy fraction
          const ux = -Math.sin(asp * DEG) * e;
          const uy = -Math.cos(asp * DEG) * e;
          outU[k] = (1 - s) * outU[k]! + s * ux;
          outV[k] = (1 - s) * outV[k]! + s * uy;
        }
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
    const day = this.sunElevation > P.daySunDeg;
    const zi = day ? (w.boundaryLayerHeight && w.boundaryLayerHeight > 0 ? w.boundaryLayerHeight : P.defaultMixedLayer) : P.nightZi;
    const c = this.columnAt(x, y);
    const qh = this.heatingOn ? this.qhCol[c]! : 0;
    const tK = w.temperature + 273.15;
    const rho = 1.1;
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
    // C-Haines from the pressure levels (model/preset only).
    let ch: number | null = null;
    if (!p.synthetic && (upper === 'model' || upper === 'preset')) {
      const lv = w.pressureLevels ?? [];
      const l850 = lv.find((l) => l.hPa === 850);
      const l700 = lv.find((l) => l.hPa === 700);
      if (l700) {
        const below = !l850 || l850.height < p.zgp;
        const t850 = below ? w.temperature : l850!.temperature;
        const td850 = below ? (w.dewPoint ?? w.temperature - 10) : (l850!.dewPoint ?? dewFromRh(l850!.temperature, l850!.relativeHumidity));
        ch = cHaines(t850, l700.temperature, td850).ch;
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
        const top = zf + Math.max(this.night.hInv, 50);
        const thTop = this.thetaAt(c, top);
        let s = 0;
        for (let z = zf + 5; z < top; z += 10) s += Math.max(0, thTop - this.thetaAt(c, z)) * 10;
        deficit += CP * 1.1 * s;
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
      if (this.thetaAt(cMed, zs + z) > th0 + 0.5) break;
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
        const b = briggsRise(P.chiC * this.firePowerW, U, p.nSquared, 1.1, w.temperature + 273.15);
        plumeTop = this.fireSrcZ + b.rise;
      }
    }
    const nfSrc = upper === 'none' ? 'none' : upper;
    return {
      spunUp: this.spunUp,
      synthetic: p.synthetic,
      upperAirSource: nfSrc,
      inversion: { present, dTheta: dThetaMax, topASL: present ? topASL : NaN, mixedLayerTopAGL: mlTop, breakEta },
      cHaines: ch,
      pft: null,
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
      kappa: A.kappa ? kappaLookup(A.kappa.mag, ATMOS_PARAMS.zRefMin) : 1,
    };
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
        bg: s.bg ? { u: s.bg.u.slice(), v: s.bg.v.slice(), w: s.bg.w.slice(), phi: s.bg.phi.slice(), alphaV: s.bg.alphaV } : null,
      })),
      time: this.time,
      night: { ...this.night },
      kbdi: this.kbdi,
      cloud: this.cloud,
      sunElevation: this.sunElevation,
      heatingOn: this.heatingOn,
      qhFire: this.qhFire.slice(),
      qhCol: this.qhCol.slice(),
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
      if (s.bg) {
        const g = this.grid;
        const uc = new Float32Array(g.n);
        const vc = new Float32Array(g.n);
        const wc = new Float32Array(g.n);
        const u = s.bg.u.slice();
        const v = s.bg.v.slice();
        const w = s.bg.w.slice();
        facesToCentres(g, u, v, w, uc, vc, wc);
        st.bg = { time: s.hour.time, profile: st.profile, u, v, w, uc, vc, wc, phi: s.bg.phi.slice(), alphaV: s.bg.alphaV, result: { iterations: 0, relResidual: 0, rate: 0, method: 'none' } };
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
  seq: { hour: WeatherHour; bg: { u: Float32Array; v: Float32Array; w: Float32Array; phi: Float64Array; alphaV: number } | null }[];
  time: number;
  night: StableNightState;
  kbdi: number;
  cloud: number;
  sunElevation: number;
  heatingOn: boolean;
  qhFire: Float32Array;
  qhCol: Float64Array;
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

function dewFromRh(t: number, rh: number): number {
  const g = Math.log((Math.max(1, rh) / 100) * Math.exp((17.67 * t) / (t + 243.5)));
  return (243.5 * g) / (17.67 - g);
}
