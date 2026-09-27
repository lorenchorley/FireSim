/**
 * AFDRS maximum spotting distance and its monotone envelope (spec §6.10) [V FBI-TG eq 3.51; envelope D29].
 * ```
 * S_raw(R) = |176.969·atan(FHS_s)·(R/U10^0.25)^0.5 + 1568800·FHS_s^−1·(R/U10^0.25)^−1.5 − 3015.09|   (m; R m/h)
 * S(R) = R < 150 ? 50 : R < 1000 ? 50 + (S_raw(1000) − 50)(R − 150)/850 : max(S_raw(R), S_raw(1000))
 * ```
 * Used as `spottingDistance`, as the ember calibration target (§9.7) and on the spotting cards.
 */
import { FIRE_MODEL_PARAMS } from './params';

const SP = FIRE_MODEL_PARAMS.spotting;

/** The raw FBI-TG fit (m). Non-monotone below ≈ 1000 m/h: use {@link spottingEnvelope}. */
export function spottingRaw(rosMh: number, u10kmh: number, fhsS: number): number {
  const u = u10kmh > SP.u10Min ? u10kmh : SP.u10Min;
  const f = fhsS > SP.fhsMin ? fhsS : SP.fhsMin;
  const x = rosMh / Math.pow(u, 0.25);
  if (!(x > 0)) return SP.shortRange;
  return Math.abs(176.969 * Math.atan(f) * Math.sqrt(x) + (1568800 / f) * Math.pow(x, -1.5) - 3015.09);
}

/** Monotone spotting envelope S(R) (m) for head ROS R (m/h), U10 (km/h) and surface FHS. */
export function spottingEnvelope(rosMh: number, u10kmh: number, fhsS: number): number {
  if (!(rosMh >= SP.rosMin)) return SP.shortRange;
  const s1000 = spottingRaw(SP.rosFit, u10kmh, fhsS);
  if (rosMh < SP.rosFit) return SP.shortRange + ((s1000 - SP.shortRange) * (rosMh - SP.rosMin)) / (SP.rosFit - SP.rosMin);
  const s = spottingRaw(rosMh, u10kmh, fhsS);
  return s > s1000 ? s : s1000;
}
