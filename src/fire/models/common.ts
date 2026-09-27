/**
 * Shared relationships of the Australian point fire models (spec docs/research/00-synthesis.md §6, §5.9, D2/D3/D8/D9).
 *
 * Units inside the models: wind km/h, ROS m/h, loads t/ha, heights m. All functions are scalar and allocation-free.
 */
import { HEAT_YIELD_KJ_PER_KG } from '../../core/physics';
import { FIRE_MODEL_PARAMS as P } from './params';

/** Byram factor: I (kW/m) = BYRAM·w (t/ha)·ROS (m/h), = 18600·(w/10)·(ROS/3600) = 0.51667·w·ROS [V]. */
export const BYRAM = HEAT_YIELD_KJ_PER_KG / 36000;

/** Byram fireline intensity (kW/m) from the consumed fine fuel w (t/ha) and the spread rate (m/h). */
export const byramIntensity = (wTha: number, rosMh: number): number => BYRAM * wTha * rosMh;

/**
 * Slope factor SF(θ) for a directional slope θ (deg, + upslope):
 * upslope `min(16, 2^(θ/10))` (D2, cap D4); downslope Kataburn `s/(2s − 1)`, `s = 2^(−θ/10)` (D3, ≥ 0.5) [V FBI-TG eq 3.6].
 */
export function slopeFactor(thetaDeg: number): number {
  if (thetaDeg > 0) {
    const s = Math.pow(2, thetaDeg / 10);
    return s < P.slope.sfMax ? s : P.slope.sfMax;
  }
  if (thetaDeg < 0) {
    const s = Math.pow(2, -thetaDeg / 10);
    return s / (2 * s - 1);
  }
  return 1; // θ = 0, and NaN treated as flat (neutral) so hot loops never propagate NaN
}

/** True when the upslope factor reached its cap (a `validated = false` condition, spec §6.12). */
export const slopeFactorCapped = (thetaDeg: number): boolean => thetaDeg > 10 * Math.log2(P.slope.sfMax);

/** Vesta Mk2 dry-forest availability FA = 1.008/(1 + 104.9·e^(−0.9306·DF)) (D8) [UNVERIFIED Mk2 lineage]. */
export const fuelAvailabilityMk2 = (df: number): number => 1.008 / (1 + 104.9 * Math.exp(-0.9306 * df));

/**
 * Wet-forest availability coefficient C1 (D9, constant −0.0175):
 * `clamp(0.1·[(0.0046W² − 0.0079W − 0.0175)·KBDI + (−0.9167W² + 1.5833W + 13.5)], 0, 1)`, W = clamp(wrf, 3, 6).
 */
export function wetForestC1(kbdi: number, wrf: number): number {
  const w = wrf < P.availability.wMin ? P.availability.wMin : wrf > P.availability.wMax ? P.availability.wMax : wrf;
  const c = 0.1 * ((0.0046 * w * w - 0.0079 * w - 0.0175) * kbdi + (-0.9167 * w * w + 1.5833 * w + 13.5));
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/** Wet-forest (and pine) availability FA_wet = FA_dry(C1(KBDI, wrf)·DF) (spec §5.9). */
export const fuelAvailabilityWet = (df: number, kbdi: number, wrf: number): number => fuelAvailabilityMk2(wetForestC1(kbdi, wrf) * df);

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
  rosMh > 0 ? 0.0193 * Math.pow(rosMh, 0.723) * Math.exp(0.64 * hElM) * 1.07 : 0;

/** Shrubland flame height (m) from intensity (kW/m): `e^(−4.142)·I^0.633` (Cruz et al. 2013 via FBI-TG) [V]. */
export const flameHeightShrub = (iKwm: number): number => (iKwm > 0 ? Math.exp(-4.142) * Math.pow(iKwm, 0.633) : 0);

/** Grass flame height (m): `(natural ? 2.66 : 1.12)·(ROS/3600)^0.295` (ROS m/h → bracket in m/s) [V FBI-TG eq 3.19–3.20]. */
export const flameHeightGrass = (rosMh: number, natural: boolean): number =>
  rosMh > 0 ? (natural ? 2.66 : 1.12) * Math.pow(rosMh / 3600, 0.295) : 0;

/** Byram flame length (m) `0.0775·I^0.46`, used only for the refuge-rule display (spec §6.9) [K Byram 1959]. */
export const byramFlameLength = (iKwm: number): number => (iKwm > 0 ? 0.0775 * Math.pow(iKwm, 0.46) : 0);
