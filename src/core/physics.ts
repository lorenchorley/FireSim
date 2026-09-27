/**
 * Shared physical constants and helpers (spec docs/research/00-synthesis.md §0.3). One saturation vapour pressure
 * formula (Bolton 1980) is used app-wide. `stableNight()` (spec §5.2a) is added by the fuel/moisture module owner.
 */
import { clamp } from './units';

export const G = 9.81;
export const CP = 1005;
export const RD = 287.0;
export const KAPPA_VK = 0.4;
export const SIGMA_SB = 5.67e-8;
export const LV = 2.5e6;
export const RCP = 0.2857;
/** AFDRS default heat yield (kJ/kg) [V doc 03 §3.1]. */
export const HEAT_YIELD_KJ_PER_KG = 18600;
/** Reference air density (kg/m³) for ember terminal velocities (spec §9). */
export const RHO_REF = 1.1;

/** Saturation vapour pressure (hPa) over water, Bolton (1980). */
export const esat = (tC: number): number => 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
/** Relative humidity (%) from temperature and dew point (°C). */
export const rhFromTd = (tC: number, tdC: number): number => clamp((100 * esat(tdC)) / esat(tC), 0, 100);
/** Dew point (°C) from temperature (°C) and RH (%): exact inverse of esat. */
export function dewPointC(tC: number, rh: number): number {
  const g = Math.log(((clamp(rh, 0.1, 100) / 100) * esat(tC)) / 6.112);
  return (243.5 * g) / (17.67 - g);
}
/** ISA pressure (hPa) at altitude z (m). */
export const pressureIsa = (zM: number): number => 1013.25 * (1 - 2.25577e-5 * zM) ** 5.25588;
/** Exner function Π = (p/1000)^(R/cp). */
export const exner = (pHpa: number): number => (pHpa / 1000) ** RCP;
/** Potential temperature (K). */
export const theta = (tC: number, pHpa: number): number => (tC + 273.15) / exner(pHpa);
/** Dry-air density (kg/m³). */
export const airDensity = (tC: number, pHpa: number): number => (pHpa * 100) / (RD * (tC + 273.15));
export const logistic = (g: number): number => 1 / (1 + Math.exp(-g));
/** Vapour pressure deficit (kPa). */
export const vpdKpa = (tC: number, rh: number): number => Math.max(0, esat(tC) * (1 - rh / 100)) / 10;
/** Local mean solar time (hours 0–24) at longitude lonDeg for unix ms. */
export const lmstHour = (ms: number, lonDeg: number): number => (((ms / 3.6e6 + lonDeg / 15) % 24) + 24) % 24;

/**
 * Local calendar date 'yyyy-mm-dd' for NSW data (spec §0.2): the UTC calendar date of ms + 12 h. This maps both
 * NPWS date conventions (00:00Z = that date; 13:00Z/14:00Z = local midnight of the next date) to the intended date.
 */
export function localDate(ms: number): string {
  return new Date(ms + 12 * 3.6e6).toISOString().slice(0, 10);
}

/** Fire season of a unix ms time: local year − 1 for local months before July (spec §0.2). */
export function season(ms: number): number {
  const d = localDate(ms);
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m < 7 ? y - 1 : y;
}
