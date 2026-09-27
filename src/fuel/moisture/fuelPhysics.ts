/**
 * Point physics of the dead-fuel-moisture model (spec §5.4, §5.5, §5.10): canopy transmittance, fuel temperature,
 * Van Wagner (1987) equilibrium moisture and drying/wetting rates, the time-lag ratio f_τ, rain and dew memory, the
 * physical anomaly of a cell against its family reference column, and the Schroeder (1969) ignition probability.
 *
 * These are the exact (Math.*) forms, used by tests, explain and the embers module. The per-cell kernel in
 * `model.ts` evaluates the same equations through the tables of `fastMath.ts`.
 */
import { esat } from '../../core/physics';
import { clamp, smoothstep } from '../../core/units';
import { MOISTURE_PARAMS, type MoistureParams } from './params';

// ─────────────────────────────────────────────────────────────────────────────
// Van Wagner (1987) EMC and log rates [V doc 04 §3.4–3.5]
// ─────────────────────────────────────────────────────────────────────────────

/** Van Wagner drying EMC E_d (%) at fuel-level RH h (%) and temperature (°C). */
export function vanWagnerEd(h: number, tC: number): number {
  return 0.942 * h ** 0.679 + 11 * Math.exp((h - 100) / 10) + 0.18 * (21.1 - tC) * (1 - Math.exp(-0.115 * h));
}

/** Van Wagner wetting EMC E_w (%) (reference only: hysteresis is not modelled, spec §5.5). */
export function vanWagnerEw(h: number, tC: number): number {
  return 0.618 * h ** 0.753 + 10 * Math.exp((h - 100) / 10) + 0.18 * (21.1 - tC) * (1 - Math.exp(-0.115 * h));
}

/**
 * Van Wagner log drying rate k (1/day-ish units, only ratios are used) at RH h (%), 10 m wind W (km/h), T (°C):
 * k = [0.424(1 − (h/100)^1.7) + 0.0694√W(1 − (h/100)^8)]·0.0579·e^{0.0365T}. Wetting: call with h → 100 − h.
 */
export function vanWagnerRate(h: number, wKmh: number, tC: number): number {
  const r = clamp(h, 0, 100) / 100;
  const r8 = r * r * r * r * r * r * r * r;
  return (0.424 * (1 - r ** 1.7) + 0.0694 * Math.sqrt(Math.max(0, wKmh)) * (1 - r8)) * 0.0579 * Math.exp(0.0365 * tC);
}

/** k at the f_τ reference state (30 %, 5 km/h, 30 °C by default). */
export function referenceRate(p: MoistureParams = MOISTURE_PARAMS): number {
  return vanWagnerRate(p.fTauRefH, p.fTauRefWKmh, p.fTauRefT);
}

/**
 * Time-lag rate ratio f_τ = k_ref / k(H_f, U10, T_f), clamped [0.3, 5] (spec §5.5). `wetting` evaluates k with
 * H → 100 − H (Van Wagner wetting rate). Vectors: (30, 5, 30) → 1.000; (15, 20, 35) → 0.609; (80, 2, 12) → 4.693.
 */
export function timeLagRatio(hF: number, u10Kmh: number, tfC: number, wetting = false, p: MoistureParams = MOISTURE_PARAMS): number {
  const k = vanWagnerRate(wetting ? 100 - hF : hF, u10Kmh, tfC);
  return clamp(referenceRate(p) / Math.max(k, 1e-9), p.fTauMin, p.fTauMax);
}

/** Exact relaxation of M_lag towards M_eq over dt (s): τ = f_τ·(drying ? 1.5 h : 2 h). */
export function relaxMoisture(mLag: number, mEq: number, fTau: number, dtS: number, p: MoistureParams = MOISTURE_PARAMS): number {
  const tauS = fTau * (mLag > mEq ? p.tauDry : p.tauWet) * 3600;
  return mEq + (mLag - mEq) * Math.exp(-dtS / tauS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canopy transmittance and fuel temperature [K form doc 04 §3.7, H coefficients]
// ─────────────────────────────────────────────────────────────────────────────

/** Beam transmittance τ_b = (1 − c) + c·exp(−0.4·LAI / max(0.1, sin h)). */
export function beamTransmittance(cover: number, lai: number, sunElevDeg: number, p: MoistureParams = MOISTURE_PARAMS): number {
  const s = Math.max(p.sinSunFloor, Math.sin((sunElevDeg * Math.PI) / 180));
  return 1 - cover + cover * Math.exp((-p.beamExtinction * lai) / s);
}

/** Diffuse transmittance τ_d = (1 − c) + c·exp(−0.8·LAI). */
export function diffuseTransmittance(cover: number, lai: number, p: MoistureParams = MOISTURE_PARAMS): number {
  return 1 - cover + cover * Math.exp(-p.diffuseExtinction * lai);
}

/** Night long-wave cooling ΔT_LW (K): −(3(1 − c) + 0.5c)(1 − cloud) when the sun is down, else 0. */
export function longwaveCooling(cover: number, sunElevDeg: number, cloudFrac: number, p: MoistureParams = MOISTURE_PARAMS): number {
  if (sunElevDeg >= 0) return 0;
  return -(p.lwCoolOpen * (1 - cover) + p.lwCoolCanopy * cover) * (1 - clamp(cloudFrac, 0, 1));
}

/** Litter-level wind u_f = U10 / (2·WRF) (m/s) [H]. */
export const litterWind = (u10: number, wrf: number, p: MoistureParams = MOISTURE_PARAMS): number => u10 / (p.uFDivisor * Math.max(wrf, 1e-3));

/** Fuel-surface temperature T_f = T + a_s·S_f/(1 + b_u·u_f) + ΔT_LW (°C). */
export function fuelTemperature(tC: number, sF: number, uF: number, dTlw: number, p: MoistureParams = MOISTURE_PARAMS): number {
  return tC + (p.aS * sF) / (1 + p.bU * uF) + dTlw;
}

/** Fuel-level humidity H_f = clamp(100·e/esat(T_f), 1, 100) with e the air vapour pressure (hPa). */
export const fuelHumidity = (eHpa: number, tfC: number): number => clamp((100 * eHpa) / esat(tfC), 1, 100);

// ─────────────────────────────────────────────────────────────────────────────
// Physical anomaly A (spec §5.4, D17)
// ─────────────────────────────────────────────────────────────────────────────

/** Inputs of one fuel column (cell or family reference) for {@link columnEmc}. */
export interface ColumnInput {
  /** Air temperature (°C) and RH (%) at the cell. */
  tC: number;
  rh: number;
  /** Beam and diffuse shortwave reaching the top of the canopy on the (sloping) surface (W/m²). */
  direct: number;
  diffuse: number;
  cover: number;
  lai: number;
  sunElevDeg: number;
  /** Litter-level wind (m/s). */
  uF: number;
  cloudFrac: number;
}

/** Fuel temperature, fuel-level RH and Van Wagner E_d of a column. */
export function columnEmc(c: ColumnInput, p: MoistureParams = MOISTURE_PARAMS): { sF: number; tF: number; hF: number; e: number } {
  const tb = c.sunElevDeg > 0 ? beamTransmittance(c.cover, c.lai, c.sunElevDeg, p) : 0;
  const td = diffuseTransmittance(c.cover, c.lai, p);
  const sF = tb * c.direct + td * c.diffuse;
  const tF = fuelTemperature(c.tC, sF, c.uF, longwaveCooling(c.cover, c.sunElevDeg, c.cloudFrac, p), p);
  const hF = fuelHumidity((c.rh / 100) * esat(c.tC), tF);
  return { sF, tF, hF, e: vanWagnerEd(hF, tF) };
}

/** Drought damping of terrain contrasts: 1 − 0.5·smoothstep(8, 10, DF) [H doc 04 §4.2 step 9]. */
export const droughtDamping = (df: number, p: MoistureParams = MOISTURE_PARAMS): number =>
  1 - p.droughtDampMax * smoothstep(p.droughtDampDfLo, p.droughtDampDfHi, df);

/** Gully wetness offset G (pp, vesta2 families only) before the KBDI fade; `isGully` = Landform Gully/ValleyFloor. */
export const gullyOffsetBase = (tpiSmall: number, isGully: boolean, p: MoistureParams = MOISTURE_PARAMS): number =>
  isGully ? p.gullyMaxPp * clamp(-tpiSmall / p.gullyTpiM, 0, 1) : 0;

/** KBDI fade of the gully offset: 1 − smoothstep(100, 150, KBDI). */
export const gullyKbdiFade = (kbdi: number, p: MoistureParams = MOISTURE_PARAMS): number =>
  1 - smoothstep(p.gullyKbdiLo, p.gullyKbdiHi, kbdi);

// ─────────────────────────────────────────────────────────────────────────────
// Rain and dew memory (spec §5.5)
// ─────────────────────────────────────────────────────────────────────────────

/** Canopy interception capacity S_c = 0.5 + 1.0·c (mm) [H]. */
export const interceptionCapacity = (cover: number, p: MoistureParams = MOISTURE_PARAMS): number => p.interceptBase + p.interceptPerCover * cover;

/** Rate of the effective hours-since-rain clock: clamp(1 + (S_f − 200)/400, 0.5, 2) h per hour. */
export const dryingClockRate = (sF: number, p: MoistureParams = MOISTURE_PARAMS): number =>
  clamp(1 + (sF - p.heSfRef) / p.heSfScale, p.heRateMin, p.heRateMax);

/** Rain memory R_mem (pp) from 48 h throughfall P48_t (mm) and the effective hours since rain h_e. */
export const rainMemory = (p48Throughfall: number, hE: number): number =>
  p48Throughfall > 0 ? 67.128 * (1 - Math.exp(-3.132 * p48Throughfall)) * Math.exp(-0.0858 * Math.max(0, hE)) : 0;

/** New dew store L_dew (mm) after dt_h hours at fuel temperature T_f, dew point T_d and fuel-level shortwave S_f. */
export function dewStore(lDew: number, tfC: number, tdC: number, sF: number, dtH: number, p: MoistureParams = MOISTURE_PARAMS): number {
  if (tfC < tdC) return lDew + Math.min(p.dewRateMax, p.dewRateCoef * (tdC - tfC)) * dtH;
  if (tfC > tdC) return Math.max(0, lDew - p.dewDryBase * (1 + sF / p.dewDrySf) * dtH);
  return lDew;
}

/** Dew moisture term D = min(40, 100·L_dew/0.3) pp. */
export const dewTerm = (lDew: number, p: MoistureParams = MOISTURE_PARAMS): number => Math.min(p.dewMaxPp, (100 * lDew) / p.dewStoreMm);

// ─────────────────────────────────────────────────────────────────────────────
// Ignition probability (spec §5.10) [V Schroeder 1969 as coded in behave ignite.cpp; UNVERIFIED for eucalypt]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Probability (0–1) that a firebrand ignites fine dead fuel at fuel temperature T_f (°C) and moisture M (%).
 * Vectors (T_f 30 °C): M 3 → 0.811, 6 → 0.529, 10 → 0.293, 20 → 0.049.
 */
export function ignitionProbability(tfC: number, mPct: number): number {
  const m = Math.max(0, mPct) / 100;
  let q = 144.51 - 0.266 * tfC - 0.00058 * tfC * tfC - tfC * m + 18.54 * (1 - Math.exp(-15.1 * m)) + 640 * m;
  if (q > 400) q = 400;
  const x = (400 - q) / 10;
  if (!(x > 0)) return 0;
  return clamp((0.000048 * x ** 4.3) / 50, 0, 1);
}
