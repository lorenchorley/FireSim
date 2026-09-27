/**
 * Fuel availability FA (spec §5.9, D8–D10).
 *
 *   dry forest (vesta2 / moistureFamily forest):  FA_dry = 1.008/(1 + 104.9·e^{−0.9306·DF})      [V Mk2 logistic]
 *   wet forest (WetForest, Rainforest):            FA_wet = FA_dry(C1·DF),
 *       C1 = clamp(0.1·[(0.0046W² − 0.0079W − 0.0175)·KBDI + (−0.9167W² + 1.5833W + 13.5)], 0, 1), W = clamp(wrf, 3, 6)
 *       (constant −0.0175, D9; validated = false if wrf > 5)
 *   topographic blend for wet-forest cells [H D10]: w = smoothstep(0, 30 m, tpiSmall)·a_w,
 *       a_w = isNaN(aspect) ? 0.5 : clamp(0.5 + 0.5·cos(aspect − 315°), 0, 1);  FA = w·FA_dry + (1 − w)·FA_wet
 *   pine: FA_wet with W = wrf;  grass, heath: 1;  none: 0
 *   Vesta 2012 / AFDRS-parity path: dry 0.1·DF; wet min(FA_dry(C1·DF), 0.1·DF)
 */
import type { MoistureFamily } from '../../core/types';
import { DEG, clamp, smoothstep } from '../../core/units';

/** Tunable [H] constants of the §5.9 topographic blend. */
export const AVAILABILITY_PARAMS = Object.freeze({
  /** tpiSmall (m) at which a wet-forest cell counts fully as exposed [H]. */
  blendTpiM: 30,
  /** Aspect of maximum exposure (NW, the hot dry afternoon aspect) [H]. */
  blendAspectDeg: 315,
  /** Neutral aspect weight on flat cells (aspect NaN, spec §0.2). */
  blendFlatAspectWeight: 0.5,
  /** Wet-forest WRF clamp of C1 and the validity edge. */
  wrfMin: 3,
  wrfMax: 6,
  wrfValidatedMax: 5,
});

/** Vesta Mk2 dry-forest availability (D8). Vectors DF 3…10 → 0.136 … 0.998. */
export const fuelAvailabilityMk2 = (df: number): number => 1.008 / (1 + 104.9 * Math.exp(-0.9306 * df));

/** Wet-forest availability coefficient C1(KBDI, WRF) (D9). Vectors C1(100, 5) = 0.430, C1(100, 4) = 0.762. */
export function wetForestC1(kbdi: number, wrf: number, clampW = true): number {
  const w = clampW ? clamp(wrf, AVAILABILITY_PARAMS.wrfMin, AVAILABILITY_PARAMS.wrfMax) : wrf;
  return clamp(0.1 * ((0.0046 * w * w - 0.0079 * w - 0.0175) * kbdi + (-0.9167 * w * w + 1.5833 * w + 13.5)), 0, 1);
}

/** FA_wet = FA_dry(C1·DF). */
export const fuelAvailabilityWet = (df: number, kbdi: number, wrf: number, clampW = true): number =>
  fuelAvailabilityMk2(wetForestC1(kbdi, wrf, clampW) * df);

/** False when the wet-forest C1 is extrapolated (wrf > 5). */
export const wetForestValidated = (wrf: number): boolean => !(wrf > AVAILABILITY_PARAMS.wrfValidatedMax);

/** Topographic blend weight w of a wet-forest cell (flat cell with tpiSmall 30 m → 0.5). */
export function faBlendWeight(tpiSmall: number, aspectDeg: number): number {
  const P = AVAILABILITY_PARAMS;
  const aw = Number.isNaN(aspectDeg) ? P.blendFlatAspectWeight : clamp(0.5 + 0.5 * Math.cos((aspectDeg - P.blendAspectDeg) * DEG), 0, 1);
  return smoothstep(0, P.blendTpiM, Number.isFinite(tpiSmall) ? tpiSmall : 0) * aw;
}

/** FA of a cell for the spread model (Mk2 path). `blendW` is the §5.9 weight (wet-forest cells). */
export function cellAvailability(family: MoistureFamily, df: number, kbdi: number, wrf: number, blendW = 0): number {
  switch (family) {
    case 'forest':
      return fuelAvailabilityMk2(df);
    case 'wetForest': {
      const dry = fuelAvailabilityMk2(df);
      const wet = fuelAvailabilityWet(df, kbdi, wrf);
      return blendW * dry + (1 - blendW) * wet;
    }
    case 'pine':
      return fuelAvailabilityWet(df, kbdi, wrf, false);
    case 'grass':
    case 'heath':
      return 1;
    default:
      return 0;
  }
}

/** FA of the Vesta 2012 / AFDRS-parity path (D8, D41): dry 0.1·DF, wet min(FA_dry(C1·DF), 0.1·DF). */
export function afdrsAvailability(family: MoistureFamily, df: number, kbdi: number, wrf: number): number {
  const lin = clamp(0.1 * df, 0, 1);
  switch (family) {
    case 'forest':
      return lin;
    case 'wetForest':
      return Math.min(fuelAvailabilityWet(df, kbdi, wrf), lin);
    case 'pine':
      return fuelAvailabilityWet(df, kbdi, wrf, false);
    case 'grass':
    case 'heath':
      return 1;
    default:
      return 0;
  }
}
