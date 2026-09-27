/**
 * Spread-driver attribution (spec docs/research/00-synthesis.md §7.12) and the arrival factor decomposition
 * (§6.12, D45). Pure functions; the model fills an {@link AttributionInput} at each arrival (and in evaluateCell).
 */
import { SpreadDriver } from '../../core/types';
import { SPREAD_PARAMS } from './params';

/** Everything §7.12 looks at, for one cell at arrival. */
export interface AttributionInput {
  /** Seeded by a spot or debris ignition (the cell was inside the seed radius). */
  seeded: boolean;
  /** R_VLS·|n·t̂| (any rate unit) and the arrival normal speed R (same unit). */
  vlsTerm: number;
  ros: number;
  /** Junction boost (≥ 1). */
  junction: number;
  /** Attachment amplifier gain G (≥ 1). */
  gain: number;
  /** SpreadFactors.direction = R_ell(ψ)/R_H. */
  direction: number;
  /** SpreadFactors.fireWindShare. */
  fireWindShare: number;
  /** SpreadFactors wind, slope, moisture, fuel. */
  wind: number;
  slope: number;
  moisture: number;
  fuel: number;
}

export const createAttributionInput = (): AttributionInput => ({
  seeded: false, vlsTerm: 0, ros: 0, junction: 1, gain: 1, direction: 1, fireWindShare: 0, wind: 1, slope: 1, moisture: 1, fuel: 1,
});

const AT = SPREAD_PARAMS.attribution;
const LN_NONE = Math.log(AT.noneFactor);

/**
 * Driver of a cell's arrival (spec §7.12, first match wins): Spotting (seeded) → LateralVorticity (R_VLS|n·t̂| ≥ 0.3R)
 * → Junction (≥ 1.3) → Eruptive (G ≥ 1.3) → Backing (direction ≤ 0.3) → FireInducedWind (share ≥ 0.3) → the factor
 * rule with ℓ_w = ln max(wind, 1), ℓ_s = ln max(slope, 1), ℓ_m = ln max(moisture, 1) (only when moisture ≥ 1.5),
 * ℓ_f = |ln fuel|: None if all < ln 1.2; WindAndSlope if ℓ_w and ℓ_s are both ≥ 0.4·max; else the largest of
 * Wind / Slope / DryFuel / Fuel.
 */
export function attributeDriver(a: AttributionInput): SpreadDriver {
  if (a.seeded) return SpreadDriver.Spotting;
  if (a.ros > 0 && a.vlsTerm >= AT.vlsShare * a.ros) return SpreadDriver.LateralVorticity;
  if (a.junction >= AT.junction) return SpreadDriver.Junction;
  if (a.gain >= AT.eruptive) return SpreadDriver.Eruptive;
  if (a.direction <= AT.backingDirection) return SpreadDriver.Backing;
  if (a.fireWindShare >= AT.fireWindShare) return SpreadDriver.FireInducedWind;
  const lw = a.wind > 1 ? Math.log(a.wind) : 0;
  const ls = a.slope > 1 ? Math.log(a.slope) : 0;
  const lm = a.moisture >= AT.dryFuelMin ? Math.log(a.moisture) : 0;
  const lf = a.fuel > 0 && Number.isFinite(a.fuel) ? Math.abs(Math.log(a.fuel)) : 0;
  let max = lw;
  let drv = SpreadDriver.Wind;
  if (ls > max) {
    max = ls;
    drv = SpreadDriver.Slope;
  }
  if (lm > max) {
    max = lm;
    drv = SpreadDriver.DryFuel;
  }
  if (lf > max) {
    max = lf;
    drv = SpreadDriver.Fuel;
  }
  if (max < LN_NONE) return SpreadDriver.None;
  if (lw >= AT.pairShare * max && ls >= AT.pairShare * max) return SpreadDriver.WindAndSlope;
  return drv;
}
