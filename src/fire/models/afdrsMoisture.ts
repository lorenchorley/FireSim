/**
 * AFDRS-equivalent dead fuel moisture M_A (spec §5.3) for the AFDRS-parity FBI path (D41).
 *
 * The implementation is `afdrsMoisture()` of fuel/moisture (spec §5.11). The provider hook lets a caller substitute
 * another M_A function (tests, what-if views); `null` restores the fuel/moisture one.
 */
import type { MoistureFamily } from '../../core/types';
import { afdrsMoisture } from '../../fuel/moisture/afdrs';

export type AfdrsMoistureFn = (
  family: MoistureFamily, tC: number, rh: number, lmstHour: number, month: number, cloudFrac: number, rain48: number, hoursSinceRain: number,
) => number;

let provider: AfdrsMoistureFn = afdrsMoisture;

/** Substitute the M_A function used by `afdrsFbi` (or restore fuel/moisture's `afdrsMoisture` with `null`). */
export function setAfdrsMoistureProvider(fn: AfdrsMoistureFn | null): void {
  provider = fn ?? afdrsMoisture;
}

/** M_A (%) through the current provider (spec §5.3 signature). */
export const afdrsMoistureFor: AfdrsMoistureFn = (family, tC, rh, lmstHour, month, cloudFrac, rain48, hoursSinceRain) =>
  provider(family, tC, rh, lmstHour, month, cloudFrac, rain48, hoursSinceRain);
