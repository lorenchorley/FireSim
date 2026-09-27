/**
 * Fuel hazard ↔ fuel load conversions (spec §4.5 bark step table, §4.6).
 *
 * - OFHAG rating → hazard score (FHS) [V AFDRS-RP Table 4.3].
 * - FHS → load (t/ha) [UNVERIFIED: Tolhurst workbook via FBCR, doc 03 §3.12; §16 item 4]: piecewise linear through
 *   (0, 0) and the table points. `fhsFromLoad` is the inverse of the same polyline and is used only for user-entered
 *   loads (D15) and for catalogue classes whose LUT row gives loads but no FHS maxima.
 * - Bark hazard from bark load: operational step table [V PyroXL `fl_to_fhs`].
 * - Litter depth → load: 0.4 t/ha per mm [V doc 05 §2.1].
 */

export type HazardLayer = 'surface' | 'nearSurface' | 'elevated' | 'bark';
export type OfhagRating = 'Low' | 'Moderate' | 'High' | 'Very High' | 'Extreme';

export const OFHAG_RATINGS: readonly OfhagRating[] = ['Low', 'Moderate', 'High', 'Very High', 'Extreme'];

/** Rating → FHS for surface / near-surface / elevated, and for bark [V AFDRS-RP Table 4.3]. */
const RATING_FHS = [1, 2, 3, 3.5, 4] as const;
const RATING_FHS_BARK = [0, 1, 2, 3, 4] as const;

/** Rating → load (t/ha) per layer [UNVERIFIED Tolhurst workbook, §4.6 table]. */
const RATING_LOAD: Record<HazardLayer, readonly number[]> = {
  surface: [4, 8, 12, 14, 20],
  nearSurface: [1, 2, 3, 3.5, 4],
  elevated: [1, 2, 3, 4, 6],
  bark: [0, 1, 2, 5, 7],
};

/** Polylines (FHS, load) through (0, 0) and the table points, per layer. Strictly increasing in both coordinates. */
interface Polyline {
  fhs: Float64Array;
  load: Float64Array;
}

function polyline(layer: HazardLayer): Polyline {
  const fhsPts = layer === 'bark' ? RATING_FHS_BARK : RATING_FHS;
  const loads = RATING_LOAD[layer];
  const f: number[] = [0];
  const l: number[] = [0];
  for (let r = 0; r < fhsPts.length; r++) {
    // Skip a point equal to the origin (bark "Low" = FHS 0, load 0).
    if (fhsPts[r] === 0 && loads[r] === 0) continue;
    f.push(fhsPts[r]!);
    l.push(loads[r]!);
  }
  return { fhs: Float64Array.from(f), load: Float64Array.from(l) };
}

const POLY: Record<HazardLayer, Polyline> = {
  surface: polyline('surface'),
  nearSurface: polyline('nearSurface'),
  elevated: polyline('elevated'),
  bark: polyline('bark'),
};

function interp(xs: Float64Array, ys: Float64Array, x: number): number {
  const n = xs.length;
  if (!(x > xs[0]!)) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let i = 1;
  while (xs[i]! < x) i++;
  const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!);
}

/** OFHAG rating → hazard score of a layer [V AFDRS-RP Table 4.3]. */
export function fhsFromRating(layer: HazardLayer, rating: OfhagRating): number {
  const r = OFHAG_RATINGS.indexOf(rating);
  if (r < 0) throw new Error(`unknown OFHAG rating '${rating}'`);
  return layer === 'bark' ? RATING_FHS_BARK[r]! : RATING_FHS[r]!;
}

/**
 * Load (t/ha) of a layer at hazard score `fhs` (clamped to 0–4): piecewise linear through (0, 0) and the §4.6 table.
 * `loadFromFhs('surface', 3.25) = 13.0`.
 */
export function loadFromFhs(layer: HazardLayer, fhs: number): number {
  const p = POLY[layer];
  const f = fhs < 0 ? 0 : fhs > 4 ? 4 : fhs;
  return interp(p.fhs, p.load, f);
}

/**
 * Hazard score (0–4) of a user-entered load (D15): inverse polyline for surface / near-surface / elevated; the
 * operational step table for bark (`barkHazardFromLoad`). Loads beyond the Extreme point give 4.
 */
export function fhsFromLoad(layer: HazardLayer, load: number): number {
  if (layer === 'bark') return barkHazardFromLoad(load);
  if (!(load > 0)) return 0;
  const p = POLY[layer];
  return interp(p.load, p.fhs, load);
}

/** Bark hazard from bark fine fuel load: ≤0 → 0, ≤1 → 1, ≤2 → 2, ≤5 → 3, >5 → 4 [V PyroXL `fl_to_fhs`]. */
export function barkHazardFromLoad(barkLoad: number): number {
  if (!(barkLoad > 0)) return 0;
  if (barkLoad <= 1) return 1;
  if (barkLoad <= 2) return 2;
  if (barkLoad <= 5) return 3;
  return 4;
}

/** Litter (surface) load from measured litter depth: 0.4 t/ha per mm, 4 t/ha ≈ 1 cm [V doc 05 §2.1]. */
export const loadFromLitterDepthMm = (depthMm: number): number => 0.4 * Math.max(0, depthMm);

/** Nearest OFHAG rating name of a hazard score (for display). Bark uses its own scale. */
export function ratingFromFhs(layer: HazardLayer, fhs: number): OfhagRating | 'None' {
  const pts = layer === 'bark' ? RATING_FHS_BARK : RATING_FHS;
  if (layer !== 'bark' && fhs < 0.5) return 'None';
  let best = 0;
  for (let r = 1; r < pts.length; r++) if (Math.abs(pts[r]! - fhs) < Math.abs(pts[best]! - fhs)) best = r;
  return OFHAG_RATINGS[best]!;
}
