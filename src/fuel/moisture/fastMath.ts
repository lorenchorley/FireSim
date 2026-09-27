/**
 * Tabulated forms of the transcendental functions in the per-cell moisture kernel (spec §13: moisture +
 * insolation ≤ 10–20 ms per 90k-cell update on a phone; spin-up ≤ 1.5 s). Linear interpolation on fine uniform
 * grids; the relative error is < 1e-5 in the fire-weather range (checked in fuelPhysics.test.ts). Arguments outside
 * a table's range are clamped to it (the ranges cover every physical value). Tables are built once per module load
 * (≈ 0.5 MB of Float64).
 */
import { esat } from '../../core/physics';

/** Linear interpolation in a uniform table at fractional index x (clamped to [0, tab.length − 2]). */
export function lerpTable(tab: Float64Array, x: number): number {
  const top = tab.length - 2;
  if (!(x > 0)) x = 0;
  else if (x > top) x = top;
  const i = x | 0;
  const a = tab[i]!;
  return a + (tab[i + 1]! - a) * (x - i);
}

// ── Temperature tables (°C): esat (Bolton) and the Van Wagner temperature factor 0.0579·e^{0.0365T} ─────────────
const T_LO = -60;
const T_HI = 80;
const T_INV = 100; // 0.01 °C
const T_N = Math.round((T_HI - T_LO) * T_INV) + 2;
const ESAT = new Float64Array(T_N);
const RATE_T = new Float64Array(T_N);
for (let i = 0; i < T_N; i++) {
  const t = T_LO + i / T_INV;
  ESAT[i] = esat(t);
  RATE_T[i] = 0.0579 * Math.exp(0.0365 * t);
}

/** esat(T) (hPa, Bolton) by table. */
export const esatFast = (tC: number): number => lerpTable(ESAT, (tC - T_LO) * T_INV);

/** Van Wagner temperature factor 0.0579·e^{0.0365T} by table. */
export const rateTempFast = (tC: number): number => lerpTable(RATE_T, (tC - T_LO) * T_INV);

// ── Humidity tables (H in %, 0.01 % steps): Van Wagner E_d parts and log-rate parts ─────────────────────────────
const H_INV = 100;
const H_N = 100 * H_INV + 2;
/** 0.942H^0.679 + 11e^{(H−100)/10} */
const ED_A = new Float64Array(H_N);
/** 0.18(1 − e^{−0.115H}) */
const ED_B = new Float64Array(H_N);
/** 0.424(1 − (H/100)^1.7) */
const K_A = new Float64Array(H_N);
/** 0.0694(1 − (H/100)^8) */
const K_B = new Float64Array(H_N);
for (let i = 0; i < H_N; i++) {
  const h = Math.min(100, i / H_INV);
  ED_A[i] = 0.942 * h ** 0.679 + 11 * Math.exp((h - 100) / 10);
  ED_B[i] = 0.18 * (1 - Math.exp(-0.115 * h));
  const r = h / 100;
  K_A[i] = 0.424 * (1 - r ** 1.7);
  K_B[i] = 0.0694 * (1 - r ** 8);
}

/**
 * Raw tables for kernels that inline their lookups (TurboFan's inlining budget runs out in a large loop body, and
 * an out-of-line call costs ~10 ns). Index conventions: T tables at (T − tLo)·tInv, clamp [0, tTop]; `edk` holds
 * 4 values per humidity node j = H·hInv (clamp [0, hTop]): [ED_A, ED_B, K_A, K_B]. See also EXPNEG_TABLE.
 */
export const FAST_TABLES = (() => {
  const edk = new Float64Array(4 * H_N);
  for (let i = 0; i < H_N; i++) {
    edk[4 * i] = ED_A[i]!;
    edk[4 * i + 1] = ED_B[i]!;
    edk[4 * i + 2] = K_A[i]!;
    edk[4 * i + 3] = K_B[i]!;
  }
  return Object.freeze({
    tLo: T_LO,
    tInv: T_INV,
    tTop: T_N - 2,
    esat: ESAT,
    rateT: RATE_T,
    hInv: H_INV,
    hTop: H_N - 2,
    edk,
  });
})();

/** Van Wagner E_d(H, T) by table, H in [0, 100] %. */
export function vanWagnerEdFast(h: number, tC: number): number {
  const x = h * H_INV;
  return lerpTable(ED_A, x) + (21.1 - tC) * lerpTable(ED_B, x);
}

/** Van Wagner log rate k(H, √W, T) by table (√W precomputed by the caller, W in km/h). */
export function vanWagnerRateFast(h: number, sqrtWKmh: number, tC: number): number {
  const x = h * H_INV;
  return (lerpTable(K_A, x) + lerpTable(K_B, x) * sqrtWKmh) * rateTempFast(tC);
}

// ── e^{−x} for x ≥ 0 (time-lag relaxation, rain memory) ──────────────────────────────────────────────────────────
const X_INV = 200; // step 0.005
const X_MAX = 40;
const EXPNEG = new Float64Array(X_MAX * X_INV + 2);
for (let i = 0; i < EXPNEG.length; i++) EXPNEG[i] = Math.exp(-i / X_INV);

/** Raw e^{−x} table (see FAST_TABLES). */
export const EXPNEG_TABLE = Object.freeze({ xInv: X_INV, xTop: EXPNEG.length - 2, xMax: X_MAX, table: EXPNEG });

/** e^{−x} for x ≥ 0 by table (relative error < 4e-6; exact 0-limit beyond x = 40 is e^{−40} ≈ 4e-18). */
export const expNegFast = (x: number): number => (x < X_MAX ? lerpTable(EXPNEG, x * X_INV) : 0);

/** Fill `out[j] = e^{a·j·step}` (a ≤ 0) — a per-step table of the canopy beam transmission over LAI. */
export function fillExpTable(out: Float64Array, a: number, step: number): void {
  for (let j = 0; j < out.length; j++) out[j] = Math.exp(a * j * step);
}
