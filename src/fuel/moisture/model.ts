/**
 * MoistureModel — dead fine fuel moisture per fire-grid cell (spec docs/research/00-synthesis.md §5, D17, D43, D49).
 *
 * Per burnable cell and update (every 600 s of simulated time, hourly in the spin-up):
 *   §5.2  air T/Td at the cell: lapse Γ (D43) from the grid-point values at z_s, plus the stable-night cold pool
 *         (Δθ, h_inv from `ctx.night`, §5.2a); RH = rhFromTd(T, Td). The atmosphere's T replaces the lapse T when
 *         sim/ passes `ctx.airT` (3-D tier spun up, mountainPhenomena on).
 *   §5.3  AFDRS-equivalent M_A per moisture family at the cell's T/RH, domain-level period (solar time).
 *   §5.4  physical anomaly A = (E_cell − E_ref)·(1 − 0.5·smoothstep(8, 10, DF)) + G_gully, with E = Van Wagner E_d at
 *         the fuel temperature/humidity of the cell (terrain insolation, canopy, litter wind, night long-wave) and of
 *         the family reference column (flat, open sky, reference canopy c_ref).
 *   §5.5  M_eq = max(2, M_A + A); exact exponential time lag τ = f_τ·(1.5 h drying | 2 h wetting); rain memory
 *         R_mem (throughfall P48, effective hours since rain; not for heath whose M_A has MC2); dew store D.
 *         M = clamp(M_lag + R_mem + D + moistureOffset, 2, 250). Burnt cells keep their last value.
 *   §5.9  fuel availability FA per cell (domain DF/KBDI, cell WRF, wet-forest topographic blend).
 * Spin-up (§5.6): hourly from max(seriesStart, t0 − 168 h); before the last 48 h a look-up table over
 * (moisture family × 25 m elevation band × canopy-cover decile) with flat insolation and zero anomaly, then per cell.
 *
 * Hot loops use typed arrays, no allocation, and the tables of fastMath.ts. Runs in a Web Worker and in Node.
 */
import type { FuelMap, MoistureFamily, StableNightState, Terrain, WeatherHour, WeatherSeries } from '../../core/types';
import type { InsolationResult, MoistureContext, TerrainDerived } from '../../core/simTypes';
import { Landform } from '../../core/types';
import { STABLE_NIGHT_PARAMS, dewPointC, initialStableNight, lmstHour } from '../../core/physics';
import { horizontalIrradiance, insolation, solarPosition } from '../../terrain';
import { MFam, afdrsMoistureCode, familyCode, familyName, forestMoisture, forestPeriod, isAfdrsNight, rainMemoryMc2 } from './afdrs';
import { lapseRate, medianOf } from './air';
import { cellAvailability, faBlendWeight } from './availability';
import { fuelParamsAt } from '../fuelMap';
import { MOISTURE_TYPE_DEFAULTS, type MoistureCellParams, type MoistureCellResolver } from './cellParams';
import { EXPNEG_TABLE, FAST_TABLES, esatFast, fillExpTable } from './fastMath';
import {
  columnEmc,
  diffuseTransmittance,
  droughtDamping,
  gullyKbdiFade,
  gullyOffsetBase,
  interceptionCapacity,
  litterWind,
  referenceRate,
} from './fuelPhysics';
import { integrateStableNight } from './night';
import { moistureParams, type MoistureParams } from './params';
import { seriesWeatherAt } from './weather';

const HOUR_MS = 3.6e6;
/** Height above the valley used for units that never sit in the cold pool (LUT keys). */
const NO_POOL = 1e9;
/** Cap of the effective hours-since-rain clock (h). */
const HE_CAP = 1000;
const EMPTY_U8 = new Uint8Array(0);
// Module-local bindings of the hot-loop tables and helpers: some loaders (e.g. Vitest's SSR transform) turn every
// access to an imported binding into a getter call. The kernel inlines its table lookups by hand (TurboFan's inlining
// budget is exhausted in a loop body this size; an out-of-line call costs ~10 ns per lookup).
const afdrsK = afdrsMoistureCode;
const { tLo: T_LO, tInv: T_INV, tTop: T_TOP, esat: ESAT, rateT: RATE_T, hInv: H_INV, hTop: H_TOP, edk: EDK } = FAST_TABLES;
const { xInv: X_INV, xTop: X_TOP, table: EXPNEG } = EXPNEG_TABLE;
/** LAI grid of the per-step canopy beam-transmission table (LAI 0–10 in 0.01 steps). */
const LAI_INV = 100;
const LAI_N = 10 * LAI_INV + 2;
const LAI_TOP = LAI_N - 2;

/** A set of moisture "units" (fire-grid cells, or spin-up LUT keys) with static parameters, state and outputs. */
interface UnitSet {
  n: number;
  fam: Uint8Array;
  z: Float32Array;
  hav: Float32Array;
  cover: Float32Array;
  lai: Float32Array;
  laiRef: Float32Array;
  cRef: Float32Array;
  wrf: Float32Array;
  /** 1 / (uFDivisor·WRF): litter wind u_f = U10·uFac. */
  uFac: Float32Array;
  tauD: Float32Array;
  tauDRef: Float32Array;
  sC: Float32Array;
  gully: Float32Array;
  offset: Float32Array;
  mLag: Float32Array;
  lDew: Float32Array;
  hE: Float32Array;
  field: Float32Array;
  afdrs: Float32Array;
  anomaly: Float32Array;
  fuelTemp: Float32Array;
  airT: Float32Array;
  airRH: Float32Array;
}

function newUnits(n: number): UnitSet {
  const f = (): Float32Array => new Float32Array(n);
  return {
    n,
    fam: new Uint8Array(n),
    z: f(),
    hav: f(),
    cover: f(),
    lai: f(),
    laiRef: f(),
    cRef: f(),
    wrf: f(),
    uFac: f(),
    tauD: f(),
    tauDRef: f(),
    sC: f(),
    gully: f(),
    offset: f(),
    mLag: f(),
    lDew: f(),
    hE: f(),
    field: f(),
    afdrs: f(),
    anomaly: f(),
    fuelTemp: f(),
    airT: f(),
    airRH: f(),
  };
}

/** Domain forcing of one kernel step. */
interface StepForcing {
  dtS: number;
  init: boolean;
  tS: number;
  tdS: number;
  zS: number;
  lapse: number;
  dTheta: number;
  hInv: number;
  sunElev: number;
  cloudFrac: number;
  period: 1 | 2 | 3;
  afdrsNight: boolean;
  mc2: number;
  p48: number;
  stepRain: number;
  damp: number;
  gullyFade: number;
  anomalyOn: boolean;
  directRef: number;
  diffuseRef: number;
  direct: Float32Array | null;
  total: Float32Array | null;
  u10: Float32Array | null;
  u10Scalar: number;
  airT: Float32Array | null;
  burnt: Uint8Array | null;
}

/** Per-cell breakdown of M for explain/ ("why is this cell wetter than AFDRS says?"). */
export interface MoistureBreakdown {
  family: MoistureFamily;
  /** Final M (%) and its AFDRS-equivalent M_A (%). */
  m: number;
  mA: number;
  /** Physical anomaly A (pp): terrain, canopy, sun and wind via the fuel temperature, gully offset. */
  anomaly: number;
  /** Lagged moisture M_lag (%) and its lag behind the equilibrium (pp, + = still drying). */
  mLag: number;
  lag: number;
  /** Rain memory R_mem and dew D (pp), user/class offset (pp). */
  rainMemory: number;
  dew: number;
  offset: number;
  airT: number;
  airRH: number;
  fuelTemp: number;
  hoursSinceRainEff: number;
}

interface RainEvent {
  t: number;
  mm: number;
}

/** Serialisable model state for checkpoints (spec §12.4). */
export interface MoistureCheckpoint {
  v: 1;
  mLag: Float32Array;
  lDew: Float32Array;
  hE: Float32Array;
  field: Float32Array;
  afdrs: Float32Array;
  anomaly: Float32Array;
  fuelTemp: Float32Array;
  airT: Float32Array;
  airRH: Float32Array;
  availability: Float32Array;
  rain: RainEvent[];
  tLastRain: number;
  kbdi: number;
  df: number;
  lastTime: number;
  initialised: boolean;
  airOffset: [number, number];
  zS: number;
}

export class MoistureModel {
  /** Dead fine (surface litter) moisture M (%) used for spread. */
  readonly field: Float32Array;
  /** AFDRS-equivalent value M_A (%) (air T/RH only, operational equations; heath includes MC2). */
  readonly afdrs: Float32Array;
  /** Physical anomaly A (pp) added to M_A. */
  readonly anomaly: Float32Array;
  /** Fuel-surface temperature T_f (°C). */
  readonly fuelTemp: Float32Array;
  /** Cell air temperature (°C) and relative humidity (%) (§5.2). */
  readonly airT: Float32Array;
  readonly airRH: Float32Array;
  /** Fuel availability FA per cell (§5.9). */
  readonly availability: Float32Array;
  /** Start-up notes (calibration hook, missing inputs). No console output. */
  readonly warnings: string[] = [];
  readonly params: MoistureParams;

  private readonly terrain: Terrain;
  private readonly fuel: FuelMap;
  private readonly derived: TerrainDerived;
  private readonly resolve: MoistureCellResolver;
  private readonly cells: UnitSet;
  private readonly moistureFamilies: MoistureFamily[];
  private readonly faBlend: Float32Array;
  private readonly relief: number;
  private readonly medianZ: number;
  private readonly kRef: number;
  private zS: number;
  private rain: RainEvent[] = [];
  private tLastRain = -Infinity;
  private kbdi = 60;
  private df = 7;
  private lastTime = NaN;
  private initialised = false;
  private airOffsetT = 0;
  private airOffsetTd = 0;
  private readonly zeroRad: Float32Array;
  /** Per-step table e^{−0.4·LAI/sin h} over LAI (beam transmission of the canopy foliage). */
  private readonly beamTab = new Float64Array(LAI_N);
  /** Mean dry-forest reference column (calibration hook), resolved lazily. */
  private forestRef: { cRef: number; wrf: number; lai: number } | null | undefined = undefined;

  /**
   * @param terrain fire-grid terrain (`fuel.grid === terrain.grid`)
   * @param fuel    fire-grid fuel map
   * @param derived `terrainDerived(terrain)` (tpiSmall, heightAboveValley)
   * @param opts    overrides of MOISTURE_PARAMS
   * @param resolve per-cell parameters (default `fuelParamsAt` of fuel/, spec §4.7; `localMoistureCellParams` is a
   *                catalogue-only adapter for tests)
   */
  constructor(terrain: Terrain, fuel: FuelMap, derived: TerrainDerived, opts?: Partial<MoistureParams>, resolve?: MoistureCellResolver) {
    const n = terrain.elevation.length;
    if (fuel.type.length !== n) throw new Error(`MoistureModel: fuel grid (${fuel.type.length}) differs from terrain grid (${n})`);
    this.terrain = terrain;
    this.fuel = fuel;
    this.derived = derived;
    this.params = moistureParams(opts);
    this.resolve = resolve ?? fuelParamsAt;
    this.cells = newUnits(n);
    this.field = this.cells.field;
    this.afdrs = this.cells.afdrs;
    this.anomaly = this.cells.anomaly;
    this.fuelTemp = this.cells.fuelTemp;
    this.airT = this.cells.airT;
    this.airRH = this.cells.airRH;
    this.availability = new Float32Array(n);
    this.faBlend = new Float32Array(n);
    this.moistureFamilies = new Array<MoistureFamily>(n);
    this.zeroRad = new Float32Array(n);
    this.relief = Math.max(1, terrain.maxElevation - terrain.minElevation);
    this.medianZ = medianOf(terrain.elevation);
    this.zS = this.medianZ;
    this.kRef = referenceRate(this.params);
    const c = this.cells;
    c.z.set(terrain.elevation);
    c.hav.set(derived.heightAboveValley);
    this.refreshFuel();
    this.computeAvailability();
  }

  /** Re-resolve the static per-cell fuel parameters (after fuel edits); `cells` = changed cells, default all. */
  refreshFuel(cells?: ArrayLike<number>): void {
    const n = this.cells.n;
    if (cells) for (let q = 0; q < cells.length; q++) this.resolveCell(cells[q]!);
    else for (let k = 0; k < n; k++) this.resolveCell(k);
    this.forestRef = undefined;
    if (this.initialised) this.computeAvailability(cells);
  }

  private resolveCell(k: number): void {
    const P = this.params;
    const c = this.cells;
    const p: MoistureCellParams = this.resolve(this.fuel, k);
    const fam = familyCode(p.moistureFamily);
    const cover = Math.min(1, Math.max(0, p.cover || 0));
    const lai = Math.max(0, p.lai || 0);
    const cRef = Math.min(1, Math.max(0, p.cRef || 0));
    this.moistureFamilies[k] = p.moistureFamily;
    c.fam[k] = fam;
    c.cover[k] = cover;
    c.lai[k] = lai;
    c.cRef[k] = cRef;
    // Reference LAI at the reference cover with the type's LAI density LAI_type/c_type (= lai/cover when the CHM
    // scaled the LAI; the catalogue value for open cells).
    const d = MOISTURE_TYPE_DEFAULTS[p.type];
    c.laiRef[k] = cover > 1e-3 ? (lai * cRef) / cover : d && d.cover > 0 ? (d.lai * cRef) / d.cover : lai;
    c.wrf[k] = p.wrf > 0 ? p.wrf : 1;
    c.uFac[k] = 1 / (P.uFDivisor * c.wrf[k]!);
    c.tauD[k] = diffuseTransmittance(cover, lai, P);
    c.tauDRef[k] = diffuseTransmittance(cRef, c.laiRef[k]!, P);
    c.sC[k] = interceptionCapacity(cover, P);
    const lf = this.terrain.landform[k];
    const vesta = p.family === 'vesta2' || fam === MFam.Forest || fam === MFam.WetForest;
    c.gully[k] = vesta ? gullyOffsetBase(this.derived.tpiSmall[k]!, lf === Landform.Gully || lf === Landform.ValleyFloor, P) : 0;
    c.offset[k] = Number.isFinite(p.moistureOffset) ? p.moistureOffset : 0;
    this.faBlend[k] = fam === MFam.WetForest ? faBlendWeight(this.derived.tpiSmall[k]!, this.terrain.aspectDeg[k]!) : 0;
  }

  /** FA per cell for the current DF/KBDI (spec §5.9). */
  private computeAvailability(cells?: ArrayLike<number>): void {
    const set = (k: number): void => {
      this.availability[k] = cellAvailability(this.moistureFamilies[k]!, this.df, this.kbdi, this.cells.wrf[k]!, this.faBlend[k]!);
    };
    if (cells) for (let q = 0; q < cells.length; q++) set(cells[q]!);
    else for (let k = 0; k < this.cells.n; k++) set(k);
  }

  /** Domain offset (K) on the grid-point T and T_d, e.g. from belt-kit readings (spec §5.2, §11.5). */
  setAirOffset(dT: number, dTd: number): void {
    this.airOffsetT = Number.isFinite(dT) ? dT : 0;
    this.airOffsetTd = Number.isFinite(dTd) ? dTd : 0;
  }

  /** Current domain drought state. */
  get drought(): { kbdi: number; df: number } {
    return { kbdi: this.kbdi, df: this.df };
  }

  /** Moisture family of a cell. */
  familyAt(k: number): MoistureFamily {
    return this.moistureFamilies[k]!;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rain history (domain)
  // ───────────────────────────────────────────────────────────────────────────

  /** Add the rain of a step ending at t (rate mm/h over dt s) and prune the 48 h window. Returns the step rain. */
  private addRain(t: number, rateMmH: number, dtS: number): number {
    const r = Number.isFinite(rateMmH) && rateMmH > 0 ? rateMmH : 0;
    const mm = (r * dtS) / 3600;
    if (mm > 0) this.rain.push({ t, mm });
    if (r > this.params.rainResetRate && dtS > 0) this.tLastRain = t;
    const cut = t - this.params.rainWindowH * HOUR_MS;
    let drop = 0;
    while (drop < this.rain.length && this.rain[drop]!.t <= cut) drop++;
    if (drop) this.rain.splice(0, drop);
    return mm;
  }

  private rain48(t: number): number {
    const cut = t - this.params.rainWindowH * HOUR_MS;
    let s = 0;
    for (const e of this.rain) if (e.t > cut && e.t <= t) s += e.mm;
    return s;
  }

  private hoursSinceRain(t: number): number {
    return Number.isFinite(this.tLastRain) ? Math.max(0, (t - this.tLastRain) / HOUR_MS) : HE_CAP;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Kernel
  // ───────────────────────────────────────────────────────────────────────────

  /** Advance a unit set by one step (no allocation; every loop-invariant is hoisted into a local). */
  private advance(u: UnitSet, F: StepForcing): void {
    const P = this.params;
    const n = u.n;
    const day = F.sunElev > 0;
    const night = F.sunElev < 0;
    const sinH = Math.max(P.sinSunFloor, Math.sin((F.sunElev * Math.PI) / 180));
    const beamTab = this.beamTab;
    if (day) fillExpTable(beamTab, -P.beamExtinction / sinH, 1 / LAI_INV);
    const lwSky = night ? 1 - Math.min(1, Math.max(0, F.cloudFrac)) : 0;
    const lwOpen = P.lwCoolOpen * lwSky;
    const lwCan = P.lwCoolCanopy * lwSky;
    const dtS = F.dtS;
    const dtH = dtS / 3600;
    const invDtH = 1 / Math.max(dtH, 1e-9);
    const lapse = F.lapse / 1000;
    const dewL = P.dewLapse / 1000;
    const tS = F.tS;
    const tdS = F.tdS;
    const zS = F.zS;
    const hInv = F.hInv;
    const dTheta = F.dTheta;
    const pool = dTheta > 0 && hInv > 0;
    const poolSn = Math.min(1, dTheta / STABLE_NIGHT_PARAMS.snScaleK);
    const invHInv = hInv > 0 ? 1 / hInv : 0;
    const stepRain = F.stepRain;
    const stepRate = stepRain * invDtH; // domain rain rate of the step (mm/h)
    const p48 = F.p48;
    const before48 = p48 - stepRain;
    const period = F.period;
    const afdrsNight = F.afdrsNight;
    const mc2 = F.mc2;
    const anomalyOn = F.anomalyOn;
    const damp = F.damp;
    const gullyFade = F.gullyFade;
    const directRef = F.directRef;
    const diffuseRef = F.diffuseRef;
    const init = F.init;
    const uScalar = F.u10Scalar;
    const hasDirect = F.direct !== null;
    const direct = F.direct ?? this.zeroRad;
    const total = F.total ?? this.zeroRad;
    const hasU = F.u10 !== null;
    const u10a = F.u10 ?? this.zeroRad;
    const hasAirT = F.airT !== null;
    const airTa = F.airT ?? this.zeroRad;
    const hasBurnt = F.burnt !== null;
    const burnt = F.burnt ?? EMPTY_U8;
    const aS = P.aS;
    const bU = P.bU;
    // Relaxation exponent x = Δt/τ = Δt·(k/k_ref)/τ₀ with k/k_ref = 1/f_τ clamped to [1/f_max, 1/f_min].
    const invKRef = 1 / this.kRef;
    const gMin = 1 / P.fTauMax;
    const gMax = 1 / P.fTauMin;
    const xDry = (dtH / P.tauDry) * X_INV;
    const xWet = (dtH / P.tauWet) * X_INV;
    const mEqMin = P.mEqMin;
    const resetRate = P.rainResetRate;
    const heRef = P.heSfRef;
    const heInvScale = 1 / P.heSfScale;
    const heMin = P.heRateMin;
    const heMax = P.heRateMax;
    const dewMax = P.dewRateMax;
    const dewCoef = P.dewRateCoef;
    const dewDry = P.dewDryBase * dtH;
    const dewInvSf = 1 / P.dewDrySf;
    const dewScale = 100 / P.dewStoreMm;
    const dewCap = P.dewMaxPp;
    const mMin = P.mMin;
    const mMax = P.mMax;
    const { fam, z, hav, cover, lai, laiRef, cRef, uFac, tauD, tauDRef, sC, gully, offset, mLag, lDew, hE } = u;
    const { field, afdrs, anomaly, fuelTemp, airT, airRH } = u;
    // Inline table lookups: x = fractional index (clamped), i = floor(x), f = x − i.
    let x = 0;
    let i = 0;
    let f = 0;
    for (let k = 0; k < n; k++) {
      if (hasBurnt && burnt[k] !== 0) continue;
      // §5.2 air temperature and dew point (lapse + cold pool; isothermal shift weighted by sn, see air.ts)
      let zq = z[k]!;
      let dPool = 0;
      const hv = hav[k]!;
      if (pool && hv < hInv) {
        const h = hv > 0 ? hv : 0;
        zq += poolSn * (hInv - h);
        dPool = dTheta * (1 - h * invHInv);
      }
      const dz = zq - zS;
      const t = hasAirT ? airTa[k]! : tS - lapse * dz - dPool;
      let td = tdS - dewL * dz;
      if (td > t) td = t;
      x = (t - T_LO) * T_INV;
      x = x > 0 ? (x < T_TOP ? x : T_TOP) : 0;
      i = x | 0;
      const eT = ESAT[i]! + (ESAT[i + 1]! - ESAT[i]!) * (x - i);
      x = (td - T_LO) * T_INV;
      x = x > 0 ? (x < T_TOP ? x : T_TOP) : 0;
      i = x | 0;
      const e = ESAT[i]! + (ESAT[i + 1]! - ESAT[i]!) * (x - i);
      const rh = (100 * e) / eT;
      airT[k] = t;
      airRH[k] = rh;
      // §5.4 fuel temperature of the cell
      const u10 = hasU ? u10a[k]! : uScalar;
      const uF = u10 * uFac[k]!;
      const cc = cover[k]!;
      let sF = 0;
      if (day) {
        x = lai[k]! * LAI_INV;
        x = x < LAI_TOP ? x : LAI_TOP;
        i = x | 0;
        const tb = 1 - cc + cc * (beamTab[i]! + (beamTab[i + 1]! - beamTab[i]!) * (x - i));
        const dir = hasDirect ? direct[k]! : directRef;
        const dif = hasDirect ? total[k]! - dir : diffuseRef;
        sF = tb * dir + tauD[k]! * (dif > 0 ? dif : 0);
      }
      const windDiv = aS / (1 + bU * uF);
      const tF = t + sF * windDiv - (night ? lwOpen * (1 - cc) + lwCan * cc : 0);
      fuelTemp[k] = tF;
      const fk = fam[k]!;
      if (fk === MFam.None) {
        field[k] = 0;
        afdrs[k] = 0;
        anomaly[k] = 0;
        continue;
      }
      x = (tF - T_LO) * T_INV;
      x = x > 0 ? (x < T_TOP ? x : T_TOP) : 0;
      i = x | 0;
      f = x - i;
      const esTf = ESAT[i]! + (ESAT[i + 1]! - ESAT[i]!) * f;
      const rateTf = RATE_T[i]! + (RATE_T[i + 1]! - RATE_T[i]!) * f;
      let hF = (100 * e) / esTf;
      hF = hF < 1 ? 1 : hF > 100 ? 100 : hF;
      // Humidity node of H_f: Van Wagner E_d parts [0, 1] and drying-rate parts [2, 3].
      x = hF * H_INV;
      x = x < H_TOP ? x : H_TOP;
      i = x | 0;
      const fH = x - i;
      const jH = 4 * i;
      // §5.3 AFDRS-equivalent value
      const mA = afdrsK(fk, t, rh, period, afdrsNight, mc2);
      // §5.4 anomaly against the family reference column (flat, open sky, reference canopy)
      let a = 0;
      if (anomalyOn) {
        const eCell = EDK[jH]! + (EDK[jH + 4]! - EDK[jH]!) * fH + (21.1 - tF) * (EDK[jH + 1]! + (EDK[jH + 5]! - EDK[jH + 1]!) * fH);
        const cr = cRef[k]!;
        let sFr = 0;
        if (day) {
          x = laiRef[k]! * LAI_INV;
          x = x < LAI_TOP ? x : LAI_TOP;
          i = x | 0;
          sFr = (1 - cr + cr * (beamTab[i]! + (beamTab[i + 1]! - beamTab[i]!) * (x - i))) * directRef + tauDRef[k]! * diffuseRef;
        }
        const tFr = t + sFr * windDiv - (night ? lwOpen * (1 - cr) + lwCan * cr : 0);
        x = (tFr - T_LO) * T_INV;
        x = x > 0 ? (x < T_TOP ? x : T_TOP) : 0;
        i = x | 0;
        let hFr = (100 * e) / (ESAT[i]! + (ESAT[i + 1]! - ESAT[i]!) * (x - i));
        hFr = hFr < 1 ? 1 : hFr > 100 ? 100 : hFr;
        x = hFr * H_INV;
        x = x < H_TOP ? x : H_TOP;
        i = x | 0;
        f = x - i;
        const j = 4 * i;
        const eRef = EDK[j]! + (EDK[j + 4]! - EDK[j]!) * f + (21.1 - tFr) * (EDK[j + 1]! + (EDK[j + 5]! - EDK[j + 1]!) * f);
        a = (eCell - eRef) * damp + gully[k]! * gullyFade;
      }
      const mEq0 = mA + a;
      const mEq = mEq0 > mEqMin ? mEq0 : mEqMin;
      // §5.5 time lag (exact exponential, Van Wagner rate ratio f_τ = k_ref / k(H_f, U10, T_f))
      let m = mLag[k]!;
      if (init) m = mEq;
      else {
        const sqW = Math.sqrt(u10 * 3.6);
        let kk: number;
        if (m < mEq) {
          // wetting: k with H → 100 − H
          x = (100 - hF) * H_INV;
          x = x > 0 ? x : 0;
          i = x | 0;
          f = x - i;
          const j = 4 * i;
          kk = (EDK[j + 2]! + (EDK[j + 6]! - EDK[j + 2]!) * f + (EDK[j + 3]! + (EDK[j + 7]! - EDK[j + 3]!) * f) * sqW) * rateTf;
        } else kk = (EDK[jH + 2]! + (EDK[jH + 6]! - EDK[jH + 2]!) * fH + (EDK[jH + 3]! + (EDK[jH + 7]! - EDK[jH + 3]!) * fH) * sqW) * rateTf;
        let g = kk * invKRef; // 1 / f_τ
        g = g < gMin ? gMin : g > gMax ? gMax : g;
        x = g * (m > mEq ? xDry : xWet);
        let decay = 0;
        if (x < X_TOP) {
          i = x | 0;
          decay = EXPNEG[i]! + (EXPNEG[i + 1]! - EXPNEG[i]!) * (x - i);
        }
        m = mEq + (m - mEq) * decay;
      }
      mLag[k] = m;
      // Rain memory (non-heath families; heath's M_A already carries MC2)
      let rMem = 0;
      if (fk !== MFam.Heath) {
        const sc = sC[k]!;
        const tfNow = p48 > sc ? p48 - sc : 0;
        let he = hE[k]!;
        if (stepRate > 0 && (tfNow - (before48 > sc ? before48 - sc : 0)) * invDtH > resetRate) he = 0;
        else {
          let rate = 1 + (sF - heRef) * heInvScale;
          rate = rate < heMin ? heMin : rate > heMax ? heMax : rate;
          he += dtH * rate;
          if (he > HE_CAP) he = HE_CAP;
        }
        hE[k] = he;
        if (tfNow > 0) rMem = 67.128 * (1 - Math.exp(-3.132 * tfNow)) * Math.exp(-0.0858 * he);
      }
      // Dew store
      let ld = lDew[k]!;
      if (tF < td) {
        const q = dewCoef * (td - tF);
        ld += (q < dewMax ? q : dewMax) * dtH;
        lDew[k] = ld;
      } else if (tF > td && ld > 0) {
        ld -= dewDry * (1 + sF * dewInvSf);
        if (ld < 0) ld = 0;
        lDew[k] = ld;
      }
      const dTerm = ld * dewScale;
      const mm = m + rMem + (dTerm < dewCap ? dTerm : dewCap) + offset[k]!;
      field[k] = mm < mMin ? mMin : mm > mMax ? mMax : mm;
      afdrs[k] = mA;
      anomaly[k] = a;
    }
  }

  /** Domain part of the forcing from an (interpolated) weather hour. */
  private baseForcing(w: WeatherHour, time: number, dtS: number, sunElev: number, lmst: number, month: number, cloudFrac: number, night: StableNightState, kbdi: number, df: number): StepForcing {
    const stepRain = this.addRain(time, w.precipitation ?? 0, dtS);
    const p48 = this.rain48(time);
    const td = w.dewPoint ?? dewPointC(w.temperature, w.relativeHumidity);
    return {
      dtS,
      init: !this.initialised,
      tS: w.temperature + this.airOffsetT,
      tdS: td + this.airOffsetTd,
      zS: this.zS,
      lapse: lapseRate(sunElev, this.relief, w.boundaryLayerHeight, this.params),
      dTheta: night.dTheta,
      hInv: night.hInv,
      sunElev,
      cloudFrac,
      period: forestPeriod(lmst, month, cloudFrac, this.params.period1CloudMax),
      afdrsNight: isAfdrsNight(lmst),
      mc2: rainMemoryMc2(p48, this.hoursSinceRain(time)),
      p48,
      stepRain,
      damp: droughtDamping(df, this.params),
      gullyFade: gullyKbdiFade(kbdi, this.params),
      anomalyOn: true,
      directRef: 0,
      diffuseRef: 0,
      direct: null,
      total: null,
      u10: null,
      u10Scalar: w.windSpeed10,
      airT: null,
      burnt: null,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Advance the moisture field by `dtSeconds` ending at `ctx.time` (spec §5.1: every 600 s).
   * `w` = weatherAt(ctx.time); `sun` = insolation(terrain, ctx.time, …) on the fire grid; `ctx.u10` the per-cell
   * open-equivalent background wind. `initialise()` already leaves the field valid at t0 (grid-point wind); the
   * "once at t0" refresh with the per-cell winds is `update(w, sun, 0, ctx)`: with Δt = 0 the state (M_lag, dew,
   * rain clocks) is unchanged and only the diagnosed outputs are re-evaluated.
   */
  update(w: WeatherHour, sun: InsolationResult, dtSeconds: number, ctx: MoistureContext): void {
    if (ctx.kbdi !== this.kbdi || ctx.df !== this.df) {
      this.kbdi = ctx.kbdi;
      this.df = ctx.df;
      this.computeAvailability();
    }
    const F = this.baseForcing(w, ctx.time, dtSeconds, ctx.sunElevation, ctx.lmstHour, ctx.month, ctx.cloudFrac, ctx.night, ctx.kbdi, ctx.df);
    const sinH = Math.sin((ctx.sunElevation * Math.PI) / 180);
    F.directRef = ctx.sunElevation > 0 ? sun.dni * sinH : 0;
    F.diffuseRef = ctx.sunElevation > 0 ? sun.dhi : 0;
    F.direct = sun.direct;
    F.total = sun.total;
    F.u10 = ctx.u10;
    F.airT = ctx.airT ?? null;
    F.burnt = ctx.burnt;
    this.advance(this.cells, F);
    this.initialised = true;
    this.lastTime = ctx.time;
  }

  /**
   * Spin-up to t0 (spec §5.6): hourly §5.2–5.5 chain from max(seriesStart, t0 − 168 h), a LUT before the final 48 h,
   * per cell with per-cell insolation inside it; the stable-night state is re-integrated alongside with the
   * template of `night`. Sets KBDI/DF (domain scalars for the run) and FA.
   */
  initialise(series: WeatherSeries, t0: number, drought: { kbdi: number; df: number }, night: StableNightState): void {
    const P = this.params;
    const hs = series.hours;
    if (hs.length === 0) throw new Error('MoistureModel.initialise: the weather series has no hours');
    this.kbdi = drought.kbdi;
    this.df = drought.df;
    this.computeAvailability();
    this.zS = series.sourceElevation !== undefined && Number.isFinite(series.sourceElevation) ? series.sourceElevation : this.medianZ;
    if (series.sourceElevation === undefined) this.warnings.push(`Weather elevation unknown: lapse rates referenced to the domain median ${this.medianZ.toFixed(0)} m.`);
    this.rain = [];
    this.tLastRain = -Infinity;
    this.initialised = false;
    // Sun geometry and the solar clock of the domain (spec §0.2: LMST at the domain longitude).
    const { lat, lon } = this.terrain.grid.origin;
    const seriesStart = hs[0]!.time;
    let tStart = Math.max(seriesStart, t0 - P.spinUpHours * HOUR_MS);
    if (tStart > t0) tStart = t0;
    this.seedRainHistory(series, tStart, t0, lon);
    const hsr = this.hoursSinceRain(tStart);
    this.cells.hE.fill(hsr);
    this.cells.lDew.fill(0);
    const tWin = t0 - P.perCellHours * HOUR_MS;
    const useLut = P.spinUpLut && tWin > tStart;
    const lut = useLut ? this.buildLut() : null;
    if (lut) {
      lut.units.hE.fill(hsr);
      lut.units.lDew.fill(0);
    }
    const ns = initialStableNight({ dThetaMax: night.dThetaMax, hInv: night.hInv });
    const meanAlt = this.medianZ;
    let calibSum = 0;
    let calibN = 0;
    let tPrev = tStart;
    let inWindow = !useLut;
    for (let t = tStart, first = true; ; first = false) {
      const dtS = first ? 0 : (t - tPrev) / 1000;
      if (!first) integrateStableNight(ns, series, tPrev, t, P.nightSubStepS);
      const w = seriesWeatherAt(series, t);
      const sunPos = solarPosition(t, lat, lon);
      const sunElev = sunPos.elevation;
      const lmst = lmstHour(t, lon);
      const month = new Date(t + (lon / 15) * HOUR_MS).getUTCMonth() + 1;
      const cloudFrac = Math.min(1, Math.max(0, (w.cloudCover ?? 0) / 100));
      const F = this.baseForcing(w, t, dtS, sunElev, lmst, month, cloudFrac, ns, this.kbdi, this.df);
      const kt = w.clearness;
      const radOpts = kt !== undefined && Number.isFinite(kt) ? { ghi: kt * horizontalIrradiance(sunPos, meanAlt, {}).ghi, cloudCover: w.cloudCover } : { cloudCover: w.cloudCover };
      const flat = horizontalIrradiance(sunPos, meanAlt, radOpts);
      F.directRef = sunElev > 0 ? flat.dni * Math.sin((sunElev * Math.PI) / 180) : 0;
      F.diffuseRef = sunElev > 0 ? flat.dhi : 0;
      if (!inWindow && t >= tWin && lut) {
        this.copyLutToCells(lut);
        inWindow = true;
      }
      if (!inWindow && lut) {
        F.anomalyOn = false;
        F.dTheta = 0;
        this.advance(lut.units, F);
      } else {
        if (sunElev > 0) {
          const sun = insolation(this.terrain, t, radOpts);
          F.direct = sun.direct;
          F.total = sun.total;
        } else {
          F.direct = this.zeroRad;
          F.total = this.zeroRad;
        }
        this.advance(this.cells, F);
      }
      if (F.period === 1 && F.stepRain === 0) {
        const d = this.calibrationDeviation(w, F);
        if (Number.isFinite(d)) {
          calibSum += d;
          calibN++;
        }
      }
      this.initialised = true;
      tPrev = t;
      if (t >= t0) break;
      t = Math.min(t0, t + Math.max(0.25, P.spinUpStepH) * HOUR_MS);
    }
    if (lut && !inWindow) this.copyLutToCells(lut);
    const bias = calibN ? calibSum / calibN : 0;
    if (Math.abs(bias) > P.calibrationWarnPp) {
      this.warnings.push(
        `Moisture calibration: the dry-forest reference column departs from the AFDRS period-1 value by ${bias.toFixed(2)} pp on average over ${calibN} dry-afternoon hours (> ${P.calibrationWarnPp} pp); a_s not re-tuned (spec §5.4).`,
      );
    }
    this.lastTime = t0;
  }

  /**
   * Calibration hook (spec §5.4): E_ref − M_A (pp) of the dry-forest family reference column at the domain median
   * elevation for the current period-1 forcing (NaN when there is no forest). initialise() warns when the mean over
   * the spin-up's dry period-1 hours exceeds 1.5 pp in magnitude (doc 04 §4.2 step 12: "dry-afternoon bias").
   */
  private calibrationDeviation(w: WeatherHour, F: StepForcing): number {
    if (this.forestRef === undefined) {
      const c = this.cells;
      let n = 0;
      let cRef = 0;
      let wrf = 0;
      let lai = 0;
      for (let k = 0; k < c.n; k++) {
        if (c.fam[k] !== MFam.Forest) continue;
        n++;
        cRef += c.cRef[k]!;
        wrf += c.wrf[k]!;
        lai += c.laiRef[k]!;
      }
      this.forestRef = n > 0 ? { cRef: cRef / n, wrf: wrf / n, lai: lai / n } : null;
    }
    const ref = this.forestRef;
    if (ref === null) return NaN;
    const tC = F.tS - (F.lapse * (this.medianZ - F.zS)) / 1000;
    const td = Math.min(tC, F.tdS - (this.params.dewLapse * (this.medianZ - F.zS)) / 1000);
    const rh = (100 * esatFast(td)) / esatFast(tC);
    const col = columnEmc(
      { tC, rh, direct: F.directRef, diffuse: F.diffuseRef, cover: ref.cRef, lai: ref.lai, sunElevDeg: F.sunElev, uF: litterWind(w.windSpeed10, ref.wrf, this.params), cloudFrac: F.cloudFrac },
      this.params,
    );
    return col.e - forestMoisture(1, tC, rh);
  }

  /** Seed the domain rain history with rain in the 48 h before the spin-up start (hours, else daily at 18:00). */
  private seedRainHistory(series: WeatherSeries, tStart: number, t0: number, lon: number): void {
    const P = this.params;
    const cut = tStart - P.rainWindowH * HOUR_MS;
    for (const h of series.hours) {
      if (h.time > cut && h.time <= tStart && (h.precipitation ?? 0) > 0) {
        this.rain.push({ t: h.time, mm: h.precipitation! });
        if (h.precipitation! > P.rainResetRate) this.tLastRain = h.time;
      }
    }
    if (t0 - series.hours[0]!.time >= 24 * HOUR_MS) return;
    // Short series (replays start at 00:00 of the date): rain of the last two days before the series, assumed to
    // have stopped at 18:00 LMST of its day [H §5.6].
    const firstDay = localSolarDate(series.hours[0]!.time, lon);
    const days: { date: string; rain: number }[] = [];
    if (series.daily && series.daily.length) {
      for (const d of series.daily) if (d.date < firstDay) days.push({ date: d.date, rain: d.rain });
    } else if (series.rainLast20 && series.rainLast20.length) {
      const r = series.rainLast20;
      const y = Date.parse(`${localSolarDate(t0, lon)}T00:00:00Z`);
      for (let i = 1; i <= Math.min(2, r.length); i++) {
        const date = new Date(y - i * 86400000).toISOString().slice(0, 10);
        if (date < firstDay) days.push({ date, rain: r[r.length - i]! });
      }
      days.reverse();
    }
    for (const d of days.slice(-2)) {
      if (!(d.rain > 0)) continue;
      const tStop = Date.parse(`${d.date}T00:00:00Z`) - (lon / 15) * HOUR_MS + P.dailyRainStopHour * HOUR_MS;
      if (tStop <= cut || tStop > tStart) continue;
      this.rain.push({ t: tStop, mm: d.rain });
      if (tStop > this.tLastRain) this.tLastRain = tStop;
    }
    this.rain.sort((a, b) => a.t - b.t);
  }

  /** Spin-up LUT over (moisture family × elevation band × canopy-cover decile), key means of z, cover, LAI, WRF. */
  private buildLut(): { units: UnitSet; keyOf: Int32Array } {
    const P = this.params;
    const c = this.cells;
    const n = c.n;
    const keyOf = new Int32Array(n);
    const index = new Map<number, number>();
    const zMin = this.terrain.minElevation;
    const bins = P.lutCoverBins;
    for (let k = 0; k < n; k++) {
      const band = Math.max(0, Math.floor((c.z[k]! - zMin) / P.lutElevBand));
      const dec = Math.min(bins - 1, Math.floor(c.cover[k]! * bins));
      const key = (band * bins + dec) * 8 + c.fam[k]!;
      let id = index.get(key);
      if (id === undefined) {
        id = index.size;
        index.set(key, id);
      }
      keyOf[k] = id;
    }
    const m = index.size;
    const u = newUnits(m);
    const cnt = new Float64Array(m);
    const acc = new Float64Array(m * 5);
    for (let k = 0; k < n; k++) {
      const id = keyOf[k]!;
      cnt[id]!++;
      acc[id * 5] += c.z[k]!;
      acc[id * 5 + 1] += c.cover[k]!;
      acc[id * 5 + 2] += c.lai[k]!;
      acc[id * 5 + 3] += c.wrf[k]!;
      acc[id * 5 + 4] += c.sC[k]!;
      u.fam[id] = c.fam[k]!;
    }
    for (let id = 0; id < m; id++) {
      const q = 1 / cnt[id]!;
      u.z[id] = acc[id * 5]! * q;
      u.cover[id] = acc[id * 5 + 1]! * q;
      u.lai[id] = acc[id * 5 + 2]! * q;
      u.wrf[id] = acc[id * 5 + 3]! * q;
      u.uFac[id] = 1 / (P.uFDivisor * u.wrf[id]!);
      u.sC[id] = acc[id * 5 + 4]! * q;
      u.hav[id] = NO_POOL;
      u.tauD[id] = diffuseTransmittance(u.cover[id]!, u.lai[id]!, P);
    }
    return { units: u, keyOf };
  }

  private copyLutToCells(lut: { units: UnitSet; keyOf: Int32Array }): void {
    const c = this.cells;
    const u = lut.units;
    for (let k = 0; k < c.n; k++) {
      const id = lut.keyOf[k]!;
      c.mLag[k] = u.mLag[id]!;
      c.lDew[k] = u.lDew[id]!;
      c.hE[k] = u.hE[id]!;
    }
  }

  /** Breakdown of a cell's moisture (explain, spec §5.5 "M − M_A is the teaching content"). */
  breakdown(k: number): MoistureBreakdown {
    const c = this.cells;
    const P = this.params;
    const t = Number.isFinite(this.lastTime) ? this.lastTime : 0;
    const p48t = Math.max(0, this.rain48(t) - c.sC[k]!);
    const rainMem = c.fam[k] === MFam.Heath || c.fam[k] === MFam.None ? 0 : p48t > 0 ? 67.128 * (1 - Math.exp(-3.132 * p48t)) * Math.exp(-0.0858 * c.hE[k]!) : 0;
    const dew = Math.min(P.dewMaxPp, (100 * c.lDew[k]!) / P.dewStoreMm);
    const mEq = Math.max(P.mEqMin, c.afdrs[k]! + c.anomaly[k]!);
    return {
      family: familyName(c.fam[k]! as MFam),
      m: c.field[k]!,
      mA: c.afdrs[k]!,
      anomaly: c.anomaly[k]!,
      mLag: c.mLag[k]!,
      lag: c.mLag[k]! - mEq,
      rainMemory: rainMem,
      dew,
      offset: c.offset[k]!,
      airT: c.airT[k]!,
      airRH: c.airRH[k]!,
      fuelTemp: c.fuelTemp[k]!,
      hoursSinceRainEff: c.hE[k]!,
    };
  }

  /** Snapshot of the model state (typed-array copies). */
  checkpoint(): MoistureCheckpoint {
    const c = this.cells;
    return {
      v: 1,
      mLag: c.mLag.slice(),
      lDew: c.lDew.slice(),
      hE: c.hE.slice(),
      field: c.field.slice(),
      afdrs: c.afdrs.slice(),
      anomaly: c.anomaly.slice(),
      fuelTemp: c.fuelTemp.slice(),
      airT: c.airT.slice(),
      airRH: c.airRH.slice(),
      availability: this.availability.slice(),
      rain: this.rain.map((e) => ({ ...e })),
      tLastRain: this.tLastRain,
      kbdi: this.kbdi,
      df: this.df,
      lastTime: this.lastTime,
      initialised: this.initialised,
      airOffset: [this.airOffsetT, this.airOffsetTd],
      zS: this.zS,
    };
  }

  /** Restore a {@link checkpoint}; output arrays keep their identity (values are copied in). */
  restore(cp: unknown): void {
    const s = cp as MoistureCheckpoint;
    if (!s || s.v !== 1 || s.mLag.length !== this.cells.n) throw new Error('MoistureModel.restore: incompatible checkpoint');
    const c = this.cells;
    c.mLag.set(s.mLag);
    c.lDew.set(s.lDew);
    c.hE.set(s.hE);
    c.field.set(s.field);
    c.afdrs.set(s.afdrs);
    c.anomaly.set(s.anomaly);
    c.fuelTemp.set(s.fuelTemp);
    c.airT.set(s.airT);
    c.airRH.set(s.airRH);
    this.availability.set(s.availability);
    this.rain = s.rain.map((e) => ({ ...e }));
    this.tLastRain = s.tLastRain;
    this.kbdi = s.kbdi;
    this.df = s.df;
    this.lastTime = s.lastTime;
    this.initialised = s.initialised;
    this.airOffsetT = s.airOffset[0];
    this.airOffsetTd = s.airOffset[1];
    this.zS = s.zS;
  }
}

/** Local mean solar calendar date 'yyyy-mm-dd' of a unix ms time. */
function localSolarDate(ms: number, lon: number): string {
  return new Date(ms + (lon / 15) * HOUR_MS).toISOString().slice(0, 10);
}
