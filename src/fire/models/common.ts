/**
 * Shared relationships of the Australian point fire models (spec docs/research/00-synthesis.md §6, §5.9, D2/D3/D8/D9).
 *
 * Units inside the models: wind km/h, ROS m/h, loads t/ha, heights m. All functions are scalar and allocation-free.
 */
import { HEAT_YIELD_KJ_PER_KG } from '../../core/physics';
import { fuelAvailabilityWet } from '../../fuel/moisture/availability';
import { FIRE_MODEL_PARAMS as P } from './params';

/** Byram factor: I (kW/m) = BYRAM·w (t/ha)·ROS (m/h), = 18600·(w/10)·(ROS/3600) = 0.51667·w·ROS [V]. */
export const BYRAM = HEAT_YIELD_KJ_PER_KG / 36000;

/** x^a for x > 0 as exp(a·ln x) (≈ 2× faster than Math.pow in V8); 0 for x ≤ 0 (a > 0 assumed). */
export const powPos = (x: number, a: number): number => (x > 0 ? Math.exp(a * Math.log(x)) : 0);

/** Byram fireline intensity (kW/m) from the consumed fine fuel w (t/ha) and the spread rate (m/h). */
export const byramIntensity = (wTha: number, rosMh: number): number => BYRAM * wTha * rosMh;

const LN2_10 = Math.LN2 / 10;

/**
 * Slope factor SF(θ) for a directional slope θ (deg, + upslope):
 * upslope `min(16, 2^(θ/10))` (D2, cap D4); downslope Kataburn `s/(2s − 1)`, `s = 2^(−θ/10)` (D3, ≥ 0.5) [V FBI-TG eq 3.6].
 */
export function slopeFactor(thetaDeg: number): number {
  if (thetaDeg > 0) {
    const s = Math.exp(thetaDeg * LN2_10);
    return s < P.slope.sfMax ? s : P.slope.sfMax;
  }
  if (thetaDeg < 0) {
    const s = Math.exp(-thetaDeg * LN2_10);
    return s / (2 * s - 1);
  }
  return 1; // θ = 0, and NaN treated as flat (neutral) so hot loops never propagate NaN
}

/** True when the upslope factor reached its cap (a `validated = false` condition, spec §6.12). */
export const slopeFactorCapped = (thetaDeg: number): boolean => thetaDeg > 10 * Math.log2(P.slope.sfMax);

/**
 * Fuel availability (spec §5.9, D8/D9): the Mk2 logistic FA_dry(DF), the wet-forest C1(KBDI, WRF) with W = clamp(wrf,
 * 3, 6) and FA_wet = FA_dry(C1·DF). Single source: fuel/moisture (the moisture module owns §5.9; the spread path uses
 * its per-cell field, the object API these same functions).
 */
export { fuelAvailabilityMk2, wetForestC1, fuelAvailabilityWet } from '../../fuel/moisture/availability';

/** True when the wet-forest C1 is used outside its published domain W ∈ [3, 5] (FBI-TG). */
export const wetC1OutOfDomain = (wrf: number): boolean => wrf < 3 || wrf > 5;

/** AFDRS-parity (Vesta 2012) availability: dry `0.1·DF`; wet `min(FA_dry(C1·DF), 0.1·DF)` (D8, doc 03 §3.4). */
export function fuelAvailabilityAfdrs(df: number, wet: boolean, kbdi: number, wrf: number): number {
  const lin = 0.1 * df;
  const fa = wet ? Math.min(fuelAvailabilityWet(df, kbdi, wrf), lin) : lin;
  return fa < 0 ? 0 : fa > 1 ? 1 : fa;
}

/** Vesta flame height (m), FBI-TG eq 3.59 [V]: `0.0193·ROS^0.723·e^(0.64·H_el)·1.07` (ROS m/h, H_el m). */
export const flameHeightVesta = (rosMh: number, hElM: number): number =>
  rosMh > 0 ? 0.0193 * 1.07 * Math.exp(0.723 * Math.log(rosMh) + 0.64 * hElM) : 0;

/** Shrubland flame height (m) from intensity (kW/m): `e^(−4.142)·I^0.633` (Cruz et al. 2013 via FBI-TG) [V]. */
export const flameHeightShrub = (iKwm: number): number => (iKwm > 0 ? Math.exp(-4.142 + 0.633 * Math.log(iKwm)) : 0);

/** Grass flame height (m): `(natural ? 2.66 : 1.12)·(ROS/3600)^0.295` (ROS m/h → bracket in m/s) [V FBI-TG eq 3.19–3.20]. */
export const flameHeightGrass = (rosMh: number, natural: boolean): number =>
  rosMh > 0 ? (natural ? 2.66 : 1.12) * Math.exp(0.295 * Math.log(rosMh / 3600)) : 0;

/** Byram flame length (m) `0.0775·I^0.46`, used only for the refuge-rule display (spec §6.9) [K Byram 1959]. */
export const byramFlameLength = (iKwm: number): number => (iKwm > 0 ? 0.0775 * Math.exp(0.46 * Math.log(iKwm)) : 0);
