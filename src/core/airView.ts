/**
 * What an AtmosphereView is and holds, asked through functions instead of by reading `nz`, `layout`, `kind` or `levels`
 * directly (pure; workstream C of docs/plans/air-slice-wind-detail-honest-speed.md, §7.4). The optional fields of
 * AtmosphereView are absent from views made before they existed (test fixtures, the 2-D mock, older producers), and
 * these helpers give those views their old meaning:
 *   layout  undefined → 'flat'
 *   kind    undefined → `nz > 0 ? 'prognostic' : 'surface'`
 *   baseM   undefined → the caller supplies the datum (SceneView estimates it today)
 */
import type { AtmosphereView } from './types';

/**
 * 'prognostic': the time-stepped 3-D air (standard and high tiers: wind, temperature and smoke). 'diagnosed': the fast
 * tier's terrain fit of the forecast wind (wind only). 'surface': only the 10 m wind on the atmosphere grid (`nz` = 0, the
 * fast tier before it publishes a volume). 'none': there is no view at all.
 */
export type AirKind = 'prognostic' | 'diagnosed' | 'surface' | 'none';

export type AirLayout = 'flat' | 'terrain-following';

/** A 3-D field a consumer may want: the three wind components, the temperature anomaly, the smoke concentration. */
export type AirField = 'wind' | 'theta' | 'smoke';

export function airKind(view: Pick<AtmosphereView, 'nz' | 'kind'> | null | undefined): AirKind {
  if (!view) return 'none';
  return view.kind ?? (view.nz > 0 ? 'prognostic' : 'surface');
}

export function airLayout(view: Pick<AtmosphereView, 'layout'> | null | undefined): AirLayout {
  return view?.layout ?? 'flat';
}

/**
 * True when the field's array really holds a value for every column and level. An empty array must never reach an
 * interpolation: the fast tier's view has no temperature or smoke array, and reading one gives NaN.
 */
export function airHas(
  view: Pick<AtmosphereView, 'grid' | 'nz' | 'u' | 'v' | 'w' | 'thetaAnomaly' | 'smoke'> | null | undefined,
  field: AirField,
): boolean {
  if (!view || view.nz <= 0) return false;
  const n = view.grid.nx * view.grid.ny * view.nz;
  if (n <= 0) return false;
  switch (field) {
    case 'wind':
      return view.u.length >= n && view.v.length >= n && view.w.length >= n;
    case 'theta':
      return view.thetaAnomaly.length >= n;
    case 'smoke':
      return view.smoke.length >= n;
  }
}

/** True when the view carries a 3-D wind a slice or a glyph can sample (prognostic or diagnosed). */
export function hasAirWind(view: Pick<AtmosphereView, 'grid' | 'nz' | 'u' | 'v' | 'w' | 'thetaAnomaly' | 'smoke'> | null | undefined): boolean {
  return airHas(view, 'wind');
}

/**
 * Height (m ASL) of the centre of level `level` in horizontal column `column` (`j · nx + i`), for either layout.
 * Flat: `baseM + levels[level]`. Terrain-following: `baseM + h0 + levels[level] · J`, `h0` the terrain above the datum
 * and `J = 1 − h0 / topM` (a view without `topM` is taken as `J = 1`).
 * `baseM` defaults to the view's own datum, or 0 for a view made before `baseM` existed: pass the estimate then.
 */
export function cellHeightAsl(
  view: Pick<AtmosphereView, 'levels' | 'terrainHeight' | 'layout' | 'topM' | 'baseM'>,
  column: number,
  level: number,
  baseM: number = view.baseM ?? 0,
): number {
  const lv = view.levels[level]!;
  if (airLayout(view) === 'flat') return baseM + lv;
  const h0 = view.terrainHeight[column]!;
  const top = view.topM;
  const J = top !== undefined && top > 0 ? 1 - h0 / top : 1;
  return baseM + h0 + lv * J;
}

/** The air counts as noticeably older than the picture it is shown with beyond this age (s): the footer then says how much. */
export const AIR_STALE_S = 90;

/**
 * Simulation time (s) of the air a view holds, so a picture can say "air from 14:05", or null for a view that does not say
 * (made before the stamp existed) or no view at all.
 */
export function airTime(view: Pick<AtmosphereView, 'time'> | null | undefined): number | null {
  const t = view?.time;
  return t !== undefined && Number.isFinite(t) ? t : null;
}

/**
 * How much older the air is than the picture it is shown with (s, never negative), or null when the view has no time.
 * Scrubbing back composes the picture from the keyframe at or before the shown time, up to a keyframe interval older
 * (snapshotStore.ts), so the air can be minutes older than the fire; the slice footer says so beyond AIR_STALE_S.
 */
export function airAgeS(view: Pick<AtmosphereView, 'time'> | null | undefined, shownTimeS: number): number | null {
  const t = airTime(view);
  return t === null ? null : Math.max(0, shownTimeS - t);
}
