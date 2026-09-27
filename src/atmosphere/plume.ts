/**
 * Plume and stability diagnostics (spec §8.10): C-Haines [V Mills & McCaw 2010], Briggs plume rise [K], the 1-D
 * bent-over MTT plume column (P1) and Byram's convective number N_c.
 */
import { CP, G, esat, exner } from '../core/physics';
import { clamp } from '../core/units';
import { ATMOS_PARAMS } from './params';
import { mixingRatioAt, pressureAt, profileWind, thetaRaw, type BackgroundProfile } from './profile';

/** C-Haines: CA = 0.5(T850 − T700) − 2; CB = min(30, T850 − Td850)/3 − 1, halved above 5; CH = CA + CB. */
export function cHaines(t850: number, t700: number, td850: number): { ch: number; ca: number; cb: number } {
  const ca = 0.5 * (t850 - t700) - 2;
  let cb = Math.min(30, t850 - td850) / 3 - 1;
  if (cb > 5) cb = 5 + (cb - 5) / 2;
  return { ch: ca + cb, ca, cb };
}

/** Buoyancy flux F = g·Q_c/(π ρ c_p T) (m⁴/s³) of a convective heat release Q_c (W). */
export const buoyancyFlux = (convectiveW: number, rho: number, tK: number): number => (G * convectiveW) / (Math.PI * rho * CP * tK);

/**
 * Briggs plume rise (m): stable windy 2.6(F/(U N²))^{1/3}, calm 5.0 F^{1/4} N^{−3/4}; the smaller of the two.
 * N = √max(N², 1e-6).
 */
export function briggsRise(convectiveW: number, U: number, n2: number, rho: number, tK: number): { rise: number; windy: number; calm: number; F: number } {
  const F = buoyancyFlux(convectiveW, rho, tK);
  const N2 = Math.max(n2, ATMOS_PARAMS.n2Floor);
  const N = Math.sqrt(N2);
  const windy = U > 0 ? 2.6 * Math.cbrt(F / (U * N2)) : Infinity;
  const calm = 5.0 * F ** 0.25 * N ** -0.75;
  return { rise: Math.min(windy, calm), windy, calm, F };
}

/** Byram convective number N_c = min(100, 2gI/(ρ c_p T·max(U·ê − R, 0.5)³)), I in W/m. */
export function byramNc(intensityWm: number, uAlong: number, ros: number, rho: number, tK: number): number {
  const d = Math.max(uAlong - ros, 0.5);
  return Math.min(100, (2 * G * intensityWm) / (rho * CP * tK * d * d * d));
}

export interface PlumeResult {
  /** Plume top (m ASL) and rise above the source (m). */
  topASL: number;
  rise: number;
  /** Lifting condensation level of the plume parcel (m ASL), NaN when not reached. */
  lclASL: number;
  /** Maximum updraft (m/s) along the column. */
  maxW: number;
  /** Source parameters. */
  F0: number;
  b0: number;
  w0: number;
}

/**
 * 1-D bent-over MTT top-hat plume (Boussinesq), RK2 in z with Δz = 20 m through the stamp's sounding.
 * Fluxes Q = b²w, M = b²w², F = b²w·g′, P = b²w·u_p (vector), W = b²w·q_p; v_e = α|w| + β|U_env − u_p|.
 * @param powerW      total fire heat release P_fire (W); χ_c applied here
 * @param burningArea m² (source radius b₀ = max(30 m, √(A/π)))
 * @param zSource     source ground elevation (m ASL)
 */
export function plumeColumn(p: BackgroundProfile, powerW: number, burningArea: number, zSource: number, rhoSrc: number, tSrcK: number): PlumeResult {
  const P = ATMOS_PARAMS;
  const out: PlumeResult = { topASL: zSource, rise: 0, lclASL: NaN, maxW: 0, F0: 0, b0: 0, w0: 0 };
  if (!(powerW > 0)) return out;
  const F0 = buoyancyFlux(P.chiC * powerW, rhoSrc, tSrcK);
  const b0 = Math.max(P.plumeB0Min, Math.sqrt(Math.max(0, burningArea) / Math.PI));
  const w0 = Math.max(P.plumeW0Min, Math.cbrt(F0 / b0));
  out.F0 = F0;
  out.b0 = b0;
  out.w0 = w0;
  const env = new Float64Array(2);
  const env0 = new Float64Array(2);
  const envAt = (z: number): void => {
    const agl = z - zSource;
    if (agl <= P.firstGuessLow) profileWind(p, Math.max(10, agl), env);
    else {
      const a0 = env0;
      profileWind(p, Math.max(10, agl), a0);
      profileWind(p, Math.max(10, z - p.zgp), env);
      const t = clamp((agl - P.firstGuessLow) / (P.firstGuessHigh - P.firstGuessLow), 0, 1);
      env[0] = a0[0]! * (1 - t) + env[0]! * t;
      env[1] = a0[1]! * (1 - t) + env[1]! * t;
    }
  };
  const z0 = zSource + 10;
  envAt(z0);
  // State: Q, M, F, Pu, Pv, W
  const s = new Float64Array(6);
  s[0] = b0 * b0 * w0;
  s[1] = b0 * b0 * w0 * w0;
  s[2] = F0;
  s[3] = s[0]! * env[0]!;
  s[4] = s[0]! * env[1]!;
  s[5] = s[0]! * mixingRatioAt(p, z0);
  const n2At = (z: number): number => {
    const a = thetaRaw(p, z - 10);
    const b = thetaRaw(p, z + 10);
    return Math.max((G / (0.5 * (a + b))) * ((b - a) / 20), P.n2Floor);
  };
  const deriv = (z: number, y: Float64Array, d: Float64Array): boolean => {
    const Q = y[0]!;
    const M = y[1]!;
    if (!(Q > 0) || !(M > 0)) return false;
    const b = Q / Math.sqrt(M);
    const w = M / Q;
    const up = y[3]! / Q;
    const vp = y[4]! / Q;
    envAt(z);
    const du = env[0]! - up;
    const dv = env[1]! - vp;
    const ve = P.plumeAlpha * Math.abs(w) + P.plumeBeta * Math.hypot(du, dv);
    const ent = 2 * b * ve;
    d[0] = ent;
    d[1] = (Q * y[2]!) / M;
    d[2] = -Q * n2At(z);
    d[3] = ent * env[0]!;
    d[4] = ent * env[1]!;
    d[5] = ent * mixingRatioAt(p, z);
    return true;
  };
  const k1 = new Float64Array(6);
  const k2 = new Float64Array(6);
  const mid = new Float64Array(6);
  const dz = P.plumeDz;
  let z = z0;
  out.maxW = w0;
  for (; z < zSource + P.plumeCap; z += dz) {
    if (!deriv(z, s, k1)) break;
    for (let q = 0; q < 6; q++) mid[q] = s[q]! + 0.5 * dz * k1[q]!;
    if (!deriv(z + 0.5 * dz, mid, k2)) {
      for (let q = 0; q < 6; q++) s[q] = mid[q]!;
      z += 0.5 * dz;
      break;
    }
    for (let q = 0; q < 6; q++) s[q] = s[q]! + dz * k2[q]!;
    const Q = s[0]!;
    const M = s[1]!;
    if (!(M > 0) || !(Q > 0)) {
      z += dz;
      break;
    }
    const w = M / Q;
    if (w > out.maxW) out.maxW = w;
    const zn = z + dz;
    if (Number.isNaN(out.lclASL)) {
      const gp = s[2]! / Q;
      const thE = thetaRaw(p, zn);
      const thP = thE + (gp * thE) / G;
      const pz = pressureAt(p, zn);
      const tpC = thP * exner(pz) - 273.15;
      const es = esat(tpC);
      const qsat = (0.622 * es) / Math.max(1, pz - es);
      if (s[5]! / Q >= qsat) out.lclASL = zn;
    }
    if (w < P.plumeWStop) {
      z += dz;
      break;
    }
  }
  out.topASL = Math.min(z, zSource + P.plumeCap);
  out.rise = out.topASL - zSource;
  return out;
}
