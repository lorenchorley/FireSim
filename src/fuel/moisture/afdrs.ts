/**
 * AFDRS-equivalent dead fine fuel moisture M_A per moisture family (spec §5.3) [V doc 03 §3.2, doc 04 §3.2;
 * FBI Technical Guide eq 3.48 ff]. Evaluated at the cell's air temperature and humidity; the physics clock is local
 * mean solar time (D37) and the forest period-1 window is 12 ≤ LMST < 17 (D47).
 */
import type { MoistureFamily } from '../../core/types';
import { MOISTURE_PARAMS } from './params';

/** Numeric moisture-family codes used in the per-cell hot loops. */
export enum MFam {
  None = 0,
  Forest = 1,
  WetForest = 2,
  Heath = 3,
  Grass = 4,
  Pine = 5,
}

const FAMILY_CODE: Record<MoistureFamily, MFam> = {
  none: MFam.None,
  forest: MFam.Forest,
  wetForest: MFam.WetForest,
  heath: MFam.Heath,
  grass: MFam.Grass,
  pine: MFam.Pine,
};
const FAMILY_NAME: MoistureFamily[] = ['none', 'forest', 'wetForest', 'heath', 'grass', 'pine'];

export const familyCode = (f: MoistureFamily): MFam => FAMILY_CODE[f] ?? MFam.None;
export const familyName = (c: MFam): MoistureFamily => FAMILY_NAME[c] ?? 'none';

/** True for the Oct–Mar fire-season months (local month 1–12). */
export const isSummerHalf = (month: number): boolean => month >= 10 || month <= 3;

/** True in the AFDRS "night" window: LMST < 7 or LMST ≥ 19. */
export const isAfdrsNight = (lmstHour: number): boolean => lmstHour < 7 || lmstHour >= 19;

/**
 * Dry-forest (Vesta) moisture period (domain level, spec §5.3): 1 = sunny summer afternoon (Oct–Mar,
 * 12 ≤ LMST < 17, cloud < 60 % [cloud test H]); 3 = night (LMST < 7 or ≥ 19); 2 otherwise.
 */
export function forestPeriod(lmstHour: number, month: number, cloudFrac: number, cloudMax = MOISTURE_PARAMS.period1CloudMax): 1 | 2 | 3 {
  if (isAfdrsNight(lmstHour)) return 3;
  if (isSummerHalf(month) && lmstHour >= 12 && lmstHour < 17 && !(cloudFrac >= cloudMax)) return 1;
  return 2;
}

/** Vesta dry-forest regressions by period (%). */
export function forestMoisture(period: 1 | 2 | 3, tC: number, rh: number): number {
  if (period === 1) return 2.76 + 0.124 * rh - 0.0187 * tC;
  if (period === 3) return 3.08 + 0.198 * rh - 0.0483 * tC;
  return 3.6 + 0.169 * rh - 0.045 * tC;
}

/** Wet forest (never period 1): day = period 2, night = period 3 (%). */
export const wetForestMoisture = (night: boolean, tC: number, rh: number): number => forestMoisture(night ? 3 : 2, tC, rh);

/** AFDRS heath MC1 (%): 4.37 + 0.161RH − 0.1(T − 25) − 0.027RH·[RH ≤ 60]. */
export const heathMc1 = (tC: number, rh: number): number => 4.37 + 0.161 * rh - 0.1 * (tC - 25) - (rh <= 60 ? 0.027 * rh : 0);

/** AFDRS heath rain term MC2 (%): 67.128(1 − e^{−3.132·P48})·e^{−0.0858·h_r} (e-folding 11.7 h). */
export function rainMemoryMc2(rain48: number, hoursSinceRain: number): number {
  if (!(rain48 > 0)) return 0;
  const h = hoursSinceRain > 0 ? hoursSinceRain : 0;
  return 67.128 * (1 - Math.exp(-3.132 * rain48)) * Math.exp(-0.0858 * h);
}

/** CSIRO grass moisture (%): max(5, 9.58 − 0.205T + 0.138RH). */
export const grassMoisture = (tC: number, rh: number): number => Math.max(5, 9.58 - 0.205 * tC + 0.138 * rh);

/** Pine (%): 4.3426 + 0.1188RH − 0.0211T. */
export const pineMoisture = (tC: number, rh: number): number => 4.3426 + 0.1188 * rh - 0.0211 * tC;

/**
 * AFDRS-equivalent moisture M_A (%) for a family at air T (°C), RH (%), local mean solar hour, local month,
 * cloud fraction (0–1), rain in the last 48 h (mm) and hours since it stopped (heath MC2 only). 'none' → 0.
 */
export function afdrsMoisture(
  family: MoistureFamily,
  tC: number,
  rh: number,
  lmstHour: number,
  month: number,
  cloudFrac: number,
  rain48: number,
  hoursSinceRain: number,
): number {
  return afdrsMoistureCode(familyCode(family), tC, rh, forestPeriod(lmstHour, month, cloudFrac), isAfdrsNight(lmstHour), rainMemoryMc2(rain48, hoursSinceRain));
}

/** Hot-loop form: family code, precomputed forest period, night flag and heath MC2 (domain level). */
export function afdrsMoistureCode(fam: MFam, tC: number, rh: number, period: 1 | 2 | 3, night: boolean, mc2: number): number {
  switch (fam) {
    case MFam.Forest:
      return forestMoisture(period, tC, rh);
    case MFam.WetForest:
      return wetForestMoisture(night, tC, rh);
    case MFam.Heath:
      return heathMc1(tC, rh) + mc2;
    case MFam.Grass:
      return grassMoisture(tC, rh);
    case MFam.Pine:
      return pineMoisture(tC, rh);
    default:
      return 0;
  }
}
