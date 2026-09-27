/**
 * Pure ember physics (spec docs/research/00-synthesis.md §9.2, §9.3, §9.5, §9.6; doc 06 §3.1–§3.3, §3.9).
 *
 * - Terminal velocities of plates and cylinders and the Albini burnout law [V doc 06 §3.1–3.2].
 * - Exact fall distance of a burning brand with v_t = max(f·v_t0, v_t0·(1 − a/τ_b)^n) (§9.3), used by the transport
 *   integrator so burnout-limited fall heights (z* = 0.8005·v_t0·τ_b for E2, z_b = v_t0·τ_b/2 for E4) are exact.
 * - Line-fire buoyancy flux F_L, Briggs final plume rise [P, §8.10 cross-check form], Byram convective number.
 * - Schroeder (1969) ignition probability as coded in behave `ignite.cpp` [V; UNVERIFIED for eucalypt] — the same
 *   formula as `fuel/moisture` `ignitionProbability()` (§5.10), duplicated here so embers do not depend on the
 *   moisture module's file layout (contract note in the final report).
 * - Emission per unit front length (D52).
 */
import { CP, G, HEAT_YIELD_KJ_PER_KG, RHO_REF } from '../core/physics';
import { ALBINI_CD, ALBINI_K, EMBER_PARAMS, type EmberParams } from './params';

/** Flat plate terminal velocity (m/s): v_t = √(2ρ_sδg/(ρ_aC_d)) [V doc 06 eq 2]. */
export function terminalVelocityPlate(rhoS: number, thicknessM: number, rhoA = RHO_REF, cd = ALBINI_CD): number {
  return Math.sqrt((2 * rhoS * thicknessM * G) / (rhoA * cd));
}

/** Cylinder (broadside) terminal velocity (m/s): v_t = √(πρ_sDg/(2C_dρ_a)) [V doc 06 eq 3]. */
export function terminalVelocityCylinder(rhoS: number, diameterM: number, rhoA = RHO_REF, cd = ALBINI_CD): number {
  return Math.sqrt((Math.PI * rhoS * diameterM * G) / (2 * cd * rhoA));
}

/** Albini burnout time τ = 4C_d·v_t0/(πKg) ≈ 24.3·v_t0 (s) [V doc 06 eq 7]. */
export const albiniBurnoutTime = (vt0: number, cd = ALBINI_CD, k = ALBINI_K): number => (4 * cd * vt0) / (Math.PI * k * G);

/** Albini burning fall height z_b = 2C_d·v_t0²/(πKg) = v_t0·τ/2 (m) [V doc 06 eq 7]. */
export const albiniFallHeight = (vt0: number, cd = ALBINI_CD, k = ALBINI_K): number => (2 * cd * vt0 * vt0) / (Math.PI * k * G);

/** r^(n+1) for the three exponents the classes use (avoids Math.pow in the transport loop). */
function powN1(r: number, n: number): number {
  if (r <= 0) return 0;
  if (n === 1) return r * r;
  if (n === 0.5) return r * Math.sqrt(r);
  if (n === 0.25) return r * Math.sqrt(Math.sqrt(r));
  return Math.pow(r, n + 1);
}

/** r^n for the class exponents. */
export function powN(r: number, n: number): number {
  if (r <= 0) return 0;
  if (n === 1) return r;
  if (n === 0.5) return Math.sqrt(r);
  if (n === 0.25) return Math.sqrt(Math.sqrt(r));
  return Math.pow(r, n);
}

/** r^(1/n): the mass ratio below which the v_t floor f applies (f = r^n). */
function floorRatio(floor: number, n: number): number {
  if (floor <= 0) return 0;
  if (n === 1) return floor;
  if (n === 0.5) return floor * floor;
  if (n === 0.25) {
    const f2 = floor * floor;
    return f2 * f2;
  }
  return Math.pow(floor, 1 / n);
}

/**
 * Exact ∫_{a0}^{a1} v_t(a)/v_t0 da (s) for v_t = v_t0·max(floor, (1 − a/τ)^n), a ≤ τ. Multiply by v_t0 (and the
 * density factor) for metres. Beyond τ the brand no longer exists; the integral is cut at τ.
 */
export function fallIntegral(tauB: number, n: number, floor: number, a0: number, a1: number): number {
  if (a1 > tauB) a1 = tauB;
  if (!(a1 > a0)) return 0;
  const rc = floorRatio(floor, n); // (1 − a/τ) below which the floor holds
  const ac = tauB * (1 - rc); // age where the floor starts
  let s = 0;
  const inv = tauB / (n + 1);
  // Power-law part on [a0, min(a1, ac)].
  if (a0 < ac) {
    const b = a1 < ac ? a1 : ac;
    s += inv * (powN1(1 - a0 / tauB, n) - powN1(1 - b / tauB, n));
  }
  // Floor part on [max(a0, ac), a1].
  if (a1 > ac) {
    const b = a0 > ac ? a0 : ac;
    s += floor * (a1 - b);
  }
  return s;
}

/** Fall height from launch to burnout divided by v_t0·τ_b (0.8005 for n = 1/4 with the 0.3 floor; 0.5 for n = 1). */
export const burnoutFallCoefficient = (n: number, floor: number): number => fallIntegral(1, n, floor, 0, 1);

/** Line-fire buoyancy flux F_L = g·χ_c·I/(ρ·c_p·T) (m³/s³), I in kW/m [P doc 06 eq 9, χ_c D27]. */
export function lineBuoyancyFlux(intensityKwM: number, rhoA: number, tK: number, chi: number = EMBER_PARAMS.transport.chi): number {
  return intensityKwM > 0 ? (G * chi * intensityKwM * 1000) / (rhoA * CP * tK) : 0;
}

/** Byram convective number N_c = 2F_L/(U − R)³ (U, R in m/s; U − R floored at 0.1 m/s) [P doc 06 eq 10]. */
export function convectiveNumber(flMsCubed: number, uMs: number, rosMs: number): number {
  const d = Math.max(0.1, uMs - rosMs);
  return (2 * flMsCubed) / (d * d * d);
}

export interface BriggsRise {
  /** Buoyancy flux F = g·Q/(π·ρ·c_p·T) (m⁴/s³) of the heat entering the plume. */
  flux: number;
  /** Stable windy final rise 2.6·(F/(U·N²))^{1/3} (m). */
  windy: number;
  /** Stable calm final rise 5.0·F^{1/4}·N^{−3/4} (m). */
  calm: number;
  /** The smaller of the two (m) [§8.10]. */
  rise: number;
}

/**
 * Briggs (1975) final plume rise for heat `qPlumeW` entering the plume (W, i.e. χ_c·P_fire), wind U (m/s) and
 * Brunt–Väisälä frequency N (s⁻¹; N = √max(N², 1e-6) as §8.2 demands) [P doc 06 eq 12; 2.6 UNVERIFIED].
 * Vectors (§8.10: ρ 1.2, T 293 K): 1 GW, U 5, N 0.01 → F 8837, windy 677 m, calm 1533 m; 10 GW → 1459 m.
 */
export function briggsPlumeRise(qPlumeW: number, uMs: number, nBv: number, rhoA = 1.2, tK = 293): BriggsRise {
  const n = Math.max(nBv, 1e-3);
  const f = qPlumeW > 0 ? (G * qPlumeW) / (Math.PI * rhoA * CP * tK) : 0;
  if (f <= 0) return { flux: 0, windy: 0, calm: 0, rise: 0 };
  const u = Math.max(uMs, 0.5);
  const windy = 2.6 * Math.cbrt(f / (u * n * n));
  const calm = 5.0 * Math.pow(f, 0.25) * Math.pow(n, -0.75);
  return { flux: f, windy, calm, rise: Math.min(windy, calm) };
}

/**
 * Schroeder (1969) / Rothermel (1983) probability of ignition, T_f in °C and M in % [V behave `ignite.cpp`, §5.10].
 * Vectors (T_f 30 °C; M 3, 5, 6, 7, 10, 12, 15, 20, 25 %) = 0.811, 0.610, 0.529, 0.458, 0.293, 0.214, 0.129, 0.049,
 * 0.014; (T_f 20 °C; 5 %, 10 %) = 0.571, 0.267.
 */
export function ignitionProbability(tfC: number, mPct: number): number {
  const m = Math.max(0, mPct) / 100;
  let q = 144.51 - 0.266 * tfC - 0.00058 * tfC * tfC - tfC * m + 18.54 * (1 - Math.exp(-15.1 * m)) + 640 * m;
  if (q > 400) q = 400;
  const x = (400 - q) / 10;
  if (!(x > 0)) return 0;
  const p = (0.000048 * Math.pow(x, 4.3)) / 50;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Bark engagement e_k = clamp((FH − 1)/(h_bark − 1), 0, 1) [A doc 06 §4.2]. */
export function barkEngagement(flameHeightM: number, hBark = EMBER_PARAMS.emission.hBark): number {
  const e = (flameHeightM - 1) / (hBark - 1);
  return e < 0 ? 0 : e > 1 ? 1 : e;
}

/** Spotting onset ramp g(I) = clamp((I − 500)/1500, 0, 1) [A anchored to V]. */
export function onsetRamp(intensityKwM: number, p: EmberParams['emission'] = EMBER_PARAMS.emission): number {
  const g = (intensityKwM - p.onsetI0) / (p.onsetI1 - p.onsetI0);
  return g < 0 ? 0 : g > 1 ? 1 : g;
}

/**
 * Real firebrands emitted per metre of front per second (D52): E0·3^(BH−2)·(I/1000)·e·g (× VLS boost).
 * Reference 10 MW/m, BH 3, e = g = 1 → 9e-5 m⁻¹ s⁻¹ = 324 brands km⁻¹ h⁻¹.
 */
export function emissionPerUnitLength(
  intensityKwM: number,
  barkHazard: number,
  flameHeightM: number,
  p: EmberParams['emission'] = EMBER_PARAMS.emission,
): number {
  return (
    p.e0 *
    p.densityScale *
    Math.pow(p.barkBase, barkHazard - p.barkRef) *
    (intensityKwM / 1000) *
    barkEngagement(flameHeightM, p.hBark) *
    onsetRamp(intensityKwM, p)
  );
}

/** Heat per unit area (kJ/m²) implied by a front of intensity I (kW/m) moving at R (m/s): I/R = H·w. */
export const heatPerArea = (intensityKwM: number, rosMs: number): number => intensityKwM / Math.max(rosMs, 1e-3);

/** Fuel load (t/ha) consumed by a front of intensity I (kW/m) at R (m/s) with the AFDRS heat yield. */
export const loadFromIntensity = (intensityKwM: number, rosMs: number): number =>
  (10 * heatPerArea(intensityKwM, rosMs)) / HEAT_YIELD_KJ_PER_KG;
