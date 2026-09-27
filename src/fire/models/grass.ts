/**
 * CSIRO grassland model (Cheney, Gould & Catchpole 1998; curing Cruz et al. 2015c) — spec §6.5 [V FBI-TG; D13, D21].
 *
 * ```
 * natural:  U < 5 ? 0.054 + 0.269U : 1.4 + 0.838(U − 5)^0.844          (km/h)
 * grazed:   U < 5 ? 0.054 + 0.209U : 1.1 + 0.715(U − 5)^0.844
 * eatenOut: U < 5 ? 0.027 + 0.1045U : 0.55 + 0.357(U − 5)^0.844        (Spark, continuous; FBI-TG form as switch)
 * φM = M < 12 ? e^{−0.108M} : (U10 ≤ 10 ? 0.684 − 0.0342M : 0.547 − 0.0228M), floor 0.001
 * φC = 1.036/(1 + 103.989·e^{−0.0996(C − 20)})
 * ROS = 1000·R·φM·φC·WAF (m/h)
 * ```
 */
import type { GrassState } from '../../core/types';
import { FIRE_MODEL_PARAMS } from './params';

const G = FIRE_MODEL_PARAMS.grass;

/** Grass moisture function φM (M %, U10 km/h) [V FBI-TG eq 3.14–3.16]. */
export function grassPhiM(mPct: number, u10: number): number {
  const v = mPct < 12 ? Math.exp(-0.108 * mPct) : u10 <= 10 ? 0.684 - 0.0342 * mPct : 0.547 - 0.0228 * mPct;
  return v > 0.001 ? v : 0.001;
}

/** Curing function φC (C %) [V FBI-TG eq 3.17, Cruz et al. 2015c]. */
export const grassPhiC = (curingPct: number): number => 1.036 / (1 + 103.989 * Math.exp(-0.0996 * (curingPct - 20)));

/** Grass state from the grass load L = surface + near-surface (t/ha): ≥ 6 natural, ≥ 3 grazed, else eaten-out [V FBI-TG]. */
export const grassStateFromLoad = (lTha: number): GrassState =>
  lTha >= G.naturalMinLoad ? 'natural' : lTha >= G.grazedMinLoad ? 'grazed' : 'eatenOut';

/** Wind function R (km/h, before moisture, curing and WAF) for a grass state. `fbitgLowWind` selects the FBI-TG eaten-out form. */
export function grassWindRate(u10: number, state: GrassState, fbitgLowWind = false): number {
  const u = u10 > 0 ? u10 : 0;
  if (state === 'natural') return u < 5 ? 0.054 + 0.269 * u : 1.4 + 0.838 * Math.pow(u - 5, 0.844);
  if (state === 'grazed') return u < 5 ? 0.054 + 0.209 * u : 1.1 + 0.715 * Math.pow(u - 5, 0.844);
  if (u < 5) return fbitgLowWind ? 0.054 + 0.209 * u : 0.027 + 0.1045 * u;
  return 0.55 + 0.357 * Math.pow(u - 5, 0.844);
}

/** CSIRO grassland head ROS (m/h, flat). */
export function grassRos(u10: number, mPct: number, curingPct: number, state: GrassState, waf: number, fbitgLowWind = false): number {
  return 1000 * grassWindRate(u10, state, fbitgLowWind) * grassPhiM(mPct, u10) * grassPhiC(curingPct) * waf;
}
