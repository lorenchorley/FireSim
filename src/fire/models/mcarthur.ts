/**
 * McArthur Mk5 Forest Fire Danger Meter and FFDI (spec §6.4) [V FFDI (Arndt 2018 note, eq 1); K rest, Noble et al. 1980].
 *
 * ```
 * FFDI = 2·exp(−0.450 + 0.987·ln DF − 0.0345·RH + 0.0338·T + 0.0234·U10)
 * R = 0.0012·FFDI·W km/h (flat; W = total fine load t/ha);  Z = 13R + 0.24W − 2 (m);  S = max(0, R(4.17 − 0.033W) − 0.36) km
 * ```
 * Legacy NSW FFDI bands are display-only (the displayed rating is the AFDRS FBI, D41).
 */

/** Forest Fire Danger Index (T °C, RH %, U10 km/h, DF 0–10). */
export function ffdi(tC: number, rh: number, u10kmh: number, df: number): number {
  if (!(df > 0)) return 0;
  return 2 * Math.exp(-0.45 + 0.987 * Math.log(df) - 0.0345 * rh + 0.0338 * tC + 0.0234 * u10kmh);
}

export interface Mk5Result {
  /** Flat head ROS (m/h). */
  rosMh: number;
  /** Flame height Z (m), ≥ 0. */
  flameHeight: number;
  /** Spotting distance S (km), ≥ 0. */
  spottingKm: number;
}

/** McArthur Mk5 rate, flame height and spotting distance from FFDI and the total fine fuel load W (t/ha) [K]. */
export function mk5(ffdiValue: number, wTha: number): Mk5Result {
  const r = 0.0012 * ffdiValue * wTha;
  return {
    rosMh: 1000 * r,
    flameHeight: Math.max(0, 13 * r + 0.24 * wTha - 2),
    spottingKm: Math.max(0, r * (4.17 - 0.033 * wTha) - 0.36),
  };
}

/** Legacy NSW FFDI bands (display only) [V AFDRS-RP Table 2.4]. */
export function legacyFfdiRating(ffdiValue: number): string {
  if (ffdiValue >= 100) return 'Catastrophic';
  if (ffdiValue >= 75) return 'Extreme';
  if (ffdiValue >= 50) return 'Severe';
  if (ffdiValue >= 25) return 'Very High';
  if (ffdiValue >= 12) return 'High';
  return 'Low–Moderate';
}
