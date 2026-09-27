/**
 * Vesta 2012 (Cheney et al. 2012) as used by the AFDRS forest model at launch (spec §6.3) [V FBI-TG §3.3.5].
 * Used for the AFDRS-parity FBI (D41) and as a comparison model; the spread itself uses Vesta Mk2.
 *
 * ```
 * U = U10·3/WRF ;  s' = FHS_s·FA ; ns' = FHS_ns·FA ;  H = min(H_ns_cm, 20)      FA = 0.1·DF (dry)
 * R0 = U ≤ 5 ? 30 : 30 + 1.5308(U − 5)^0.8576·s'^0.9301·(ns'·H)^0.6366·1.03
 * ROS = R0·φ ;  φ = 2.31 (M ≤ 4), 18.35·M^−1.495 (4 < M ≤ 20), 0 (M > 20)
 * ```
 */

/** Vesta 2012 moisture function φ (normalised to 1 at M = 7 %) [V FBI-TG eq 3.47]. */
export function vesta2012PhiM(mPct: number): number {
  if (mPct <= 4) return 2.31;
  if (mPct > 20) return 0;
  return 18.35 * Math.pow(mPct, -1.495);
}

/** No-moisture Vesta 2012 rate R0 (m/h) at 10 m wind `u10` (km/h). `hNsCm` is the near-surface height in cm. */
export function vesta2012R0(u10: number, fhsS: number, fhsNs: number, hNsCm: number, fa: number, wrf: number): number {
  const u = (u10 * 3) / wrf;
  if (!(u > 5)) return 30;
  const s = fhsS * fa;
  const ns = fhsNs * fa;
  const h = Math.min(hNsCm, 20);
  if (!(s > 0) || !(ns * h > 0)) return 30;
  return 30 + 1.5308 * Math.pow(u - 5, 0.8576) * Math.pow(s, 0.9301) * Math.pow(ns * h, 0.6366) * 1.03;
}

/** Vesta 2012 head ROS (m/h, flat). */
export const vesta2012Ros = (u10: number, fhsS: number, fhsNs: number, hNsCm: number, mPct: number, fa: number, wrf: number): number =>
  vesta2012R0(u10, fhsS, fhsNs, hNsCm, fa, wrf) * vesta2012PhiM(mPct);
