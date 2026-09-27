/**
 * "Why" factor decomposition with the generic-fuel reference (spec §6.12, D45).
 *
 * With R(U, M, FA, fuel) the flat head kernel including its R0 floor, `generic` the steady-state type row (generic
 * class, type WRF; grass: natural state at curing 100), M_ref = 10 %, FA_ref = 1 and U the cell's U10 (fire wind):
 * ```
 * base     = R(0, M_ref, 1, generic)                                (m/s; vesta2: 30·φM(10) = 15.43 m/h)
 * wind     = R(U, M_ref, 1, generic) / base
 * fuel     = R(U, M_ref, 1, cell) / R(U, M_ref, 1, generic)       (loads, FHS, heights, WRF, curing, grass state)
 * moisture = R(U, M, FA, cell) / R(U, M_ref, 1, cell)             (includes FA; > 1 when drier than 10 %)
 * ```
 * so base·wind·fuel·moisture = R_w (the cell's flat head rate). fire/spread adds slope, direction and the terrain
 * residual (§7.12); the object API adds slope = SF(θ) and the cap ratio as `terrain`.
 */
import type { CellFuelParams } from '../../core/types';
import { genericCellParams } from './fuelRef';
import { createHeadKernelOut, headRosKernel } from './kernel';

/** Reference moisture (%) and availability of the decomposition (D45). */
export const FACTOR_REF_MOISTURE = 10;
export const FACTOR_REF_AVAILABILITY = 1;

export interface ReferenceFactorsOut {
  /** No-wind rate of the generic fuel at M_ref (m/s). */
  base: number;
  wind: number;
  fuel: number;
  moisture: number;
  /** The cell's flat head rate R(U, M, FA, cell) = base·wind·fuel·moisture (m/h). */
  rw: number;
}

export const createReferenceFactorsOut = (): ReferenceFactorsOut => ({ base: 0, wind: 1, fuel: 1, moisture: 1, rw: 0 });

const K = createHeadKernelOut();

/**
 * Fill the base/wind/fuel/moisture factors of a cell (allocation-free; 4 kernel calls, arrival-time use only).
 * @param generic override of the generic reference (default: {@link genericCellParams}(p.type))
 */
export function referenceFactors(
  p: CellFuelParams, u10kmh: number, mPct: number, fa: number, out: ReferenceFactorsOut, df?: number, generic?: CellFuelParams,
): ReferenceFactorsOut {
  const g = generic ?? genericCellParams(p.type);
  headRosKernel(g, 0, FACTOR_REF_MOISTURE, FACTOR_REF_AVAILABILITY, K, df);
  const base = K.rw;
  headRosKernel(g, u10kmh, FACTOR_REF_MOISTURE, FACTOR_REF_AVAILABILITY, K, df);
  const rGen = K.rw;
  headRosKernel(p, u10kmh, FACTOR_REF_MOISTURE, FACTOR_REF_AVAILABILITY, K, df);
  const rCellRef = K.rw;
  headRosKernel(p, u10kmh, mPct, fa, K, df);
  const rw = K.rw;
  out.base = base / 3600;
  out.wind = base > 0 ? rGen / base : 1;
  out.fuel = rGen > 0 ? rCellRef / rGen : rCellRef > 0 ? Infinity : base > 0 ? 0 : 1;
  out.moisture = rCellRef > 0 ? rw / rCellRef : 1;
  out.rw = rw;
  return out;
}
