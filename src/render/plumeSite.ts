/**
 * The fire's plume as a site for the detailed streaks' eddies (0.7.0, E2; docs/plans/0.7.0/D-CONTRACT-070-detail-looks.md section 2.2): where the
 * intensity-weighted centre of the fire is, how big the plume's base is and how strong it is. Display only: it reads the picture of the fire that is
 * already on screen and decides nothing about the fire. Pure (no Three, no DOM), unit-tested (plumeSite.test.ts).
 */
import type { Plume } from './wind/glyphTypes';

/** The fireline intensity (kW/m) at which a plume counts as full strength. */
export const PLUME_FULL_KW_M = 20_000;
/** The radius (m) of a plume's base at no strength, and what each unit of strength adds. */
const BASE_RADIUS_M = 30;
const RADIUS_PER_STRENGTH_M = 90;

/** No plume: one frozen list, so a layer told "none" twice is told the same object. */
export const NO_PLUMES: readonly Plume[] = Object.freeze([]);

/** The plume of a fire's centre (`fireCentroid`): none without a fire or without any intensity; strength 0 to 1 from the hottest cell, radius 30 to 120 m. */
export function plumeSites(centre: { x: number; y: number; maxIntensity: number } | null): readonly Plume[] {
  if (!centre || !(centre.maxIntensity > 0)) return NO_PLUMES;
  const strength = Math.min(1, centre.maxIntensity / PLUME_FULL_KW_M);
  return [{ x: centre.x, y: centre.y, radiusM: BASE_RADIUS_M + RADIUS_PER_STRENGTH_M * strength, strength }];
}
