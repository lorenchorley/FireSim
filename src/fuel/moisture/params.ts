/**
 * Tunable constants of the dead-fuel-moisture module (spec docs/research/00-synthesis.md §5, §0.1).
 *
 * Every [H] (FireSim heuristic) or UNVERIFIED number of §5 lives here, with its source tag, so it can be tuned and
 * listed (§16 item 8). [V]/[K] equation coefficients (AFDRS moisture regressions, Van Wagner EMC, KBDI, Griffiths
 * drought factor, Mk2 availability, Schroeder P_ig) are hard-coded next to their equations instead.
 */

export interface MoistureParams {
  // ── §5.2 air temperature / humidity at each cell (D43) ───────────────────────────────────────────────────────
  /** Night / stable lapse rate Γ (K/km) [K doc 04 §4.2]. */
  lapseNight: number;
  /** Daytime lapse rate when the mixed layer spans the relief (K/km): dry adiabatic 9.8 [D43, H]. */
  lapseDay: number;
  /** Sun-elevation edges (deg) of the day-lapse switch smoothstep(lo, hi, h_sun) [H D43]. */
  lapseSunLoDeg: number;
  lapseSunHiDeg: number;
  /** BLH edges as multiples of the domain relief: smoothstep(lo·relief, hi·relief, BLH) [H D43]. */
  lapseBlhLo: number;
  lapseBlhHi: number;
  /** Boundary-layer height assumed by day when the weather has none (m) [H D43]. */
  blhDefault: number;
  /** Dew-point lapse rate (K/km) [K doc 04 §4.2]. */
  dewLapse: number;
  // ── §5.3 AFDRS period rule ───────────────────────────────────────────────────────────────────────────────────
  /** Forest period 1 needs cloud fraction below this [H]. */
  period1CloudMax: number;
  // ── §5.4 physical anomaly (doc 04 §3.4–3.7, calibration H; UNVERIFIED §16 item 8) ─────────────────────────────
  /** a_s: fuel-temperature excess per unit fuel-level shortwave (K m²/W) [H]. */
  aS: number;
  /** b_u: wind cooling of the fuel temperature excess (s/m) [H]. */
  bU: number;
  /** G·Ω beam extinction of eucalypt foliage in τ_b = (1 − c) + c·exp(−gOmega·LAI/sin h) [K form, H value]. */
  beamExtinction: number;
  /** Diffuse extinction in τ_d = (1 − c) + c·exp(−k_d·LAI) [K form, H value]. */
  diffuseExtinction: number;
  /** Floor of sin h in the beam path length. */
  sinSunFloor: number;
  /** Litter-level wind u_f = U10 / (uFDivisor·WRF) (m/s) [H]. */
  uFDivisor: number;
  /** Night long-wave fuel cooling in the open / under full canopy (K), × (1 − cloud) [H doc 04 §3.7]. */
  lwCoolOpen: number;
  lwCoolCanopy: number;
  /** Drought damping of terrain contrasts: A × (1 − dampMax·smoothstep(dfLo, dfHi, DF)) [H doc 04 §4.2 step 9]. */
  droughtDampMax: number;
  droughtDampDfLo: number;
  droughtDampDfHi: number;
  /** Gully offset G = gullyMaxPp·clamp(−tpiSmall/gullyTpiM, 0, 1)·[Gully|ValleyFloor]·(1 − smoothstep(kLo, kHi, KBDI)) [H]. */
  gullyMaxPp: number;
  gullyTpiM: number;
  gullyKbdiLo: number;
  gullyKbdiHi: number;
  /** Calibration hook: warn when the family reference column departs from M_A by more than this in period 1 (pp). */
  calibrationWarnPp: number;
  // ── §5.5 time lag, rain and dew ──────────────────────────────────────────────────────────────────────────────
  /** Base time lag drying (M_lag > M_eq) / wetting (h) [H doc 04 §3.5]. */
  tauDry: number;
  tauWet: number;
  /** Clamp of the Van Wagner rate ratio f_τ [H]. */
  fTauMin: number;
  fTauMax: number;
  /** Reference state of f_τ: k(refH %, refWKmh km/h, refT °C) [H]. */
  fTauRefH: number;
  fTauRefWKmh: number;
  fTauRefT: number;
  /** Floor of the equilibrium moisture M_eq = max(mEqMin, M_A + A) (%). */
  mEqMin: number;
  /** Canopy interception capacity S_c = interceptBase + interceptPerCover·c (mm) [H doc 04 §4.2 step 6]. */
  interceptBase: number;
  interceptPerCover: number;
  /** A step resets the hours-since-rain clock when its throughfall rate exceeds this (mm/h) [H]. */
  rainResetRate: number;
  /** Effective drying clock dh_e/dt = clamp(1 + (S_f − heSfRef)/heSfScale, heRateMin, heRateMax) [H]. */
  heSfRef: number;
  heSfScale: number;
  heRateMin: number;
  heRateMax: number;
  /** Rain window of P48 (h) [V heath MC2]. */
  rainWindowH: number;
  /** Dew deposition min(dewRateMax, dewRateCoef·(T_d − T_f)) mm/h; drying dewDryBase·(1 + S_f/dewDrySf) mm/h [H doc 04 §3.8]. */
  dewRateMax: number;
  dewRateCoef: number;
  dewDryBase: number;
  dewDrySf: number;
  /** Dew term D = min(dewMaxPp, 100·L_dew/dewStoreMm) pp (w_s = 0.3 kg/m² surface layer) [H]. */
  dewStoreMm: number;
  dewMaxPp: number;
  /** Final clamp of M (%). */
  mMin: number;
  mMax: number;
  // ── §5.6 spin-up ─────────────────────────────────────────────────────────────────────────────────────────────
  /** Spin-up length before t0 (h) and the final per-cell window (h). */
  spinUpHours: number;
  perCellHours: number;
  /** Spin-up step (h): 1 per spec §5.6; 2 halves the start-up cost on slow devices (performance lever, §13). */
  spinUpStepH: number;
  /** Use the (family × elevation band × cover decile) look-up table before the per-cell window. */
  spinUpLut: boolean;
  /** LUT elevation band (m) and canopy-cover bins. */
  lutElevBand: number;
  lutCoverBins: number;
  /** Local mean solar hour at which daily rain is assumed to have stopped (short series fallback) [H]. */
  dailyRainStopHour: number;
  /** Stable-night sub-step during spin-up (s). */
  nightSubStepS: number;
}

export const MOISTURE_PARAMS: Readonly<MoistureParams> = Object.freeze({
  lapseNight: 6.5,
  lapseDay: 9.8,
  lapseSunLoDeg: 5,
  lapseSunHiDeg: 15,
  lapseBlhLo: 0.75,
  lapseBlhHi: 1.25,
  blhDefault: 1500,
  dewLapse: 1.8,
  period1CloudMax: 0.6,
  aS: 0.02,
  bU: 0.5,
  beamExtinction: 0.4,
  diffuseExtinction: 0.8,
  sinSunFloor: 0.1,
  uFDivisor: 2,
  lwCoolOpen: 3,
  lwCoolCanopy: 0.5,
  droughtDampMax: 0.5,
  droughtDampDfLo: 8,
  droughtDampDfHi: 10,
  gullyMaxPp: 3,
  gullyTpiM: 20,
  gullyKbdiLo: 100,
  gullyKbdiHi: 150,
  calibrationWarnPp: 1.5,
  tauDry: 1.5,
  tauWet: 2.0,
  fTauMin: 0.3,
  fTauMax: 5,
  fTauRefH: 30,
  fTauRefWKmh: 5,
  fTauRefT: 30,
  mEqMin: 2,
  interceptBase: 0.5,
  interceptPerCover: 1.0,
  rainResetRate: 0.2,
  heSfRef: 200,
  heSfScale: 400,
  heRateMin: 0.5,
  heRateMax: 2,
  rainWindowH: 48,
  dewRateMax: 0.09,
  dewRateCoef: 0.02,
  dewDryBase: 0.1,
  dewDrySf: 300,
  dewStoreMm: 0.3,
  dewMaxPp: 40,
  mMin: 2,
  mMax: 250,
  spinUpHours: 168,
  perCellHours: 48,
  spinUpStepH: 1,
  spinUpLut: true,
  lutElevBand: 25,
  lutCoverBins: 10,
  dailyRainStopHour: 18,
  nightSubStepS: 600,
});

/** MOISTURE_PARAMS with overrides. */
export function moistureParams(over?: Partial<MoistureParams>): MoistureParams {
  return { ...MOISTURE_PARAMS, ...(over ?? {}) };
}
